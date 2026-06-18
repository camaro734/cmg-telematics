# Manual CAN — entrega diferida, reset por pulso confirmado y limpieza de UI

Fecha: 2026-06-18
Estado: aprobado (diseño)
Autor: CMG Dev + Claude

## Contexto y problema

El control "CAN Manual" (botones que actúan sobre el PLC CR2530 vía FMC650) muestra
"FMC Offline" y deshabilita los botones casi todo el tiempo cuando el vehículo está
parado. Causa raíz (ya investigada y confirmada en código):

- El botón se habilita solo si `connected === true` (`ManualCanControl.tsx:214`).
- `connected` viene de `GET /vehicles/{id}/fmc-status`, que comprueba la existencia de
  la clave Redis `ingest:conn:{imei}` (`vehicles.py:1944`) — es decir, un **socket TCP vivo**.
- El FMC650 usa patrón connect→send→disconnect: cierra el socket entre lotes
  (`server.py:135` borra `ingest:conn` al cerrar). Por eso la ventana en que
  `connected=true` es de segundos por ciclo, y con el vehículo parado puede tardar
  hasta el Max Period configurado (On Stop = 300 s ≈ 5 min) en volver a estar disponible.

Hoy, si el FMC no está conectado, el endpoint devuelve `503` y el comando se pierde.

Los botones momentáneos (`function: 'hold'`) **no activan salidas físicas**: sirven para
**poner a cero contadores de mantenimiento y horas de trabajo** en el PLC. Por eso un
pulso diferido es seguro y deseable.

## Objetivos

1. **Entrega diferida**: si el FMC está offline, encolar el comando y entregarlo cuando
   el dispositivo reconecte, en vez de fallar con `503`.
2. **Botones reset (`hold`) con doble confirmación**: clic → modal de confirmación →
   se envía un **pulso ON+OFF** (inmediato si online, diferido si offline).
3. **Feedback de entrega**: badge en el propio botón (`Encolado` → `Enviado OK`) + toast.
4. **Historial reciente solo para admin** dentro de `ManualCanControl`.
5. **Quitar el aviso rojo** `● FMC Online / ○ FMC Offline`.
6. **Quitar la pestaña vieja** "Historial de comandos e incidencias" de `VehicleDetailPage`.

## No objetivos (YAGNI)

- No se toca el protocolo Codec 8/8E/12 ni la lógica de ingreso de telemetría.
- No se añade caducidad a los comandos encolados (decisión explícita: persisten como DOUT).
- No se cambia el comportamiento de DOUT ni `_restore_dout_state`.
- No se añade integración WebSocket a `ManualCanControl` (el feedback se hace por polling).

## Enfoque elegido

**Replicar el patrón `_restore_dout_state`** (ya probado en producción). La API persiste
el comando pendiente en Redis y el ingest lo reproduce al reconectar. Descartadas: cola
FIFO genérica (reproduce estados intermedios obsoletos, necesita dedup) y BD como fuente
de verdad en el ingest (acopla ingest↔BD en la ruta de reconexión).

## Diseño detallado

### A. Estado de comando

`CommandLog.status` es `String(20)` libre (no enum Postgres) → **sin migración**.
Nuevo valor: `queued`.

Ciclo de vida diferido: `queued` → (al reconectar y recibir ACK del FMC) `confirmed`
(reutiliza el camino de confirmación actual vía `command:{imei}:last_log_id`).

### B. Backend — `send_manual_can_command` (`backend/app/api/v1/vehicles.py`)

Entrada extendida (`ManualCanCommandRequest`): añadir `mode: 'set' | 'pulse'`
(default `set` para no romper toggles existentes).

Flujo:
1. Auth + multi-tenant + lookup device + slot config: igual que hoy.
2. Construir `param_id` y valores hex (`01FFFFFFFFFFFFFF` / `00FFFFFFFFFFFFFF`).
3. Si **`ingest:conn:{imei}` existe (online)**:
   - `mode=set`: comportamiento actual (publica, BLPOP 18 s, confirma).
   - `mode=pulse`: enviar ON, esperar ACK, enviar OFF, esperar ACK — **una sola
     operación lógica bajo el mismo lock anti-concurrencia** (`command:{imei}:pending_response`).
     El OFF reintenta el lock como ya hace el OFF de hold hoy.
   - Responde `200` con el `CommandLog` resultante.
4. Si **no existe `ingest:conn` (offline)**:
   - Crear `CommandLog` con `status="queued"`.
   - Guardar el pendiente en Redis `vehicle:{vehicle_id}:manual_can_pending`
     (Hash o JSON), clave por `param_id`:
     `{ "<param_id>": {"type": "set"|"pulse", "value": bool, "log_id": "<uuid>"} }`.
     Repetir presses sobre el mismo `param_id` **sobrescribe** (gana el último).
   - **Sin TTL** (persiste hasta reconexión, como DOUT).
   - Responde `202 { "queued": true, "log_id": "<uuid>" }`.

El `503` por FMC desconectado deja de devolverse para Manual CAN (se sustituye por el `202`).

### C. Ingest — restore al reconectar (`services/ingest/src/server.py`)

En `_handshake`, tras `await self._restore_dout_state()` (línea ~198), añadir
`await self._restore_manual_can_state()`:

```
_restore_manual_can_state():
  pending = redis.get/hgetall(vehicle:{vehicle_id}:manual_can_pending)
  si vacío: return
  para cada (param_id, entry) [orden estable]:
    si type == "set":
      escribir codec12 setparam param_id:value_hex
    si type == "pulse":
      escribir codec12 setparam param_id:01...   (ON)
      escribir codec12 setparam param_id:00...   (OFF)
    enlazar command:{imei}:last_log_id = entry.log_id (TTL corto)
    -> el ACK del FMC dispara el camino de confirmación existente y marca CommandLog confirmed
  borrar vehicle:{vehicle_id}:manual_can_pending
```

Sigue el mismo estilo que `_restore_dout_state` (fire-and-forward al writer TCP activo).
Nota: la confirmación 1:1 con el ACK es best-effort; si llegan varios pendientes, se
reproducen secuencialmente para no solapar respuestas.

### D. Frontend — `ManualCanControl.tsx`

1. **Quitar** la query `fmc-status` (`:64-68`), la variable `connected` (`:79`) y el
   badge `● FMC Online / ○ FMC Offline` (`:185-190`).
2. **Botones siempre habilitados**: `disabled` pasa a depender solo de `loading`
   (para toggles en vuelo), no de `connected`.
3. **Botones `hold` → reset confirmado**:
   - Sustituir los handlers `onPointerDown/Up/Leave/Cancel` y el `useEffect` de OFF de
     seguridad (`:142-159`) por: `onClick` → abrir **modal de confirmación** → al aceptar
     `POST .../toggle { mode: 'pulse' }`.
   - Texto del modal: "Vas a enviar un dato al equipo (reset de contador/horas). ¿Confirmar?".
4. **Badge de entrega por botón**: estado derivado del último `CommandLog` del `param_id`
   del botón (consulta ligera polleada, disponible a todos los roles):
   - `queued` → chip ámbar "Encolado".
   - `confirmed` (tras estar `queued`) → chip verde "Enviado OK" + toast "Comando entregado al FMC".
5. **Historial reciente solo admin** (`:275-311`): envolver en `isAdmin` y poner
   `enabled: isAdmin` en la query `manual-can-history` (`:70-77`).
   `isAdmin = useAuthStore(s => s.user?.role === 'admin')`.

### E. Frontend — `VehicleDetailPage.tsx`

- Eliminar el bloque colapsable "Historial de comandos e incidencias" (`:479-525`):
  el `<div>` del botón toggle y el panel `showBottomPanel` (HISTORIAL DE COMANDOS +
  INCIDENCIAS).
- Eliminar el estado `showBottomPanel` si no se usa en otro punto.
- **Conservar** la query `commandHistory` (`:149-154`): la consume `ActivityDrawer`
  (`:643`). Verificar antes de borrar nada.

## Flujo de datos (reconexión con comando encolado)

```
Operador pulsa botón (FMC offline)
  → POST toggle  → API: status=queued, Redis vehicle:{id}:manual_can_pending, 202
  → Frontend: badge "Encolado" + toast "Encolado, se enviará al reconectar"

FMC reconecta (handshake)
  → ingest _restore_dout_state()  (sin cambios)
  → ingest _restore_manual_can_state(): reproduce pendientes (set / pulse ON+OFF)
  → FMC responde ACK → camino de confirmación marca CommandLog confirmed
  → Frontend (polling): badge "Enviado OK" + toast "Comando entregado al FMC"
  → Redis pending limpiado
```

## Manejo de errores

- FMC offline: ya no es error → `202 queued`.
- Lock anti-concurrencia ocupado (online): `409` como hoy.
- Slot/manual CAN no configurado: `404` como hoy.
- Si el FMC reconecta y el ACK del pendiente da WARNING/ERROR: `CommandLog.status="failed"`
  (reutiliza `is_fmc_error_response`), badge "Fallido" en el botón.
- Pendiente persiste sin TTL; se borra solo tras reproducirse en una reconexión.

## Pruebas

Backend (`backend/tests/`):
- `test_manual_can_queued_when_offline`: sin `ingest:conn` → `202`, `status=queued`,
  pending escrito en Redis (mock).
- `test_manual_can_pulse_online`: con conexión → envía ON y OFF, un solo lock.
- `test_manual_can_pending_overwrite`: dos presses mismo `param_id` → gana el último.

Ingest (`services/ingest/tests/` o equivalente):
- `test_restore_manual_can_state`: pending en Redis (mock) → escribe codec12 esperado
  (set y pulse), limpia la clave.

Frontend:
- Build TS sin errores.
- (Si hay tests) `ManualCanControl`: historial oculto sin admin; modal en `hold`;
  badge queued→OK.

## Riesgos / notas

- **Cambio de comportamiento visible**: los botones `hold` dejan de ser press-and-hold
  y pasan a clic+modal+pulso. Aprobado por el usuario.
- Confirmación 1:1 con el ACK en reconexión es best-effort si hay varios pendientes.
- Producción sin staging: validar con tests antes de desplegar; deploy frontend e ingest
  según procedimiento de CLAUDE.md.
