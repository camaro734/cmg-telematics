"""
Tests TDD — Pieza B: reasignación de vehículo entre tenants.

Cubre:
- CMG admin reasigna cualquier vehículo → 200, from/to correctos, contadores OK.
- Manufacturer reasigna vehículo de su flota/cliente a otro cliente suyo → 200.
- Manufacturer no puede reasignar vehículo de otro fabricante → 403.
- Manufacturer no puede reasignar a tenant ajeno → 403.
- Client/subclient no puede reasignar → 403.
- Vehículo con órdenes abiertas bloquea → 409.
- Alert rules específicas del tenant anterior desactivadas y contadas.
- Permission grants del vehículo revocados y contados.
- plan.tenant_id migrado al nuevo tenant; owner_tenant_id intacto (política M3).
- vehicle.tenant_id cambia (garantía de invisibilidad de telemetría histórica).
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
from app.models.vehicle import Vehicle
from app.models.tenant import Tenant
from app.models.alert_rule import AlertRule
from app.models.permission_grant import PermissionGrant
from app.models.maintenance import MaintenancePlan
from app.models.work_order import WorkOrder

# ---------------------------------------------------------------------------
# IDs fijos
# ---------------------------------------------------------------------------
VPS_ID     = uuid.UUID("aa100000-0000-0000-0000-000000000001")  # fabricante
AGUAS_ID   = uuid.UUID("bb100000-0000-0000-0000-000000000001")  # cliente de VPS
RENTA_ID   = uuid.UUID("bb100000-0000-0000-0000-000000000002")  # otro cliente de VPS
OTHER_MFR  = uuid.UUID("cc100000-0000-0000-0000-000000000001")  # otro fabricante
OTHER_CL   = uuid.UUID("dd100000-0000-0000-0000-000000000001")  # cliente de OTHER_MFR
CMG_ID     = uuid.UUID("ee100000-0000-0000-0000-000000000001")
CLIENT_ID  = uuid.UUID("ff100000-0000-0000-0000-000000000001")  # tier=client puro
VEHICLE_ID = uuid.UUID("a1000000-0000-0000-0000-000000000099")
OWNER_ID   = uuid.UUID("a2000000-0000-0000-0000-000000000001")  # owner_tenant_id de un plan

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
# Helpers de mock
# ---------------------------------------------------------------------------

class _MockVehicle:
    """Vehículo mutable para verificar cambios de tenant_id post-call."""
    def __init__(self, tenant_id: uuid.UUID, mfr_tid: uuid.UUID | None = None):
        self.id = VEHICLE_ID
        self.tenant_id = tenant_id
        self.manufacturer_tenant_id = mfr_tid
        self.active = True


class _MockTenant:
    def __init__(self, tid: uuid.UUID, parent_mfr: uuid.UUID | None = None):
        self.id = tid
        self.parent_manufacturer_id = parent_mfr
        self.active = True
        self.manufacturer_can_transfer_vehicles = True


class _MockPlan:
    def __init__(self, tenant_id: uuid.UUID, owner_tenant_id: uuid.UUID):
        self.vehicle_id = VEHICLE_ID
        self.tenant_id = tenant_id
        self.owner_tenant_id = owner_tenant_id


class _MockRule:
    """AlertRule con vehicle_filter específico para este vehículo."""
    def __init__(self, tenant_id: uuid.UUID):
        self.active = True
        self.tenant_id = tenant_id
        self.vehicle_filter = {"scope": "specific", "vehicle_ids": [str(VEHICLE_ID)]}


class _MockGrant:
    def __init__(self):
        self.resource_type = "vehicle"
        self.resource_id = VEHICLE_ID


def _scalar_none():
    """db.execute → .scalar_one_or_none() == None."""
    return MagicMock(scalar_one_or_none=MagicMock(return_value=None))


def _scalar_val(val):
    """db.execute → .scalar_one_or_none() == val."""
    return MagicMock(scalar_one_or_none=MagicMock(return_value=val))


def _scalars_list(items):
    """db.execute → .scalars().all() == items."""
    m = MagicMock()
    m.scalars.return_value.all.return_value = items
    return m


def _default_executes():
    """Secuencia feliz: sin órdenes abiertas, sin reglas específicas, sin grants, sin planes, sin device."""
    return [
        _scalar_none(),     # WorkOrder check
        _scalars_list([]),  # AlertRule específicas
        _scalars_list([]),  # PermissionGrant
        _scalars_list([]),  # MaintenancePlan
        _scalar_none(),     # Device montado (ninguno)
    ]


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
# Test 1 — CMG reasigna cualquier vehículo → 200, contadores en respuesta
# ---------------------------------------------------------------------------
def test_cmg_reassigns_any_vehicle_200():
    vehicle = _MockVehicle(AGUAS_ID, VPS_ID)
    target = _MockTenant(RENTA_ID, VPS_ID)
    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, pk: vehicle if model is Vehicle else target)
    db.execute = AsyncMock(side_effect=_default_executes())
    db.delete = AsyncMock()
    _setup(CMG_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        f"/api/v1/vehicles/{VEHICLE_ID}/reassign",
        json={"target_tenant_id": str(RENTA_ID)},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["from_tenant_id"] == str(AGUAS_ID)
    assert data["to_tenant_id"] == str(RENTA_ID)
    assert data["alert_rules_deactivated"] == 0
    assert data["grants_revoked"] == 0
    assert "reassigned_at" in data
    assert vehicle.tenant_id == RENTA_ID


# ---------------------------------------------------------------------------
# Test 2 — Manufacturer reasigna vehículo de cliente a otro cliente suyo → 200
# ---------------------------------------------------------------------------
def test_manufacturer_reassigns_client_vehicle_200():
    vehicle = _MockVehicle(AGUAS_ID, VPS_ID)
    target = _MockTenant(RENTA_ID, VPS_ID)
    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, pk: vehicle if model is Vehicle else target)
    db.execute = AsyncMock(side_effect=_default_executes())
    db.delete = AsyncMock()
    _setup(VPS_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        f"/api/v1/vehicles/{VEHICLE_ID}/reassign",
        json={"target_tenant_id": str(RENTA_ID)},
    )
    assert resp.status_code == 200
    assert resp.json()["to_tenant_id"] == str(RENTA_ID)


# ---------------------------------------------------------------------------
# Test 3 — Manufacturer no puede reasignar vehículo de otro fabricante → 403
# ---------------------------------------------------------------------------
def test_manufacturer_cannot_reassign_foreign_vehicle_403():
    vehicle = _MockVehicle(OTHER_CL, OTHER_MFR)  # manufacturer_tenant_id = OTHER_MFR, no VPS
    db = AsyncMock()
    db.get = AsyncMock(return_value=vehicle)
    _setup(VPS_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        f"/api/v1/vehicles/{VEHICLE_ID}/reassign",
        json={"target_tenant_id": str(AGUAS_ID)},
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 4 — Manufacturer no puede reasignar a tenant ajeno → 403
# ---------------------------------------------------------------------------
def test_manufacturer_cannot_reassign_to_foreign_tenant_403():
    vehicle = _MockVehicle(AGUAS_ID, VPS_ID)
    foreign_target = _MockTenant(OTHER_CL, OTHER_MFR)  # cliente de otro fabricante
    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, pk:
        vehicle if model is Vehicle else foreign_target
    )
    _setup(VPS_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        f"/api/v1/vehicles/{VEHICLE_ID}/reassign",
        json={"target_tenant_id": str(OTHER_CL)},
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 5 — Client/subclient no puede reasignar → 403
# ---------------------------------------------------------------------------
def test_client_cannot_reassign_403():
    _setup(CLIENT_USER, AsyncMock())

    resp = TestClient(app, raise_server_exceptions=False).post(
        f"/api/v1/vehicles/{VEHICLE_ID}/reassign",
        json={"target_tenant_id": str(RENTA_ID)},
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 6 — Órdenes de trabajo abiertas bloquean → 409
# ---------------------------------------------------------------------------
def test_open_work_orders_block_reassign_409():
    vehicle = _MockVehicle(AGUAS_ID, VPS_ID)
    target = _MockTenant(RENTA_ID, VPS_ID)
    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, pk: vehicle if model is Vehicle else target)
    # Primera execute: WorkOrder abierta encontrada
    db.execute = AsyncMock(return_value=_scalar_val(uuid.uuid4()))
    _setup(CMG_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        f"/api/v1/vehicles/{VEHICLE_ID}/reassign",
        json={"target_tenant_id": str(RENTA_ID)},
    )
    assert resp.status_code == 409
    assert "abiertas" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Test 7 — Alert rules específicas del tenant anterior se desactivan y cuentan
# ---------------------------------------------------------------------------
def test_specific_alert_rules_deactivated():
    vehicle = _MockVehicle(AGUAS_ID, VPS_ID)
    target = _MockTenant(RENTA_ID, VPS_ID)
    rule = _MockRule(AGUAS_ID)

    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, pk: vehicle if model is Vehicle else target)
    db.execute = AsyncMock(side_effect=[
        _scalar_none(),         # WorkOrder check
        _scalars_list([rule]),  # AlertRule específica (1 regla para este vehículo)
        _scalars_list([]),      # PermissionGrant
        _scalars_list([]),      # MaintenancePlan
        _scalar_none(),         # Device montado (ninguno)
    ])
    db.delete = AsyncMock()
    _setup(CMG_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        f"/api/v1/vehicles/{VEHICLE_ID}/reassign",
        json={"target_tenant_id": str(RENTA_ID)},
    )
    assert resp.status_code == 200
    assert resp.json()["alert_rules_deactivated"] == 1
    assert rule.active is False


# ---------------------------------------------------------------------------
# Test 8 — Permission grants del vehículo revocados y contados
# ---------------------------------------------------------------------------
def test_permission_grants_revoked():
    vehicle = _MockVehicle(AGUAS_ID, VPS_ID)
    target = _MockTenant(RENTA_ID, VPS_ID)
    grant1 = _MockGrant()
    grant2 = _MockGrant()

    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, pk: vehicle if model is Vehicle else target)
    db.execute = AsyncMock(side_effect=[
        _scalar_none(),                 # WorkOrder check
        _scalars_list([]),              # AlertRule
        _scalars_list([grant1, grant2]),# PermissionGrant (2 grants)
        _scalars_list([]),              # MaintenancePlan
        _scalar_none(),                 # Device montado (ninguno)
    ])
    db.delete = AsyncMock()
    _setup(CMG_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        f"/api/v1/vehicles/{VEHICLE_ID}/reassign",
        json={"target_tenant_id": str(RENTA_ID)},
    )
    assert resp.status_code == 200
    assert resp.json()["grants_revoked"] == 2
    assert db.delete.await_count == 2


# ---------------------------------------------------------------------------
# Test 9 — plan.tenant_id migrado; owner_tenant_id intacto (política M3)
# ---------------------------------------------------------------------------
def test_maintenance_plan_tenant_migrated_owner_intact():
    vehicle = _MockVehicle(AGUAS_ID, VPS_ID)
    target = _MockTenant(RENTA_ID, VPS_ID)
    plan = _MockPlan(tenant_id=AGUAS_ID, owner_tenant_id=OWNER_ID)

    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, pk: vehicle if model is Vehicle else target)
    db.execute = AsyncMock(side_effect=[
        _scalar_none(),          # WorkOrder check
        _scalars_list([]),       # AlertRule
        _scalars_list([]),       # PermissionGrant
        _scalars_list([plan]),   # MaintenancePlan (1 plan)
        _scalar_none(),          # Device montado (ninguno)
    ])
    db.delete = AsyncMock()
    _setup(CMG_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        f"/api/v1/vehicles/{VEHICLE_ID}/reassign",
        json={"target_tenant_id": str(RENTA_ID)},
    )
    assert resp.status_code == 200
    # tenant_id migrado al nuevo tenant
    assert plan.tenant_id == RENTA_ID
    # owner_tenant_id intacto — propiedad M3 no cambia con reasignación operativa
    assert plan.owner_tenant_id == OWNER_ID


# ---------------------------------------------------------------------------
# Test 10 — La cajita (device) viaja con el camión al reasignar
# ---------------------------------------------------------------------------
class _MockDevice:
    def __init__(self, tenant_id):
        self.imei = "356938035643809"
        self.vehicle_id = VEHICLE_ID
        self.tenant_id = tenant_id
        self.active = True


def test_reassign_moves_device_with_vehicle():
    vehicle = _MockVehicle(AGUAS_ID, VPS_ID)
    target = _MockTenant(RENTA_ID, VPS_ID)
    device = _MockDevice(AGUAS_ID)
    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, pk: vehicle if model is Vehicle else target)
    # Orden de executes: WorkOrder(none), AlertRule([]), PermissionGrant([]), MaintenancePlan([]), Device(device)
    execs = [
        _scalar_none(),     # WorkOrder check
        _scalars_list([]),  # AlertRule específicas
        _scalars_list([]),  # PermissionGrant
        _scalars_list([]),  # MaintenancePlan
        _scalar_val(device),  # Device montado
    ]
    db.execute = AsyncMock(side_effect=execs)
    db.delete = AsyncMock()
    _setup(CMG_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        f"/api/v1/vehicles/{VEHICLE_ID}/reassign",
        json={"target_tenant_id": str(RENTA_ID)},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["device_moved"] is True
    assert data["device_imei"] == "356938035643809"
    assert device.tenant_id == RENTA_ID


# ---------------------------------------------------------------------------
# Test 11 — Fabricante sin flag no puede traspasar → 403
# ---------------------------------------------------------------------------
def test_manufacturer_without_transfer_flag_403():
    vehicle = _MockVehicle(AGUAS_ID, VPS_ID)
    mfr = _MockTenant(VPS_ID, None)
    mfr.manufacturer_can_transfer_vehicles = False
    db = AsyncMock()
    # db.get: Vehicle → vehicle; Tenant(VPS_ID, flag) → mfr; Tenant(target) → target
    target = _MockTenant(RENTA_ID, VPS_ID)
    def _get(model, pk):
        if model is Vehicle:
            return vehicle
        return mfr if str(pk) == str(VPS_ID) else target
    db.get = AsyncMock(side_effect=_get)
    _setup(VPS_ADMIN, db)
    resp = TestClient(app, raise_server_exceptions=False).post(
        f"/api/v1/vehicles/{VEHICLE_ID}/reassign",
        json={"target_tenant_id": str(RENTA_ID)},
    )
    assert resp.status_code == 403
