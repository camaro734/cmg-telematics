# Sprint 16 — Catálogo CAN + Configuración de Sensores por Tipo de Vehículo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear un catálogo de los ~25 parámetros CAN conocidos del FMC650 y una UI en Ajustes donde un CMG admin pueda activar/desactivar cada parámetro por tipo de vehículo, guardándolo en `vehicle_type.sensor_schema`, de forma que los gauges en la pestaña EN VIVO de cada vehículo se muestren automáticamente.

**Architecture:** Un nuevo endpoint `PATCH /api/v1/vehicle-types/{id}/sensor-schema` (CMG admin only) recibe la lista completa de `SensorDef` serializada y la guarda en el campo JSONB. El frontend mantiene un catálogo estático de AVL IDs conocidos con valores por defecto; la sección `VehicleTypeSensorsSection` en Ajustes permite seleccionar parámetros del catálogo y configurarlos, haciendo PATCH inmediato en cada cambio. `SensorGrid.tsx` ya lee `can_data[avl_${sensor.avl_id}]` — no necesita cambios.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Pydantic v2, React 18 + TanStack Query, TypeScript.

---

## Ficheros afectados

| Fichero | Acción |
|---------|--------|
| `backend/app/schemas/vehicle.py` | Modificar — añadir `VehicleTypeSensorSchemaUpdate` |
| `backend/app/api/v1/vehicles.py` | Modificar — añadir endpoint PATCH sensor-schema |
| `backend/tests/api/test_vehicle_types_api.py` | Crear — 4 tests |
| `frontend/src/lib/avlCatalog.ts` | Crear — catálogo de 25 parámetros CAN |
| `frontend/src/lib/queryKeys.ts` | Sin cambios — `keys.vehicleTypes()` ya existe |
| `frontend/src/features/settings/VehicleTypeSensorsSection.tsx` | Crear — UI de configuración |
| `frontend/src/features/settings/SettingsPage.tsx` | Modificar — añadir sección CMG admin |

---

## Task 1 — Backend: schema + endpoint PATCH sensor-schema

**Files:**
- Modify: `backend/app/schemas/vehicle.py`
- Modify: `backend/app/api/v1/vehicles.py`

- [ ] **Step 1: Añadir schema `VehicleTypeSensorSchemaUpdate` en `vehicle.py`**

Al final del fichero `backend/app/schemas/vehicle.py`, después de `KpiHour`, añadir:

```python
class VehicleTypeSensorSchemaUpdate(BaseModel):
    sensor_schema: list[dict[str, Any]]
```

El fichero debe quedar con este bloque añadido al final:

```python
# backend/app/schemas/vehicle.py
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict


class VehicleTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    slug: str
    name: str
    sensor_schema: list[dict[str, Any]]


class VehicleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    tenant_id: uuid.UUID
    vehicle_type_id: uuid.UUID
    name: str
    license_plate: str | None = None
    vin: str | None = None
    year: int | None = None
    active: bool
    created_at: datetime


class VehicleCreate(BaseModel):
    vehicle_type_id: uuid.UUID
    name: str
    license_plate: str | None = None
    vin: str | None = None
    year: int | None = None
    tenant_id: uuid.UUID | None = None


class VehicleStatus(BaseModel):
    vehicle_id: uuid.UUID
    online: bool
    last_seen: datetime | None = None
    lat: float | None = None
    lon: float | None = None
    speed_kmh: float | None = None
    ignition: bool | None = None
    pto_active: bool | None = None
    can_data: dict[str, Any] | None = None


class TelemetryPoint(BaseModel):
    time: datetime
    lat: float | None = None
    lon: float | None = None
    speed_kmh: float | None = None
    heading: int | None = None
    altitude_m: float | None = None
    ignition: bool | None = None
    pto_active: bool | None = None
    ext_voltage_mv: int | None = None
    can_data: dict[str, Any] | None = None


class TrackPoint(BaseModel):
    time: datetime
    lat: float | None = None
    lon: float | None = None


class KpiHour(BaseModel):
    bucket: datetime
    avg_pressure_1: float | None = None
    max_pressure_1: float | None = None
    avg_oil_temp: float | None = None
    max_oil_temp: float | None = None
    pto_active_minutes: int | None = None
    engine_on_minutes: int | None = None
    record_count: int | None = None


class VehicleTypeSensorSchemaUpdate(BaseModel):
    sensor_schema: list[dict[str, Any]]
```

- [ ] **Step 2: Añadir endpoint en `vehicles.py`**

Añadir al `import` al principio del fichero `backend/app/api/v1/vehicles.py`:

```python
from app.schemas.vehicle import (
    VehicleTypeOut, VehicleOut, VehicleCreate, VehicleStatus,
    TelemetryPoint, TrackPoint, KpiHour, VehicleTypeSensorSchemaUpdate,
)
```

Después del endpoint `list_vehicle_types` (línea ~39), añadir:

```python
@router.patch("/vehicle-types/{type_id}/sensor-schema", response_model=VehicleTypeOut)
async def update_vehicle_type_sensor_schema(
    type_id: uuid.UUID,
    body: VehicleTypeSensorSchemaUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo CMG admin puede modificar tipos de vehículo",
        )
    vtype = await db.get(VehicleType, type_id)
    if not vtype:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tipo de vehículo no encontrado",
        )
    from sqlalchemy.orm.attributes import flag_modified
    vtype.sensor_schema = body.sensor_schema
    flag_modified(vtype, "sensor_schema")
    await db.commit()
    await db.refresh(vtype)
    return vtype
```

El `flag_modified` es necesario porque SQLAlchemy no siempre detecta cambios en columnas JSONB cuando se reasigna una lista nueva.

- [ ] **Step 3: Commit**

```bash
cd /opt/cmg-telematic1
git add backend/app/schemas/vehicle.py backend/app/api/v1/vehicles.py
git commit -m "feat: add PATCH /vehicle-types/{id}/sensor-schema endpoint (CMG admin)"
```

---

## Task 2 — Backend tests

**Files:**
- Create: `backend/tests/api/test_vehicle_types_api.py`

- [ ] **Step 1: Escribir el test (empezar con test que falla sin el endpoint)**

Verificar que el fichero aún no existe:

```bash
ls /opt/cmg-telematic1/backend/tests/api/test_vehicle_types_api.py 2>&1 || echo "no existe"
```

Crear `backend/tests/api/test_vehicle_types_api.py`:

```python
"""Tests para PATCH /api/v1/vehicle-types/{id}/sensor-schema."""
from unittest.mock import AsyncMock, MagicMock, patch
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser
from app.models.vehicle_type import VehicleType

CMG_TENANT_ID    = uuid.UUID("10000000-0000-0000-0000-000000000000")
CLIENT_TENANT_ID = uuid.UUID("20000000-0000-0000-0000-000000000000")
VTYPE_ID         = uuid.UUID("a0000000-0000-0000-0000-000000000001")

CMG_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CMG_TENANT_ID,
    tenant_tier="cmg", role="admin", email="cmg@test.com",
)
CLIENT_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CLIENT_TENANT_ID,
    tenant_tier="client", role="admin", email="client@test.com",
)


def _override_user(user: CurrentUser):
    app.dependency_overrides[get_current_user] = lambda: user


def _override_db(session):
    async def _gen():
        yield session
    app.dependency_overrides[get_db] = _gen


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def _make_vtype() -> MagicMock:
    vt = MagicMock(spec=VehicleType)
    vt.id = VTYPE_ID
    vt.slug = "cisterna"
    vt.name = "Cisterna"
    vt.sensor_schema = []
    return vt


SENSOR_PAYLOAD = [
    {
        "key": "avl_87",
        "label": "Nivel combustible",
        "unit": "%",
        "min": 0,
        "max": 100,
        "gauge_type": "battery",
        "avl_id": 87,
    }
]


def test_cmg_admin_can_update_sensor_schema():
    """CMG admin PATCH sensor-schema → 200 con schema actualizado."""
    db = AsyncMock()
    vt = _make_vtype()
    db.get = AsyncMock(return_value=vt)
    db.commit = AsyncMock()
    db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "sensor_schema", SENSOR_PAYLOAD))
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.patch(
        f"/api/v1/vehicle-types/{VTYPE_ID}/sensor-schema",
        json={"sensor_schema": SENSOR_PAYLOAD},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["sensor_schema"] == SENSOR_PAYLOAD


def test_client_admin_cannot_update_sensor_schema():
    """Usuario no CMG → 403."""
    db = AsyncMock()
    _override_user(CLIENT_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.patch(
        f"/api/v1/vehicle-types/{VTYPE_ID}/sensor-schema",
        json={"sensor_schema": []},
    )
    assert resp.status_code == 403


def test_unknown_vehicle_type_returns_404():
    """Tipo de vehículo inexistente → 404."""
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.patch(
        f"/api/v1/vehicle-types/{uuid.uuid4()}/sensor-schema",
        json={"sensor_schema": []},
    )
    assert resp.status_code == 404


def test_empty_schema_clears_sensors():
    """Enviar lista vacía borra todos los sensores."""
    db = AsyncMock()
    vt = _make_vtype()
    vt.sensor_schema = SENSOR_PAYLOAD  # empieza con un sensor
    db.get = AsyncMock(return_value=vt)
    db.commit = AsyncMock()
    db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "sensor_schema", []))
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.patch(
        f"/api/v1/vehicle-types/{VTYPE_ID}/sensor-schema",
        json={"sensor_schema": []},
    )
    assert resp.status_code == 200
    assert resp.json()["sensor_schema"] == []
```

- [ ] **Step 2: Ejecutar tests**

```bash
cd /opt/cmg-telematic1
DB_URL="postgresql+asyncpg://cmg:cmg@localhost:5432/cmg" \
DB_URL_SYNC="postgresql+psycopg2://cmg:cmg@localhost:5432/cmg" \
REDIS_URL="redis://localhost:6379" \
SECRET_KEY="test-secret" \
python -m pytest backend/tests/api/test_vehicle_types_api.py -v
```

Resultado esperado: 4 tests PASSED.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/api/test_vehicle_types_api.py
git commit -m "test: vehicle-type sensor-schema endpoint — 4 tests"
```

---

## Task 3 — Frontend: catálogo AVL + queryKeys

**Files:**
- Create: `frontend/src/lib/avlCatalog.ts`
- Modify: `frontend/src/lib/queryKeys.ts`

- [ ] **Step 1: Crear `avlCatalog.ts`**

Crear `frontend/src/lib/avlCatalog.ts` con el catálogo completo de parámetros FMC650 CAN IO. Cada entrada define los valores por defecto que se usan al añadir un sensor al `sensor_schema`:

```typescript
import type { SensorDef } from './types'

export interface AvlParam {
  avl_id: number
  defaultKey: string
  defaultLabel: string
  unit: string | null
  defaultMin: number
  defaultMax: number
  defaultGaugeType: SensorDef['gauge_type']
  scale?: number
  group: 'motor' | 'combustible' | 'freno_carga' | 'analogico' | 'pto' | 'temperatura'
  description: string
}

export const AVL_CATALOG: AvlParam[] = [
  // ── Motor ──────────────────────────────────────────────────────────────────
  {
    avl_id: 88, defaultKey: 'avl_88', defaultLabel: 'RPM Motor', unit: 'rpm',
    defaultMin: 0, defaultMax: 3000, defaultGaugeType: 'circular',
    group: 'motor', description: 'Revoluciones por minuto del motor',
  },
  {
    avl_id: 85, defaultKey: 'avl_85', defaultLabel: 'Carga Motor', unit: '%',
    defaultMin: 0, defaultMax: 100, defaultGaugeType: 'circular',
    group: 'motor', description: 'Carga del motor en porcentaje',
  },
  {
    avl_id: 104, defaultKey: 'avl_104', defaultLabel: 'Horas Motor', unit: 'h',
    defaultMin: 0, defaultMax: 50000, defaultGaugeType: 'numeric',
    group: 'motor', description: 'Horas totales de motor acumuladas',
  },
  {
    avl_id: 80, defaultKey: 'avl_80', defaultLabel: 'Velocidad (CAN)', unit: 'km/h',
    defaultMin: 0, defaultMax: 130, defaultGaugeType: 'numeric',
    group: 'motor', description: 'Velocidad de rueda por CAN bus (J1939)',
  },
  // ── Combustible ────────────────────────────────────────────────────────────
  {
    avl_id: 87, defaultKey: 'avl_87', defaultLabel: 'Nivel Combustible', unit: '%',
    defaultMin: 0, defaultMax: 100, defaultGaugeType: 'battery',
    group: 'combustible', description: 'Nivel de combustible en depósito',
  },
  {
    avl_id: 86, defaultKey: 'avl_86', defaultLabel: 'Combustible Total', unit: 'L',
    defaultMin: 0, defaultMax: 999999, defaultGaugeType: 'numeric',
    group: 'combustible', description: 'Combustible total consumido acumulado',
  },
  {
    avl_id: 135, defaultKey: 'avl_135', defaultLabel: 'Consumo Instantáneo', unit: 'L/h',
    defaultMin: 0, defaultMax: 80, defaultGaugeType: 'circular',
    group: 'combustible', description: 'Tasa de consumo de combustible en tiempo real',
  },
  {
    avl_id: 10455, defaultKey: 'avl_10455', defaultLabel: 'Nivel AdBlue', unit: '%',
    defaultMin: 0, defaultMax: 100, defaultGaugeType: 'battery',
    group: 'combustible', description: 'Nivel de solución AdBlue (SCR)',
  },
  // ── Temperatura ────────────────────────────────────────────────────────────
  {
    avl_id: 127, defaultKey: 'avl_127', defaultLabel: 'Temp. Refrigerante', unit: '°C',
    defaultMin: -20, defaultMax: 120, defaultGaugeType: 'circular',
    group: 'temperatura', description: 'Temperatura del líquido refrigerante del motor',
  },
  {
    avl_id: 70, defaultKey: 'avl_70', defaultLabel: 'Temp. PCB Dispositivo', unit: '°C',
    defaultMin: -40, defaultMax: 85, defaultGaugeType: 'numeric',
    scale: 0.1,
    group: 'temperatura', description: 'Temperatura interna de la PCB del FMC650',
  },
  // ── Freno y carga ──────────────────────────────────────────────────────────
  {
    avl_id: 79, defaultKey: 'avl_79', defaultLabel: 'Pedal Freno', unit: '0/1',
    defaultMin: 0, defaultMax: 1, defaultGaugeType: 'led',
    group: 'freno_carga', description: 'Estado del pedal de freno (0=libre, 1=presionado)',
  },
  {
    avl_id: 84, defaultKey: 'avl_84', defaultLabel: 'Pedal Acelerador', unit: '%',
    defaultMin: 0, defaultMax: 100, defaultGaugeType: 'linear',
    group: 'freno_carga', description: 'Posición del pedal de acelerador',
  },
  {
    avl_id: 139, defaultKey: 'avl_139', defaultLabel: 'Peso Total (PBT)', unit: 'kg',
    defaultMin: 0, defaultMax: 32000, defaultGaugeType: 'numeric',
    group: 'freno_carga', description: 'Peso bruto total del vehículo (combinado)',
  },
  {
    avl_id: 89, defaultKey: 'avl_89', defaultLabel: 'Peso Eje 1', unit: 'kg',
    defaultMin: 0, defaultMax: 12000, defaultGaugeType: 'numeric',
    group: 'freno_carga', description: 'Peso del eje 1 (eje delantero)',
  },
  {
    avl_id: 90, defaultKey: 'avl_90', defaultLabel: 'Peso Eje 2', unit: 'kg',
    defaultMin: 0, defaultMax: 12000, defaultGaugeType: 'numeric',
    group: 'freno_carga', description: 'Peso del eje 2',
  },
  {
    avl_id: 91, defaultKey: 'avl_91', defaultLabel: 'Peso Eje 3', unit: 'kg',
    defaultMin: 0, defaultMax: 12000, defaultGaugeType: 'numeric',
    group: 'freno_carga', description: 'Peso del eje 3',
  },
  {
    avl_id: 92, defaultKey: 'avl_92', defaultLabel: 'Peso Eje 4', unit: 'kg',
    defaultMin: 0, defaultMax: 12000, defaultGaugeType: 'numeric',
    group: 'freno_carga', description: 'Peso del eje 4',
  },
  {
    avl_id: 93, defaultKey: 'avl_93', defaultLabel: 'Peso Eje 5', unit: 'kg',
    defaultMin: 0, defaultMax: 12000, defaultGaugeType: 'numeric',
    group: 'freno_carga', description: 'Peso del eje 5',
  },
  {
    avl_id: 94, defaultKey: 'avl_94', defaultLabel: 'Peso Eje 6', unit: 'kg',
    defaultMin: 0, defaultMax: 12000, defaultGaugeType: 'numeric',
    group: 'freno_carga', description: 'Peso del eje 6',
  },
  {
    avl_id: 95, defaultKey: 'avl_95', defaultLabel: 'Peso Eje 7', unit: 'kg',
    defaultMin: 0, defaultMax: 12000, defaultGaugeType: 'numeric',
    group: 'freno_carga', description: 'Peso del eje 7',
  },
  // ── PTO ───────────────────────────────────────────────────────────────────
  {
    avl_id: 179, defaultKey: 'avl_179', defaultLabel: 'Estado PTO', unit: '0/1',
    defaultMin: 0, defaultMax: 1, defaultGaugeType: 'led',
    group: 'pto', description: 'Estado de la toma de fuerza — FMC650 usa AVL ID 179',
  },
  {
    avl_id: 83, defaultKey: 'avl_83', defaultLabel: 'Estado PTO (alt)', unit: '0/1',
    defaultMin: 0, defaultMax: 1, defaultGaugeType: 'led',
    group: 'pto', description: 'PTO alternativo — algunos dispositivos usan AVL 83',
  },
  // ── Analógico ─────────────────────────────────────────────────────────────
  {
    avl_id: 9, defaultKey: 'avl_9', defaultLabel: 'AIN 1', unit: 'V',
    defaultMin: 0, defaultMax: 30, defaultGaugeType: 'numeric',
    scale: 0.001,
    group: 'analogico', description: 'Entrada analógica 1 (0–30 V, valor raw en mV)',
  },
  {
    avl_id: 10, defaultKey: 'avl_10', defaultLabel: 'AIN 2', unit: 'V',
    defaultMin: 0, defaultMax: 30, defaultGaugeType: 'numeric',
    scale: 0.001,
    group: 'analogico', description: 'Entrada analógica 2 (0–30 V, valor raw en mV)',
  },
  {
    avl_id: 11, defaultKey: 'avl_11', defaultLabel: 'AIN 3', unit: 'V',
    defaultMin: 0, defaultMax: 30, defaultGaugeType: 'numeric',
    scale: 0.001,
    group: 'analogico', description: 'Entrada analógica 3 (0–30 V, valor raw en mV)',
  },
  {
    avl_id: 245, defaultKey: 'avl_245', defaultLabel: 'AIN 4', unit: 'V',
    defaultMin: 0, defaultMax: 30, defaultGaugeType: 'numeric',
    scale: 0.001,
    group: 'analogico', description: 'Entrada analógica 4 (0–30 V, valor raw en mV)',
  },
]

export const GROUP_LABELS: Record<AvlParam['group'], string> = {
  motor: 'Motor',
  combustible: 'Combustible',
  temperatura: 'Temperatura',
  freno_carga: 'Freno y carga',
  pto: 'PTO',
  analogico: 'Analógico',
}

export function avlParamToSensorDef(param: AvlParam): SensorDef {
  return {
    key: param.defaultKey,
    label: param.defaultLabel,
    unit: param.unit,
    min: param.defaultMin,
    max: param.defaultMax,
    gauge_type: param.defaultGaugeType,
    avl_id: param.avl_id,
    ...(param.scale != null ? { scale: param.scale } : {}),
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit
```

Resultado esperado: sin errores.

- [ ] **Step 3: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/lib/avlCatalog.ts
git commit -m "feat: AVL parameter catalog — 25 FMC650 CAN parameters"
```

---

## Task 4 — Frontend: VehicleTypeSensorsSection

**Files:**
- Create: `frontend/src/features/settings/VehicleTypeSensorsSection.tsx`

UX: selector de tipo de vehículo en la parte superior → tabla con los sensores activos → botón "+ Añadir sensor" → modal con selector del catálogo + label editable + tipo de gauge + min/max. Cada operación (añadir, eliminar) hace PATCH inmediato.

- [ ] **Step 1: Crear el componente**

Crear `frontend/src/features/settings/VehicleTypeSensorsSection.tsx`:

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleTypeOut, SensorDef } from '../../lib/types'
import { AVL_CATALOG, GROUP_LABELS, avlParamToSensorDef } from '../../lib/avlCatalog'

const GAUGE_OPTIONS: SensorDef['gauge_type'][] = ['circular', 'linear', 'battery', 'numeric', 'led']

const sectionStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--bg-border)',
  borderRadius: 8,
  padding: 20,
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  color: 'var(--text-base, #E7E5E4)',
  border: '1px solid var(--bg-border)',
  borderRadius: 5,
  padding: '6px 10px',
  fontSize: 13,
  width: '100%',
}

interface AddSensorForm {
  avl_id: number
  label: string
  gauge_type: SensorDef['gauge_type']
  min: number
  max: number
}

export default function VehicleTypeSensorsSection() {
  const queryClient = useQueryClient()
  const [selectedTypeId, setSelectedTypeId] = useState<string>('')
  const [showModal, setShowModal] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<AddSensorForm>>({})

  const { data: vehicleTypes = [], isLoading } = useQuery({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: 60_000,
  })

  const selectedType = vehicleTypes.find(vt => vt.id === selectedTypeId)

  const patchSchemaMutation = useMutation({
    mutationFn: ({ id, schema }: { id: string; schema: SensorDef[] }) =>
      apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${id}/sensor-schema`, { sensor_schema: schema }),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.vehicleTypes(), (old: VehicleTypeOut[] | undefined) =>
        old?.map(vt => vt.id === updated.id ? updated : vt) ?? [updated]
      )
    },
    onError: (err: Error) => setModalError(err.message),
  })

  function handleCatalogChange(avlId: number) {
    const param = AVL_CATALOG.find(p => p.avl_id === avlId)
    if (!param) return
    setForm({
      avl_id: param.avl_id,
      label: param.defaultLabel,
      gauge_type: param.defaultGaugeType,
      min: param.defaultMin,
      max: param.defaultMax,
    })
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedType || form.avl_id == null || !form.label || !form.gauge_type) {
      setModalError('Completa todos los campos')
      return
    }
    const param = AVL_CATALOG.find(p => p.avl_id === form.avl_id)
    if (!param) { setModalError('Parámetro no encontrado'); return }
    const alreadyAdded = selectedType.sensor_schema.some(s => s.avl_id === form.avl_id)
    if (alreadyAdded) { setModalError('Este sensor ya está configurado para este tipo de vehículo'); return }

    const newSensor: SensorDef = {
      ...avlParamToSensorDef(param),
      label: form.label,
      gauge_type: form.gauge_type,
      min: form.min ?? param.defaultMin,
      max: form.max ?? param.defaultMax,
    }
    const updatedSchema = [...selectedType.sensor_schema, newSensor]
    patchSchemaMutation.mutate(
      { id: selectedType.id, schema: updatedSchema },
      {
        onSuccess: () => {
          setShowModal(false)
          setForm({})
          setModalError(null)
        },
      },
    )
  }

  function handleRemove(avlId: number | undefined) {
    if (!selectedType) return
    const updatedSchema = selectedType.sensor_schema.filter(s => s.avl_id !== avlId)
    patchSchemaMutation.mutate({ id: selectedType.id, schema: updatedSchema })
  }

  const activeAvlIds = new Set(selectedType?.sensor_schema.map(s => s.avl_id) ?? [])

  return (
    <div style={sectionStyle}>
      <h3 style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-base, #E7E5E4)' }}>
        Sensores por tipo de vehículo
      </h3>

      {isLoading ? (
        <div style={{ color: 'var(--accent-off)', fontSize: 13 }}>Cargando…</div>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>
              Tipo de vehículo
            </label>
            <select
              style={{ ...inputStyle, maxWidth: 300 }}
              value={selectedTypeId}
              onChange={e => { setSelectedTypeId(e.target.value); setModalError(null) }}
            >
              <option value="">Seleccionar tipo…</option>
              {vehicleTypes.map(vt => (
                <option key={vt.id} value={vt.id}>{vt.name}</option>
              ))}
            </select>
          </div>

          {selectedType && (
            <>
              {selectedType.sensor_schema.length === 0 ? (
                <div style={{ color: 'var(--accent-off)', fontSize: 13, marginBottom: 12 }}>
                  No hay sensores configurados. Añade uno del catálogo CAN.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
                      <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--accent-off)' }}>Label</th>
                      <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--accent-off)' }}>AVL ID</th>
                      <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--accent-off)' }}>Gauge</th>
                      <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--accent-off)' }}>Min / Max</th>
                      <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--accent-off)' }}>Unidad</th>
                      <th style={{ width: 32 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {selectedType.sensor_schema.map(s => (
                      <tr key={s.key} style={{ borderBottom: '1px solid var(--bg-elevated)' }}>
                        <td style={{ padding: '5px 8px', color: 'var(--text-base, #E7E5E4)' }}>{s.label}</td>
                        <td style={{ padding: '5px 8px', color: 'var(--accent-energy)', fontFamily: 'var(--font-data)', fontSize: 11 }}>
                          {s.avl_id != null ? `avl_${s.avl_id}` : '—'}
                        </td>
                        <td style={{ padding: '5px 8px', color: 'var(--accent-off)' }}>{s.gauge_type}</td>
                        <td style={{ padding: '5px 8px', color: 'var(--accent-off)', fontFamily: 'var(--font-data)', fontSize: 11 }}>
                          {s.min ?? 0} / {s.max ?? 100}
                        </td>
                        <td style={{ padding: '5px 8px', color: 'var(--accent-off)' }}>{s.unit ?? '—'}</td>
                        <td style={{ padding: '5px 8px' }}>
                          <button
                            onClick={() => handleRemove(s.avl_id)}
                            disabled={patchSchemaMutation.isPending}
                            title="Eliminar sensor"
                            style={{ background: 'none', border: 'none', color: 'var(--accent-crit)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 2 }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <button
                onClick={() => { setShowModal(true); setForm({}); setModalError(null) }}
                style={{ padding: '5px 12px', background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 5, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
              >
                + Añadir sensor
              </button>
            </>
          )}
        </>
      )}

      {showModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) { setShowModal(false); setModalError(null) } }}
        >
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 10, padding: 24, width: 480, maxWidth: '92vw', maxHeight: '80vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 14 }}>Añadir sensor CAN</h3>
            <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              <div>
                <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>
                  Parámetro del catálogo *
                </label>
                <select
                  style={inputStyle}
                  value={form.avl_id ?? ''}
                  onChange={e => handleCatalogChange(Number(e.target.value))}
                  required
                >
                  <option value="">Seleccionar parámetro…</option>
                  {Object.entries(GROUP_LABELS).map(([groupKey, groupLabel]) => {
                    const params = AVL_CATALOG.filter(p => p.group === groupKey && !activeAvlIds.has(p.avl_id))
                    if (params.length === 0) return null
                    return (
                      <optgroup key={groupKey} label={groupLabel}>
                        {params.map(p => (
                          <option key={p.avl_id} value={p.avl_id}>
                            AVL {p.avl_id} — {p.defaultLabel} ({p.unit ?? 'sin unidad'})
                          </option>
                        ))}
                      </optgroup>
                    )
                  })}
                </select>
              </div>

              {form.avl_id != null && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>
                      Label mostrado *
                    </label>
                    <input
                      style={inputStyle}
                      value={form.label ?? ''}
                      onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>
                      Tipo de gauge *
                    </label>
                    <select
                      style={inputStyle}
                      value={form.gauge_type ?? 'numeric'}
                      onChange={e => setForm(f => ({ ...f, gauge_type: e.target.value as SensorDef['gauge_type'] }))}
                    >
                      {GAUGE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>Mín</label>
                      <input
                        type="number"
                        style={inputStyle}
                        value={form.min ?? 0}
                        onChange={e => setForm(f => ({ ...f, min: Number(e.target.value) }))}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>Máx</label>
                      <input
                        type="number"
                        style={inputStyle}
                        value={form.max ?? 100}
                        onChange={e => setForm(f => ({ ...f, max: Number(e.target.value) }))}
                      />
                    </div>
                  </div>

                  <div style={{ padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 5, fontSize: 11, color: 'var(--accent-off)' }}>
                    {AVL_CATALOG.find(p => p.avl_id === form.avl_id)?.description}
                  </div>
                </>
              )}

              {modalError && (
                <div style={{ color: 'var(--accent-crit)', fontSize: 12 }}>{modalError}</div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setModalError(null) }}
                  style={{ padding: '6px 14px', background: 'var(--bg-elevated)', color: 'var(--text-base, #E7E5E4)', border: '1px solid var(--bg-border)', borderRadius: 5, fontSize: 13, cursor: 'pointer' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={patchSchemaMutation.isPending || form.avl_id == null}
                  style={{ padding: '6px 14px', background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 5, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
                >
                  {patchSchemaMutation.isPending ? 'Guardando…' : 'Añadir'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Integrar en SettingsPage**

Editar `frontend/src/features/settings/SettingsPage.tsx`:

```tsx
import Shell from '../../shared/ui/Shell'
import NotificationSettings from './NotificationSettings'
import UsersSection from './UsersSection'
import WorkCycleDefinitionsSection from './WorkCycleDefinitionsSection'
import VehicleTypeSensorsSection from './VehicleTypeSensorsSection'
import { useAuthStore } from '../auth/useAuthStore'

export default function SettingsPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const isCmg = user?.tenant_tier === 'cmg'

  return (
    <Shell title="Ajustes">
      <div style={{ padding: 24, overflowY: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: 32 }}>
        <NotificationSettings />
        {isAdmin && <UsersSection />}
        {isAdmin && <WorkCycleDefinitionsSection />}
        {isCmg && isAdmin && <VehicleTypeSensorsSection />}
      </div>
    </Shell>
  )
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit
```

Resultado esperado: 0 errores.

- [ ] **Step 4: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/settings/VehicleTypeSensorsSection.tsx \
        frontend/src/features/settings/SettingsPage.tsx
git commit -m "feat: VehicleTypeSensorsSection — CAN sensor catalog UI in Settings"
```

---

## Task 5 — Verificación final

- [ ] **Step 1: Backend tests completos**

```bash
cd /opt/cmg-telematic1
DB_URL="postgresql+asyncpg://cmg:cmg@localhost:5432/cmg" \
DB_URL_SYNC="postgresql+psycopg2://cmg:cmg@localhost:5432/cmg" \
REDIS_URL="redis://localhost:6379" \
SECRET_KEY="test-secret" \
python -m pytest backend/tests/ -v --tb=short
```

Resultado esperado: todos los tests pasan (incluyendo los 4 nuevos de vehicle-types).

- [ ] **Step 2: Frontend typecheck**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit
```

Resultado esperado: 0 errores.

- [ ] **Step 3: Frontend tests**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run
```

Resultado esperado: todos los tests existentes siguen en verde (no hay tests nuevos de frontend para esta feature — la lógica de mutación es tan directa que cae fuera del umbral de valor de test).

- [ ] **Step 4: Verificación manual en producción**

1. Acceder a `cmgtrack.com` con `admin@cmg.es`
2. Navegar a Ajustes → confirmar que aparece la sección "Sensores por tipo de vehículo"
3. Seleccionar un tipo de vehículo (ej. "Cisterna")
4. Click "+ Añadir sensor" → seleccionar "Nivel Combustible (AVL 87)" → Añadir
5. Confirmar que el sensor aparece en la tabla
6. Navegar a Flota → abrir un vehículo de tipo Cisterna → pestaña EN VIVO
7. Confirmar que el gauge "Nivel Combustible" aparece (mostrará `—` hasta que el FMC650 envíe datos)
8. Volver a Ajustes → eliminar el sensor (×) → confirmar que desaparece

- [ ] **Step 5: Commit final (si hay ajustes post-verificación)**

```bash
git add -p  # solo los cambios de ajuste
git commit -m "fix: post-verification adjustments for CAN sensor catalog"
```

---

## Notas de implementación

- **`flag_modified`** en SQLAlchemy: al reasignar un campo JSONB (no mutarlo sino reemplazarlo), SQLAlchemy no siempre detecta el cambio como "dirty". `flag_modified(vtype, 'sensor_schema')` garantiza que el commit incluye la actualización. Sin esto, la primera actualización puede funcionar pero la segunda no.

- **`SensorDef.key`**: se usa `avl_{avl_id}` como clave única. Si un admin añade dos sensors con el mismo `avl_id`, la UI lo bloquea con "Este sensor ya está configurado". No hay constraint en BD pero la UI lo previene.

- **Sensores no en el catálogo**: si en el futuro se necesita un AVL ID personalizado (ej. sensor IFM propietario), se puede añadir directamente como `SensorDef` en `sensor_schema` vía la API sin pasar por el catálogo frontend. La UI de edición avanzada queda para un sprint posterior (YAGNI).

- **`scale` en los sensores analógicos**: AIN 1-4 y PCB Temperature tienen `scale: 0.001` y `0.1` respectivamente. `SensorGrid.tsx` aplica el scale automáticamente: `raw * sensor.scale`. Los AVL IDs 9-11/245 envían mV, el scale los convierte a V para el gauge.

- **AVL IDs top-level** (239=Ignition, 66=Ext Voltage, 179=PTO): writer.py los extrae a campos top-level de `telemetry_record`. Sin embargo, la ingestión también los guarda en `can_data` como `avl_239`, `avl_66`, `avl_179` — así el catálogo puede usarlos igualmente. (Verificar con CAN Scanner una vez conectado el primer FMC650.)
