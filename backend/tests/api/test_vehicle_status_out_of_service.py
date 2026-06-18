"""
Tests TDD — device_out_of_service propagado en VehicleStatus (bulk + detalle).

Cubre:
- bulk: device con out_of_service=True → statuses[0]["device_out_of_service"] is True
- bulk: device con out_of_service=False → campo present y False
- detalle: device con out_of_service=True → campo present y True
- detalle: sin device → campo present y False (default)
"""
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime, timezone
import uuid
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser
from app.models.vehicle import Vehicle

# --- IDs fijos ---
TENANT_ID  = uuid.UUID("bb000000-0000-0000-0000-000000000001")
VEHICLE_ID = uuid.UUID("bb100000-0000-0000-0000-000000000001")

CLIENT_USER = CurrentUser(
    user_id=uuid.uuid4(),
    tenant_id=TENANT_ID,
    tenant_tier="client",
    role="admin",
    email="oos_test@test.com",
)


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def _override_user(user: CurrentUser) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


def _override_db(session) -> None:
    async def _gen():
        yield session
    app.dependency_overrides[get_db] = _gen


def _make_vehicle_mock(
    vehicle_id: uuid.UUID = VEHICLE_ID,
    tenant_id: uuid.UUID = TENANT_ID,
) -> MagicMock:
    v = MagicMock(spec=Vehicle)
    v.id = vehicle_id
    v.tenant_id = tenant_id
    v.active = True
    return v


def _make_redis_hash(
    vehicle_id: uuid.UUID = VEHICLE_ID,
) -> dict:
    """Hash Redis con datos de status mínimos para que el vehículo aparezca en resultado."""
    return {
        "last_seen": datetime.now(timezone.utc).isoformat(),
        "lat": "39.4702",
        "lon": "-0.3768",
        "speed_kmh": "0.0",
        "ignition": "true",
        "pto_active": "false",
        "ext_voltage_mv": "13500",
        "can_data": json.dumps({}),
        "online": "true",
    }


def _make_db_bulk(vehicle: MagicMock, oos_value: bool) -> AsyncMock:
    """
    Mock de AsyncSession para el endpoint bulk statuses.

    db.execute se llama DOS veces:
      1. Query Vehicle activos → result1 con scalars().all() = [vehicle]
      2. Query Device OOS bulk → result2 con all() = [(vehicle.id, oos_value)]
    """
    # Resultado 1: query de Vehicle
    result1 = MagicMock()
    result1.scalars.return_value.all.return_value = [vehicle]

    # Resultado 2: query de Device OOS — fila (vehicle_id, out_of_service)
    oos_row = MagicMock()
    oos_row.vehicle_id = vehicle.id
    oos_row.out_of_service = oos_value
    result2 = MagicMock()
    result2.all.return_value = [oos_row]

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[result1, result2])
    # list_accessible_vehicle_ids usa db.scalars con retorno de IDs
    db.scalars = AsyncMock(return_value=[vehicle.id])
    return db


def _make_db_detail(vehicle: MagicMock, oos_value: bool | None) -> AsyncMock:
    """
    Mock de AsyncSession para el endpoint detalle /status.

    assert_can_access_vehicle usa db.get (no db.execute).
    La query OOS usa db.execute → scalar_one_or_none().
    """
    db = AsyncMock()
    db.get = AsyncMock(return_value=vehicle)

    # Resultado de la query OOS
    oos_result = MagicMock()
    oos_result.scalar_one_or_none.return_value = oos_value
    db.execute = AsyncMock(return_value=oos_result)
    db.scalars = AsyncMock()
    return db


def _build_redis_bulk(hash_data: dict) -> AsyncMock:
    """Redis mock para el bulk: pipeline hgetall + pipeline dout."""
    redis = AsyncMock()

    pipe1 = AsyncMock()
    pipe1.hgetall = MagicMock(return_value=None)
    pipe1.execute = AsyncMock(return_value=[hash_data])

    pipe2 = AsyncMock()
    pipe2.get = MagicMock(return_value=None)
    pipe2.execute = AsyncMock(return_value=[None])  # sin dout

    redis.pipeline = MagicMock(side_effect=[pipe1, pipe2])
    return redis


# ---------------------------------------------------------------------------
# Test 1 — bulk: device out_of_service=True → campo True en respuesta
# ---------------------------------------------------------------------------
def test_bulk_status_exposes_out_of_service_true():
    vehicle = _make_vehicle_mock()
    db = _make_db_bulk(vehicle, oos_value=True)
    _override_user(CLIENT_USER)
    _override_db(db)

    redis = _build_redis_bulk(_make_redis_hash())
    app.state.redis = redis

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicles/statuses?ids={VEHICLE_ID}")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["vehicle_id"] == str(VEHICLE_ID)
    assert data[0]["device_out_of_service"] is True


# ---------------------------------------------------------------------------
# Test 2 — bulk: device out_of_service=False → campo False en respuesta
# ---------------------------------------------------------------------------
def test_bulk_status_exposes_out_of_service_false():
    vehicle = _make_vehicle_mock()
    db = _make_db_bulk(vehicle, oos_value=False)
    _override_user(CLIENT_USER)
    _override_db(db)

    redis = _build_redis_bulk(_make_redis_hash())
    app.state.redis = redis

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicles/statuses?ids={VEHICLE_ID}")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["device_out_of_service"] is False


# ---------------------------------------------------------------------------
# Test 3 — detalle: device out_of_service=True → campo True
# ---------------------------------------------------------------------------
def test_detail_status_exposes_out_of_service_true():
    vehicle = _make_vehicle_mock()
    db = _make_db_detail(vehicle, oos_value=True)
    _override_user(CLIENT_USER)
    _override_db(db)

    fake_redis = AsyncMock()
    fake_redis.hgetall = AsyncMock(return_value=_make_redis_hash())
    fake_redis.get = AsyncMock(return_value=None)

    with TestClient(app) as c:
        c.app.state.redis = fake_redis
        resp = c.get(f"/api/v1/vehicles/{VEHICLE_ID}/status")

    assert resp.status_code == 200
    data = resp.json()
    assert data["vehicle_id"] == str(VEHICLE_ID)
    assert data["device_out_of_service"] is True


# ---------------------------------------------------------------------------
# Test 4 — detalle: sin device (scalar_one_or_none=None) → campo False (default)
# ---------------------------------------------------------------------------
def test_detail_status_out_of_service_defaults_false_when_no_device():
    vehicle = _make_vehicle_mock()
    db = _make_db_detail(vehicle, oos_value=None)
    _override_user(CLIENT_USER)
    _override_db(db)

    fake_redis = AsyncMock()
    fake_redis.hgetall = AsyncMock(return_value=_make_redis_hash())
    fake_redis.get = AsyncMock(return_value=None)

    with TestClient(app) as c:
        c.app.state.redis = fake_redis
        resp = c.get(f"/api/v1/vehicles/{VEHICLE_ID}/status")

    assert resp.status_code == 200
    data = resp.json()
    assert data["device_out_of_service"] is False
