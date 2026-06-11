"""
Tests TDD — Pieza E: creación de dispositivos y vinculación vehicle por manufacturer.

Cubre:
- Manufacturer admin puede crear un dispositivo (device.tenant_id = su propio tenant).
- Manufacturer vincula device propio a vehicle de su cliente (vehicle.manufacturer_tenant_id == device.tenant_id) → 200.
- Manufacturer no puede vincular a vehicle de cliente ajeno → 403.
- Client sigue sin poder crear dispositivos → 403.
- La lógica de ingest: get_device_info hace JOIN device→vehicle y devuelve v.tenant_id,
  por lo que la telemetría se escribe con el tenant del cliente aunque device.tenant_id sea del fabricante.
  Esto se valida implícitamente: device.tenant_id permanece en VPS tras la asignación.
"""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser
from app.models.device import Device
from app.models.vehicle import Vehicle
from app.models.tenant import Tenant

# --- IDs fijos ---
VPS_TENANT_ID   = uuid.UUID("aa100000-0000-0000-0000-000000000001")
AGUAS_TENANT_ID = uuid.UUID("bb100000-0000-0000-0000-000000000001")   # cliente de VPS
OTHER_MFR_ID    = uuid.UUID("cc100000-0000-0000-0000-000000000001")
OTHER_CLIENT_ID = uuid.UUID("dd100000-0000-0000-0000-000000000001")   # cliente de OTHER_MFR
CMG_TENANT_ID   = uuid.UUID("ee100000-0000-0000-0000-000000000001")
CLIENT_ONLY_ID  = uuid.UUID("ff100000-0000-0000-0000-000000000001")

DEVICE_ID  = uuid.UUID("de000000-0000-0000-0000-000000000001")
VEHICLE_ID = uuid.UUID("b1000000-0000-0000-0000-000000000001")

# --- Usuarios ---
VPS_ADMIN = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=VPS_TENANT_ID,
    tenant_tier="manufacturer", role="admin", email="vps@test.com",
)
CMG_ADMIN = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CMG_TENANT_ID,
    tenant_tier="cmg", role="admin", email="cmg@test.com",
)
CLIENT_ADMIN = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CLIENT_ONLY_ID,
    tenant_tier="client", role="admin", email="client@test.com",
)


def _mock_device(tenant_id: uuid.UUID = VPS_TENANT_ID) -> MagicMock:
    d = MagicMock(spec=Device)
    d.id = DEVICE_ID
    d.tenant_id = tenant_id
    d.vehicle_id = None
    d.imei = "111222333444555"
    d.model = "FMC650"
    d.firmware_ver = None
    d.online = False
    d.last_seen = None
    d.sim_phone = None
    d.active = True
    d.created_at = datetime.now(timezone.utc)
    return d


def _mock_vehicle(tenant_id: uuid.UUID, manufacturer_tenant_id: uuid.UUID | None) -> MagicMock:
    v = MagicMock(spec=Vehicle)
    v.id = VEHICLE_ID
    v.tenant_id = tenant_id
    v.manufacturer_tenant_id = manufacturer_tenant_id
    v.active = True
    return v


def _setup(user: CurrentUser, db: AsyncMock) -> None:
    app.dependency_overrides[get_current_user] = lambda: user
    async def _db_gen():
        yield db
    app.dependency_overrides[get_db] = _db_gen


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Test 1 — manufacturer admin puede crear dispositivo → 201
# ---------------------------------------------------------------------------
def test_manufacturer_admin_can_create_device_201():
    db = AsyncMock()
    db.get = AsyncMock(return_value=MagicMock(id=VPS_TENANT_ID))

    created = _mock_device(tenant_id=VPS_TENANT_ID)

    async def _fake_refresh(obj):
        obj.id = created.id
        obj.tenant_id = VPS_TENANT_ID
        obj.vehicle_id = None
        obj.imei = "111222333444555"
        obj.model = "FMC650"
        obj.firmware_ver = None
        obj.online = False
        obj.last_seen = None
        obj.sim_phone = None
        obj.active = True
        obj.created_at = datetime.now(timezone.utc)

    db.refresh = _fake_refresh
    _setup(VPS_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        "/api/v1/devices",
        json={"imei": "111222333444555", "model": "FMC650", "tenant_id": str(VPS_TENANT_ID)},
    )
    assert resp.status_code == 201
    assert resp.json()["imei"] == "111222333444555"


# ---------------------------------------------------------------------------
# Test 2 — client admin NO puede crear dispositivos → 403
# ---------------------------------------------------------------------------
def test_client_cannot_create_device_403():
    _setup(CLIENT_ADMIN, AsyncMock())

    resp = TestClient(app, raise_server_exceptions=False).post(
        "/api/v1/devices",
        json={"imei": "999000111222333", "model": "FMC650", "tenant_id": str(CLIENT_ONLY_ID)},
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 3 — manufacturer vincula device propio a vehicle de su cliente → 200
# vehicle.manufacturer_tenant_id == device.tenant_id (VPS), pero tenant distinto
# ---------------------------------------------------------------------------
def test_manufacturer_assigns_device_to_own_client_vehicle_200():
    db = AsyncMock()

    device = _mock_device(tenant_id=VPS_TENANT_ID)
    # vehicle en AGUAS pero manufacturer = VPS
    vehicle = _mock_vehicle(tenant_id=AGUAS_TENANT_ID, manufacturer_tenant_id=VPS_TENANT_ID)

    def _get(model, pk):
        if model is Device:
            return device
        if model is Vehicle:
            return vehicle
        return None

    db.get = AsyncMock(side_effect=_get)

    no_conflict = MagicMock()
    no_conflict.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=no_conflict)

    async def _fake_refresh(obj):
        obj.vehicle_id = VEHICLE_ID

    db.refresh = _fake_refresh
    _setup(VPS_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).patch(
        f"/api/v1/devices/{DEVICE_ID}/vehicle",
        json={"vehicle_id": str(VEHICLE_ID)},
    )
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Test 4 — manufacturer NO puede vincular a vehicle de cliente ajeno → 403
# vehicle.manufacturer_tenant_id == OTHER_MFR (distinto de VPS)
# ---------------------------------------------------------------------------
def test_manufacturer_cannot_assign_device_to_foreign_client_vehicle_403():
    db = AsyncMock()

    device = _mock_device(tenant_id=VPS_TENANT_ID)
    # vehicle en OTHER_CLIENT cuyo fabricante es OTHER_MFR, no VPS
    vehicle = _mock_vehicle(tenant_id=OTHER_CLIENT_ID, manufacturer_tenant_id=OTHER_MFR_ID)

    def _get(model, pk):
        if model is Device:
            return device
        if model is Vehicle:
            return vehicle
        return None

    db.get = AsyncMock(side_effect=_get)
    _setup(VPS_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).patch(
        f"/api/v1/devices/{DEVICE_ID}/vehicle",
        json={"vehicle_id": str(VEHICLE_ID)},
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 5 — device.tenant_id permanece en VPS tras asignación a cliente
# (garantiza coherencia con _check_device_access para el fabricante)
# ---------------------------------------------------------------------------
def test_device_tenant_id_stays_manufacturer_after_client_vehicle_assignment():
    db = AsyncMock()

    device = _mock_device(tenant_id=VPS_TENANT_ID)
    vehicle = _mock_vehicle(tenant_id=AGUAS_TENANT_ID, manufacturer_tenant_id=VPS_TENANT_ID)

    def _get(model, pk):
        if model is Device:
            return device
        if model is Vehicle:
            return vehicle
        return None

    db.get = AsyncMock(side_effect=_get)

    no_conflict = MagicMock()
    no_conflict.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=no_conflict)

    async def _fake_refresh(obj):
        obj.vehicle_id = VEHICLE_ID

    db.refresh = _fake_refresh
    _setup(VPS_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).patch(
        f"/api/v1/devices/{DEVICE_ID}/vehicle",
        json={"vehicle_id": str(VEHICLE_ID)},
    )
    assert resp.status_code == 200
    # device.tenant_id NO debe cambiar al del cliente
    assert str(device.tenant_id) == str(VPS_TENANT_ID)
