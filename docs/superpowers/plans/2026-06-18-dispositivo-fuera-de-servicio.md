# Dispositivo fuera de servicio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir marcar un dispositivo como "Fuera de servicio" para que no genere alerta de inactividad ("vehículo silencioso"), manteniéndolo visible, con reactivación automática al volver a transmitir y un estado propio "Equipo desmontado" en la flota.

**Architecture:** Columna nueva `out_of_service` (+ `out_of_service_since`) en la tabla `device`, ortogonal a `active`. El sweep de silencio (rules-engine) excluye los dispositivos fuera de servicio; el ingest los reactiva al reconectar; la API permite cambiar el estado y resuelve la alerta firing al marcarlo; el estado se propaga a `VehicleStatus` y el frontend lo pinta en gris neutro.

**Tech Stack:** Backend FastAPI + SQLAlchemy 2.x async + Alembic + Pydantic v2 (Postgres/TimescaleDB). rules-engine e ingest usan asyncpg directo. Frontend React 18 + TS estricto + React Query + Vitest.

## Global Constraints

- Comentarios en español, código en inglés. Type hints en toda función pública Python; TS estricto (no `any`).
- Filtrado multi-tenant intacto en todos los endpoints tocados.
- `device.active` y `device.out_of_service` son ortogonales: NO reusar `active`.
- Producción sin staging: la migración Alembic requiere confirmación explícita del usuario antes de `alembic upgrade head` (no la ejecuta el agente).
- Redis con `pipeline()` y queries bulk con `= ANY(:ids)` (escala N=1000).
- Último head Alembic actual = `054`. La nueva migración es `055`, `down_revision = "054"`.

---

### Task 1: Migración 055 + columnas en el modelo Device

**Files:**
- Create: `backend/alembic/versions/055_device_out_of_service.py`
- Modify: `backend/app/models/device.py:22-23` (añadir columnas tras `active`)

**Interfaces:**
- Produces: `Device.out_of_service: bool` (default False, NOT NULL), `Device.out_of_service_since: datetime | None`. Columnas SQL `device.out_of_service` y `device.out_of_service_since`.

- [ ] **Step 1: Escribir la migración**

Crear `backend/alembic/versions/055_device_out_of_service.py`:

```python
"""device_out_of_service: estado 'fuera de servicio' para silenciar alerta de inactividad.

Un dispositivo fuera de servicio (desmontado / en reparación) no genera alerta de
'vehículo silencioso'. Es ortogonal a `active` (que significa dado de baja / oculto).
out_of_service_since sella el momento en que se marcó, para mostrar 'desde DD/MM'.

Revision ID: 055
Revises: 054
Create Date: 2026-06-18
"""
from alembic import op
import sqlalchemy as sa

revision = "055"
down_revision = "054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "device",
        sa.Column("out_of_service", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "device",
        sa.Column("out_of_service_since", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("device", "out_of_service_since")
    op.drop_column("device", "out_of_service")
```

- [ ] **Step 2: Añadir las columnas al modelo ORM**

En `backend/app/models/device.py`, tras la línea `active: Mapped[bool] = ...` (línea 22):

```python
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Fuera de servicio: dispositivo desmontado/parado a propósito. No genera alerta
    # de inactividad. Ortogonal a `active` (baja/oculto). Se reactiva solo al transmitir.
    out_of_service: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    out_of_service_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

- [ ] **Step 3: Verificar que el SQL de la migración es additivo y reversible**

Run: `cd /opt/cmg-telematic1 && python -c "import ast; ast.parse(open('backend/alembic/versions/055_device_out_of_service.py').read()); print('OK sintaxis')"`
Expected: `OK sintaxis`

NOTA: NO ejecutar `alembic upgrade head` aquí — requiere confirmación del usuario (producción). Se aplica en el paso de despliegue final.

- [ ] **Step 4: Commit**

```bash
git add backend/alembic/versions/055_device_out_of_service.py backend/app/models/device.py
git commit -m "feat(db): migración 055 + modelo device.out_of_service / out_of_service_since"
```

---

### Task 2: Sweep de silencio ignora dispositivos fuera de servicio

**Files:**
- Modify: `services/rules-engine/src/silence.py:137-147` (SELECT de candidatos en `sweep_silent_vehicles`)
- Test: `services/rules-engine/tests/` (clonar el patrón del test de silence existente; ver Step 1)

**Interfaces:**
- Consumes: columna `device.out_of_service` (Task 1).
- Produces: ningún device con `out_of_service = true` entra en el barrido.

- [ ] **Step 1: Escribir el test que falla**

Localizar el archivo de tests del sweep de silencio (`grep -rln "sweep_silent_vehicles\|silence" services/rules-engine/tests/`). Clonar el patrón del test existente que inserta un vehículo+device con `last_seen` antiguo y verifica que se crea alerta. Añadir un caso que marca el device `out_of_service = true` y verifica que NO se crea alerta:

```python
async def test_sweep_skips_out_of_service_device(db_pool, redis_client):
    # Vehículo+device con last_seen muy antiguo (superaría el umbral) PERO out_of_service=true
    vehicle_id, _tenant_id = await _insert_silent_vehicle(
        db_pool, last_seen_hours_ago=100, out_of_service=True,
    )
    await sweep_silent_vehicles(db_pool, redis_client)
    async with db_pool.acquire() as conn:
        n = await conn.fetchval(
            "SELECT count(*) FROM alert_instance WHERE vehicle_id = $1::uuid AND status = 'firing'",
            vehicle_id,
        )
    assert n == 0
```

Ajustar `_insert_silent_vehicle` (helper del test existente) para aceptar `out_of_service` y escribirlo en el INSERT de `device`.

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `docker exec cmg-telematic1_rules-engine_1 sh -c 'cd /app && python -m pytest tests/ -k out_of_service -xvs'`
Expected: FAIL — actualmente el sweep crea la alerta porque no filtra `out_of_service`.

(Si el contenedor no monta el código fuente, copiar con `docker cp` o ejecutar la suite donde corre normalmente la del rules-engine.)

- [ ] **Step 3: Añadir el filtro al SELECT del sweep**

En `services/rules-engine/src/silence.py`, dentro de `sweep_silent_vehicles`, el SELECT (líneas 137-147) pasa de:

```python
                """
                SELECT v.id::text    AS vehicle_id,
                       v.tenant_id::text AS tenant_id,
                       d.last_seen
                FROM   vehicle v
                JOIN   device  d ON d.vehicle_id = v.id AND d.active = true
                WHERE  v.active       = true
                  AND  d.last_seen   IS NOT NULL
                """
```

a (añadir `AND d.out_of_service = false` en el JOIN del device):

```python
                """
                SELECT v.id::text    AS vehicle_id,
                       v.tenant_id::text AS tenant_id,
                       d.last_seen
                FROM   vehicle v
                JOIN   device  d ON d.vehicle_id = v.id
                                 AND d.active = true
                                 AND d.out_of_service = false
                WHERE  v.active       = true
                  AND  d.last_seen   IS NOT NULL
                """
```

- [ ] **Step 4: Ejecutar el test para verificar que pasa**

Run: `docker exec cmg-telematic1_rules-engine_1 sh -c 'cd /app && python -m pytest tests/ -k out_of_service -xvs'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/rules-engine/src/silence.py services/rules-engine/tests/
git commit -m "feat(rules-engine): el sweep de silencio ignora dispositivos out_of_service"
```

---

### Task 3: Ingest reactiva el dispositivo al reconectar

**Files:**
- Modify: `services/ingest/src/writer.py:138-143` (`update_device_online`)
- Test: `services/ingest/tests/` (clonar patrón del test de writer existente)

**Interfaces:**
- Consumes: columna `device.out_of_service` (Task 1).
- Produces: cuando `update_device_online(conn, imei, online=True)`, el device pasa a `out_of_service=false`, `out_of_service_since=NULL`. Con `online=False` (desconexión) NO se toca `out_of_service`.

- [ ] **Step 1: Escribir el test que falla**

Clonar el patrón del test existente de `update_device_online` (`grep -rln "update_device_online" services/ingest/tests/`). Añadir:

```python
async def test_update_device_online_true_clears_out_of_service(db_conn):
    # Device marcado fuera de servicio
    await db_conn.execute(
        "UPDATE device SET out_of_service=true, out_of_service_since=now() WHERE imei=$1",
        TEST_IMEI,
    )
    await update_device_online(db_conn, TEST_IMEI, True)
    row = await db_conn.fetchrow(
        "SELECT online, out_of_service, out_of_service_since FROM device WHERE imei=$1", TEST_IMEI
    )
    assert row["online"] is True
    assert row["out_of_service"] is False
    assert row["out_of_service_since"] is None


async def test_update_device_online_false_keeps_out_of_service(db_conn):
    await db_conn.execute(
        "UPDATE device SET out_of_service=true, out_of_service_since=now() WHERE imei=$1",
        TEST_IMEI,
    )
    await update_device_online(db_conn, TEST_IMEI, False)
    row = await db_conn.fetchrow("SELECT out_of_service FROM device WHERE imei=$1", TEST_IMEI)
    assert row["out_of_service"] is True  # la desconexión NO reactiva
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `docker exec cmg-telematic1_ingest-svc_1 sh -c 'cd /app && python -m pytest tests/ -k out_of_service -xvs'`
Expected: FAIL — `update_device_online` aún no toca `out_of_service`.

- [ ] **Step 3: Modificar `update_device_online`**

En `services/ingest/src/writer.py` (líneas 138-143):

```python
async def update_device_online(
    conn: asyncpg.Connection, imei: str, online: bool
) -> None:
    if online:
        # Reconexión = dispositivo vivo: reactiva si estaba fuera de servicio (remontado).
        await conn.execute("""
            UPDATE device
               SET online=true, last_seen=now(),
                   out_of_service=false, out_of_service_since=NULL
             WHERE imei=$1
        """, imei)
    else:
        await conn.execute("""
            UPDATE device SET online=false, last_seen=now() WHERE imei=$1
        """, imei)
```

- [ ] **Step 4: Ejecutar el test para verificar que pasa**

Run: `docker exec cmg-telematic1_ingest-svc_1 sh -c 'cd /app && python -m pytest tests/ -k out_of_service -xvs'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/ingest/src/writer.py services/ingest/tests/
git commit -m "feat(ingest): reactivar device (out_of_service=false) al reconectar"
```

---

### Task 4: API — PATCH /devices/{id} acepta out_of_service y resuelve la alerta firing

**Files:**
- Modify: `backend/app/schemas/device.py:7-22` (DeviceOut) y `46-51` (DeviceUpdate)
- Modify: `backend/app/api/v1/devices.py:198-217` (`update_device`)
- Test: `backend/tests/api/test_devices_out_of_service.py` (crear)

**Interfaces:**
- Consumes: columna `device.out_of_service` (Task 1).
- Produces: `DeviceOut.out_of_service: bool`, `DeviceOut.out_of_service_since: datetime | None`. `DeviceUpdate.out_of_service: bool | None`. Al PATCH con `out_of_service=true` → sella `out_of_service_since=now()` y resuelve alerta de silencio `firing` del vehículo; con `false` → limpia el timestamp.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/api/test_devices_out_of_service.py`. Clonar el patrón de autenticación CMG admin de los tests de devices existentes (`grep -rln "update_device\|PATCH.*devices" backend/tests/`):

```python
import pytest

@pytest.mark.asyncio
async def test_patch_out_of_service_true_seals_timestamp(client, cmg_admin_headers, device_factory):
    device = await device_factory()  # device CMG admin-gestionable
    resp = await client.patch(
        f"/api/v1/devices/{device.id}", json={"out_of_service": True}, headers=cmg_admin_headers
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["out_of_service"] is True
    assert body["out_of_service_since"] is not None


@pytest.mark.asyncio
async def test_patch_out_of_service_false_clears_timestamp(client, cmg_admin_headers, device_factory):
    device = await device_factory(out_of_service=True)
    resp = await client.patch(
        f"/api/v1/devices/{device.id}", json={"out_of_service": False}, headers=cmg_admin_headers
    )
    assert resp.status_code == 200
    assert resp.json()["out_of_service"] is False
    assert resp.json()["out_of_service_since"] is None
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd /opt/cmg-telematic1 && docker exec cmg-telematic1_core-api_1 sh -c 'cd /app && python -m pytest tests/api/test_devices_out_of_service.py -xvs'`
Expected: FAIL — `DeviceUpdate` no tiene `out_of_service`; `DeviceOut` no expone los campos.

(NOTA de memoria: el contenedor core-api no monta el código fuente; copiar los ficheros con `docker cp` antes de correr los tests, o ejecutar la suite donde corra normalmente.)

- [ ] **Step 3: Ampliar los schemas**

En `backend/app/schemas/device.py`, en `DeviceOut` (tras `active: bool`, línea 19):

```python
    active: bool
    out_of_service: bool = False
    out_of_service_since: datetime | None = None
```

En `DeviceUpdate` (línea 46-51), añadir:

```python
class DeviceUpdate(BaseModel):
    firmware_ver: str | None = None
    tenant_id: uuid.UUID | None = None
    active: bool | None = None
    model: str | None = None
    sim_phone: str | None = None
    out_of_service: bool | None = None
```

- [ ] **Step 4: Modificar el handler `update_device`**

En `backend/app/api/v1/devices.py`, sustituir el bucle de asignación (líneas 213-217) por un manejo explícito de `out_of_service` que selle/limpie el timestamp y resuelva la alerta firing. Añadir imports al inicio del archivo (`from datetime import datetime, timezone` ya está parcialmente; falta `timezone`) y el modelo `AlertInstance`:

```python
from datetime import datetime, timezone
from app.models.alert import AlertInstance, AlertRule
```

Reemplazar el cuerpo desde la línea 213:

```python
    data = body.model_dump(exclude_unset=True)
    new_oos = data.pop("out_of_service", None)
    for field, value in data.items():
        setattr(device, field, value)

    if new_oos is not None and new_oos != device.out_of_service:
        device.out_of_service = new_oos
        if new_oos:
            device.out_of_service_since = datetime.now(timezone.utc)
            # Resolver alerta de silencio firing del vehículo vinculado (si la hay)
            if device.vehicle_id is not None:
                await db.execute(
                    update(AlertInstance)
                    .where(
                        AlertInstance.vehicle_id == device.vehicle_id,
                        AlertInstance.status == "firing",
                        AlertInstance.rule_id.in_(
                            select(AlertRule.id).where(
                                AlertRule.condition["type"].as_string() == "silence"
                            )
                        ),
                    )
                    .values(status="resolved", resolved_at=datetime.now(timezone.utc))
                )
                redis = getattr(request.app.state, "redis", None)
                if redis is not None:
                    try:
                        await redis.delete(f"silence:firing:{device.vehicle_id}")
                    except Exception as e:
                        logger.warning("No se pudo limpiar silence key: %s", e)
        else:
            device.out_of_service_since = None

    await db.commit()
    await db.refresh(device)
    return device
```

Añadir `request: Request` a la firma de `update_device` (ya se importa `Request` en la línea 4) y `from sqlalchemy import select, func, case, update` (añadir `update`). Verificar el nombre real de la columna `resolved_at` en `AlertInstance` (`grep -n "resolved_at\|class AlertInstance" backend/app/models/alert.py`); si no existe, omitir ese `.values` extra y dejar solo `status="resolved"`.

- [ ] **Step 5: Ejecutar el test para verificar que pasa**

Run: `docker exec cmg-telematic1_core-api_1 sh -c 'cd /app && python -m pytest tests/api/test_devices_out_of_service.py -xvs'`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/device.py backend/app/api/v1/devices.py backend/tests/api/test_devices_out_of_service.py
git commit -m "feat(api): PATCH device.out_of_service sella timestamp y resuelve alerta de silencio"
```

---

### Task 5: Propagar device_out_of_service a VehicleStatus (bulk + detalle)

**Files:**
- Modify: `backend/app/schemas/vehicle.py:167-183` (VehicleStatus)
- Modify: `backend/app/api/v1/vehicles.py` — `get_vehicles_statuses_bulk` (~1092-1262) y `get_vehicle_status` detalle (~1277-1419)
- Test: `backend/tests/api/test_vehicle_status_out_of_service.py` (crear)

**Interfaces:**
- Consumes: columna `device.out_of_service` (Task 1).
- Produces: `VehicleStatus.device_out_of_service: bool` (default False), poblado en bulk y detalle desde una query bulk de `device` por `vehicle_id`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/api/test_vehicle_status_out_of_service.py`:

```python
import pytest

@pytest.mark.asyncio
async def test_bulk_status_exposes_out_of_service(client, cmg_admin_headers, vehicle_with_device_factory):
    v = await vehicle_with_device_factory(out_of_service=True, redis_status=True)
    resp = await client.get(f"/api/v1/vehicles/statuses?ids={v.id}", headers=cmg_admin_headers)
    assert resp.status_code == 200
    statuses = resp.json()
    assert len(statuses) == 1
    assert statuses[0]["device_out_of_service"] is True
```

(Usar/extender el factory existente que crea vehículo+device y siembra el hash Redis `vehicle:{id}:status`.)

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `docker exec cmg-telematic1_core-api_1 sh -c 'cd /app && python -m pytest tests/api/test_vehicle_status_out_of_service.py -xvs'`
Expected: FAIL — el campo no existe ni se puebla.

- [ ] **Step 3: Añadir el campo al schema**

En `backend/app/schemas/vehicle.py`, en `VehicleStatus` (tras `status: str | None = None`):

```python
    status: str | None = None
    lng: float | None = None
    device_out_of_service: bool = False
```

- [ ] **Step 4: Poblar el campo en el bulk**

En `get_vehicles_statuses_bulk` (`backend/app/api/v1/vehicles.py`), tras construir `accessible_ids` y antes de armar `statuses`, añadir una query bulk de los devices vinculados (sin N+1):

```python
    # Estado fuera-de-servicio del device vinculado (bulk, sin N+1)
    oos_rows = await db.execute(
        select(Device.vehicle_id, Device.out_of_service)
        .where(Device.vehicle_id.in_(accessible_ids), Device.active == True)
    )
    oos_by_vehicle = {row.vehicle_id: row.out_of_service for row in oos_rows.all()}
```

Asegurar el import `from app.models.device import Device` en el archivo (verificar; añadir si falta). En la construcción de cada `VehicleStatus`, añadir:

```python
            dout_state=dout_state,
            device_out_of_service=bool(oos_by_vehicle.get(vid, False)),
        ))
```

- [ ] **Step 5: Poblar el campo en el detalle**

En `get_vehicle_status` (detalle), tras resolver el `vehicle_id`, leer el device:

```python
    oos = await db.execute(
        select(Device.out_of_service).where(Device.vehicle_id == vehicle_id, Device.active == True)
    )
    device_oos = bool(oos.scalar_one_or_none() or False)
```

Y en el `return VehicleStatus(...)` añadir `device_out_of_service=device_oos`.

- [ ] **Step 6: Ejecutar el test para verificar que pasa**

Run: `docker exec cmg-telematic1_core-api_1 sh -c 'cd /app && python -m pytest tests/api/test_vehicle_status_out_of_service.py -xvs'`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/vehicle.py backend/app/api/v1/vehicles.py backend/tests/api/test_vehicle_status_out_of_service.py
git commit -m "feat(api): VehicleStatus.device_out_of_service en bulk y detalle"
```

---

### Task 6: Frontend — tipo VehicleStatus + helpers de estado

**Files:**
- Modify: `frontend/src/lib/types.ts:40-54` (VehicleStatus) y `DeviceOut` (~648-663)
- Modify: `frontend/src/lib/staleStatus.ts`
- Test: `frontend/src/lib/staleStatus.test.ts` (crear o extender)

**Interfaces:**
- Consumes: `VehicleStatus.device_out_of_service` (Task 5), `DeviceOut.out_of_service` (Task 4).
- Produces: helper `isOutOfService(status): boolean`. `isOnline(status)` devuelve `false` si el device está fuera de servicio (no es "online"). Tipos TS con los campos nuevos.

- [ ] **Step 1: Escribir el test que falla**

Crear/extender `frontend/src/lib/staleStatus.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { isOutOfService, isOnline } from './staleStatus'

describe('out of service', () => {
  it('isOutOfService true cuando el device está fuera de servicio', () => {
    expect(isOutOfService({ device_out_of_service: true } as never)).toBe(true)
  })
  it('isOnline es false si está fuera de servicio aunque el dato sea fresco', () => {
    const fresh = new Date().toISOString()
    expect(isOnline({ device_out_of_service: true, last_seen: fresh, ignition: false } as never)).toBe(false)
  })
})
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd /opt/cmg-telematic1/frontend && npx vitest run src/lib/staleStatus.test.ts`
Expected: FAIL — `isOutOfService` no existe.

- [ ] **Step 3: Añadir campos a los tipos**

En `frontend/src/lib/types.ts`, en `interface VehicleStatus` (tras `dout_state`):

```typescript
  dout_state: Record<number, boolean>
  device_out_of_service?: boolean
```

En `interface DeviceOut` (tras `active: boolean`):

```typescript
  active: boolean
  out_of_service?: boolean
  out_of_service_since?: string | null
```

- [ ] **Step 4: Añadir helpers en staleStatus.ts**

En `frontend/src/lib/staleStatus.ts`, tras `isFresh` y antes/junto a `isOnline`:

```typescript
/** Dispositivo marcado como fuera de servicio (desmontado/parado a propósito). */
export function isOutOfService(status: VehicleStatus | null | undefined): boolean {
  return status?.device_out_of_service === true
}
```

Y modificar `isOnline` para que un device fuera de servicio nunca cuente como online:

```typescript
export function isOnline(status: VehicleStatus | null | undefined): boolean {
  if (!status) return false
  if (status.device_out_of_service === true) return false
  return isFresh(status.device_last_seen ?? status.last_seen, status.ignition)
}
```

- [ ] **Step 5: Ejecutar el test para verificar que pasa**

Run: `cd /opt/cmg-telematic1/frontend && npx vitest run src/lib/staleStatus.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/staleStatus.ts frontend/src/lib/staleStatus.test.ts
git commit -m "feat(frontend): tipos y helper isOutOfService; isOnline excluye fuera de servicio"
```

---

### Task 7: Frontend — DevicesPage: toggle y columna de estado

**Files:**
- Modify: `frontend/src/features/devices/DevicesPage.tsx`

**Interfaces:**
- Consumes: `DeviceOut.out_of_service`, `out_of_service_since` (Task 6); `PATCH /api/v1/devices/{id}` con `{ out_of_service }` (Task 4).
- Produces: acción admin "En servicio ⟷ Fuera de servicio" por fila e indicación en la columna Estado.

- [ ] **Step 1: Añadir la mutación de cambio de estado**

En `DevicesPage.tsx`, junto a las otras mutaciones (tras `transferMutation`):

```tsx
  const outOfServiceMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      apiClient.patch<DeviceOut>(`/api/v1/devices/${id}`, { out_of_service: value }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['devices'] }) },
  })
```

- [ ] **Step 2: Reflejar el estado fuera de servicio en la columna Estado**

En la celda de Estado (líneas ~255-268), anteponer el caso fuera de servicio al online/offline:

```tsx
                        <td style={tdStyle}>
                          {device.out_of_service ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent-off)' }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-off)', flexShrink: 0 }} />
                              Fuera de servicio
                              {device.out_of_service_since && (
                                <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
                                  {' · desde '}{new Date(device.out_of_service_since).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: online ? 'var(--ok)' : 'var(--offline)', flexShrink: 0 }} />
                              <span style={{ color: online ? 'var(--ok)' : 'var(--offline)' }}>{online ? 'Online' : 'Offline'}</span>
                            </span>
                          )}
                        </td>
```

- [ ] **Step 3: Añadir el botón de acción (solo admin)**

En la celda de acciones (junto a Transferir/Eliminar, dentro del `{isAdmin && ...}`):

```tsx
                            {isAdmin && <button
                              onClick={() => outOfServiceMutation.mutate({ id: device.id, value: !device.out_of_service })}
                              disabled={outOfServiceMutation.isPending}
                              title={device.out_of_service ? 'Volver a poner en servicio' : 'Marcar como fuera de servicio (no alertar inactividad)'}
                              style={{
                                background: 'transparent',
                                border: '1px solid var(--accent-off)',
                                color: 'var(--accent-off)',
                                borderRadius: 4, padding: '3px 10px', fontSize: 11, cursor: 'pointer',
                                opacity: outOfServiceMutation.isPending ? 0.5 : 1,
                              }}
                            >
                              {device.out_of_service ? 'Poner en servicio' : 'Fuera de servicio'}
                            </button>}
```

- [ ] **Step 4: Verificar typecheck y build**

Run: `cd /opt/cmg-telematic1/frontend && npx tsc --noEmit`
Expected: EXIT 0

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/devices/DevicesPage.tsx
git commit -m "feat(frontend): DevicesPage toggle y estado 'Fuera de servicio'"
```

---

### Task 8: Frontend — Flota muestra "Equipo desmontado"

**Files:**
- Modify: `frontend/src/features/fleet/FleetDashboard.tsx:22-32` (`getVehicleState`, `stateColor`, tipo `VehicleState`)
- Modify: `frontend/src/features/fleet/FleetMap.tsx:109-114` (icono)
- Modify: `frontend/src/features/vehicles/VehiclesPage.tsx` (columna Dispositivo GPS — usa `dev.out_of_service`)

**Interfaces:**
- Consumes: `isOutOfService` (Task 6), `VehicleStatus.device_out_of_service`, `DeviceOut.out_of_service`.
- Produces: estado visual neutro/gris "Equipo desmontado", prioritario sobre offline; nunca rojo.

- [ ] **Step 1: Añadir el estado en FleetDashboard**

En `frontend/src/features/fleet/FleetDashboard.tsx`, importar `isOutOfService` desde `staleStatus` y ampliar el tipo `VehicleState` con `'out_of_service'`. En `getVehicleState`, primer caso:

```tsx
function getVehicleState(vehicle: VehicleOut, status: VehicleStatus | undefined, alerts: AlertInstanceOut[]): VehicleState {
  if (isOutOfService(status)) return 'out_of_service'
  if (!isOnline(status)) return 'offline'
  if (alerts.some(a => a.vehicle_id === vehicle.id)) return 'alert'
  if ((status!.speed_kmh ?? 0) > 2) return 'moving'
  if (status!.ignition) return 'idle'
  return 'parked'
}
```

En `stateColor`, añadir el caso gris neutro:

```tsx
function stateColor(state: VehicleState): string {
  return state === 'alert' ? 'var(--danger)'
    : state === 'moving' ? 'var(--ok)'
    : state === 'idle' ? 'var(--warn)'
    : state === 'parked' ? 'var(--info)'
    : state === 'out_of_service' ? 'var(--accent-off)'
    : 'var(--offline)'
}
```

Si hay una leyenda/etiqueta de texto por estado en el dashboard, añadir la entrada `out_of_service → 'Equipo desmontado'`.

- [ ] **Step 2: Icono diferenciado en FleetMap**

En `frontend/src/features/fleet/FleetMap.tsx`, en `makeVehicleIcon` anteponer el caso fuera de servicio (reutiliza el icono offline gris para no introducir un asset nuevo, pero con prioridad sobre alert):

```tsx
function makeVehicleIcon(status: VehicleStatus, hasAlert: boolean): L.DivIcon {
  if (status.device_out_of_service === true) return makeOfflineIcon()
  if (!isEffectivelyOnline(status)) return makeOfflineIcon()
  if (hasAlert) return makeAlertIcon()
  if ((status.speed_kmh ?? 0) > 2) return makeMovingIcon()
  return makeStoppedIcon(status.ignition)
}
```

(El estado gris ya lo da `isOnline`/`isEffectivelyOnline` devolviendo false para fuera de servicio — Task 6 — así que el marcador cae a gris automáticamente; este caso explícito lo deja claro y prioriza sobre alert.)

- [ ] **Step 3: VehiclesPage — columna Dispositivo GPS**

En `frontend/src/features/vehicles/VehiclesPage.tsx`, donde se calcula `devOnline` (Task del fix previo), anteponer el caso fuera de servicio en el render de la celda Dispositivo GPS:

```tsx
                          {dev ? (
                            dev.out_of_service ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: 'var(--accent-off)' }} />
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-off)' }}>
                                  {dev.imei} · desmontado
                                </span>
                              </span>
                            ) : (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: devOnline ? 'var(--ok)' : 'var(--offline)' }} />
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: devOnline ? 'var(--ok)' : 'var(--fg-muted)' }}>
                                  {dev.imei}
                                </span>
                              </span>
                            )
                          ) : (
                            <span style={{ color: 'var(--warn)', fontSize: 12 }}>Sin dispositivo</span>
                          )}
```

- [ ] **Step 4: Verificar typecheck**

Run: `cd /opt/cmg-telematic1/frontend && npx tsc --noEmit`
Expected: EXIT 0

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/fleet/FleetDashboard.tsx frontend/src/features/fleet/FleetMap.tsx frontend/src/features/vehicles/VehiclesPage.tsx
git commit -m "feat(frontend): estado 'Equipo desmontado' (gris) en flota y VehiclesPage"
```

---

## Despliegue (tras aprobar todas las tareas)

Requiere confirmación explícita del usuario (producción):

1. **Migración** (additive): `docker-compose run --rm --no-deps core-api alembic -c /app/alembic.ini upgrade head` y verificar `055` aplicada.
2. **Rebuild + swap** de los servicios tocados siguiendo el procedimiento del proyecto (`docker-compose build` → swap con `docker run` replicando red/alias/puertos/volumen inspeccionados): core-api, ingest-svc, rules-engine y frontend.
3. Verificar: marcar `ot1234` (device de prueba) como fuera de servicio desde `/devices` y comprobar que deja de generar alerta de "vehículo silencioso" y que en flota aparece "Equipo desmontado".

## Self-review (cubierto)

- **Spec coverage:** estado del device (Task 1, 4, 7) · sweep ignora oos (Task 2) · reactivación por dato (Task 3) · vista flota "Equipo desmontado" (Task 5, 6, 8) · solo admin (Task 4 gating ya existente, Task 7 `isAdmin`) · tests (cada task) · migración additive con confirmación (Task 1 + Despliegue).
- **Tipos consistentes:** `out_of_service` / `out_of_service_since` (backend snake_case), `device_out_of_service` (VehicleStatus, ambos lados), `isOutOfService` (helper TS) usados igual en todas las tareas.
- **Sin placeholders:** todos los pasos llevan código o comando concreto. Las dos verificaciones a confirmar contra el código real (`AlertInstance.resolved_at`, import de `Device`/`update` en vehicles.py) están señaladas explícitamente como checks, no como TODOs.
