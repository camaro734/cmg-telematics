# CMG Telematics 2 — Plan 2: Core API + Rules Engine + Notify Service

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete core-api REST + WebSocket layer (Sprint 3) and implement the rules-engine with hot-reload + notify-svc (Sprint 4).

**Architecture:** The core-api (FastAPI) exposes a multi-tenant REST API with JWT auth, serves telemetry from TimescaleDB, and provides a real-time WebSocket feed from Redis Streams. The rules-engine runs as an independent asyncpg/Redis consumer that evaluates 6 alert condition types with hot-reload via PostgreSQL NOTIFY/LISTEN. The notify-svc dispatches email/webhook/in_app with a Redis ZSET escalation timer.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, asyncpg, Redis Streams, httpx, pytest-asyncio, Docker Compose.

**Spec:** `/opt/cmg-telematic1/docs/superpowers/specs/2026-04-18-cmg-telematics2-design.md`

**Contexto Plan 1:** Schema completo en DB, ingest-svc activo en puerto 5027, auth JWT en `/api/v1/auth/login` y `/refresh`. Tenant CMG (tier=cmg), usuario `admin@cmg.es` / `Admin2026!`, vehículo TEST-001 (vacuum, IMEI `000000000000001`). DB en Docker: `postgresql+asyncpg://cmg:changeme_db@127.0.0.1:5432/cmg_telematics`. Redis: `redis://:changeme_redis@127.0.0.1:6379/0`.

---

## Estructura de ficheros

```
/opt/cmg-telematic1/
├── pytest.ini                            ← MODIFY: add pythonpath
├── backend/app/
│   ├── api/v1/
│   │   ├── deps.py                       ← NEW: get_current_user, require_role
│   │   ├── vehicles.py                   ← NEW: vehicles + telemetry endpoints
│   │   ├── alerts.py                     ← NEW: alert instances + ack
│   │   ├── rules.py                      ← NEW: alert rules CRUD
│   │   ├── tenants.py                    ← NEW: tenant + grants mgmt
│   │   ├── ws.py                         ← NEW: WebSocket /ws/fleet + ConnectionManager
│   │   └── router.py                     ← MODIFY: include all new routers
│   ├── schemas/
│   │   ├── vehicle.py                    ← NEW
│   │   ├── alert.py                      ← NEW
│   │   ├── rule.py                       ← NEW
│   │   └── tenant.py                     ← NEW
│   └── main.py                           ← MODIFY: lifespan (Redis + WS task)
├── services/
│   ├── rules-engine/
│   │   ├── Dockerfile                    ← NEW
│   │   ├── pyproject.toml                ← NEW
│   │   └── src/
│   │       ├── __init__.py               ← NEW
│   │       ├── config.py                 ← NEW
│   │       ├── loader.py                 ← NEW
│   │       ├── state.py                  ← NEW
│   │       ├── evaluator.py              ← NEW
│   │       └── main.py                   ← NEW
│   └── notify/
│       ├── Dockerfile                    ← NEW
│       ├── pyproject.toml                ← NEW
│       └── src/
│           ├── __init__.py               ← NEW
│           ├── config.py                 ← NEW
│           ├── dispatcher.py             ← NEW
│           ├── escalation.py             ← NEW
│           └── main.py                   ← NEW
├── docker-compose.yml                    ← MODIFY: add rules-engine + notify-svc
└── tests/
    ├── api/
    │   ├── __init__.py                   ← NEW
    │   ├── conftest.py                   ← NEW
    │   ├── test_vehicles_api.py          ← NEW
    │   ├── test_alerts_api.py            ← NEW
    │   ├── test_rules_api.py             ← NEW
    │   └── test_ws_api.py                ← NEW
    └── rules_engine/
        ├── __init__.py                   ← NEW
        ├── conftest.py                   ← NEW
        └── test_evaluator.py             ← NEW
```

---

### Task 1: Auth dependency + API test scaffolding

**Files:**
- Create: `backend/app/api/v1/deps.py`
- Modify: `pytest.ini`
- Create: `tests/api/__init__.py`
- Create: `tests/api/conftest.py`
- Create: `tests/api/test_auth_deps.py`

- [ ] **Step 1: Write the failing test**

Create `tests/api/__init__.py` (empty).

Create `tests/api/test_auth_deps.py`:

```python
# tests/api/test_auth_deps.py
import pytest


async def test_protected_endpoint_rejects_missing_token(client):
    response = await client.get("/api/v1/vehicles")
    assert response.status_code == 403


async def test_protected_endpoint_rejects_invalid_token(client):
    response = await client.get(
        "/api/v1/vehicles", headers={"Authorization": "Bearer invalid.token.here"}
    )
    assert response.status_code == 401


async def test_protected_endpoint_accepts_valid_token(client, admin_token):
    response = await client.get(
        "/api/v1/vehicles", headers={"Authorization": f"Bearer {admin_token}"}
    )
    # 200 or 404 are both OK — just not 401/403
    assert response.status_code not in (401, 403)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/api/test_auth_deps.py -v 2>&1 | head -30
```

Expected: ImportError or 404 (no /api/v1/vehicles yet) — tests fail because deps.py and conftest don't exist yet.

- [ ] **Step 3: Create `backend/app/api/v1/deps.py`**

```python
# backend/app/api/v1/deps.py
import uuid
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.security import decode_token
from app.schemas.auth import CurrentUser

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> CurrentUser:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autenticado")
    try:
        payload = decode_token(credentials.credentials)
        if payload.get("type") != "access":
            raise ValueError("Not an access token")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc))
    return CurrentUser(
        user_id=uuid.UUID(payload["sub"]),
        tenant_id=uuid.UUID(payload["tenant_id"]),
        tenant_tier=payload["tenant_tier"],
        role=payload["role"],
        email=payload["email"],
    )


def require_role(*roles: str):
    """Dependency factory: requires user to have one of the given roles."""
    async def checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado")
        return user
    return checker


def require_tier(*tiers: str):
    """Dependency factory: requires user's tenant to be one of the given tiers."""
    async def checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.tenant_tier not in tiers:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado")
        return user
    return checker
```

- [ ] **Step 4: Create `tests/api/conftest.py`**

```python
# tests/api/conftest.py
# Env vars must be set before any app import
import os
import sys

os.environ.setdefault(
    "DB_URL",
    "postgresql+asyncpg://cmg:changeme_db@127.0.0.1:5432/cmg_telematics",
)
os.environ.setdefault(
    "DB_URL_SYNC",
    "postgresql://cmg:changeme_db@127.0.0.1:5432/cmg_telematics",
)
os.environ.setdefault("REDIS_URL", "redis://:changeme_redis@127.0.0.1:6379/0")
os.environ.setdefault(
    "SECRET_KEY",
    "changeme_secret_key_64_chars_minimum_replace_in_production",
)

# Add backend to path so `from app.* import` works
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../backend"))

import pytest
from httpx import AsyncClient, ASGITransport


@pytest.fixture
async def client():
    from app.main import app  # lazy import — env vars already set above

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def admin_token(client):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@cmg.es", "password": "Admin2026!"},
    )
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return resp.json()["access_token"]
```

- [ ] **Step 5: Update `pytest.ini`**

```ini
[pytest]
asyncio_mode = auto
asyncio_default_fixture_loop_scope = function
pythonpath = backend
```

- [ ] **Step 6: Run tests again — they should still fail (no /vehicles endpoint yet)**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/api/test_auth_deps.py -v 2>&1 | head -40
```

Expected: `test_protected_endpoint_rejects_missing_token` and `test_protected_endpoint_rejects_invalid_token` FAIL with 404 (route not found yet). `test_protected_endpoint_accepts_valid_token` FAIL with 404. All fail for wrong reasons — that's fine; vehicles will be added in Task 2.

- [ ] **Step 7: Temporarily stub `/api/v1/vehicles` in router to make auth tests pass**

Add a temporary stub to `backend/app/api/v1/router.py` so we can run the auth tests now:

```python
# backend/app/api/v1/router.py
from fastapi import APIRouter, Depends
from app.api.v1.auth import router as auth_router
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)


@api_router.get("/vehicles")
async def _vehicles_stub(user: CurrentUser = Depends(get_current_user)):
    return []
```

- [ ] **Step 8: Run auth dep tests — they must pass**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/api/test_auth_deps.py -v
```

Expected output:
```
tests/api/test_auth_deps.py::test_protected_endpoint_rejects_missing_token PASSED
tests/api/test_auth_deps.py::test_protected_endpoint_rejects_invalid_token PASSED
tests/api/test_auth_deps.py::test_protected_endpoint_accepts_valid_token PASSED
3 passed
```

- [ ] **Step 9: Commit**

```bash
cd /opt/cmg-telematic1
git add backend/app/api/v1/deps.py backend/app/api/v1/router.py \
        tests/api/__init__.py tests/api/conftest.py tests/api/test_auth_deps.py \
        pytest.ini
git commit -m "feat: auth dependency get_current_user + API test scaffolding"
```

---

### Task 2: Vehicle types + vehicles list endpoint

**Files:**
- Create: `backend/app/schemas/vehicle.py`
- Create: `backend/app/api/v1/vehicles.py`
- Modify: `backend/app/api/v1/router.py`
- Create: `tests/api/test_vehicles_api.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/api/test_vehicles_api.py
import pytest


async def test_list_vehicle_types_requires_auth(client):
    resp = await client.get("/api/v1/vehicle-types")
    assert resp.status_code == 403


async def test_list_vehicle_types(client, admin_token):
    resp = await client.get(
        "/api/v1/vehicle-types",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 3  # vacuum, sweeper, cistern from seeds
    slugs = [v["slug"] for v in data]
    assert "vacuum" in slugs
    assert "sweeper" in slugs


async def test_list_vehicles(client, admin_token):
    resp = await client.get(
        "/api/v1/vehicles",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1  # TEST-001 from seed
    v = data[0]
    assert "id" in v
    assert "name" in v
    assert "tenant_id" in v
    assert "vehicle_type_id" in v


async def test_get_vehicle_by_id(client, admin_token):
    # Get first vehicle id from list
    list_resp = await client.get(
        "/api/v1/vehicles",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    vehicle_id = list_resp.json()[0]["id"]

    resp = await client.get(
        f"/api/v1/vehicles/{vehicle_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == vehicle_id


async def test_get_vehicle_wrong_tenant_returns_404(client, admin_token):
    import uuid
    resp = await client.get(
        f"/api/v1/vehicles/{uuid.uuid4()}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 404
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/api/test_vehicles_api.py -v 2>&1 | head -30
```

Expected: All FAIL with 404 or 422 — endpoints don't exist yet.

- [ ] **Step 3: Create `backend/app/schemas/vehicle.py`**

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
```

- [ ] **Step 4: Create `backend/app/api/v1/vehicles.py`**

```python
# backend/app/api/v1/vehicles.py
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.schemas.vehicle import (
    VehicleTypeOut, VehicleOut, VehicleStatus,
    TelemetryPoint, TrackPoint, KpiHour,
)
from app.models.vehicle import Vehicle
from app.models.vehicle_type import VehicleType
from app.models.device import Device

router = APIRouter(tags=["vehicles"])


def _check_vehicle_access(vehicle: Vehicle, user: CurrentUser) -> None:
    if user.tenant_tier == "cmg":
        return
    if str(vehicle.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")


@router.get("/vehicle-types", response_model=list[VehicleTypeOut])
async def list_vehicle_types(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(VehicleType).order_by(VehicleType.name))
    return result.scalars().all()


@router.get("/vehicles", response_model=list[VehicleOut])
async def list_vehicles(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Vehicle).where(Vehicle.active == True)
    if user.tenant_tier != "cmg":
        query = query.where(Vehicle.tenant_id == user.tenant_id)
    result = await db.execute(query.order_by(Vehicle.name))
    return result.scalars().all()


@router.get("/vehicles/{vehicle_id}", response_model=VehicleOut)
async def get_vehicle(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)
    return vehicle


@router.get("/vehicles/{vehicle_id}/status", response_model=VehicleStatus)
async def get_vehicle_status(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)

    device_result = await db.execute(
        select(Device).where(Device.vehicle_id == vehicle_id, Device.active == True)
    )
    device = device_result.scalar_one_or_none()

    since = datetime.now(timezone.utc) - timedelta(days=1)
    row = (
        await db.execute(
            text(
                "SELECT lat, lon, speed_kmh, ignition, pto_active, can_data "
                "FROM telemetry_record "
                "WHERE vehicle_id = :vid AND tenant_id = :tid AND time >= :since "
                "ORDER BY time DESC LIMIT 1"
            ),
            {"vid": vehicle_id, "tid": vehicle.tenant_id, "since": since},
        )
    ).fetchone()

    return VehicleStatus(
        vehicle_id=vehicle_id,
        online=device.online if device else False,
        last_seen=device.last_seen if device else None,
        lat=row.lat if row else None,
        lon=row.lon if row else None,
        speed_kmh=row.speed_kmh if row else None,
        ignition=row.ignition if row else None,
        pto_active=row.pto_active if row else None,
        can_data=row.can_data if row else None,
    )


@router.get("/vehicles/{vehicle_id}/telemetry/latest", response_model=list[TelemetryPoint])
async def get_vehicle_telemetry_latest(
    vehicle_id: uuid.UUID,
    limit: int = 50,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if limit > 1000:
        limit = 1000
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)

    since = datetime.now(timezone.utc) - timedelta(days=7)
    rows = (
        await db.execute(
            text(
                "SELECT time, lat, lon, speed_kmh, heading, altitude_m, "
                "ignition, pto_active, ext_voltage_mv, can_data "
                "FROM telemetry_record "
                "WHERE vehicle_id = :vid AND tenant_id = :tid AND time >= :since "
                "ORDER BY time DESC LIMIT :lim"
            ),
            {"vid": vehicle_id, "tid": vehicle.tenant_id, "since": since, "lim": limit},
        )
    ).fetchall()

    return [TelemetryPoint(**dict(r._mapping)) for r in rows]


@router.get("/vehicles/{vehicle_id}/telemetry/history", response_model=list[TelemetryPoint])
async def get_vehicle_telemetry_history(
    vehicle_id: uuid.UUID,
    from_ts: datetime | None = None,
    to_ts: datetime | None = None,
    limit: int = 500,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if limit > 5000:
        limit = 5000
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)

    if from_ts is None:
        from_ts = datetime.now(timezone.utc) - timedelta(days=1)
    if to_ts is None:
        to_ts = datetime.now(timezone.utc)

    rows = (
        await db.execute(
            text(
                "SELECT time, lat, lon, speed_kmh, heading, altitude_m, "
                "ignition, pto_active, ext_voltage_mv, can_data "
                "FROM telemetry_record "
                "WHERE vehicle_id = :vid AND tenant_id = :tid "
                "AND time >= :from_ts AND time <= :to_ts "
                "ORDER BY time DESC LIMIT :lim"
            ),
            {
                "vid": vehicle_id,
                "tid": vehicle.tenant_id,
                "from_ts": from_ts,
                "to_ts": to_ts,
                "lim": limit,
            },
        )
    ).fetchall()

    return [TelemetryPoint(**dict(r._mapping)) for r in rows]


@router.get("/vehicles/{vehicle_id}/track/today", response_model=list[TrackPoint])
async def get_vehicle_track_today(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)

    rows = (
        await db.execute(
            text(
                "SELECT time, lat, lon FROM telemetry_record "
                "WHERE vehicle_id = :vid AND tenant_id = :tid "
                "AND time >= current_date::timestamptz "
                "AND lat IS NOT NULL AND lon IS NOT NULL "
                "ORDER BY time ASC LIMIT 2000"
            ),
            {"vid": vehicle_id, "tid": vehicle.tenant_id},
        )
    ).fetchall()

    return [TrackPoint(**dict(r._mapping)) for r in rows]


@router.get("/vehicles/{vehicle_id}/kpis", response_model=list[KpiHour])
async def get_vehicle_kpis(
    vehicle_id: uuid.UUID,
    hours: int = 24,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if hours > 24 * 30:
        hours = 24 * 30
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)

    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = (
        await db.execute(
            text(
                "SELECT bucket, avg_pressure_1, max_pressure_1, avg_oil_temp, "
                "max_oil_temp, pto_active_minutes, engine_on_minutes, record_count "
                "FROM telemetry_1h "
                "WHERE vehicle_id = :vid AND tenant_id = :tid AND bucket >= :since "
                "ORDER BY bucket DESC"
            ),
            {"vid": vehicle_id, "tid": vehicle.tenant_id, "since": since},
        )
    ).fetchall()

    return [KpiHour(**dict(r._mapping)) for r in rows]
```

- [ ] **Step 5: Update `backend/app/api/v1/router.py`**

```python
# backend/app/api/v1/router.py
from fastapi import APIRouter
from app.api.v1.auth import router as auth_router
from app.api.v1.vehicles import router as vehicles_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(vehicles_router)
```

- [ ] **Step 6: Run vehicle tests — must pass**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/api/test_vehicles_api.py -v
```

Expected: all 5 tests PASS.

- [ ] **Step 7: Also confirm auth tests still pass**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/api/ -v
```

Expected: 8 tests PASS.

- [ ] **Step 8: Commit**

```bash
cd /opt/cmg-telematic1
git add backend/app/schemas/vehicle.py backend/app/api/v1/vehicles.py \
        backend/app/api/v1/router.py \
        tests/api/test_vehicles_api.py
git commit -m "feat: vehicle-types + vehicles REST endpoints with tenant scope"
```

---

### Task 3: Alert instances endpoint + acknowledge

**Files:**
- Create: `backend/app/schemas/alert.py`
- Create: `backend/app/api/v1/alerts.py`
- Modify: `backend/app/api/v1/router.py`
- Create: `tests/api/test_alerts_api.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/api/test_alerts_api.py
import pytest
import uuid


async def test_list_alerts_requires_auth(client):
    resp = await client.get("/api/v1/alerts")
    assert resp.status_code == 403


async def test_list_alerts_empty(client, admin_token):
    resp = await client.get(
        "/api/v1/alerts",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


async def test_ack_nonexistent_alert_returns_404(client, admin_token):
    fake_id = str(uuid.uuid4())
    resp = await client.post(
        f"/api/v1/alerts/{fake_id}/acknowledge",
        json={"note": "test"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 404
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/api/test_alerts_api.py -v 2>&1 | head -20
```

Expected: all FAIL with 404/403.

- [ ] **Step 3: Create `backend/app/schemas/alert.py`**

```python
# backend/app/schemas/alert.py
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict


class AlertInstanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    rule_id: uuid.UUID
    vehicle_id: uuid.UUID
    tenant_id: uuid.UUID
    triggered_at: datetime
    resolved_at: datetime | None = None
    status: str
    trigger_value: dict[str, Any] | None = None
    ack_by_user_id: uuid.UUID | None = None
    ack_at: datetime | None = None
    ack_note: str | None = None


class AckRequest(BaseModel):
    note: str | None = None
```

- [ ] **Step 4: Create `backend/app/api/v1/alerts.py`**

```python
# backend/app/api/v1/alerts.py
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.schemas.alert import AlertInstanceOut, AckRequest
from app.models.alert_instance import AlertInstance

router = APIRouter(tags=["alerts"])


@router.get("/alerts", response_model=list[AlertInstanceOut])
async def list_alerts(
    alert_status: str | None = Query(None, alias="status"),
    limit: int = 50,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if limit > 200:
        limit = 200
    query = select(AlertInstance)
    if user.tenant_tier != "cmg":
        query = query.where(AlertInstance.tenant_id == user.tenant_id)
    if alert_status:
        query = query.where(AlertInstance.status == alert_status)
    query = query.order_by(AlertInstance.triggered_at.desc()).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/alerts/{alert_id}/acknowledge", response_model=AlertInstanceOut)
async def acknowledge_alert(
    alert_id: uuid.UUID,
    body: AckRequest,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    alert = await db.get(AlertInstance, alert_id)
    if not alert:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alerta no encontrada")
    if user.tenant_tier != "cmg" and str(alert.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alerta no encontrada")
    if alert.status not in ("firing", "escalated"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No se puede reconocer alerta en estado '{alert.status}'",
        )

    alert.status = "acknowledged"
    alert.ack_by_user_id = user.user_id
    alert.ack_at = datetime.now(timezone.utc)
    alert.ack_note = body.note
    await db.commit()
    await db.refresh(alert)
    return alert
```

- [ ] **Step 5: Update `backend/app/api/v1/router.py`**

```python
# backend/app/api/v1/router.py
from fastapi import APIRouter
from app.api.v1.auth import router as auth_router
from app.api.v1.vehicles import router as vehicles_router
from app.api.v1.alerts import router as alerts_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(vehicles_router)
api_router.include_router(alerts_router)
```

- [ ] **Step 6: Run tests**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/api/test_alerts_api.py -v
```

Expected: 3 tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /opt/cmg-telematic1
git add backend/app/schemas/alert.py backend/app/api/v1/alerts.py \
        backend/app/api/v1/router.py tests/api/test_alerts_api.py
git commit -m "feat: alert instances list + acknowledge endpoint"
```

---

### Task 4: Alert rules CRUD

**Files:**
- Create: `backend/app/schemas/rule.py`
- Create: `backend/app/api/v1/rules.py`
- Modify: `backend/app/api/v1/router.py`
- Create: `tests/api/test_rules_api.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/api/test_rules_api.py
import pytest
import uuid

RULE_PAYLOAD = {
    "name": "Presión alta bomba",
    "condition": {
        "type": "threshold",
        "field": "hydraulic_pressure_1",
        "op": ">",
        "value": 220.0,
    },
    "severity": "warning",
    "vehicle_filter": {"scope": "all"},
    "actions": [{"type": "in_app"}],
    "cooldown_minutes": 30,
}


async def test_list_rules_empty(client, admin_token):
    resp = await client.get(
        "/api/v1/rules", headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


async def test_create_rule(client, admin_token):
    resp = await client.post(
        "/api/v1/rules",
        json=RULE_PAYLOAD,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == RULE_PAYLOAD["name"]
    assert data["severity"] == "warning"
    assert "id" in data
    return data["id"]


async def test_update_rule(client, admin_token):
    create_resp = await client.post(
        "/api/v1/rules",
        json=RULE_PAYLOAD,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    rule_id = create_resp.json()["id"]

    resp = await client.put(
        f"/api/v1/rules/{rule_id}",
        json={"name": "Presión alta — actualizado", "active": False},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Presión alta — actualizado"
    assert resp.json()["active"] is False


async def test_delete_rule(client, admin_token):
    create_resp = await client.post(
        "/api/v1/rules",
        json=RULE_PAYLOAD,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    rule_id = create_resp.json()["id"]

    resp = await client.delete(
        f"/api/v1/rules/{rule_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 204

    get_resp = await client.get(
        f"/api/v1/rules/{rule_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert get_resp.status_code == 404


async def test_test_rule_endpoint(client, admin_token):
    create_resp = await client.post(
        "/api/v1/rules",
        json=RULE_PAYLOAD,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    rule_id = create_resp.json()["id"]

    # Test with value that should fire
    resp = await client.post(
        f"/api/v1/rules/{rule_id}/test",
        json={"field_values": {"hydraulic_pressure_1": 250.0}},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["would_fire"] is True

    # Test with value that should not fire
    resp2 = await client.post(
        f"/api/v1/rules/{rule_id}/test",
        json={"field_values": {"hydraulic_pressure_1": 100.0}},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp2.status_code == 200
    assert resp2.json()["would_fire"] is False
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/api/test_rules_api.py -v 2>&1 | head -20
```

Expected: all FAIL.

- [ ] **Step 3: Create `backend/app/schemas/rule.py`**

```python
# backend/app/schemas/rule.py
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict


class RuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    description: str | None = None
    active: bool
    vehicle_filter: dict[str, Any]
    condition: dict[str, Any]
    severity: str
    actions: list[Any]
    escalation: list[Any]
    schedule: dict[str, Any]
    cooldown_minutes: int
    created_at: datetime


class RuleCreate(BaseModel):
    name: str
    description: str | None = None
    vehicle_filter: dict[str, Any] = {"scope": "all"}
    condition: dict[str, Any]
    severity: str = "warning"
    actions: list[Any] = []
    escalation: list[Any] = []
    schedule: dict[str, Any] = {"type": "always"}
    cooldown_minutes: int = 30


class RuleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    active: bool | None = None
    vehicle_filter: dict[str, Any] | None = None
    condition: dict[str, Any] | None = None
    severity: str | None = None
    actions: list[Any] | None = None
    escalation: list[Any] | None = None
    schedule: dict[str, Any] | None = None
    cooldown_minutes: int | None = None


class RuleTestRequest(BaseModel):
    field_values: dict[str, Any]


class RuleTestResult(BaseModel):
    would_fire: bool
    trigger_value: float | None = None
    reason: str | None = None
```

- [ ] **Step 4: Create `backend/app/api/v1/rules.py`**

```python
# backend/app/api/v1/rules.py
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.schemas.rule import RuleOut, RuleCreate, RuleUpdate, RuleTestRequest, RuleTestResult
from app.models.alert_rule import AlertRule

router = APIRouter(tags=["rules"])

_OPS = {">": float.__gt__, "<": float.__lt__, ">=": float.__ge__, "<=": float.__le__, "==": float.__eq__, "!=": float.__ne__}


def _eval_threshold(condition: dict, field_values: dict) -> tuple[bool, float | None]:
    field = condition.get("field", "")
    val = field_values.get(field)
    if val is None:
        return False, None
    try:
        fval = float(val)
        op_fn = _OPS.get(condition.get("op", ">"))
        threshold = float(condition.get("value", 0))
        return (op_fn(fval, threshold) if op_fn else False), fval
    except (TypeError, ValueError):
        return False, None


@router.get("/rules", response_model=list[RuleOut])
async def list_rules(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(AlertRule)
    if user.tenant_tier != "cmg":
        query = query.where(AlertRule.tenant_id == user.tenant_id)
    result = await db.execute(query.order_by(AlertRule.created_at.desc()))
    return result.scalars().all()


@router.get("/rules/{rule_id}", response_model=RuleOut)
async def get_rule(
    rule_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    if user.tenant_tier != "cmg" and str(rule.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    return rule


@router.post("/rules", response_model=RuleOut, status_code=status.HTTP_201_CREATED)
async def create_rule(
    body: RuleCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado")
    rule = AlertRule(
        tenant_id=user.tenant_id,
        created_by_user_id=user.user_id,
        **body.model_dump(),
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.put("/rules/{rule_id}", response_model=RuleOut)
async def update_rule(
    rule_id: uuid.UUID,
    body: RuleUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    if user.tenant_tier != "cmg" and str(rule.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(rule, field, value)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(
    rule_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    if user.tenant_tier != "cmg" and str(rule.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado")
    await db.delete(rule)
    await db.commit()


@router.post("/rules/{rule_id}/test", response_model=RuleTestResult)
async def test_rule(
    rule_id: uuid.UUID,
    body: RuleTestRequest,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    if user.tenant_tier != "cmg" and str(rule.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")

    ctype = rule.condition.get("type")
    if ctype == "threshold":
        fired, val = _eval_threshold(rule.condition, body.field_values)
        return RuleTestResult(would_fire=fired, trigger_value=val)

    return RuleTestResult(
        would_fire=False,
        reason=f"Tipo '{ctype}' requiere estado — prueba con datos reales",
    )
```

- [ ] **Step 5: Update `backend/app/api/v1/router.py`**

```python
# backend/app/api/v1/router.py
from fastapi import APIRouter
from app.api.v1.auth import router as auth_router
from app.api.v1.vehicles import router as vehicles_router
from app.api.v1.alerts import router as alerts_router
from app.api.v1.rules import router as rules_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(vehicles_router)
api_router.include_router(alerts_router)
api_router.include_router(rules_router)
```

- [ ] **Step 6: Run tests**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/api/test_rules_api.py -v
```

Expected: 5 tests PASS.

- [ ] **Step 7: Run all API tests together**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/api/ -v
```

Expected: 13+ tests PASS.

- [ ] **Step 8: Commit**

```bash
cd /opt/cmg-telematic1
git add backend/app/schemas/rule.py backend/app/api/v1/rules.py \
        backend/app/api/v1/router.py tests/api/test_rules_api.py
git commit -m "feat: alert rules CRUD + threshold test endpoint"
```

---

### Task 5: Tenants + permission grants

**Files:**
- Create: `backend/app/schemas/tenant.py`
- Create: `backend/app/api/v1/tenants.py`
- Modify: `backend/app/api/v1/router.py`

- [ ] **Step 1: Create `backend/app/schemas/tenant.py`**

```python
# backend/app/schemas/tenant.py
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict


class TenantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    parent_id: uuid.UUID | None = None
    tier: str
    name: str
    slug: str
    active: bool
    brand_name: str | None = None
    brand_color: str | None = None
    logo_url: str | None = None
    custom_domain: str | None = None
    brand_tokens: dict[str, Any] | None = None
    created_at: datetime


class TenantCreate(BaseModel):
    parent_id: uuid.UUID | None = None
    tier: str
    name: str
    slug: str
    brand_name: str | None = None
    brand_color: str | None = None
    logo_url: str | None = None


class BrandTokensUpdate(BaseModel):
    brand_tokens: dict[str, Any]


class GrantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    grantor_id: uuid.UUID
    grantee_id: uuid.UUID
    resource_type: str
    resource_id: uuid.UUID | None = None
    allowed_actions: list[str]
    constraints: dict[str, Any] | None = None
    granted_at: datetime
    expires_at: datetime | None = None
    active: bool


class GrantCreate(BaseModel):
    grantee_id: uuid.UUID
    resource_type: str
    resource_id: uuid.UUID | None = None
    allowed_actions: list[str]
    constraints: dict[str, Any] | None = None
    expires_at: datetime | None = None
```

- [ ] **Step 2: Create `backend/app/api/v1/tenants.py`**

```python
# backend/app/api/v1/tenants.py
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from app.core.database import get_db
from app.api.v1.deps import get_current_user, require_tier
from app.schemas.auth import CurrentUser
from app.schemas.tenant import TenantOut, TenantCreate, BrandTokensUpdate, GrantOut, GrantCreate
from app.models.tenant import Tenant
from app.models.permission_grant import PermissionGrant

router = APIRouter(tags=["tenants"])


@router.get("/tenants", response_model=list[TenantOut])
async def list_tenants(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier == "cmg":
        result = await db.execute(select(Tenant).order_by(Tenant.name))
    else:
        result = await db.execute(
            select(Tenant).where(Tenant.id == user.tenant_id)
        )
    return result.scalars().all()


@router.post("/tenants", response_model=TenantOut, status_code=status.HTTP_201_CREATED)
async def create_tenant(
    body: TenantCreate,
    user: CurrentUser = Depends(require_tier("cmg")),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(select(Tenant).where(Tenant.slug == body.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un tenant con slug '{body.slug}'",
        )
    tenant = Tenant(**body.model_dump())
    db.add(tenant)
    await db.commit()
    await db.refresh(tenant)
    return tenant


@router.get("/tenants/{tenant_id}/brand-tokens")
async def get_brand_tokens(
    tenant_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    return tenant.brand_tokens or {}


@router.put("/tenants/{tenant_id}/brand-tokens")
async def update_brand_tokens(
    tenant_id: uuid.UUID,
    body: BrandTokensUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    if user.tenant_tier != "cmg" and str(tenant.id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado")
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo admins")
    tenant.brand_tokens = body.brand_tokens
    await db.commit()
    return tenant.brand_tokens


# --- Grants ---

@router.get("/grants", response_model=list[GrantOut])
async def list_grants(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier == "cmg":
        result = await db.execute(select(PermissionGrant).where(PermissionGrant.active == True))
    else:
        result = await db.execute(
            select(PermissionGrant).where(
                PermissionGrant.active == True,
                or_(
                    PermissionGrant.grantor_id == user.tenant_id,
                    PermissionGrant.grantee_id == user.tenant_id,
                ),
            )
        )
    return result.scalars().all()


@router.post("/grants", response_model=GrantOut, status_code=status.HTTP_201_CREATED)
async def create_grant(
    body: GrantCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo admins")
    # Grantor is always the current user's tenant
    grant = PermissionGrant(
        grantor_id=user.tenant_id,
        granted_by_user=user.user_id,
        **body.model_dump(),
    )
    db.add(grant)
    await db.commit()
    await db.refresh(grant)
    return grant


@router.delete("/grants/{grant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_grant(
    grant_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    grant = await db.get(PermissionGrant, grant_id)
    if not grant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Grant no encontrado")
    if user.tenant_tier != "cmg" and str(grant.grantor_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado")
    grant.active = False
    await db.commit()
```

- [ ] **Step 3: Update `backend/app/api/v1/router.py`**

```python
# backend/app/api/v1/router.py
from fastapi import APIRouter
from app.api.v1.auth import router as auth_router
from app.api.v1.vehicles import router as vehicles_router
from app.api.v1.alerts import router as alerts_router
from app.api.v1.rules import router as rules_router
from app.api.v1.tenants import router as tenants_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(vehicles_router)
api_router.include_router(alerts_router)
api_router.include_router(rules_router)
api_router.include_router(tenants_router)
```

- [ ] **Step 4: Run all API tests to confirm no regressions**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/api/ -v
```

Expected: 13+ tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /opt/cmg-telematic1
git add backend/app/schemas/tenant.py backend/app/api/v1/tenants.py \
        backend/app/api/v1/router.py
git commit -m "feat: tenants admin + permission grants endpoints"
```

---

### Task 6: WebSocket /ws/fleet + Redis lifespan

**Files:**
- Create: `backend/app/api/v1/ws.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/api/v1/router.py`
- Create: `tests/api/test_ws_api.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/api/test_ws_api.py
# Note: WS tests use starlette TestClient (sync) — no async fixtures.
# Env vars already set by tests/api/conftest.py (processed first by pytest).
import uuid
from starlette.testclient import TestClient


def _make_valid_token() -> str:
    """Creates a valid JWT without hitting the DB."""
    from app.core.security import create_access_token
    return create_access_token({
        "sub": str(uuid.uuid4()),
        "tenant_id": str(uuid.uuid4()),
        "tenant_tier": "cmg",
        "role": "admin",
        "email": "ws-test@cmg.es",
    })


def test_ws_rejects_missing_token():
    from app.main import app
    with TestClient(app) as tc:
        with tc.websocket_connect("/ws/fleet") as ws:
            data = ws.receive_json()
            assert data.get("error") == "unauthenticated"


def test_ws_rejects_invalid_token():
    from app.main import app
    with TestClient(app) as tc:
        with tc.websocket_connect("/ws/fleet?token=bad.token.here") as ws:
            data = ws.receive_json()
            assert data.get("error") == "invalid_token"


def test_ws_accepts_valid_token():
    from app.main import app
    token = _make_valid_token()
    with TestClient(app) as tc:
        with tc.websocket_connect(f"/ws/fleet?token={token}") as ws:
            data = ws.receive_json()
            assert data.get("type") == "connected"
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/api/test_ws_api.py -v 2>&1 | head -20
```

Expected: all FAIL (no /ws/fleet endpoint yet).

- [ ] **Step 3: Create `backend/app/api/v1/ws.py`**

```python
# backend/app/api/v1/ws.py
import asyncio
import json
import logging
import uuid
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.security import decode_token
from app.schemas.auth import CurrentUser

logger = logging.getLogger(__name__)
router = APIRouter(tags=["websocket"])


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}

    async def connect(self, ws: WebSocket, tenant_id: str) -> None:
        await ws.accept()
        self._connections.setdefault(tenant_id, set()).add(ws)

    def disconnect(self, ws: WebSocket, tenant_id: str) -> None:
        if tenant_id in self._connections:
            self._connections[tenant_id].discard(ws)

    async def broadcast_to_tenant(self, tenant_id: str, message: dict) -> None:
        dead: set[WebSocket] = set()
        for ws in list(self._connections.get(tenant_id, set())):
            try:
                await ws.send_json(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._connections[tenant_id].discard(ws)

    async def broadcast_to_all(self, message: dict) -> None:
        for tenant_id in list(self._connections):
            await self.broadcast_to_tenant(tenant_id, message)


async def broadcast_telemetry_task(redis, manager: ConnectionManager) -> None:
    last_id = "$"
    while True:
        try:
            entries = await redis.xread({"telemetry.raw": last_id}, block=1000, count=50)
            for _stream, messages in entries:
                for msg_id, fields in messages:
                    last_id = msg_id
                    try:
                        payload = json.loads(
                            fields["payload"] if isinstance(fields, dict) and "payload" in fields
                            else fields[b"payload"]
                        )
                        tenant_id = payload.get("tenant_id")
                        if tenant_id:
                            await manager.broadcast_to_tenant(
                                tenant_id, {"type": "telemetry", "data": payload}
                            )
                    except Exception as exc:
                        logger.debug(f"WS broadcast parse error: {exc}")
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error(f"WS broadcast task error: {exc}")
            await asyncio.sleep(1)


@router.websocket("/ws/fleet")
async def ws_fleet(websocket: WebSocket, token: str | None = None) -> None:
    if not token:
        await websocket.accept()
        await websocket.send_json({"error": "unauthenticated"})
        await websocket.close(code=4001)
        return

    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise ValueError("Not an access token")
        user = CurrentUser(
            user_id=uuid.UUID(payload["sub"]),
            tenant_id=uuid.UUID(payload["tenant_id"]),
            tenant_tier=payload["tenant_tier"],
            role=payload["role"],
            email=payload["email"],
        )
    except ValueError:
        await websocket.accept()
        await websocket.send_json({"error": "invalid_token"})
        await websocket.close(code=4001)
        return

    manager: ConnectionManager = websocket.app.state.ws_manager
    await manager.connect(websocket, str(user.tenant_id))
    try:
        await websocket.send_json({"type": "connected", "tenant_id": str(user.tenant_id)})
        while True:
            await websocket.receive_text()  # keep alive; client may send ping
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket, str(user.tenant_id))
```

- [ ] **Step 4: Update `backend/app/main.py` — add lifespan + ws router**

```python
# backend/app/main.py
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import redis.asyncio as aioredis
from app.api.v1.router import api_router
from app.api.v1.ws import ConnectionManager, broadcast_telemetry_task, router as ws_router
from app.core.config import settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    app.state.ws_manager = ConnectionManager()
    task = asyncio.create_task(
        broadcast_telemetry_task(app.state.redis, app.state.ws_manager)
    )
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    await app.state.redis.aclose()


app = FastAPI(
    title="CMG Telematics API",
    version="2.0.0",
    docs_url="/docs" if not settings.is_production else None,
    redoc_url="/redoc" if not settings.is_production else None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
app.include_router(ws_router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}
```

- [ ] **Step 5: Update `backend/app/api/v1/router.py` — remove vehicles stub if still present**

The router.py from Task 4 is already complete (no stub). Confirm it looks like Task 4's final version. No changes needed.

- [ ] **Step 6: Run WS tests**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/api/test_ws_api.py -v
```

Expected: 3 tests PASS.

- [ ] **Step 7: Run all API tests**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/api/ -v
```

Expected: 16+ tests PASS.

- [ ] **Step 8: Commit**

```bash
cd /opt/cmg-telematic1
git add backend/app/api/v1/ws.py backend/app/main.py \
        backend/app/api/v1/router.py tests/api/test_ws_api.py
git commit -m "feat: WebSocket /ws/fleet + Redis lifespan for real-time telemetry broadcast"
```

---

### Task 7: rules-engine scaffolding + evaluator

**Files:**
- Create: `services/rules-engine/pyproject.toml`
- Create: `services/rules-engine/Dockerfile`
- Create: `services/rules-engine/src/__init__.py`
- Create: `services/rules-engine/src/config.py`
- Create: `services/rules-engine/src/loader.py`
- Create: `services/rules-engine/src/state.py`
- Create: `services/rules-engine/src/evaluator.py`
- Create: `tests/rules_engine/__init__.py`
- Create: `tests/rules_engine/conftest.py`
- Create: `tests/rules_engine/test_evaluator.py`

- [ ] **Step 1: Write failing tests**

Create `tests/rules_engine/__init__.py` (empty).

Create `tests/rules_engine/conftest.py`:

```python
# tests/rules_engine/conftest.py
import sys
import os

# Add rules-engine src to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../services/rules-engine"))
```

Create `tests/rules_engine/test_evaluator.py`:

```python
# tests/rules_engine/test_evaluator.py
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
import pytest
from src.evaluator import evaluate_rule, process_message, TelemetryMsg, _check_schedule
from src.loader import Rule


def make_rule(**kwargs) -> Rule:
    defaults = dict(
        id="rule-1",
        tenant_id="tenant-1",
        name="Test",
        active=True,
        vehicle_filter={"scope": "all"},
        condition={},
        severity="warning",
        actions=[],
        escalation=[],
        schedule={"type": "always"},
        cooldown_minutes=30,
    )
    defaults.update(kwargs)
    return Rule(**defaults)


def make_msg(**kwargs) -> TelemetryMsg:
    defaults = dict(
        time=datetime(2024, 6, 15, 10, 0, 0, tzinfo=timezone.utc),  # Saturday 10:00 UTC
        device_id="dev-1",
        vehicle_id="veh-1",
        tenant_id="tenant-1",
        lat=39.0,
        lon=-0.4,
        speed_kmh=50.0,
        ignition=True,
        pto_active=False,
        can_data={"hydraulic_pressure_1": 230.0, "oil_temp_c": 80.0},
    )
    defaults.update(kwargs)
    return TelemetryMsg(**defaults)


# --- threshold ---

async def test_threshold_fires_when_above():
    rule = make_rule(condition={"type": "threshold", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0})
    msg = make_msg()
    redis = AsyncMock()
    result = await evaluate_rule(rule, msg, redis)
    assert result is not None
    assert result.trigger_value["value"] == 230.0


async def test_threshold_no_fire_when_below():
    rule = make_rule(condition={"type": "threshold", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0})
    msg = make_msg(can_data={"hydraulic_pressure_1": 100.0})
    redis = AsyncMock()
    result = await evaluate_rule(rule, msg, redis)
    assert result is None


async def test_threshold_missing_field_no_fire():
    rule = make_rule(condition={"type": "threshold", "field": "nonexistent_field", "op": ">", "value": 10.0})
    msg = make_msg(can_data={})
    redis = AsyncMock()
    result = await evaluate_rule(rule, msg, redis)
    assert result is None


# --- threshold_sustained ---

async def test_threshold_sustained_starts_timer_first_occurrence():
    rule = make_rule(condition={"type": "threshold_sustained", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0, "minutes": 5})
    msg = make_msg()
    redis = AsyncMock()
    redis.hget.return_value = None  # no timer yet

    result = await evaluate_rule(rule, msg, redis)
    assert result is None  # first occurrence: timer started, not fired
    redis.hset.assert_called_once()  # timer was set


async def test_threshold_sustained_fires_after_duration():
    rule = make_rule(condition={"type": "threshold_sustained", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0, "minutes": 5})
    ts = datetime(2024, 6, 15, 10, 0, 0, tzinfo=timezone.utc)
    msg = make_msg(time=ts)
    redis = AsyncMock()
    # Timer started 10 minutes ago
    start = ts.timestamp() - 600
    redis.hget.return_value = str(start)

    result = await evaluate_rule(rule, msg, redis)
    assert result is not None


async def test_threshold_sustained_clears_when_condition_not_met():
    rule = make_rule(condition={"type": "threshold_sustained", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0, "minutes": 5})
    msg = make_msg(can_data={"hydraulic_pressure_1": 100.0})  # below threshold
    redis = AsyncMock()

    await evaluate_rule(rule, msg, redis)
    redis.delete.assert_called_once()  # timer cleared


# --- accumulation ---

async def test_accumulation_fires_when_limit_reached():
    rule = make_rule(condition={"type": "accumulation", "field": "pto_active", "increment_when": True, "limit": 3})
    msg = make_msg(pto_active=True)
    redis = AsyncMock()
    redis.incrbyfloat.return_value = 3.0  # limit reached

    result = await evaluate_rule(rule, msg, redis)
    assert result is not None


async def test_accumulation_no_fire_below_limit():
    rule = make_rule(condition={"type": "accumulation", "field": "pto_active", "increment_when": True, "limit": 10})
    msg = make_msg(pto_active=True)
    redis = AsyncMock()
    redis.incrbyfloat.return_value = 2.0  # below limit

    result = await evaluate_rule(rule, msg, redis)
    assert result is None


# --- composite ---

async def test_composite_and_fires_when_both_conditions_met():
    rule = make_rule(condition={
        "type": "composite",
        "op": "AND",
        "conditions": [
            {"type": "threshold", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0},
            {"type": "threshold", "field": "oil_temp_c", "op": ">", "value": 70.0},
        ],
    })
    msg = make_msg(can_data={"hydraulic_pressure_1": 230.0, "oil_temp_c": 80.0})
    redis = AsyncMock()
    result = await evaluate_rule(rule, msg, redis)
    assert result is not None


async def test_composite_and_no_fire_when_one_fails():
    rule = make_rule(condition={
        "type": "composite",
        "op": "AND",
        "conditions": [
            {"type": "threshold", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0},
            {"type": "threshold", "field": "oil_temp_c", "op": ">", "value": 70.0},
        ],
    })
    msg = make_msg(can_data={"hydraulic_pressure_1": 230.0, "oil_temp_c": 50.0})  # oil_temp below
    redis = AsyncMock()
    result = await evaluate_rule(rule, msg, redis)
    assert result is None


# --- schedule filter ---

def test_schedule_always_returns_true():
    assert _check_schedule({"type": "always"}, datetime.now(timezone.utc)) is True


def test_schedule_time_window_active_hours():
    # Monday 10:00 UTC
    ts = datetime(2024, 6, 17, 10, 0, tzinfo=timezone.utc)
    sched = {"type": "time_window", "days": [0, 1, 2, 3, 4], "start": "08:00", "end": "18:00"}
    assert _check_schedule(sched, ts) is True


def test_schedule_time_window_outside_hours():
    # Monday 22:00 UTC
    ts = datetime(2024, 6, 17, 22, 0, tzinfo=timezone.utc)
    sched = {"type": "time_window", "days": [0, 1, 2, 3, 4], "start": "08:00", "end": "18:00"}
    assert _check_schedule(sched, ts) is False


# --- cooldown + vehicle filter in process_message ---

async def test_process_message_respects_cooldown():
    rule = make_rule(condition={"type": "threshold", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0})
    msg = make_msg()
    redis = AsyncMock()
    redis.exists.return_value = 1  # in cooldown

    results = await process_message([rule], msg, redis)
    assert results == []


async def test_process_message_skips_wrong_tenant():
    rule = make_rule(tenant_id="other-tenant")
    msg = make_msg(tenant_id="tenant-1")
    redis = AsyncMock()
    redis.exists.return_value = 0

    results = await process_message([rule], msg, redis)
    assert results == []
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/rules_engine/test_evaluator.py -v 2>&1 | head -20
```

Expected: ImportError (src.evaluator doesn't exist yet).

- [ ] **Step 3: Create `services/rules-engine/pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "cmg-rules-engine"
version = "2.0.0"
requires-python = ">=3.12"
dependencies = [
    "asyncpg==0.29.0",
    "redis[asyncio]==5.1.1",
    "pydantic-settings==2.5.2",
]

[project.optional-dependencies]
dev = [
    "pytest==8.3.3",
    "pytest-asyncio==0.24.0",
]

[tool.setuptools.packages.find]
include = ["src*"]
```

- [ ] **Step 4: Create `services/rules-engine/Dockerfile`**

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir -e .
COPY src/ ./src/
CMD ["python", "-m", "src.main"]
```

- [ ] **Step 5: Create `services/rules-engine/src/__init__.py`** (empty file)

- [ ] **Step 6: Create `services/rules-engine/src/config.py`**

```python
# services/rules-engine/src/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    db_url: str
    redis_url: str
    environment: str = "development"


settings = Settings()
```

- [ ] **Step 7: Create `services/rules-engine/src/loader.py`**

```python
# services/rules-engine/src/loader.py
import asyncpg
from dataclasses import dataclass


@dataclass
class Rule:
    id: str
    tenant_id: str
    name: str
    active: bool
    vehicle_filter: dict
    condition: dict
    severity: str
    actions: list
    escalation: list
    schedule: dict
    cooldown_minutes: int


async def load_rules(conn: asyncpg.Connection) -> list[Rule]:
    rows = await conn.fetch(
        "SELECT id::text, tenant_id::text, name, active, vehicle_filter, condition, "
        "severity, actions, escalation, schedule, cooldown_minutes "
        "FROM alert_rule WHERE active = true"
    )
    return [Rule(**dict(row)) for row in rows]
```

- [ ] **Step 8: Create `services/rules-engine/src/state.py`**

```python
# services/rules-engine/src/state.py
from redis.asyncio import Redis


async def is_in_cooldown(redis: Redis, rule_id: str, vehicle_id: str) -> bool:
    return await redis.exists(f"rule:cooldown:{rule_id}:{vehicle_id}") > 0


async def set_cooldown(redis: Redis, rule_id: str, vehicle_id: str, minutes: int) -> None:
    await redis.setex(f"rule:cooldown:{rule_id}:{vehicle_id}", minutes * 60, "1")


async def get_sustained_start(redis: Redis, rule_id: str, vehicle_id: str) -> float | None:
    val = await redis.hget(f"rule:state:{rule_id}:{vehicle_id}", "first_triggered_at")
    return float(val) if val is not None else None


async def set_sustained_start(redis: Redis, rule_id: str, vehicle_id: str, ts: float) -> None:
    await redis.hset(f"rule:state:{rule_id}:{vehicle_id}", "first_triggered_at", ts)


async def clear_sustained_start(redis: Redis, rule_id: str, vehicle_id: str) -> None:
    await redis.delete(f"rule:state:{rule_id}:{vehicle_id}")


async def get_accumulator(redis: Redis, rule_id: str, vehicle_id: str) -> float:
    val = await redis.get(f"rule:accum:{rule_id}:{vehicle_id}")
    return float(val) if val is not None else 0.0


async def increment_accumulator(redis: Redis, rule_id: str, vehicle_id: str, delta: float) -> float:
    return float(await redis.incrbyfloat(f"rule:accum:{rule_id}:{vehicle_id}", delta))
```

- [ ] **Step 9: Create `services/rules-engine/src/evaluator.py`**

```python
# services/rules-engine/src/evaluator.py
from dataclasses import dataclass
from datetime import datetime, timezone
from redis.asyncio import Redis
from src.loader import Rule
from src.state import (
    is_in_cooldown,
    get_sustained_start,
    set_sustained_start,
    clear_sustained_start,
    get_accumulator,
    increment_accumulator,
)

_OPS = {
    ">": float.__gt__,
    "<": float.__lt__,
    ">=": float.__ge__,
    "<=": float.__le__,
    "==": float.__eq__,
    "!=": float.__ne__,
}


@dataclass
class TelemetryMsg:
    time: datetime
    device_id: str
    vehicle_id: str
    tenant_id: str
    lat: float | None
    lon: float | None
    speed_kmh: float | None
    ignition: bool | None
    pto_active: bool | None
    can_data: dict


@dataclass
class RuleMatch:
    rule: Rule
    vehicle_id: str
    trigger_value: dict


def _get_field(msg: TelemetryMsg, field: str) -> float | None:
    top = {
        "speed_kmh": msg.speed_kmh,
        "ignition": msg.ignition,
        "pto_active": msg.pto_active,
    }
    if field in top:
        v = top[field]
        return float(v) if v is not None else None
    val = msg.can_data.get(field)
    return float(val) if val is not None else None


def _apply_op(value: float, op: str, threshold: float) -> bool:
    fn = _OPS.get(op)
    return fn(value, threshold) if fn else False


def _check_schedule(schedule: dict, ts: datetime) -> bool:
    if schedule.get("type", "always") == "always":
        return True
    if schedule.get("type") == "time_window":
        weekday = ts.weekday()
        if weekday not in schedule.get("days", list(range(7))):
            return False
        sh, sm = map(int, schedule.get("start", "00:00").split(":"))
        eh, em = map(int, schedule.get("end", "23:59").split(":"))
        t = ts.hour * 60 + ts.minute
        return sh * 60 + sm <= t <= eh * 60 + em
    return True


async def _eval_condition(
    cond: dict, rule: Rule, msg: TelemetryMsg, redis: Redis
) -> float | None:
    ctype = cond.get("type")

    if ctype == "threshold":
        val = _get_field(msg, cond["field"])
        if val is not None and _apply_op(val, cond["op"], float(cond["value"])):
            return val

    elif ctype == "threshold_sustained":
        val = _get_field(msg, cond["field"])
        if val is not None and _apply_op(val, cond["op"], float(cond["value"])):
            start = await get_sustained_start(redis, rule.id, msg.vehicle_id)
            now_ts = msg.time.timestamp()
            if start is None:
                await set_sustained_start(redis, rule.id, msg.vehicle_id, now_ts)
            elif (now_ts - start) / 60 >= float(cond.get("minutes", 1)):
                return val
        else:
            await clear_sustained_start(redis, rule.id, msg.vehicle_id)

    elif ctype == "accumulation":
        val = _get_field(msg, cond["field"])
        if val is not None:
            increment_when = cond.get("increment_when")
            if increment_when is True:
                delta = 1.0 if val else 0.0
            else:
                delta = float(val)
            if delta > 0:
                total = await increment_accumulator(redis, rule.id, msg.vehicle_id, delta)
            else:
                total = await get_accumulator(redis, rule.id, msg.vehicle_id)
            if total >= float(cond.get("limit", float("inf"))):
                return total

    elif ctype == "composite":
        results = []
        for sub in cond.get("conditions", []):
            r = await _eval_condition(sub, rule, msg, redis)
            results.append(r is not None)
        op = cond.get("op", "AND")
        if (op == "AND" and all(results)) or (op == "OR" and any(results)):
            return 1.0

    elif ctype == "schedule":
        val = _get_field(msg, cond.get("field", "ignition"))
        expected_off = cond.get("expected_off", False)
        in_window = _check_schedule(cond.get("schedule", {"type": "always"}), msg.time)
        if not in_window and val and expected_off:
            return float(val) if val is not None else 1.0

    return None


async def evaluate_rule(rule: Rule, msg: TelemetryMsg, redis: Redis) -> RuleMatch | None:
    if not _check_schedule(rule.schedule, msg.time):
        return None
    val = await _eval_condition(rule.condition, rule, msg, redis)
    if val is not None:
        return RuleMatch(
            rule=rule,
            vehicle_id=msg.vehicle_id,
            trigger_value={"field": rule.condition.get("field"), "value": val},
        )
    return None


async def process_message(
    rules: list[Rule], msg: TelemetryMsg, redis: Redis
) -> list[RuleMatch]:
    matches = []
    for rule in rules:
        if rule.tenant_id != msg.tenant_id:
            continue
        scope = rule.vehicle_filter.get("scope", "all")
        if scope == "vehicle" and rule.vehicle_filter.get("vehicle_id") != msg.vehicle_id:
            continue
        if await is_in_cooldown(redis, rule.id, msg.vehicle_id):
            continue
        match = await evaluate_rule(rule, msg, redis)
        if match:
            matches.append(match)
    return matches
```

- [ ] **Step 10: Install rules-engine dev deps and run tests**

```bash
cd /opt/cmg-telematic1/services/rules-engine
pip install -e ".[dev]" -q
cd /opt/cmg-telematic1
python -m pytest tests/rules_engine/test_evaluator.py -v
```

Expected: 14 tests PASS.

- [ ] **Step 11: Commit**

```bash
cd /opt/cmg-telematic1
git add services/rules-engine/ tests/rules_engine/
git commit -m "feat: rules-engine evaluator — 6 condition types + state management"
```

---

### Task 8: rules-engine main (Consumer Group + NOTIFY/LISTEN hot-reload)

**Files:**
- Create: `services/rules-engine/src/main.py`

- [ ] **Step 1: Create `services/rules-engine/src/main.py`**

```python
# services/rules-engine/src/main.py
import asyncio
import json
import logging
import uuid as _uuid

import asyncpg
from redis.asyncio import Redis

from src.config import settings
from src.loader import load_rules, Rule
from src.evaluator import process_message, TelemetryMsg, RuleMatch
from src.state import set_cooldown

logger = logging.getLogger(__name__)

STREAM_KEY = "telemetry.raw"
ALERTS_KEY = "alerts.fire"
CONSUMER_GROUP = "rules-workers"
CONSUMER_NAME = f"worker-{_uuid.uuid4().hex[:8]}"
ALERTS_MAX_LEN = 10_000

_rules: list[Rule] = []


async def _write_alert(conn: asyncpg.Connection, match: RuleMatch) -> str:
    alert_id = str(_uuid.uuid4())
    await conn.execute(
        """
        INSERT INTO alert_instance
            (id, rule_id, vehicle_id, tenant_id, triggered_at, status, trigger_value)
        VALUES ($1, $2::uuid, $3::uuid, $4::uuid, now(), 'firing', $5)
        """,
        alert_id,
        match.rule.id,
        match.vehicle_id,
        match.rule.tenant_id,
        json.dumps(match.trigger_value),
    )
    return alert_id


async def _publish_alert(redis: Redis, alert_id: str, match: RuleMatch) -> None:
    await redis.xadd(
        ALERTS_KEY,
        {
            "alert_id": alert_id,
            "rule_id": match.rule.id,
            "vehicle_id": match.vehicle_id,
            "tenant_id": match.rule.tenant_id,
            "severity": match.rule.severity,
            "trigger_value": json.dumps(match.trigger_value),
            "actions": json.dumps(match.rule.actions),
            "escalation": json.dumps(match.rule.escalation),
        },
        maxlen=ALERTS_MAX_LEN,
        approximate=True,
    )


async def _process_stream(db_pool: asyncpg.Pool, redis: Redis) -> None:
    while True:
        try:
            entries = await redis.xreadgroup(
                CONSUMER_GROUP,
                CONSUMER_NAME,
                {STREAM_KEY: ">"},
                count=50,
                block=2000,
            )
            if not entries:
                continue
            for _stream, messages in entries:
                for msg_id, fields in messages:
                    try:
                        raw = fields.get("payload") or fields.get(b"payload", "{}")
                        payload = json.loads(raw)
                        can = payload.get("can_data") or {}
                        if isinstance(can, str):
                            can = json.loads(can)
                        msg = TelemetryMsg(
                            time=__import__("datetime").datetime.fromisoformat(payload["time"]),
                            device_id=payload["device_id"],
                            vehicle_id=payload["vehicle_id"],
                            tenant_id=payload["tenant_id"],
                            lat=payload.get("lat"),
                            lon=payload.get("lon"),
                            speed_kmh=payload.get("speed_kmh"),
                            ignition=bool(payload.get("ignition")),
                            pto_active=bool(payload.get("pto_active")),
                            can_data=can,
                        )
                        matches = await process_message(_rules, msg, redis)
                        if matches:
                            async with db_pool.acquire() as conn:
                                for match in matches:
                                    alert_id = await _write_alert(conn, match)
                                    await _publish_alert(redis, alert_id, match)
                                    await set_cooldown(
                                        redis, match.rule.id, match.vehicle_id,
                                        match.rule.cooldown_minutes
                                    )
                        await redis.xack(STREAM_KEY, CONSUMER_GROUP, msg_id)
                    except Exception as exc:
                        logger.error(f"Error processing {msg_id}: {exc}", exc_info=True)
                        await redis.xack(STREAM_KEY, CONSUMER_GROUP, msg_id)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error(f"Stream read error: {exc}")
            await asyncio.sleep(1)


async def _reload_rules(db_pool: asyncpg.Pool) -> None:
    global _rules
    try:
        async with db_pool.acquire() as conn:
            _rules = await load_rules(conn)
        logger.info(f"Hot-reloaded {len(_rules)} rules")
    except Exception as exc:
        logger.error(f"Rule reload failed: {exc}")


async def _listen_rule_changes(db_pool: asyncpg.Pool) -> None:
    dsn = settings.db_url.replace("+asyncpg", "")
    conn = await asyncpg.connect(dsn=dsn)
    try:
        def _on_notify(conn, pid, channel, payload):
            asyncio.ensure_future(_reload_rules(db_pool))

        await conn.add_listener("rules_changed", _on_notify)
        logger.info("Listening for rule changes on PostgreSQL NOTIFY 'rules_changed'")
        while True:
            await asyncio.sleep(3600)
    except asyncio.CancelledError:
        pass
    finally:
        await conn.close()


async def main() -> None:
    global _rules

    def _encode_json(v):
        return json.dumps(v)

    def _decode_json(v):
        return json.loads(v)

    async def _init_conn(conn):
        await conn.set_type_codec(
            "jsonb", encoder=_encode_json, decoder=_decode_json, schema="pg_catalog"
        )

    dsn = settings.db_url.replace("+asyncpg", "")
    db_pool = await asyncpg.create_pool(dsn=dsn, min_size=2, max_size=10, init=_init_conn)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)

    async with db_pool.acquire() as conn:
        _rules = await load_rules(conn)
    logger.info(f"Loaded {len(_rules)} rules at startup")

    try:
        await redis.xgroup_create(STREAM_KEY, CONSUMER_GROUP, id="0", mkstream=True)
    except Exception:
        pass  # group already exists

    logger.info(f"Rules engine started as {CONSUMER_NAME}")
    await asyncio.gather(
        _process_stream(db_pool, redis),
        _listen_rule_changes(db_pool),
    )


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    asyncio.run(main())
```

- [ ] **Step 2: Verify the service starts without errors (no DB needed for syntax check)**

```bash
cd /opt/cmg-telematic1/services/rules-engine
python -c "from src.main import main; print('OK')"
```

Expected: `OK` (no import errors).

- [ ] **Step 3: Run all evaluator tests still pass**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/rules_engine/ -v
```

Expected: 14 tests PASS.

- [ ] **Step 4: Commit**

```bash
cd /opt/cmg-telematic1
git add services/rules-engine/src/main.py
git commit -m "feat: rules-engine main — Redis Consumer Group + PostgreSQL NOTIFY hot-reload"
```

---

### Task 9: notify-svc + docker-compose update

**Files:**
- Create: `services/notify/pyproject.toml`
- Create: `services/notify/Dockerfile`
- Create: `services/notify/src/__init__.py`
- Create: `services/notify/src/config.py`
- Create: `services/notify/src/dispatcher.py`
- Create: `services/notify/src/escalation.py`
- Create: `services/notify/src/main.py`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Create `services/notify/pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "cmg-notify-svc"
version = "2.0.0"
requires-python = ">=3.12"
dependencies = [
    "asyncpg==0.29.0",
    "redis[asyncio]==5.1.1",
    "pydantic-settings==2.5.2",
    "httpx==0.27.2",
]

[project.optional-dependencies]
dev = [
    "pytest==8.3.3",
    "pytest-asyncio==0.24.0",
]

[tool.setuptools.packages.find]
include = ["src*"]
```

- [ ] **Step 2: Create `services/notify/Dockerfile`**

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir -e .
COPY src/ ./src/
CMD ["python", "-m", "src.main"]
```

- [ ] **Step 3: Create `services/notify/src/__init__.py`** (empty)

- [ ] **Step 4: Create `services/notify/src/config.py`**

```python
# services/notify/src/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    db_url: str
    redis_url: str
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "alertas@cmg.es"
    environment: str = "development"


settings = Settings()
```

- [ ] **Step 5: Create `services/notify/src/escalation.py`**

```python
# services/notify/src/escalation.py
import json
import time
from redis.asyncio import Redis

ESCALATION_KEY = "escalation"


async def schedule_escalation(
    redis: Redis,
    alert_id: str,
    rule_id: str,
    vehicle_id: str,
    step: dict,
    delay_minutes: int,
) -> None:
    score = time.time() + delay_minutes * 60
    payload = json.dumps(
        {"alert_id": alert_id, "rule_id": rule_id, "vehicle_id": vehicle_id, "actions": step.get("actions", [])}
    )
    await redis.zadd(ESCALATION_KEY, {payload: score})


async def pop_due_escalations(redis: Redis) -> list[dict]:
    now = time.time()
    items = await redis.zrangebyscore(ESCALATION_KEY, 0, now)
    if items:
        await redis.zremrangebyscore(ESCALATION_KEY, 0, now)
    return [json.loads(item) for item in items]
```

- [ ] **Step 6: Create `services/notify/src/dispatcher.py`**

```python
# services/notify/src/dispatcher.py
import asyncio
import logging
import smtplib
from email.message import EmailMessage
import httpx
from src.config import settings

logger = logging.getLogger(__name__)


async def dispatch_action(action: dict, context: dict) -> None:
    atype = action.get("type")
    if atype == "email":
        await _send_email(action, context)
    elif atype == "webhook":
        await _send_webhook(action, context)
    elif atype == "in_app":
        pass  # already persisted in alert_instance by rules-engine
    elif atype in ("push", "sms"):
        logger.info(
            "[stub] Would send %s to alert %s vehicle %s",
            atype, context.get("alert_id"), context.get("vehicle_id"),
        )
    else:
        logger.warning("Unknown action type: %s", atype)


async def _send_email(action: dict, context: dict) -> None:
    recipients = action.get("recipients", [])
    if not recipients:
        return
    if not settings.smtp_host:
        logger.info(
            "[stub] Email to %s — rule: %s vehicle: %s",
            recipients, context.get("rule_name"), context.get("vehicle_id"),
        )
        return

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = action.get(
        "subject", f"Alerta: {context.get('rule_name', 'CMG Telematics')}"
    )
    msg.set_content(
        f"Vehículo: {context.get('vehicle_id')}\n"
        f"Severidad: {context.get('severity')}\n"
        f"Valor disparado: {context.get('trigger_value')}\n"
        f"Regla: {context.get('rule_name')}"
    )
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _smtp_send, msg)


def _smtp_send(msg: EmailMessage) -> None:
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as s:
        if settings.smtp_user:
            s.starttls()
            s.login(settings.smtp_user, settings.smtp_password)
        s.send_message(msg)


async def _send_webhook(action: dict, context: dict) -> None:
    url = action.get("url", "")
    if not url:
        logger.warning("Webhook action has no URL")
        return
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.request(
                method=action.get("method", "POST").upper(),
                url=url,
                json=context,
            )
        logger.info("Webhook sent to %s for alert %s", url, context.get("alert_id"))
    except Exception as exc:
        logger.error("Webhook %s failed: %s", url, exc)
```

- [ ] **Step 7: Create `services/notify/src/main.py`**

```python
# services/notify/src/main.py
import asyncio
import json
import logging
import uuid as _uuid

import asyncpg
from redis.asyncio import Redis

from src.config import settings
from src.dispatcher import dispatch_action
from src.escalation import schedule_escalation, pop_due_escalations

logger = logging.getLogger(__name__)

STREAM_KEY = "alerts.fire"
CONSUMER_GROUP = "notify-workers"
CONSUMER_NAME = f"notifier-{_uuid.uuid4().hex[:8]}"


async def _process_alert(conn: asyncpg.Connection, redis: Redis, fields: dict) -> None:
    alert_id = fields.get("alert_id", "")
    rule_id = fields.get("rule_id", "")
    vehicle_id = fields.get("vehicle_id", "")
    tenant_id = fields.get("tenant_id", "")
    severity = fields.get("severity", "info")
    trigger_value = json.loads(fields.get("trigger_value", "{}"))
    actions = json.loads(fields.get("actions", "[]"))
    escalation = json.loads(fields.get("escalation", "[]"))

    row = await conn.fetchrow("SELECT name FROM alert_rule WHERE id = $1::uuid", rule_id)
    rule_name = row["name"] if row else "unknown"

    context = {
        "alert_id": alert_id,
        "rule_id": rule_id,
        "rule_name": rule_name,
        "vehicle_id": vehicle_id,
        "tenant_id": tenant_id,
        "severity": severity,
        "trigger_value": trigger_value,
    }

    for action in actions:
        await dispatch_action(action, context)

    for step in escalation:
        await schedule_escalation(
            redis, alert_id, rule_id, vehicle_id,
            step, step.get("delay_minutes", 10),
        )


async def _process_stream(db_pool: asyncpg.Pool, redis: Redis) -> None:
    while True:
        try:
            entries = await redis.xreadgroup(
                CONSUMER_GROUP, CONSUMER_NAME, {STREAM_KEY: ">"}, count=10, block=2000
            )
            if not entries:
                continue
            for _stream, messages in entries:
                for msg_id, fields in messages:
                    try:
                        async with db_pool.acquire() as conn:
                            await _process_alert(conn, redis, fields)
                        await redis.xack(STREAM_KEY, CONSUMER_GROUP, msg_id)
                    except Exception as exc:
                        logger.error(f"Error on alert {msg_id}: {exc}", exc_info=True)
                        await redis.xack(STREAM_KEY, CONSUMER_GROUP, msg_id)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error(f"Stream error: {exc}")
            await asyncio.sleep(1)


async def _escalation_worker(db_pool: asyncpg.Pool, redis: Redis) -> None:
    while True:
        await asyncio.sleep(30)
        try:
            due = await pop_due_escalations(redis)
            for item in due:
                context = {
                    "alert_id": item["alert_id"],
                    "rule_id": item["rule_id"],
                    "vehicle_id": item["vehicle_id"],
                    "severity": "escalated",
                    "rule_name": "escalation",
                    "trigger_value": {},
                }
                for action in item.get("actions", []):
                    await dispatch_action(action, context)
                logger.info("Escalation fired for alert %s", item["alert_id"])
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error(f"Escalation worker error: {exc}")


async def main() -> None:
    dsn = settings.db_url.replace("+asyncpg", "")
    db_pool = await asyncpg.create_pool(dsn=dsn, min_size=2, max_size=5)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)

    try:
        await redis.xgroup_create(STREAM_KEY, CONSUMER_GROUP, id="0", mkstream=True)
    except Exception:
        pass

    logger.info(f"Notify service started as {CONSUMER_NAME}")
    await asyncio.gather(
        _process_stream(db_pool, redis),
        _escalation_worker(db_pool, redis),
    )


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    asyncio.run(main())
```

- [ ] **Step 8: Update `docker-compose.yml` — add rules-engine + notify-svc**

Replace the complete file:

```yaml
services:

  postgres:
    image: timescale/timescaledb:latest-pg16
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD} --save 60 1 --loglevel warning
    volumes:
      - redisdata:/data
    ports:
      - "127.0.0.1:6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  ingest-svc:
    build:
      context: ./services/ingest
    restart: unless-stopped
    ports:
      - "0.0.0.0:5027:5027"
    environment:
      DB_URL: ${DB_URL}
      REDIS_URL: ${REDIS_URL}
      ENVIRONMENT: ${ENVIRONMENT}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  rules-engine:
    build:
      context: ./services/rules-engine
    restart: unless-stopped
    environment:
      DB_URL: ${DB_URL}
      REDIS_URL: ${REDIS_URL}
      ENVIRONMENT: ${ENVIRONMENT}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  notify-svc:
    build:
      context: ./services/notify
    restart: unless-stopped
    environment:
      DB_URL: ${DB_URL}
      REDIS_URL: ${REDIS_URL}
      SMTP_HOST: ${SMTP_HOST:-}
      SMTP_PORT: ${SMTP_PORT:-587}
      SMTP_USER: ${SMTP_USER:-}
      SMTP_PASSWORD: ${SMTP_PASSWORD:-}
      SMTP_FROM: ${SMTP_FROM:-alertas@cmg.es}
      ENVIRONMENT: ${ENVIRONMENT}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  core-api:
    build:
      context: ./backend
    restart: unless-stopped
    ports:
      - "127.0.0.1:8010:8010"
    environment:
      DB_URL: ${DB_URL}
      DB_URL_SYNC: ${DB_URL_SYNC}
      REDIS_URL: ${REDIS_URL}
      SECRET_KEY: ${SECRET_KEY}
      ENVIRONMENT: ${ENVIRONMENT}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://localhost:8010/health')\""]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddydata:/data
      - caddyconfig:/config
    depends_on:
      core-api:
        condition: service_started

volumes:
  pgdata:
  redisdata:
  caddydata:
  caddyconfig:
```

- [ ] **Step 9: Verify notify-svc imports cleanly**

```bash
cd /opt/cmg-telematic1/services/notify
pip install -e . -q
python -c "from src.main import main; print('OK')"
```

Expected: `OK`.

- [ ] **Step 10: Run all tests to confirm nothing broken**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/api/ tests/rules_engine/ -v
```

Expected: 17+ tests PASS.

- [ ] **Step 11: Validate docker-compose syntax**

```bash
cd /opt/cmg-telematic1
docker compose config --quiet && echo "docker-compose syntax OK"
```

Expected: `docker-compose syntax OK`.

- [ ] **Step 12: Commit**

```bash
cd /opt/cmg-telematic1
git add services/notify/ docker-compose.yml
git commit -m "feat: notify-svc (email/webhook/escalation) + docker-compose with rules-engine + notify-svc"
```

---

### Task 10: Integration smoke test + build verification

**Goal:** Confirm all services build and the full test suite passes before handing off to Plan 3 (frontend).

- [ ] **Step 1: Run complete test suite**

```bash
cd /opt/cmg-telematic1
python -m pytest tests/ -v --ignore=tests/ingest/test_ingest_integration.py 2>&1 | tail -20
```

Expected: 22+ tests PASS. (Ingest integration tests are excluded as they require the running ingest-svc Docker container.)

- [ ] **Step 2: Confirm core-api starts with the new lifespan**

```bash
cd /opt/cmg-telematic1/backend
DB_URL="postgresql+asyncpg://cmg:changeme_db@127.0.0.1:5432/cmg_telematics" \
DB_URL_SYNC="postgresql://cmg:changeme_db@127.0.0.1:5432/cmg_telematics" \
REDIS_URL="redis://:changeme_redis@127.0.0.1:6379/0" \
SECRET_KEY="changeme_secret_key_64_chars_minimum_replace_in_production" \
python -c "
import asyncio, os
os.chdir('/opt/cmg-telematic1/backend')
from app.main import app
print('App created OK:', app.title)
"
```

Expected: `App created OK: CMG Telematics API`

- [ ] **Step 3: Build Docker images for new services**

```bash
cd /opt/cmg-telematic1
docker compose build rules-engine notify-svc 2>&1 | tail -10
```

Expected: both images build successfully (`Successfully built ...`).

- [ ] **Step 4: Verify core-api Docker image still builds**

```bash
cd /opt/cmg-telematic1
docker compose build core-api 2>&1 | tail -5
```

Expected: `Successfully built ...`

- [ ] **Step 5: Confirm API docs endpoint is accessible**

If Docker stack is running:
```bash
curl -s http://127.0.0.1:8010/health | python3 -m json.tool
```
Expected: `{"status": "ok", "version": "2.0.0"}`

If not running, rebuild and restart:
```bash
docker compose up -d --build core-api
sleep 10
curl -s http://127.0.0.1:8010/health | python3 -m json.tool
```

- [ ] **Step 6: Final commit**

```bash
cd /opt/cmg-telematic1
git add .
git commit -m "chore: Plan 2 complete — core-api REST + WS + rules-engine + notify-svc"
```

---

## Summary

Plan 2 delivers:

| Componente | Endpoints / Funcionalidad |
|------------|--------------------------|
| **core-api REST** | `/vehicles`, `/vehicle-types`, telemetry history + status + track + KPIs, `/alerts` + ack, `/rules` CRUD + test, `/tenants`, `/grants` |
| **WebSocket** | `/ws/fleet` — stream telemetría en tiempo real filtrado por tenant |
| **rules-engine** | Consumer Group Redis, 6 tipos de condición, hot-reload NOTIFY/LISTEN |
| **notify-svc** | email/webhook/in_app, escalación ZSET, consumer group `alerts.fire` |
| **Tests** | 22+ tests cubriendo auth deps, endpoints CRUD, evaluador (14 unit tests) |

**Endpoints diferidos para Plan 3:** `GET/POST /api/v1/maintenance/plans`, `POST /api/v1/maintenance/logs`, `POST /api/v1/reports/generate`, `GET /api/v1/reports/{job_id}/download`, `GET/POST /api/v1/api-keys`, `POST /api/v1/vehicle-types`. Estos se implementan junto con el frontend que los consume.

**Siguiente plan:** Plan 3 — Frontend React + Vite (Sprint 5: layout + mapa + lista vehículos; Sprint 6: gauges SVG + WS live; Sprint 7: alertas + rule builder).
