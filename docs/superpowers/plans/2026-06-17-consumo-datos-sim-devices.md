# Consumo de datos SIM por dispositivo — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar en `/devices` los datos transmitidos por cada dispositivo FMC650 (mes en curso, total acumulado e histórico mensual) para estimar el gasto de la tarjeta SIM.

**Architecture:** Feature 100% autocontenida. Una única tabla nueva `device_data_usage(device_id, year_month, bytes)`. El ingest-svc suma el tamaño del frame Codec 8 recibido vía una función dedicada nueva (sin tocar `update_device_last_packet`). La API expone `total_bytes`/`month_bytes` calculados desde esa tabla y un endpoint de detalle para el histórico. El frontend añade una columna y un panel de barras.

**Tech Stack:** Alembic, SQLAlchemy 2.x async, asyncpg (ingest), FastAPI, Pydantic v2, React 18 + React Query + Recharts.

**Spec:** `docs/superpowers/specs/2026-06-17-consumo-datos-sim-devices-design.md`

---

## Estructura de ficheros

**Crear:**
- `backend/alembic/versions/054_device_data_usage.py` — migración de la tabla
- `backend/app/models/device_data_usage.py` — modelo ORM
- `services/ingest/src/data_usage.py` — función de captura independiente del ingest

**Modificar:**
- `backend/app/models/__init__.py` — registrar el nuevo modelo
- `backend/app/schemas/device.py` — `DeviceOut` + schema `DataUsageMonth`
- `backend/app/api/v1/devices.py` — agregación en listado + endpoint detalle
- `services/ingest/src/server.py:270-280` — llamar a la función de captura
- `frontend/src/lib/types.ts:648-660` — `DeviceOut` + tipo `DataUsageMonth`
- `frontend/src/lib/format.ts` (o crear si no existe) — helper `formatBytes`
- `frontend/src/features/devices/DevicesPage.tsx` — columna + modal histórico

**Tests:**
- `backend/tests/api/test_devices_api.py` — actualizar test de listado + test endpoint detalle
- `services/ingest/tests/test_data_usage.py` — test de la función de captura

---

## Task 1: Migración 054 — tabla `device_data_usage`

**Files:**
- Create: `backend/alembic/versions/054_device_data_usage.py`

⚠️ **No ejecutar `alembic upgrade` en este task.** El servidor es producción; el upgrade se hace en el Task de despliegue con confirmación explícita de Carlos. Aquí solo se escribe y se valida la sintaxis del fichero.

- [ ] **Step 1: Escribir la migración**

```python
"""device_data_usage: histórico mensual de bytes transmitidos por dispositivo.

Feature autocontenida para estimar el consumo de la tarjeta SIM. Una fila por
dispositivo y mes natural (year_month = 'YYYY-MM'). El total acumulado se calcula
como SUM(bytes) sobre todas las filas del dispositivo.

Revision ID: 054
Revises: 053
Create Date: 2026-06-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "054"
down_revision = "053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "device_data_usage",
        sa.Column("device_id", UUID(as_uuid=True), nullable=False),
        sa.Column("year_month", sa.String(length=7), nullable=False),
        sa.Column("bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["device_id"], ["device.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("device_id", "year_month"),
    )


def downgrade() -> None:
    op.drop_table("device_data_usage")
```

- [ ] **Step 2: Verificar que el fichero importa sin errores de sintaxis**

Run:
```bash
cd /opt/cmg-telematic1/backend && python -c "import importlib.util, pathlib; spec = importlib.util.spec_from_file_location('m054', 'alembic/versions/054_device_data_usage.py'); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); print('revision', m.revision, 'down', m.down_revision)"
```
Expected: `revision 054 down 053`

- [ ] **Step 3: Commit**

```bash
git add backend/alembic/versions/054_device_data_usage.py
git commit -m "feat(db): migración 054 device_data_usage (histórico SIM)"
```

---

## Task 2: Modelo ORM `DeviceDataUsage`

**Files:**
- Create: `backend/app/models/device_data_usage.py`
- Modify: `backend/app/models/__init__.py`

- [ ] **Step 1: Escribir el modelo**

```python
# backend/app/models/device_data_usage.py
import uuid
from sqlalchemy import String, BigInteger, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class DeviceDataUsage(Base):
    """Histórico mensual de bytes transmitidos por dispositivo (estimación SIM).

    Una fila por (device_id, year_month). El total acumulado se obtiene como
    SUM(bytes) sobre todas las filas del dispositivo.
    """
    __tablename__ = "device_data_usage"

    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("device.id", ondelete="CASCADE"), primary_key=True,
    )
    year_month: Mapped[str] = mapped_column(String(7), primary_key=True)  # 'YYYY-MM'
    bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
```

- [ ] **Step 2: Registrar el modelo en `__init__.py`**

Abrir `backend/app/models/__init__.py`, localizar la línea que importa el modelo Device (`from app.models.device import Device`) y añadir justo debajo:

```python
from app.models.device_data_usage import DeviceDataUsage
```

Si el fichero tiene una lista `__all__`, añadir `"DeviceDataUsage"` a esa lista.

- [ ] **Step 3: Verificar que el modelo se importa y registra en metadata**

Run:
```bash
cd /opt/cmg-telematic1/backend && python -c "from app.models import DeviceDataUsage; from app.models.base import Base; assert 'device_data_usage' in Base.metadata.tables; print('OK', DeviceDataUsage.__tablename__)"
```
Expected: `OK device_data_usage`

- [ ] **Step 4: Commit**

```bash
git add backend/app/models/device_data_usage.py backend/app/models/__init__.py
git commit -m "feat(models): modelo DeviceDataUsage"
```

---

## Task 3: Captura de bytes en ingest-svc

**Files:**
- Create: `services/ingest/src/data_usage.py`
- Modify: `services/ingest/src/server.py:270-280`
- Test: `services/ingest/tests/test_data_usage.py`

**Nota de diseño:** el `year_month` se calcula en SQL con `now() AT TIME ZONE 'Europe/Madrid'` para que el corte mensual coincida con el mes de facturación local. El device se resuelve por IMEI dentro del mismo INSERT (sin parámetro device_id); si el IMEI no existe, el SELECT no devuelve filas y no se inserta nada (seguro). Solo se cuentan frames Codec 8/8E (los Codec 12 hacen `continue` antes y no pasan por aquí).

- [ ] **Step 1: Escribir el test que falla**

```python
# services/ingest/tests/test_data_usage.py
"""Tests para src/data_usage.py — captura de bytes para consumo SIM."""
from unittest.mock import AsyncMock

import pytest

from src.data_usage import record_device_data_usage


@pytest.mark.asyncio
async def test_record_device_data_usage_executes_upsert():
    conn = AsyncMock()
    await record_device_data_usage(conn, "123456789012345", 512)

    conn.execute.assert_awaited_once()
    args = conn.execute.await_args.args
    sql = args[0]
    # UPSERT sobre device_data_usage con ON CONFLICT
    assert "device_data_usage" in sql
    assert "ON CONFLICT" in sql
    # Parámetros posicionales: imei, bytes
    assert args[1] == "123456789012345"
    assert args[2] == 512


@pytest.mark.asyncio
async def test_record_device_data_usage_ignores_zero_or_negative():
    conn = AsyncMock()
    await record_device_data_usage(conn, "123456789012345", 0)
    conn.execute.assert_not_awaited()
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run:
```bash
cd /opt/cmg-telematic1/services/ingest && python -m pytest tests/test_data_usage.py -v
```
Expected: FAIL con `ModuleNotFoundError: No module named 'src.data_usage'`

- [ ] **Step 3: Escribir la implementación mínima**

```python
# services/ingest/src/data_usage.py
"""Captura del consumo de datos por dispositivo para estimar el gasto de la SIM.

Módulo autocontenido: NO reutiliza update_device_last_packet ni el contador
total_messages. Solo escribe en device_data_usage (histórico mensual de bytes).
"""
import asyncpg

# UPSERT del acumulado del mes en curso. El device se resuelve por IMEI y el
# mes (year_month) se calcula en hora local de Madrid para casar con la
# facturación del operador. Si el IMEI no existe, el SELECT no devuelve filas.
_UPSERT_SQL = """
    INSERT INTO device_data_usage (device_id, year_month, bytes)
    SELECT d.id, to_char(now() AT TIME ZONE 'Europe/Madrid', 'YYYY-MM'), $2
    FROM device d
    WHERE d.imei = $1
    ON CONFLICT (device_id, year_month)
    DO UPDATE SET bytes = device_data_usage.bytes + EXCLUDED.bytes
"""


async def record_device_data_usage(
    conn: asyncpg.Connection, imei: str, packet_bytes: int
) -> None:
    """Suma packet_bytes al acumulado del mes en curso del dispositivo.

    packet_bytes = tamaño del frame Codec 8 recibido (cabecera + payload + CRC).
    No-op si packet_bytes <= 0.
    """
    if packet_bytes <= 0:
        return
    await conn.execute(_UPSERT_SQL, imei, packet_bytes)
```

- [ ] **Step 4: Ejecutar el test para verificar que pasa**

Run:
```bash
cd /opt/cmg-telematic1/services/ingest && python -m pytest tests/test_data_usage.py -v
```
Expected: PASS (2 passed)

- [ ] **Step 5: Conectar la captura en el receive loop**

En `services/ingest/src/server.py`, localizar el bloque (líneas ~270-280):

```python
            async with self.db_pool.acquire() as conn:
                for avl in records:
                    await write_record(
                        conn, avl,
                        self.device_info["device_id"],
                        self.device_info["vehicle_id"],
                        self.device_info["tenant_id"],
                    )
                await update_device_last_packet(
                    conn, self.imei, codec_id, len(records)
                )
```

Añadir la llamada de captura justo después de `update_device_last_packet`, dentro del mismo `async with`:

```python
            async with self.db_pool.acquire() as conn:
                for avl in records:
                    await write_record(
                        conn, avl,
                        self.device_info["device_id"],
                        self.device_info["vehicle_id"],
                        self.device_info["tenant_id"],
                    )
                await update_device_last_packet(
                    conn, self.imei, codec_id, len(records)
                )
                # Consumo SIM: suma los bytes del frame recibido (feature independiente)
                await record_device_data_usage(conn, self.imei, len(packet))
```

- [ ] **Step 6: Añadir el import en `server.py`**

Localizar los imports de módulos locales del ingest en la cabecera de `server.py` (junto a `from src.writer import ...`) y añadir:

```python
from src.data_usage import record_device_data_usage
```

- [ ] **Step 7: Verificar que `server.py` importa sin errores**

Run:
```bash
cd /opt/cmg-telematic1/services/ingest && python -c "import ast; ast.parse(open('src/server.py').read()); print('server.py sintaxis OK')"
```
Expected: `server.py sintaxis OK`

- [ ] **Step 8: Commit**

```bash
git add services/ingest/src/data_usage.py services/ingest/src/server.py services/ingest/tests/test_data_usage.py
git commit -m "feat(ingest): captura de bytes por dispositivo para consumo SIM"
```

---

## Task 4: Schemas Pydantic

**Files:**
- Modify: `backend/app/schemas/device.py:7-20`

- [ ] **Step 1: Añadir campos a `DeviceOut` y nuevo schema `DataUsageMonth`**

En `backend/app/schemas/device.py`, modificar `DeviceOut` para añadir dos campos con default 0 (siempre los rellena el endpoint; el default evita romper otros usos):

```python
class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID | None
    vehicle_id: uuid.UUID | None
    imei: str
    model: str
    firmware_ver: str | None
    online: bool
    last_seen: datetime | None
    sim_phone: str | None = None
    active: bool
    created_at: datetime
    total_bytes: int = 0   # acumulado total estimado (SUM de device_data_usage)
    month_bytes: int = 0   # bytes del mes en curso
```

Y añadir al final del fichero un schema para el detalle histórico:

```python
class DataUsageMonth(BaseModel):
    year_month: str   # 'YYYY-MM'
    bytes: int
```

- [ ] **Step 2: Verificar que el schema importa**

Run:
```bash
cd /opt/cmg-telematic1/backend && python -c "from app.schemas.device import DeviceOut, DataUsageMonth; print(DeviceOut.model_fields['total_bytes'].default, DeviceOut.model_fields['month_bytes'].default)"
```
Expected: `0 0`

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/device.py
git commit -m "feat(api): campos total_bytes/month_bytes en DeviceOut + DataUsageMonth"
```

---

## Task 5: Agregación en el listado de devices

**Files:**
- Modify: `backend/app/api/v1/devices.py:1-81`
- Test: `backend/tests/api/test_devices_api.py`

**Patrón:** una sola query agregada con `WHERE device_id = ANY(:ids)` (sin N+1), construyendo un dict `device_id -> (total, month)` que se vuelca en cada `DeviceOut`. El mes en curso se calcula en SQL en hora de Madrid para casar con el ingest.

- [ ] **Step 1: Actualizar el test del listado (TDD) — debe reflejar la 2ª query**

En `backend/tests/api/test_devices_api.py`, sustituir el cuerpo de `test_devices_cmg_admin_lists_all` por una versión que provea dos resultados de `db.execute` (primero los devices, luego la agregación de uso) y verifique los nuevos campos:

```python
def test_devices_cmg_admin_lists_all():
    _override_user(CMG_USER)

    devices_result = MagicMock()
    devices_result.scalars.return_value.all.return_value = [_make_device()]

    # Segunda query: filas de agregación de uso (device_id, total_bytes, month_bytes)
    usage_result = MagicMock()
    usage_row = MagicMock()
    usage_row.device_id = DEVICE_ID
    usage_row.total_bytes = 5000
    usage_row.month_bytes = 1200
    usage_result.all.return_value = [usage_row]

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[devices_result, usage_result])
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/devices")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["imei"] == "123456789012345"
    assert data[0]["total_bytes"] == 5000
    assert data[0]["month_bytes"] == 1200
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run:
```bash
cd /opt/cmg-telematic1/backend && DATABASE_URL=postgresql+asyncpg://x:x@localhost/x REDIS_URL=redis://localhost SECRET_KEY=test python -m pytest tests/api/test_devices_api.py::test_devices_cmg_admin_lists_all -v
```
Expected: FAIL (`total_bytes` == 0, no 5000; aún no existe la 2ª query)

- [ ] **Step 3: Implementar la agregación en `list_devices`**

En `backend/app/api/v1/devices.py`, añadir los imports necesarios en la cabecera:

```python
from sqlalchemy import select, func, case
from app.models.device_data_usage import DeviceDataUsage
```

(`select` ya está importado; añadir `func, case` a esa línea y la línea del modelo.)

Después de obtener `devices = result.scalars().all()` (línea ~42) e **inmediatamente antes** del bloque de Redis (línea ~44), insertar la agregación:

```python
    # Consumo SIM estimado: total acumulado + bytes del mes en curso, agregados
    # desde device_data_usage en una sola query (sin N+1). El mes en curso se
    # calcula en hora local de Madrid para casar con el corte de facturación.
    usage_map: dict[str, tuple[int, int]] = {}
    device_ids = [d.id for d in devices]
    if device_ids:
        current_month = func.to_char(
            func.timezone("Europe/Madrid", func.now()), "YYYY-MM"
        )
        usage_q = (
            select(
                DeviceDataUsage.device_id,
                func.coalesce(func.sum(DeviceDataUsage.bytes), 0).label("total_bytes"),
                func.coalesce(
                    func.sum(
                        case(
                            (DeviceDataUsage.year_month == current_month, DeviceDataUsage.bytes),
                            else_=0,
                        )
                    ),
                    0,
                ).label("month_bytes"),
            )
            .where(DeviceDataUsage.device_id.in_(device_ids))
            .group_by(DeviceDataUsage.device_id)
        )
        usage_rows = await db.execute(usage_q)
        usage_map = {
            row.device_id: (int(row.total_bytes), int(row.month_bytes))
            for row in usage_rows.all()
        }
```

Y dentro del bucle `for d in devices:`, tras `item = DeviceOut.model_validate(d)` (línea ~68), volcar los valores:

```python
    for d in devices:
        item = DeviceOut.model_validate(d)
        total_b, month_b = usage_map.get(d.id, (0, 0))
        item.total_bytes = total_b
        item.month_bytes = month_b
        if d.vehicle_id:
            ...  # (resto del bloque Redis sin cambios)
```

- [ ] **Step 4: Ejecutar el test para verificar que pasa**

Run:
```bash
cd /opt/cmg-telematic1/backend && DATABASE_URL=postgresql+asyncpg://x:x@localhost/x REDIS_URL=redis://localhost SECRET_KEY=test python -m pytest tests/api/test_devices_api.py -v
```
Expected: PASS (toda la suite de devices, incluido el test actualizado)

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/devices.py backend/tests/api/test_devices_api.py
git commit -m "feat(api): listado de devices con consumo SIM agregado"
```

---

## Task 6: Endpoint de detalle del histórico

**Files:**
- Modify: `backend/app/api/v1/devices.py`
- Test: `backend/tests/api/test_devices_api.py`

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `backend/tests/api/test_devices_api.py`:

```python
def test_device_data_usage_history_returns_series():
    _override_user(CMG_USER)

    device = _make_device(CMG_TENANT_ID)
    db = AsyncMock()
    db.get = AsyncMock(return_value=device)

    rows_result = MagicMock()
    r1 = MagicMock(); r1.year_month = "2026-05"; r1.bytes = 4000
    r2 = MagicMock(); r2.year_month = "2026-06"; r2.bytes = 1200
    rows_result.all.return_value = [r1, r2]
    db.execute = AsyncMock(return_value=rows_result)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/devices/{DEVICE_ID}/data-usage")
    assert resp.status_code == 200
    data = resp.json()
    assert data == [
        {"year_month": "2026-05", "bytes": 4000},
        {"year_month": "2026-06", "bytes": 1200},
    ]
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run:
```bash
cd /opt/cmg-telematic1/backend && DATABASE_URL=postgresql+asyncpg://x:x@localhost/x REDIS_URL=redis://localhost SECRET_KEY=test python -m pytest tests/api/test_devices_api.py::test_device_data_usage_history_returns_series -v
```
Expected: FAIL (404, la ruta no existe)

- [ ] **Step 3: Implementar el endpoint**

Añadir el import del schema en la cabecera de `devices.py`:

```python
from app.schemas.device import DeviceOut, DeviceCreate, DeviceUpdate, DeviceAssignVehicle, DeviceTransfer, DataUsageMonth
```

Y añadir el endpoint (p.ej. tras `list_devices`, antes de `create_device`):

```python
@router.get("/{device_id}/data-usage", response_model=list[DataUsageMonth])
async def device_data_usage(
    device_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Serie mensual de bytes transmitidos por el dispositivo (estimación SIM)."""
    device = await db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo no encontrado")
    _check_device_access(device, user)

    rows = await db.execute(
        select(DeviceDataUsage.year_month, DeviceDataUsage.bytes)
        .where(DeviceDataUsage.device_id == device_id)
        .order_by(DeviceDataUsage.year_month)
    )
    return [DataUsageMonth(year_month=r.year_month, bytes=int(r.bytes)) for r in rows.all()]
```

- [ ] **Step 4: Ejecutar el test para verificar que pasa**

Run:
```bash
cd /opt/cmg-telematic1/backend && DATABASE_URL=postgresql+asyncpg://x:x@localhost/x REDIS_URL=redis://localhost SECRET_KEY=test python -m pytest tests/api/test_devices_api.py -v
```
Expected: PASS (suite completa)

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/devices.py backend/tests/api/test_devices_api.py
git commit -m "feat(api): GET /devices/{id}/data-usage histórico mensual"
```

---

## Task 7: Frontend — tipos y helper de formato

**Files:**
- Modify: `frontend/src/lib/types.ts:648-660`
- Modify/Create: `frontend/src/lib/format.ts`

- [ ] **Step 1: Añadir campos al tipo `DeviceOut` y tipo `DataUsageMonth`**

En `frontend/src/lib/types.ts`, dentro de `interface DeviceOut` (tras `created_at`):

```typescript
export interface DeviceOut {
  id: string
  tenant_id: string | null
  vehicle_id: string | null
  imei: string
  model: string
  firmware_ver: string | null
  online: boolean
  last_seen: string | null
  sim_phone: string | null
  active: boolean
  created_at: string
  total_bytes: number
  month_bytes: number
}

export interface DataUsageMonth {
  year_month: string
  bytes: number
}
```

- [ ] **Step 2: Añadir helper `formatBytes`**

Comprobar primero si `frontend/src/lib/format.ts` existe:

```bash
ls frontend/src/lib/format.ts 2>/dev/null && echo EXISTE || echo NO-EXISTE
```

Añadir esta función a `frontend/src/lib/format.ts` (crear el fichero con solo esta función si no existe):

```typescript
/** Formatea bytes a KB/MB/GB con 1-2 decimales. 0 → "0 B". */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const decimals = value >= 100 || i === 0 ? 0 : 1
  return `${value.toFixed(decimals)} ${units[i]}`
}
```

- [ ] **Step 3: Verificar compilación TypeScript**

Run:
```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit
```
Expected: sin errores (exit 0)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/format.ts
git commit -m "feat(frontend): tipos consumo SIM + helper formatBytes"
```

---

## Task 8: Frontend — columna "Datos (mes / total)" en /devices

**Files:**
- Modify: `frontend/src/features/devices/DevicesPage.tsx`

- [ ] **Step 1: Importar el helper**

En la cabecera de `DevicesPage.tsx`, añadir junto a los imports de `lib`:

```typescript
import { formatBytes } from '../../lib/format'
```

- [ ] **Step 2: Añadir la cabecera de columna**

En el `<thead>` (líneas ~221-223), insertar la nueva columna tras "Teléfono SIM":

```tsx
                    <th style={thStyle}>Teléfono SIM</th>
                    <th style={thStyle}>Datos (mes / total)</th>
                    <th style={thStyle}>Firmware</th>
```

- [ ] **Step 3: Añadir la celda en cada fila**

Tras la celda de `sim_phone` (líneas ~261-263), insertar:

```tsx
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                          <span style={{ color: device.month_bytes > 50 * 1024 * 1024 ? 'var(--gauge-fill)' : 'var(--fg-primary)' }}>
                            {formatBytes(device.month_bytes)}
                          </span>
                          <span style={{ color: 'var(--fg-muted)' }}> / {formatBytes(device.total_bytes)}</span>
                          <span style={{ color: 'var(--fg-muted)', fontSize: 10 }} title="Estimación basada en los datos recibidos; la factura real del operador es algo mayor"> ℹ</span>
                        </td>
```

(El umbral naranja de 50 MB/mes es orientativo; ajustar si Carlos indica otro.)

- [ ] **Step 4: Verificar compilación**

Run:
```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit
```
Expected: sin errores (exit 0)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/devices/DevicesPage.tsx
git commit -m "feat(frontend): columna consumo SIM en /devices"
```

---

## Task 9: Frontend — modal de histórico mensual (barras)

**Files:**
- Create: `frontend/src/features/devices/DataUsageModal.tsx`
- Modify: `frontend/src/features/devices/DevicesPage.tsx`

- [ ] **Step 1: Crear el componente modal con gráfico de barras**

```tsx
// frontend/src/features/devices/DataUsageModal.tsx
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { apiClient } from '../../lib/apiClient'
import type { DataUsageMonth } from '../../lib/types'
import { formatBytes } from '../../lib/format'

interface Props {
  deviceId: string
  imei: string
  onClose: () => void
}

export function DataUsageModal({ deviceId, imei, onClose }: Props) {
  const { data, isLoading } = useQuery<DataUsageMonth[]>({
    queryKey: ['devices', deviceId, 'data-usage'],
    queryFn: () => apiClient.get<DataUsageMonth[]>(`/api/v1/devices/${deviceId}/data-usage`),
  })

  const chartData = (data ?? []).map(d => ({ mes: d.year_month, mb: +(d.bytes / (1024 * 1024)).toFixed(2), bytes: d.bytes }))

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, width: 560, maxWidth: '90vw' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Consumo de datos (estimado)</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 12 }}>{imei}</div>
        {isLoading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>Cargando…</div>
        ) : chartData.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>Sin datos de consumo todavía.</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData}>
              <XAxis dataKey="mes" tick={{ fill: 'var(--fg-muted)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--fg-muted)', fontSize: 11 }} unit=" MB" width={60} />
              <Tooltip
                formatter={(_v: number, _n, p: any) => [formatBytes(p.payload.bytes), 'Consumo']}
                contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
              />
              <Bar dataKey="mb" fill="var(--gauge-fill)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
```

(Verificar que la ruta de import de `apiClient` coincide con la usada en `DevicesPage.tsx`; ajustar si difiere.)

- [ ] **Step 2: Montar el modal y el botón en `DevicesPage.tsx`**

Añadir el import:

```typescript
import { DataUsageModal } from './DataUsageModal'
```

Añadir el estado (junto a los demás `useState` de la página):

```typescript
const [usageDevice, setUsageDevice] = useState<DeviceOut | null>(null)
```

Hacer la celda de datos clicable: envolver el contenido de la celda del Step 3 del Task 8 en un botón/elemento con `onClick={() => setUsageDevice(device)}` y `cursor: 'pointer'`, o añadir un icono 📊 al final de esa celda:

```tsx
                          <button
                            onClick={() => setUsageDevice(device)}
                            title="Ver histórico mensual"
                            style={{ background: 'none', border: 'none', color: 'var(--accent-info)', cursor: 'pointer', marginLeft: 6 }}
                          >📊</button>
```

Y renderizar el modal al final del JSX de la página (junto a los demás modales, antes del cierre del contenedor raíz):

```tsx
        {usageDevice && (
          <DataUsageModal
            deviceId={usageDevice.id}
            imei={usageDevice.imei}
            onClose={() => setUsageDevice(null)}
          />
        )}
```

- [ ] **Step 3: Verificar compilación**

Run:
```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit
```
Expected: sin errores (exit 0)

- [ ] **Step 4: Build del frontend**

Run:
```bash
cd /opt/cmg-telematic1/frontend && npm run build
```
Expected: build correcto (exit 0)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/devices/DataUsageModal.tsx frontend/src/features/devices/DevicesPage.tsx
git commit -m "feat(frontend): modal histórico mensual de consumo SIM"
```

---

## Task 10: Despliegue en producción (requiere confirmación de Carlos)

⚠️ **Producción real. No ejecutar ningún paso sin confirmación explícita de Carlos en el momento.** Sigue el procedimiento de deploy de `CLAUDE.md` (compose; recovery del bug ContainerConfig de compose v1.29.2).

- [ ] **Step 1: Aplicar migración 054**

Confirmar con Carlos y ejecutar:
```bash
docker compose exec -T core-api alembic upgrade head
```
Verificar:
```bash
docker compose exec -T core-api alembic current
```
Expected: `054 (head)`

- [ ] **Step 2: Rebuild + redeploy core-api**

Según el procedimiento de `CLAUDE.md` (sección DEPLOY core-api), con `--env-file`, volumen de uploads y `--network-alias core-api`.

- [ ] **Step 3: Redeploy ingest-svc**

Rebuild de la imagen del ingest y reinicio del contenedor (la nueva captura `record_device_data_usage` solo entra en vigor al recargar el código del ingest).

- [ ] **Step 4: Redeploy frontend**

Según el procedimiento obligatorio de `CLAUDE.md` (§DEPLOY FRONTEND).

- [ ] **Step 5: Validación end-to-end**

```bash
# La tabla existe y empieza a poblarse con dispositivos reales transmitiendo
docker compose exec -T timescaledb psql -U postgres -d cmg -c "SELECT device_id, year_month, bytes FROM device_data_usage ORDER BY bytes DESC LIMIT 10;"
# El endpoint responde
curl -s -H "Authorization: Bearer $TOKEN" "https://cmgtrack.com/api/v1/devices" | head -c 400
```
Expected: filas con `bytes > 0` acumulándose; campos `total_bytes`/`month_bytes` en la respuesta del listado.

---

## Notas de cierre

- **Estimación, no factura:** el valor mostrado son los bytes de los frames Codec 8 recibidos; el consumo real del operador es mayor (TCP/IP, GPRS, ACKs, reintentos). Etiquetado como "estimado" en la UI.
- **Datos retroactivos:** la tabla empieza vacía; el histórico se construye desde el despliegue hacia adelante. No hay datos de meses anteriores al deploy.
- **Fuera de alcance (futuro):** límites/alertas por SIM, factor de sobrecarga configurable, relleno de `iccid`.
