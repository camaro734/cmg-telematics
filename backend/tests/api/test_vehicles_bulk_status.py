"""
Tests para GET /api/v1/vehicles/statuses — endpoint bulk de estados de vehículos.

Patrón: override de dependencias FastAPI (get_current_user, get_db) + mocks de Redis.
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
CLIENT_TENANT_ID = uuid.UUID("20000000-0000-0000-0000-000000000000")
OTHER_TENANT_ID  = uuid.UUID("30000000-0000-0000-0000-000000000000")
VEHICLE_ID_1     = uuid.UUID("a0000000-0000-0000-0000-000000000001")
VEHICLE_ID_2     = uuid.UUID("a0000000-0000-0000-0000-000000000002")

CLIENT_USER = CurrentUser(
    user_id=uuid.uuid4(),
    tenant_id=CLIENT_TENANT_ID,
    tenant_tier="client",
    role="admin",
    email="client@test.com",
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


def _make_vehicle(
    vehicle_id: uuid.UUID = VEHICLE_ID_1,
    tenant_id: uuid.UUID = CLIENT_TENANT_ID,
    active: bool = True,
) -> MagicMock:
    """Crea un mock de Vehicle con los atributos mínimos para el endpoint."""
    vehicle = MagicMock(spec=Vehicle)
    vehicle.id = vehicle_id
    vehicle.tenant_id = tenant_id
    vehicle.active = active
    return vehicle


def _make_redis_hash() -> dict:
    """Hash de Redis simulado con datos de status de un vehículo."""
    return {
        "last_seen": datetime.now(timezone.utc).isoformat(),
        "lat": "39.4702",
        "lon": "-0.3768",
        "speed_kmh": "0.0",
        "ignition": "true",
        "pto_active": "false",
        "ext_voltage_mv": "13500",
        "can_data": json.dumps({"avl_1": 1}),
        "online": "true",
    }


def _build_redis_mock(hash_data: dict | None = None, dout_data: str | None = None) -> AsyncMock:
    """Construye un mock de redis con pipeline que devuelve hash_data y dout_data."""
    redis = AsyncMock()

    pipe1 = AsyncMock()
    pipe1.hgetall = MagicMock(return_value=None)  # encadenado en pipeline
    pipe1.execute = AsyncMock(return_value=[hash_data or {}])

    pipe2 = AsyncMock()
    pipe2.get = MagicMock(return_value=None)
    pipe2.execute = AsyncMock(return_value=[dout_data])

    # pipeline() se llama dos veces: una para hgetall, otra para dout
    redis.pipeline = MagicMock(side_effect=[pipe1, pipe2])
    return redis


# ---------------------------------------------------------------------------
# Test 1 — sin autenticación → 403 (HTTPBearer sin credenciales)
# ---------------------------------------------------------------------------
def test_statuses_unauthenticated():
    app.dependency_overrides = {}
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicles/statuses?ids={VEHICLE_ID_1}")
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 2 — IDs válidos del tenant → devuelve lista de statuses
# ---------------------------------------------------------------------------
def test_statuses_returns_list_for_own_vehicles():
    _override_user(CLIENT_USER)

    db = AsyncMock()
    vehicle = _make_vehicle(VEHICLE_ID_1, CLIENT_TENANT_ID)
    db.get = AsyncMock(return_value=vehicle)

    _override_db(db)

    redis = _build_redis_mock(hash_data=_make_redis_hash())

    # Inyectar redis en app.state
    app.state.redis = redis

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicles/statuses?ids={VEHICLE_ID_1}")

    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["vehicle_id"] == str(VEHICLE_ID_1)
    assert "online" in data[0]
    assert "lat" in data[0]


# ---------------------------------------------------------------------------
# Test 3 — IDs de otro tenant → devuelve lista vacía (no 403)
# ---------------------------------------------------------------------------
def test_statuses_cross_tenant_returns_empty():
    _override_user(CLIENT_USER)

    db = AsyncMock()
    # Vehículo pertenece a otro tenant
    vehicle = _make_vehicle(VEHICLE_ID_1, OTHER_TENANT_ID)
    db.get = AsyncMock(return_value=vehicle)

    _override_db(db)

    # Redis no debe ser consultado porque no hay IDs accesibles
    redis = AsyncMock()
    app.state.redis = redis

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicles/statuses?ids={VEHICLE_ID_1}")

    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# Test 4 — IDs malformados (no UUID) → 400
# ---------------------------------------------------------------------------
def test_statuses_invalid_ids_returns_400():
    _override_user(CLIENT_USER)

    db = AsyncMock()
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/vehicles/statuses?ids=not-a-uuid,also-bad")

    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Test 5 — más de 200 IDs → trunca a 200 (no es error, el endpoint usa [:200])
# ---------------------------------------------------------------------------
def test_statuses_truncates_to_200_ids():
    _override_user(CLIENT_USER)

    # 201 UUIDs válidos pero inexistentes → db.get devuelve None → lista vacía
    ids_str = ",".join(str(uuid.uuid4()) for _ in range(201))

    db = AsyncMock()
    db.get = AsyncMock(return_value=None)  # todos inexistentes
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicles/statuses?ids={ids_str}")

    # El endpoint trunca silenciosamente a 200 y devuelve lista vacía
    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# Test 6 — vehículo existe pero sin datos en Redis → omitido del resultado
# ---------------------------------------------------------------------------
def test_statuses_vehicle_without_redis_data_is_omitted():
    _override_user(CLIENT_USER)

    db = AsyncMock()
    vehicle = _make_vehicle(VEHICLE_ID_1, CLIENT_TENANT_ID)
    db.get = AsyncMock(return_value=vehicle)
    _override_db(db)

    # Redis devuelve hash vacío → el vehículo se omite del resultado
    redis = _build_redis_mock(hash_data={})
    app.state.redis = redis

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicles/statuses?ids={VEHICLE_ID_1}")

    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# Test 7 — Redis no disponible → devuelve statuses con online=False
# ---------------------------------------------------------------------------
def test_statuses_redis_unavailable_returns_offline():
    _override_user(CLIENT_USER)

    db = AsyncMock()
    vehicle = _make_vehicle(VEHICLE_ID_1, CLIENT_TENANT_ID)
    db.get = AsyncMock(return_value=vehicle)
    _override_db(db)

    # Redis falla al ejecutar el pipeline
    redis = AsyncMock()
    broken_pipe = AsyncMock()
    broken_pipe.hgetall = MagicMock(return_value=None)
    broken_pipe.execute = AsyncMock(side_effect=Exception("Redis connection refused"))
    redis.pipeline = MagicMock(return_value=broken_pipe)
    app.state.redis = redis

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicles/statuses?ids={VEHICLE_ID_1}")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["online"] is False
    assert data[0]["vehicle_id"] == str(VEHICLE_ID_1)
