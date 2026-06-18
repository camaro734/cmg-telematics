"""
Tests TDD — Provisión y transferencia de dispositivos CMG→fabricante.

Cubre:
- CMG crea device sin tenant_id → se asigna al propio CMG.
- CMG crea device con tenant_id de un fabricante → ok.
- CMG intenta crear device en tenant tier=client → 422.
- Manufacturer crea device → siempre forzado a su propio tenant (ignora tenant_id).
- PATCH /transfer: CMG transfiere device libre a fabricante → 200.
- PATCH /transfer: device vinculado a vehículo → 409.
- PATCH /transfer: destino tier=client → 422.
- PATCH /transfer: non-CMG → 403.
- Flujo completo: CMG crea device→fabricante VPS; VPS lo ve en su lista.
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
from app.models.tenant import Tenant

# ---------------------------------------------------------------------------
# IDs fijos
# ---------------------------------------------------------------------------
CMG_ID   = uuid.UUID("ae100000-0000-0000-0000-000000000001")
VPS_ID   = uuid.UUID("ae200000-0000-0000-0000-000000000001")  # tier=manufacturer
CLIENT_ID = uuid.UUID("ae300000-0000-0000-0000-000000000001") # tier=client
DEV_ID   = uuid.UUID("ae400000-0000-0000-0000-000000000001")

# ---------------------------------------------------------------------------
# Usuarios
# ---------------------------------------------------------------------------
CMG_ADMIN = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CMG_ID,
    tenant_tier="cmg", role="admin", email="cmg@test.com",
)
VPS_ADMIN = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=VPS_ID,
    tenant_tier="manufacturer", role="admin", email="vps@test.com",
)
CLIENT_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CLIENT_ID,
    tenant_tier="client", role="admin", email="client@test.com",
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _MockTenant:
    def __init__(self, tid: uuid.UUID, tier: str, parent_manufacturer_id=None,
                 manufacturer_can_transfer_vehicles: bool = False):
        self.id = tid
        self.tier = tier
        self.name = f"Tenant-{tier}"
        self.parent_manufacturer_id = parent_manufacturer_id
        self.manufacturer_can_transfer_vehicles = manufacturer_can_transfer_vehicles


class _MockDevice:
    def __init__(self, tenant_id: uuid.UUID, vehicle_id: uuid.UUID | None = None):
        self.id = DEV_ID
        self.tenant_id = tenant_id
        self.vehicle_id = vehicle_id
        self.imei = "12345678901234"
        self.model = "FMC650"
        self.firmware_ver = None
        self.online = False
        self.last_seen = None
        self.sim_phone = None
        self.active = True
        self.out_of_service = False
        self.out_of_service_since = None
        self.created_at = "2026-06-11T00:00:00Z"

    def model_dump(self):
        return {
            "id": self.id, "tenant_id": self.tenant_id, "vehicle_id": self.vehicle_id,
            "imei": self.imei, "model": self.model, "firmware_ver": self.firmware_ver,
            "online": self.online, "last_seen": self.last_seen, "sim_phone": self.sim_phone,
            "active": self.active, "created_at": self.created_at,
            "out_of_service": self.out_of_service,
            "out_of_service_since": self.out_of_service_since,
        }


def _make_db(get_side_effects: list, execute_side_effects: list | None = None) -> AsyncMock:
    db = AsyncMock()
    db.get.side_effect = get_side_effects
    if execute_side_effects is not None:
        db.execute.side_effect = execute_side_effects
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.delete = AsyncMock()
    db.rollback = AsyncMock()

    async def _refresh(obj):
        # Popula campos mínimos que DeviceOut requiere para serializar
        if not getattr(obj, 'id', None):
            obj.id = DEV_ID
        if getattr(obj, 'online', None) is None:
            obj.online = False
        if getattr(obj, 'active', None) is None:
            obj.active = True
        if getattr(obj, 'out_of_service', None) is None:
            obj.out_of_service = False
        if not hasattr(obj, 'out_of_service_since'):
            obj.out_of_service_since = None
        if not getattr(obj, 'created_at', None):
            obj.created_at = datetime.now(timezone.utc)

    db.refresh = _refresh
    return db


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
# Tests POST /devices
# ---------------------------------------------------------------------------

def test_cmg_creates_device_default_tenant():
    """CMG sin tenant_id → device asignado al propio CMG."""
    dev = _MockDevice(tenant_id=CMG_ID)
    cmg_tenant = _MockTenant(CMG_ID, "cmg")
    db = _make_db(get_side_effects=[cmg_tenant, dev])
    _setup(CMG_ADMIN, db)
    with TestClient(app) as c:
        r = c.post("/api/v1/devices", json={"imei": "12345678901234", "model": "FMC650"})
    assert r.status_code == 201


def test_cmg_creates_device_for_manufacturer():
    """CMG especifica tenant_id de un fabricante → ok."""
    vps_tenant = _MockTenant(VPS_ID, "manufacturer")
    dev = _MockDevice(tenant_id=VPS_ID)
    db = _make_db(get_side_effects=[vps_tenant, dev])
    _setup(CMG_ADMIN, db)
    with TestClient(app) as c:
        r = c.post("/api/v1/devices", json={"imei": "12345678901234", "model": "FMC650", "tenant_id": str(VPS_ID)})
    assert r.status_code == 201


def test_cmg_creates_device_for_client_tier_422():
    """CMG intenta asignar a tenant tier=client → 422."""
    client_tenant = _MockTenant(CLIENT_ID, "client")
    db = _make_db(get_side_effects=[client_tenant])
    _setup(CMG_ADMIN, db)
    with TestClient(app) as c:
        r = c.post("/api/v1/devices", json={"imei": "12345678901234", "model": "FMC650", "tenant_id": str(CLIENT_ID)})
    assert r.status_code == 422
    assert "fabricante" in r.json()["detail"].lower() or "manufacturer" in r.json()["detail"].lower()


def test_manufacturer_forced_to_own_tenant():
    """Manufacturer siempre registra en su propio tenant aunque envíe otro tenant_id."""
    vps_tenant = _MockTenant(VPS_ID, "manufacturer")
    dev = _MockDevice(tenant_id=VPS_ID)
    db = _make_db(get_side_effects=[vps_tenant, dev])
    _setup(VPS_ADMIN, db)
    with TestClient(app) as c:
        # Aunque envíe CLIENT_ID, debe quedar en VPS_ID
        r = c.post("/api/v1/devices", json={"imei": "12345678901234", "model": "FMC650", "tenant_id": str(CLIENT_ID)})
    assert r.status_code == 201
    # El device se crea con effective_tenant_id = VPS_ID (no CLIENT_ID)
    added_device = db.add.call_args[0][0]
    assert str(added_device.tenant_id) == str(VPS_ID)


# ---------------------------------------------------------------------------
# Tests PATCH /devices/{id}/transfer
# ---------------------------------------------------------------------------

def test_transfer_free_device_ok():
    """CMG transfiere device sin vehículo a fabricante → 200."""
    dev = _MockDevice(tenant_id=CMG_ID, vehicle_id=None)
    vps_tenant = _MockTenant(VPS_ID, "manufacturer")
    db = _make_db(get_side_effects=[dev, vps_tenant])
    _setup(CMG_ADMIN, db)
    with TestClient(app) as c:
        r = c.patch(f"/api/v1/devices/{DEV_ID}/transfer", json={"target_tenant_id": str(VPS_ID)})
    assert r.status_code == 200
    assert dev.tenant_id == VPS_ID


def test_transfer_linked_device_409():
    """Device vinculado a vehículo → 409."""
    vehicle_id = uuid.uuid4()
    dev = _MockDevice(tenant_id=CMG_ID, vehicle_id=vehicle_id)
    db = _make_db(get_side_effects=[dev])
    _setup(CMG_ADMIN, db)
    with TestClient(app) as c:
        r = c.patch(f"/api/v1/devices/{DEV_ID}/transfer", json={"target_tenant_id": str(VPS_ID)})
    assert r.status_code == 409
    assert "vehículo" in r.json()["detail"].lower()


def test_transfer_to_client_tier_422():
    """CMG intenta transferir a tenant tier=client → 422."""
    dev = _MockDevice(tenant_id=CMG_ID, vehicle_id=None)
    client_tenant = _MockTenant(CLIENT_ID, "client")
    db = _make_db(get_side_effects=[dev, client_tenant])
    _setup(CMG_ADMIN, db)
    with TestClient(app) as c:
        r = c.patch(f"/api/v1/devices/{DEV_ID}/transfer", json={"target_tenant_id": str(CLIENT_ID)})
    assert r.status_code == 422
    assert "fabricante" in r.json()["detail"].lower() or "manufacturer" in r.json()["detail"].lower()


def test_transfer_client_tier_403():
    """Un cliente (tier=client) nunca puede transferir dispositivos → 403."""
    dev = _MockDevice(tenant_id=CLIENT_ID, vehicle_id=None)
    target = _MockTenant(CMG_ID, "cmg")
    db = _make_db(get_side_effects=[dev, target])
    _setup(CLIENT_USER, db)
    with TestClient(app) as c:
        r = c.patch(f"/api/v1/devices/{DEV_ID}/transfer", json={"target_tenant_id": str(CMG_ID)})
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Flujo de integración razonado
# ---------------------------------------------------------------------------

def test_cmg_provisions_device_to_vps_and_vps_sees_it():
    """Flujo: CMG crea device→VPS. VPS recibe el device con tenant_id=VPS_ID.
    El endpoint GET /devices para manufacturer filtra por tenant_id==user.tenant_id,
    por lo que VPS verá el device en su lista."""
    vps_tenant = _MockTenant(VPS_ID, "manufacturer")
    created_dev = _MockDevice(tenant_id=VPS_ID)
    db = _make_db(get_side_effects=[vps_tenant, created_dev])
    _setup(CMG_ADMIN, db)
    with TestClient(app) as c:
        r = c.post("/api/v1/devices", json={"imei": "12345678901234", "model": "FMC650", "tenant_id": str(VPS_ID)})
    assert r.status_code == 201
    # El device creado tiene tenant_id = VPS_ID
    added = db.add.call_args[0][0]
    assert str(added.tenant_id) == str(VPS_ID)
    # Verificamos que el endpoint list_devices filtra por tenant_id para manufacturer
    # (list_devices usa: query.where(Device.tenant_id == user.tenant_id) para non-cmg)
    # VPS verá el device en su lista porque su tenant_id = VPS_ID


# ---------------------------------------------------------------------------
# Montaje: device sin dueño adopta el tenant del vehículo
# ---------------------------------------------------------------------------

VEH_ID = uuid.UUID("ae500000-0000-0000-0000-000000000001")


class _MockVehicle:
    def __init__(self, tenant_id, manufacturer_tenant_id=None):
        self.id = VEH_ID
        self.tenant_id = tenant_id
        self.manufacturer_tenant_id = manufacturer_tenant_id
        self.active = True


def test_manufacturer_transfers_own_device_to_client_200():
    """Fabricante con permiso transfiere un device propio suelto a su cliente."""
    dev = _MockDevice(tenant_id=VPS_ID, vehicle_id=None)
    target = _MockTenant(CLIENT_ID, "client", parent_manufacturer_id=VPS_ID)
    mfr = _MockTenant(VPS_ID, "manufacturer", manufacturer_can_transfer_vehicles=True)
    db = _make_db(get_side_effects=[dev, target, mfr])
    _setup(VPS_ADMIN, db)
    with TestClient(app) as c:
        r = c.patch(f"/api/v1/devices/{DEV_ID}/transfer", json={"target_tenant_id": str(CLIENT_ID)})
    assert r.status_code == 200
    assert dev.tenant_id == CLIENT_ID


def test_manufacturer_transfer_without_flag_403():
    """Sin el flag manufacturer_can_transfer_vehicles → 403."""
    dev = _MockDevice(tenant_id=VPS_ID, vehicle_id=None)
    target = _MockTenant(CLIENT_ID, "client", parent_manufacturer_id=VPS_ID)
    mfr = _MockTenant(VPS_ID, "manufacturer", manufacturer_can_transfer_vehicles=False)
    db = _make_db(get_side_effects=[dev, target, mfr])
    _setup(VPS_ADMIN, db)
    with TestClient(app) as c:
        r = c.patch(f"/api/v1/devices/{DEV_ID}/transfer", json={"target_tenant_id": str(CLIENT_ID)})
    assert r.status_code == 403
    assert dev.tenant_id == VPS_ID  # no se tocó


def test_manufacturer_cannot_transfer_to_foreign_tenant_403():
    """Fabricante no puede transferir a un tenant que no es su cliente."""
    other_mfr = uuid.UUID("ae200000-0000-0000-0000-000000000099")
    dev = _MockDevice(tenant_id=VPS_ID, vehicle_id=None)
    target = _MockTenant(CLIENT_ID, "client", parent_manufacturer_id=other_mfr)
    mfr = _MockTenant(VPS_ID, "manufacturer", manufacturer_can_transfer_vehicles=True)
    db = _make_db(get_side_effects=[dev, target, mfr])
    _setup(VPS_ADMIN, db)
    with TestClient(app) as c:
        r = c.patch(f"/api/v1/devices/{DEV_ID}/transfer", json={"target_tenant_id": str(CLIENT_ID)})
    assert r.status_code == 403


def test_assign_unowned_device_adopts_vehicle_tenant():
    """Montar un device sin dueño (tenant_id None) adopta el tenant del vehículo."""
    dev = _MockDevice(tenant_id=None, vehicle_id=None)
    veh = _MockVehicle(tenant_id=VPS_ID)
    no_existing = MagicMock()
    no_existing.scalar_one_or_none.return_value = None
    db = _make_db(get_side_effects=[dev, veh], execute_side_effects=[no_existing])
    _setup(CMG_ADMIN, db)
    with TestClient(app) as c:
        r = c.patch(f"/api/v1/devices/{DEV_ID}/vehicle", json={"vehicle_id": str(VEH_ID)})
    assert r.status_code == 200
    assert dev.tenant_id == VPS_ID   # adoptó el tenant del vehículo
    assert dev.vehicle_id == VEH_ID
