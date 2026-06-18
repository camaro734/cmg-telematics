# Dispositivo fuera de servicio (silenciar alerta de inactividad)

Fecha: 2026-06-18
Estado: aprobado (diseño)

## Problema

La alerta de sistema "Vehículo silencioso" (`services/rules-engine/src/silence.py`)
salta cuando un dispositivo deja de transmitir más de 2 h (ignición ON) o 72 h
(parado). Es la conducta deseada para equipos en servicio asignados a un cliente.

Pero cuando un equipo GPS se **desmonta** de un vehículo (reparación, retirada,
vehículo vendido) o se sabe que está parado, deja de transmitir a propósito y la
alerta de inactividad se vuelve ruido: vuelve a aparecer cada ~2 h aunque se
reconozca, porque el dedup del sweep solo busca alertas en estado `firing`.

Caso real que lo motivó: el vehículo de PRUEBA `ot1234` (device `864275075510100`),
parado desde el 2026-06-16, genera alertas de "vehículo silencioso" sin parar.

## Objetivo

Permitir marcar un **dispositivo** como "Fuera de servicio" para que no genere
alerta de inactividad, manteniéndolo visible y gestionable en la aplicación, y que
vuelva solo a vigilancia normal en cuanto se remonte y retome la transmisión.

## Decisiones de diseño (acordadas con el usuario)

1. **Modelo:** estado explícito del dispositivo, no un simple interruptor de alerta.
   Dos estados: *En servicio* (normal) / *Fuera de servicio* (desmontado).
2. **Reactivación:** automática. Al llegar el primer dato nuevo de un dispositivo
   *Fuera de servicio*, vuelve solo a *En servicio*.
3. **Vista de flota:** el vehículo asociado muestra un estado propio neutro/gris
   **"Equipo desmontado"**, distinto del rojo "Sin señal", para que se vea que es
   intencional y no un fallo.
4. **Quién:** solo admin (mismo gating que el resto de mutaciones de device).

## Enfoque técnico

Columna nueva en `device`, **no** reusar `device.active`. `active=false` ya
significa "dado de baja / oculto" en el sweep, los listados y la asignación;
mezclar ambos conceptos causaría regresiones. El estado nuevo es additive y
ortogonal: un device puede estar `active=true` y `out_of_service=true`.

## Diseño por capas

### 1. Datos — migración Alembic (additive)

Nueva migración tras la `022` vigente (numerar según el último head real):

```sql
ALTER TABLE device ADD COLUMN out_of_service BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE device ADD COLUMN out_of_service_since TIMESTAMPTZ NULL;
```

- Additive, sin backfill: todos los dispositivos arrancan *En servicio*.
- Es cambio de esquema en **producción** → requiere confirmación explícita del
  usuario antes de aplicar (`alembic upgrade head`).

### 2. Sweep de silencio — `services/rules-engine/src/silence.py`

En el `SELECT` de candidatos de `sweep_silent_vehicles` añadir el filtro:

```sql
AND d.out_of_service = false
```

Un dispositivo *Fuera de servicio* nunca entra en el barrido → no genera alerta.

### 3. Reactivación automática — ingest

En el punto del ingest donde ya se actualiza `device.last_seen` al recibir un
registro, si el device tiene `out_of_service = true`:

- `out_of_service = false`
- `out_of_service_since = NULL`

Reutiliza el flujo existente que ya resuelve el silencio al volver el dato
(análogo a `maybe_resolve_silence`). Misma lógica/idempotencia.

### 4. API — `backend/app/api/v1/devices.py`

- `PATCH /api/v1/devices/{id}` (ya existe, ya exige `role == "admin"`) acepta el
  campo `out_of_service` en su schema de entrada:
  - `true`  → sella `out_of_service_since = now()`; si hay alerta de silencio
    `firing` del vehículo asociado, la marca `resolved` y limpia la key Redis
    `silence:firing:{vehicle_id}`.
  - `false` → limpia `out_of_service_since` (reactivación manual).
- `DeviceOut` expone `out_of_service` y `out_of_service_since`.
- El estado se propaga al estado de flota: el bulk `GET /api/v1/vehicles/statuses`
  y el de detalle incluyen un indicador de "equipo desmontado" derivado del device
  vinculado, para que el frontend lo pinte sin una llamada extra.

### 5. Frontend

- **`/devices`** (`DevicesPage.tsx`):
  - Acción admin "En servicio ⟷ Fuera de servicio" por fila (toggle/botón siguiendo
    el patrón de los botones existentes).
  - La columna Estado (o una nueva) muestra "Fuera de servicio · desde DD/MM"
    cuando aplica.
- **Flota** (`VehiclesPage.tsx`, `FleetDashboard.tsx`, `staleStatus.ts`):
  - Nuevo estado neutro/gris **"Equipo desmontado"** con prioridad sobre el
    cálculo de offline (`isFresh`). Si el device está fuera de servicio, se muestra
    ese estado en vez de "Sin señal".
  - Color neutro (`--accent-off` / gris), nunca rojo.

### 6. Tests

- `silence.py`: un device `out_of_service` no produce alerta aunque supere el umbral.
- ingest: al recibir dato, un device `out_of_service` pasa a `in_service` y limpia
  el timestamp (idempotente si ya estaba en servicio).
- API `PATCH`: marcar `true` sella `out_of_service_since` y resuelve la alerta
  `firing`; marcar `false` limpia el timestamp.
- Frontend: la flota muestra "Equipo desmontado" (gris) y no "Sin señal" (rojo)
  cuando el device está fuera de servicio.

## Fuera de alcance (YAGNI)

- Estados adicionales (almacén, reparación) — de momento solo dos.
- Campo de motivo/nota libre — se puede añadir después si hace falta.
- Caducidad temporal automática — descartada a favor de reactivación por dato.

## Puntos de coherencia a respetar

- La lógica de elegibilidad del device (`active` y `out_of_service`) debe quedar
  alineada entre el sweep (`silence.py`) y cualquier consulta de estado de flota.
- Comentarios en español, código en inglés; type hints en Python; TS estricto.
- Filtrado multi-tenant intacto en todos los endpoints tocados.
