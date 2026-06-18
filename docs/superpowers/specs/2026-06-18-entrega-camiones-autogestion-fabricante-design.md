# Entrega de camiones (la cajita viaja con el camión) + autogestión del fabricante

**Fecha:** 2026-06-18
**Estado:** Diseño aprobado — pendiente de plan de implementación

## Problema

La gestión de dispositivos y vehículos es difícil de entender y operar, incluso para CMG (que hoy lo hace todo en nombre de fabricantes y clientes). Tres focos de fricción confirmados:

1. **Dos páginas.** Montar/desvincular la cajita se hace en *Dispositivos* y el vehículo se gestiona aparte en *Flota*.
2. **Conceptos/roles.** Distinguir fabricante / cliente / subcliente y "qué ve cada uno" es confuso.
3. **Flujo de venta/reasignación.** Al entregar un camión a su cliente, el modelo actual deja la cajita con el fabricante (`device.tenant_id` no cambia), lo que genera el caso confuso "el cliente ve el camión en Flota pero no la cajita en Dispositivos".

## Objetivos

- Que la cajita **pertenezca a quien posee el camión** y se mueva con él automáticamente.
- Que el día a día de CMG sea de **acciones de un clic** (alta con equipo, entrega a cliente).
- Que un fabricante, **si CMG le concede permiso**, pueda autogestionar aguas abajo (crear sus clientes y traspasar/recuperar sus camiones) sin depender de CMG.
- Reducir la carga conceptual con etiquetas claras.

## No-objetivos (YAGNI)

- El fabricante **no** crea camiones nuevos ni monta/desvincula dispositivos (eso sigue siendo de CMG).
- No se fusionan las páginas *Dispositivos* y *Flota* (se mantiene *Dispositivos* como inventario de stock + consumo SIM + diagnóstico + fuera de servicio).
- No se añade visibilidad de la "tarjeta de dispositivo" para el fabricante tras la venta (conserva acceso técnico **a nivel de vehículo**, que es lo relevante para soporte). Revisable más adelante.

## Modelo conceptual (regla única)

> **La cajita pertenece a quien posee el camión.** El fabricante que lo construyó conserva acceso técnico de por vida, pero ya no "posee" el equipo.

- `device.tenant_id` deja de gestionarse a mano: **sigue siempre a `vehicle.tenant_id`** del vehículo donde está montada.
- `vehicle.manufacturer_tenant_id` (ya existe) no cambia nunca → da al fabricante acceso técnico de por vida vía `assert_can_access_vehicle` nivel 4.

Roles:
- **CMG** — dueños de todo; dan de alta camiones y los entregan a fabricante o cliente.
- **Fabricante** (p. ej. VPS) — "constructor con acceso técnico de por vida".
- **Cliente final** (p. ej. Delimex) — "dueño y operador".

## Cambios en el modelo de datos

Migración **056** (additive): dos columnas booleanas en `tenant`, siguiendo el patrón de los flags de fabricante ya existentes (`manufacturer_can_view_operations`, `manufacturer_can_view_can_data`, `manufacturer_can_create_rules`):

- `manufacturer_can_manage_clients BOOLEAN NOT NULL DEFAULT false`
- `manufacturer_can_transfer_vehicles BOOLEAN NOT NULL DEFAULT false`

⚠️ **Cambio de comportamiento:** hoy un fabricante admin puede crear clientes y reasignar **sin** flag. Con el default `false`, dejará de poder hasta que CMG lo active. Aceptable en fase de pruebas. Requiere confirmación explícita antes de aplicar la migración (producción).

## Cambios en backend

### 1. La entrega mueve la cajita (`POST /vehicles/{id}/reassign`)
- Tras cambiar `vehicle.tenant_id`, **mover también el dispositivo montado**: si existe `Device` con `vehicle_id == vehicle.id` y `active`, poner `device.tenant_id = target_tenant_id`. El `vehicle_id` no cambia (sigue montada).
- El resto de pasos actuales se mantienen: desactivar alert rules específicas del tenant anterior, revocar `permission_grant` del vehículo, migrar `MaintenancePlan.tenant_id`.
- Ampliar `VehicleReassignOut` con info del dispositivo movido (p. ej. `device_imei: str | None`, `device_moved: bool`) para el resumen en UI.

### 2. Gating del traspaso por fabricante
- En `reassign_vehicle`, cuando `user.tenant_tier == "manufacturer"`: exigir además `tenant.manufacturer_can_transfer_vehicles == True` (del propio tenant del fabricante). Si no, 403.
- CMG sigue sin restricción. La lógica de ámbito existente se mantiene (el fabricante solo actúa sobre vehículos con `manufacturer_tenant_id == su tenant`, y destino = su tenant **o** sus clientes `parent_manufacturer_id == su tenant`). Esto cubre tanto **entregar** (destino = cliente) como **recuperar** (destino = su propia flota).

### 3. Gating de creación de clientes por fabricante (`POST /tenants`)
- En `create_tenant`, cuando `user.tenant_tier == "manufacturer"`: exigir `tenant.manufacturer_can_manage_clients == True`. Si no, 403.
- Igual para creación de usuarios de esos clientes (`POST /tenants/{id}/users`) si el actor es fabricante: el `assert_can_manage_tenant` debe respetar el flag.

### 4. Sin cambios
- `PATCH /devices/{id}/transfer` (stock sin montar, destinos cmg/manufacturer) se mantiene igual.
- `PATCH /devices/{id}/vehicle` (montaje) se mantiene; la regla `mfr_cross` sigue siendo válida.

### Consecuencia de visibilidad (intencionada)
- Tras la entrega a Delimex: la cajita pasa a `device.tenant_id = Delimex` → Delimex la ve en su *Dispositivos*; el fabricante deja de verla ahí pero conserva acceso técnico al **vehículo** (telemetría/CAN). CMG ve todo.

## Cambios en frontend

### A. Alta de camión con equipo (CMG) — texto
El formulario de alta ya monta la cajita por IMEI. Solo afinar etiquetas para dejar claro "alta del camión **con** su equipo". Sin cambio estructural.

### B. Botón/modal "Entregar / Traspasar" (antes "Reasignar")
- Renombrar **Reasignar → Entregar/Traspasar** en `VehiclesPage` (y donde aplique).
- Resumen antes/después en el resultado: Dueño origen→destino, IMEI de la cajita movida, nº de alertas desactivadas, nº de permisos reajustados, y nota "El fabricante <X> conserva acceso técnico".
- Sirve en ambos sentidos (entregar a cliente / recuperar a flota del fabricante) según los destinos ya permitidos.

### C. Autogestión del fabricante (según flags)
- Con `manage_clients`: el fabricante ve la sección **Clientes** (hoy oculta a no-CMG en el sidebar) y puede crear sus clientes/usuarios (solo bajo él).
- Con `transfer_vehicles`: el fabricante ve el botón **Entregar/Traspasar** en sus camiones (solo entre su flota y sus clientes).
- Sin flag: ni una cosa ni la otra (estado por defecto).
- Para el gating de UI, exponer ambos flags en el payload de `/auth/me` (perfil del usuario), de modo que el frontend los tenga al cargar sin pedir el tenant aparte.

### D. Interruptores (CMG)
En la edición de un tenant **fabricante**, dos casillas junto a los flags de fabricante existentes:
- ☐ Puede gestionar sus clientes (`manufacturer_can_manage_clients`)
- ☐ Puede traspasar vehículos a sus clientes (`manufacturer_can_transfer_vehicles`)

### E. Conceptos/etiquetas
- Columnas **Dueño** y **Fabricante** claras en Flota.
- Lenguaje consistente: "Fabricante = acceso técnico de por vida", "Cliente = dueño y operador".

## Matriz de permisos (resumen)

| Acción | CMG admin | Fabricante admin | Cliente admin |
|---|---|---|---|
| Crear camión + montar cajita | ✅ | ❌ | ❌ |
| Entregar/recuperar camión (mueve cajita) | ✅ (cualquiera) | ✅ solo sus camiones↔sus clientes, **si** `transfer_vehicles` | ❌ |
| Crear sus clientes/usuarios | ✅ | ✅ bajo él, **si** `manage_clients` | ❌ |
| Ver camión en vivo | ✅ | ✅ (los que fabricó) | ✅ (los suyos) |

Se respeta la "regla de hierro": el fabricante nunca actúa fuera de su ámbito (`manufacturer_tenant_id` propio, clientes con `parent_manufacturer_id` propio).

## Manejo de errores / casos límite

- Vehículo **sin** dispositivo al entregar → no hay cajita que mover; el resto del flujo es igual.
- Vehículo con **orden de trabajo abierta** → 409 (candado actual, se mantiene).
- Fabricante sin el flag correspondiente → 403 con mensaje claro.
- Entregar a un destino fuera de ámbito (cliente ajeno) → 403 (lógica actual).

## Testing

- Backend (pytest, estilo `test_vehicle_reassignment.py` con mocks):
  - La entrega mueve `device.tenant_id` al destino (con y sin dispositivo montado).
  - Fabricante con/sin `transfer_vehicles` → 200 / 403.
  - Fabricante con/sin `manage_clients` crea cliente → 201 / 403.
  - Recuperar (destino = flota del fabricante) funciona.
  - Regresión: CMG sigue reasignando sin flags.
- Frontend: `tsc -b` limpio; verificación manual de visibilidad por flags.

## Despliegue / orden

1. Migración 056 (additive) — con confirmación explícita; en producción vía `docker-compose run --rm --no-deps core-api alembic ... upgrade head` (ver memoria de deploy).
2. Backend (core-api): reassign mueve cajita + gating. Swap con `docker run` (recipe).
3. Frontend: interruptores, modal renombrado + resumen, acceso por flags. Rebuild + swap.
4. Tests verdes antes de cada swap.

## Decisiones por defecto (cerradas)

- Flags **a `false` por defecto** (el fabricante no autogestiona hasta que CMG lo active). Aprobado.
- Renombrar "Reasignar" → "Entregar/Traspasar". Aprobado.
- Dos flags separados (`manage_clients`, `transfer_vehicles`). Aprobado.
- La "tarjeta de dispositivo" sigue al dueño; el fabricante conserva acceso técnico a nivel de vehículo (no se añade visibilidad de dispositivo para el fabricante). Decisión de diseño, revisable.
