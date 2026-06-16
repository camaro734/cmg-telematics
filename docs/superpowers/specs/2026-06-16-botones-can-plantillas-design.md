# Configuración de botones CAN en plantillas + permisos por rol

**Fecha:** 2026-06-16
**Autor:** Carlos (CMG) + Claude
**Estado:** Aprobado — pendiente de plan de implementación

## Contexto

La comunicación **FMC650 → CR2530** (PLC) ya funciona: el FMC650 envía comandos
Codec 12 (`setparam {param_id}:{hex}`) que ponen bytes en el bus CAN hacia el
CR2530, el cual acciona sus salidas. La lectura inversa (CR2530 → FMC, sensores)
no se toca en este trabajo.

Hoy los botones de control (`manual_can_button`) y los slots
(`vehicle_manual_can_slot`, con el `param_id` que mapea al mensaje CAN) se
configuran **por vehículo** desde la ficha del vehículo. Los permisos para
pulsar están hardcodeados a `admin`/`operator`, sin granularidad.

## Objetivo

Llevar la configuración de slots + botones + su función a las **plantillas**
(`vehicle_type`, página `/tipos-vehiculo`, solo CMG admin), heredada por todos
los vehículos del tipo, y añadir **permisos por rol configurables por botón**.

## Decisiones tomadas (brainstorming)

1. **Ámbito:** slots y botones se definen en la **plantilla** (`vehicle_type`);
   todos los vehículos del tipo los heredan. Una sola fuente de verdad.
2. **Qué se mueve:** toda la config CAN-salida (slots + `param_id` + botones).
   Asume cableado/param_id homogéneo entre vehículos del mismo tipo.
3. **Permisos:** lista de roles permitidos **por botón** (`allowed_roles`).
   `admin` siempre puede pulsar, esté o no en la lista.
4. **Funciones del botón:**
   - `toggle` (enclavado): clic alterna ON↔OFF y se mantiene.
   - `hold` (mantener pulsado): pulsar → ON; soltar → OFF. Dirigido por el
     frontend. La seguridad última recae en el cableado/CR2530.
5. **Estado runtime** (qué salida está ON ahora): se queda **por vehículo**.
6. **UI ficha vehículo:** se quita la edición (slots/botones); queda solo el
   panel de **operación** (pulsar botones). Config solo en plantillas.
7. **Datos existentes:** empezar limpio. La plantilla arranca vacía; se
   reconfigura en la UI nueva. No se migran las definiciones por vehículo.

## Modelo de datos

### Plantilla (`vehicle_type`) — dos campos JSONB nuevos

Siguiendo el patrón de `dout_config` / `sensor_schema` (listas JSONB).

`manual_can_slots`:
```json
[{ "id": "uuid", "slot": 0, "param_id": 16002, "description": "Salidas hidráulicas" }]
```

`manual_can_buttons`:
```json
[{
  "id": "uuid",
  "slot_id": "uuid (→ manual_can_slots[].id)",
  "byte_index": 0,
  "bit_index": 0,
  "label": "Bomba",
  "function": "toggle | hold",
  "allowed_roles": ["admin", "operator", "driver"],
  "sort_order": 0,
  "active": true
}]
```

Validaciones: `slot` 0–9, `byte_index`/`bit_index` 0–7, unicidad
(`slot`, `byte_index`, `bit_index`) dentro de la plantilla, `param_id` > 0,
`allowed_roles` ⊆ {admin, operator, driver, viewer}.

### Estado runtime (por vehículo)

El bitmask actual de cada slot se guarda en **Redis**:
`vehicle:{vehicle_id}:can_outputs` (hash, campo = nº de slot → 8 bytes hex).
Consistente con la persistencia de DOUT.

> **A verificar antes de implementar:** si el restore-on-reconnect del
> ingest-svc lee `vehicle_manual_can_slot.current_value` de BD. Si lo usa, hay
> que mantener también ese espejo o adaptar el restore — **sin tocar la lógica
> TCP del ingest sin OK explícito de Carlos**.

## Backend

### Migración Alembic 053
- Añade `manual_can_slots` y `manual_can_buttons` (JSONB, `server_default "[]"`,
  `default=list`) a `vehicle_type`.
- **No** borra las tablas `vehicle_manual_can_slot` / `manual_can_button`
  (se dejan inertes por seguridad; limpieza posterior si procede).

### CRUD de configuración
- `PATCH /vehicle-types/{type_id}/manual-can` — **solo CMG admin** (mismo gating
  que `/sensor-schema`). Body con `manual_can_slots` y `manual_can_buttons`
  completos; valida rangos/unicidad/roles; `flag_modified` sobre los campos.

### Endpoint de operación (toggle/hold) — reescritura
Ruta actual `POST /vehicles/{vehicle_id}/can-slots/{slot_id}/buttons/{button_id}/toggle`
(se mantiene la forma para no romper el panel de operación):
1. Carga `vehicle` + su `vehicle_type`; localiza el botón y el slot en los JSONB.
2. **Permiso:** `user.role in btn.allowed_roles` (admin siempre); además
   `assert_can_access_vehicle(..., operation="write")`.
3. Estado actual desde Redis (`vehicle:{id}:can_outputs`).
4. Calcula nuevo bitmask (mismo cálculo de bits que hoy).
5. Reusa el **flujo Codec 12 ya probado**: lock `command:{imei}:pending_response`,
   `publish` a `cmg:manual_can_commands`, `blpop` ack 18 s, `CommandLog`.
6. Tras ack OK, persiste el nuevo estado en Redis.

### Botones `hold` — prioridad del OFF (punto delicado, aprobado)
En un botón de mantener pulsado, ON (al pulsar) y OFF (al soltar) son dos
comandos seguidos. Si se suelta antes de que vuelva el ack del ON, el OFF
chocaría con el lock por dispositivo (409).

Resolución aprobada:
- El **ON** se confirma con el flujo síncrono normal.
- El **OFF de soltar tiene prioridad y reintenta hasta entrar** en el lock — el
  OFF nunca se pierde (la salida no queda colgada).
- El botón se **bloquea visualmente** hasta que el ON confirma.

Mecanismo concreto a cerrar en el plan (p. ej. parámetro `priority`/`reason` en
el endpoint que, para un OFF de seguridad, espera-y-reintenta el lock en vez de
devolver 409 inmediato).

### Listado para operación
`GET .../buttons` lee de la plantilla y devuelve **solo** los botones que el rol
del usuario puede pulsar, más su estado actual (desde Redis).

## Frontend

- **Nueva sección `ManualCanConfigSection`** en `VehicleTypesPage`
  (`/tipos-vehiculo`): editor de slots (slot/param_id/descr.) y botones
  (label, slot, byte, bit, función toggle/hold, checkboxes de `allowed_roles`,
  orden, activo). Mismo estilo que `DoutConfigSection`.
- **`ManualCanControl`** (ficha vehículo): filtra botones por rol; soporta:
  - `toggle`: clic alterna.
  - `hold`: `mousedown`/`touchstart` → ON; `mouseup`/`touchend` → OFF; OFF de
    seguridad también en `mouseleave`, `blur`, `visibilitychange` y desmontaje.
- **Se eliminan** `ManualCanButtonManager` y `ManualCanSlotManager` de
  `VehicleDetailPage` (la edición vive solo en plantillas).

## Producción / despliegue
- Servidor de producción, sin staging. La migración 053 y los despliegues
  (core-api, frontend) requieren **confirmación explícita** antes de ejecutar.
- Deploy frontend según procedimiento de `CLAUDE.md` (§DEPLOY).

## Fuera de alcance (YAGNI)
- Grupos exclusivos (radio) y controles multi-bit.
- Override de botones por vehículo (contradice "todo a la plantilla").
- Pulso temporizado por backend (sustituido por `hold` press/release).
- Borrado de las tablas relacionales antiguas (se difiere).
