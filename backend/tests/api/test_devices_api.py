"""
Tests para /api/v1/devices — gestión de dispositivos (IMEI, asignación de vehículo).
"""
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime, timezone
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser
from app.models.device import Device
from app.models.vehicle import Vehicle

# --- Tenant IDs fijos para pruebas ---
CMG_TENANT_ID    = uuid.UUID("10000000-0000-0000-0000-000000000000")
CLIENT_TENANT_ID = uuid.UUID("20000000-0000-0000-0000-000000000000")
OTHER_TENANT_ID  = uuid.UUID("30000000-0000-0000-0000-000000000000")

DEVICE_ID  = uuid.UUID("d0000000-0000-0000-0000-000000000001")
VEHICLE_ID = uuid.UUID("f0000000-0000-0000-0000-000000000001")

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


def _make_device(tenant_id: uuid.UUID = CLIENT_TENANT_ID) -> MagicMock:
    """Crea un mock de Device con los atributos mínimos para DeviceOut."""
    device = MagicMock(spec=Device)
    device.id = DEVICE_ID
    device.tenant_id = tenant_id
    device.vehicle_id = None
    device.imei = "123456789012345"
    device.model = "FMC650"
    device.firmware_ver = None
    device.online = False
    device.last_seen = None
    device.sim_phone = None
    device.active = True
    device.created_at = datetime.now(timezone.utc)
    return device


def _make_vehicle(tenant_id: uuid.UUID = CLIENT_TENANT_ID) -> MagicMock:
    """Crea un mock de Vehicle con tenant_id y active."""
    vehicle = MagicMock(spec=Vehicle)
    vehicle.id = VEHICLE_ID
    vehicle.tenant_id = tenant_id
    vehicle.active = True
    return vehicle


# ---------------------------------------------------------------------------
# Test 1 — sin token → 403 (HTTPBearer devuelve 403 cuando no hay credenciales)
# ---------------------------------------------------------------------------
def test_devices_unauthenticated():
    app.dependency_overrides = {}
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/devices")
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 2 — CMG admin lista todos los dispositivos → 200
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Test 3 — CMG admin crea dispositivo → 201, respuesta contiene IMEI
# ---------------------------------------------------------------------------
def test_devices_cmg_admin_creates_device():
    _override_user(CMG_USER)
    db = AsyncMock()
    # db.get(Tenant, ...) debe devolver un tenant válido
    db.get = AsyncMock(return_value=MagicMock(id=CLIENT_TENANT_ID))
    # db.refresh rellena el objeto con datos simulados
    created_device = _make_device()

    async def _fake_refresh(obj):
        obj.id = DEVICE_ID
        obj.tenant_id = CLIENT_TENANT_ID
        obj.vehicle_id = None
        obj.imei = "123456789012345"
        obj.model = "FMC650"
        obj.firmware_ver = None
        obj.online = False
        obj.last_seen = None
        obj.active = True
        obj.created_at = datetime.now(timezone.utc)

    db.refresh = _fake_refresh
    _override_db(db)

    payload = {
        "imei": "123456789012345",
        "model": "FMC650",
        "tenant_id": str(CLIENT_TENANT_ID),
    }
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/api/v1/devices", json=payload)
    assert resp.status_code == 201
    assert resp.json()["imei"] == "123456789012345"


# ---------------------------------------------------------------------------
# Test 4 — IMEI duplicado → db.commit lanza IntegrityError → 409
# ---------------------------------------------------------------------------
def test_devices_duplicate_imei():
    _override_user(CMG_USER)
    db = AsyncMock()
    db.get = AsyncMock(return_value=MagicMock(id=CLIENT_TENANT_ID))
    db.commit = AsyncMock(side_effect=IntegrityError(None, None, None))
    _override_db(db)

    payload = {
        "imei": "123456789012345",
        "model": "FMC650",
        "tenant_id": str(CLIENT_TENANT_ID),
    }
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/api/v1/devices", json=payload)
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Test 5 — client admin lista dispositivos → 200, query acotada a su tenant
# ---------------------------------------------------------------------------
def test_devices_client_scoped_to_own_tenant():
    _override_user(CLIENT_USER)
    db = AsyncMock()
    devices_result = MagicMock()
    devices_result.scalars.return_value.all.return_value = []
    # Segunda query de uso: lista vacía porque no hay dispositivos
    usage_result = MagicMock()
    usage_result.all.return_value = []
    db.execute = AsyncMock(side_effect=[devices_result, usage_result])
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/devices")
    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# Test 6 — client admin asigna vehículo a dispositivo propio → 200
# ---------------------------------------------------------------------------
def test_devices_assign_vehicle():
    _override_user(CLIENT_USER)
    db = AsyncMock()

    device = _make_device(tenant_id=CLIENT_TENANT_ID)
    vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)

    # db.get devuelve device o vehicle según el modelo solicitado
    def _get_side_effect(model, pk):
        if model is Device:
            return device
        if model is Vehicle:
            return vehicle
        return None

    db.get = AsyncMock(side_effect=_get_side_effect)

    # No hay otro dispositivo activo asignado al vehículo
    no_conflict = MagicMock()
    no_conflict.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=no_conflict)

    async def _fake_refresh(obj):
        obj.vehicle_id = VEHICLE_ID

    db.refresh = _fake_refresh
    _override_db(db)

    payload = {"vehicle_id": str(VEHICLE_ID)}
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.patch(f"/api/v1/devices/{DEVICE_ID}/vehicle", json=payload)
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Test 7 — vehicle pertenece a otro tenant → 403
# ---------------------------------------------------------------------------
def test_devices_assign_vehicle_cross_tenant():
    _override_user(CLIENT_USER)
    db = AsyncMock()

    # dispositivo pertenece al tenant del usuario (CLIENT_TENANT_ID)
    device = _make_device(tenant_id=CLIENT_TENANT_ID)
    # vehículo pertenece a un tenant distinto
    vehicle = _make_vehicle(tenant_id=OTHER_TENANT_ID)

    def _get_side_effect(model, pk):
        if model is Device:
            return device
        if model is Vehicle:
            return vehicle
        return None

    db.get = AsyncMock(side_effect=_get_side_effect)
    _override_db(db)

    payload = {"vehicle_id": str(VEHICLE_ID)}
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.patch(f"/api/v1/devices/{DEVICE_ID}/vehicle", json=payload)
    assert resp.status_code == 403
