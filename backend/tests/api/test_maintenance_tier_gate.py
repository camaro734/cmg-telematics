"""
Test 2C + M3 — Gating de tier y política de propiedad en planes de mantenimiento.

Verifica:
- Gate (require_plan_admin): subclient, non-admin y subclient.admin → 403.
  client.admin pasa el gate (M3) — antes bloqueado, ahora 404 por recurso.
- Propiedad (assert_can_manage_plan): manufacturer/client admin pueden editar/borrar
  SOLO sus propios planes (plan.owner_tenant_id == user.tenant_id).
- Fix R5: manufacturer.admin podía crear planes pero no editarlos (403 de
  assert_can_access_vehicle write). Con M3 usa assert_can_manage_plan y pasa.
- CMG admin puede gestionar cualquier plan.
- Cross-tenant: client admin de otro tenant recibe 403 en gestión.
"""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.core.database import get_db

PLAN_ID = uuid.uuid4()
VEHICLE_ID = uuid.uuid4()
CLIENT_TENANT_ID = uuid.uuid4()
MFR_TENANT_ID = uuid.uuid4()
CMG_TENANT_ID = uuid.uuid4()
OTHER_TENANT_ID = uuid.uuid4()  # tenant ajeno para tests cross-tenant


def _user(tier: str, role: str, tenant_id: uuid.UUID | None = None) -> CurrentUser:
    return CurrentUser(
        user_id=uuid.uuid4(),
        tenant_id=tenant_id or CLIENT_TENANT_ID,
        tenant_tier=tier,
        role=role,
        email=f"{tier}.{role}@test.com",
    )


def _override(user: CurrentUser):
    app.dependency_overrides[get_current_user] = lambda: user


def _clear():
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def cleanup():
    yield
    _clear()


client = TestClient(app, raise_server_exceptions=False)

_PLAN_BODY = {
    "vehicle_id": str(VEHICLE_ID),
    "name": "Plan test",
    "trigger_condition": {"thresholds": [{"type": "calendar_days", "value": 90}], "op": "OR"},
    "warn_before_pct": 10,
    "active": True,
}


# ── POST /maintenance/plans ────────────────────────────────────────────────────

@pytest.mark.parametrize("tier,role", [
    # client.admin eliminado: M3 le permite crear (pasa gate, falla en vehículo → 404)
    ("client", "operator"),
    ("subclient", "admin"),
])
def test_create_plan_non_management_blocked(tier, role):
    """Roles no-admin y subclient.admin siguen obteniendo 403 en creación."""
    _override(_user(tier, role))
    resp = client.post("/api/v1/maintenance/plans", json=_PLAN_BODY)
    assert resp.status_code == 403, f"Esperado 403 para {tier}.{role}, got {resp.status_code}"


def test_create_plan_manufacturer_passes_gate():
    _override(_user("manufacturer", "admin", MFR_TENANT_ID))
    resp = client.post("/api/v1/maintenance/plans", json=_PLAN_BODY)
    assert resp.status_code != 403, f"manufacturer.admin bloqueado — no debería. Got {resp.status_code}"


def test_create_plan_cmg_passes_gate():
    _override(_user("cmg", "admin", CMG_TENANT_ID))
    resp = client.post("/api/v1/maintenance/plans", json=_PLAN_BODY)
    assert resp.status_code != 403, f"cmg.admin bloqueado — no debería. Got {resp.status_code}"


# ── PUT /maintenance/plans/{id} ────────────────────────────────────────────────

@pytest.mark.parametrize("tier,role", [
    # client.admin eliminado: M3 le permite editar sus propios planes
    ("client", "operator"),
    ("subclient", "admin"),
])
def test_update_plan_non_management_blocked(tier, role):
    """Roles no-admin y subclient.admin siguen obteniendo 403 en actualización."""
    _override(_user(tier, role))
    resp = client.put(f"/api/v1/maintenance/plans/{PLAN_ID}", json={"name": "Actualizado"})
    assert resp.status_code == 403, f"Esperado 403 para {tier}.{role}, got {resp.status_code}"


def test_update_plan_manufacturer_passes_gate():
    _override(_user("manufacturer", "admin", MFR_TENANT_ID))
    resp = client.put(f"/api/v1/maintenance/plans/{PLAN_ID}", json={"name": "Actualizado"})
    assert resp.status_code != 403, f"manufacturer.admin bloqueado — no debería. Got {resp.status_code}"


def test_update_plan_cmg_passes_gate():
    _override(_user("cmg", "admin", CMG_TENANT_ID))
    resp = client.put(f"/api/v1/maintenance/plans/{PLAN_ID}", json={"name": "Actualizado"})
    assert resp.status_code != 403, f"cmg.admin bloqueado — no debería. Got {resp.status_code}"


# ── DELETE /maintenance/plans/{id} ────────────────────────────────────────────

@pytest.mark.parametrize("tier,role", [
    # client.admin eliminado: M3 le permite borrar sus propios planes
    ("client", "operator"),
])
def test_delete_plan_non_management_blocked(tier, role):
    """Roles no-admin siguen obteniendo 403 en borrado."""
    _override(_user(tier, role))
    resp = client.delete(f"/api/v1/maintenance/plans/{PLAN_ID}")
    assert resp.status_code == 403, f"Esperado 403 para {tier}.{role}, got {resp.status_code}"


def test_delete_plan_manufacturer_passes_gate():
    _override(_user("manufacturer", "admin", MFR_TENANT_ID))
    resp = client.delete(f"/api/v1/maintenance/plans/{PLAN_ID}")
    assert resp.status_code != 403, f"manufacturer.admin bloqueado — no debería. Got {resp.status_code}"


def test_delete_plan_cmg_passes_gate():
    _override(_user("cmg", "admin", CMG_TENANT_ID))
    resp = client.delete(f"/api/v1/maintenance/plans/{PLAN_ID}")
    assert resp.status_code != 403, f"cmg.admin bloqueado — no debería. Got {resp.status_code}"


# ── Helpers para tests de propiedad (requieren DB mock) ───────────────────────

def _plan_mock(owner_tenant_id):
    """Plan mock con thresholds de solo calendar_days para evitar queries CAN."""
    p = MagicMock()
    p.id = PLAN_ID
    p.vehicle_id = VEHICLE_ID
    p.tenant_id = CLIENT_TENANT_ID
    p.owner_tenant_id = owner_tenant_id
    p.name = "Plan test"
    p.trigger_condition = {"thresholds": [{"type": "calendar_days", "value": 90}]}
    p.warn_before_pct = 10
    p.active = True
    p.created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return p


def _vehicle_mock(tenant_id, manufacturer_tenant_id=None):
    v = MagicMock()
    v.id = VEHICLE_ID
    v.tenant_id = tenant_id
    v.name = "Vehículo test"
    v.vehicle_type_id = uuid.uuid4()
    v.manufacturer_tenant_id = manufacturer_tenant_id
    return v


def _make_db(plan=None, vehicle=None):
    """AsyncMock DB que sirve plan, vehículo, VehicleType vacío y Tenant con maintenance."""
    from app.models.maintenance import MaintenancePlan
    from app.models.vehicle import Vehicle
    from app.models.vehicle_type import VehicleType
    from app.models.tenant import Tenant

    mock_db = AsyncMock()

    async def _get(model, pk):
        if model is MaintenancePlan:
            return plan
        if model is Vehicle:
            return vehicle
        if model is VehicleType:
            vt = MagicMock()
            vt.maintenance_counters = []
            return vt
        if model is Tenant:
            t = MagicMock()
            t.enabled_modules = ["maintenance"]
            return t
        return None

    mock_db.get = AsyncMock(side_effect=_get)
    mock_db.commit = AsyncMock()
    mock_db.refresh = AsyncMock()
    mock_db.delete = AsyncMock()
    mock_db.add = AsyncMock()
    fetch = MagicMock()
    fetch.fetchone = MagicMock(return_value=None)
    fetch.scalar_one_or_none = MagicMock(return_value=None)
    fetch.scalar_one = MagicMock(return_value=0.0)
    mock_db.execute = AsyncMock(return_value=fetch)
    return mock_db


def _override_db(db):
    async def _gen():
        yield db
    app.dependency_overrides[get_db] = _gen


# ── Gate: client.admin ya NO queda bloqueado (M3) ────────────────────────────

def test_create_plan_client_admin_passes_gate():
    """Tras M3, client.admin supera el gate y recibe 404 (vehículo), no 403."""
    _override(_user("client", "admin", CLIENT_TENANT_ID))
    resp = client.post("/api/v1/maintenance/plans", json=_PLAN_BODY)
    assert resp.status_code != 403, f"client.admin bloqueado en gate — no debería. Got {resp.status_code}"


def test_update_plan_client_admin_passes_gate():
    """Tras M3, client.admin supera el gate de actualización (recibe 404, no 403)."""
    _override(_user("client", "admin", CLIENT_TENANT_ID))
    resp = client.put(f"/api/v1/maintenance/plans/{PLAN_ID}", json={"name": "x"})
    assert resp.status_code != 403, f"client.admin bloqueado en gate — no debería. Got {resp.status_code}"


def test_delete_plan_client_admin_passes_gate():
    """Tras M3, client.admin supera el gate de borrado (recibe 404, no 403)."""
    _override(_user("client", "admin", CLIENT_TENANT_ID))
    resp = client.delete(f"/api/v1/maintenance/plans/{PLAN_ID}")
    assert resp.status_code != 403, f"client.admin bloqueado en gate — no debería. Got {resp.status_code}"


# ── Propiedad: client.admin puede gestionar SU plan ──────────────────────────

def test_update_plan_client_admin_own_plan():
    """client.admin puede actualizar un plan cuyo owner_tenant_id es el suyo."""
    user = _user("client", "admin", CLIENT_TENANT_ID)
    _override(user)
    db = _make_db(
        plan=_plan_mock(owner_tenant_id=CLIENT_TENANT_ID),
        vehicle=_vehicle_mock(tenant_id=CLIENT_TENANT_ID),
    )
    _override_db(db)
    resp = client.put(f"/api/v1/maintenance/plans/{PLAN_ID}", json={"name": "Actualizado"})
    assert resp.status_code != 403, f"client.admin bloqueado en su propio plan. Got {resp.status_code}"


def test_delete_plan_client_admin_own_plan():
    """client.admin puede borrar un plan cuyo owner_tenant_id es el suyo."""
    user = _user("client", "admin", CLIENT_TENANT_ID)
    _override(user)
    db = _make_db(plan=_plan_mock(owner_tenant_id=CLIENT_TENANT_ID))
    _override_db(db)
    resp = client.delete(f"/api/v1/maintenance/plans/{PLAN_ID}")
    assert resp.status_code == 204, f"client.admin no pudo borrar su plan. Got {resp.status_code}"


# ── Propiedad: client.admin NO puede tocar el plan del fabricante ─────────────

def test_update_plan_client_admin_foreign_plan_forbidden():
    """client.admin recibe 403 al intentar actualizar un plan del fabricante."""
    user = _user("client", "admin", CLIENT_TENANT_ID)
    _override(user)
    db = _make_db(
        plan=_plan_mock(owner_tenant_id=MFR_TENANT_ID),
        vehicle=_vehicle_mock(tenant_id=CLIENT_TENANT_ID),
    )
    _override_db(db)
    resp = client.put(f"/api/v1/maintenance/plans/{PLAN_ID}", json={"name": "Hack"})
    assert resp.status_code == 403, f"client.admin editó plan ajeno — debería ser 403. Got {resp.status_code}"


def test_delete_plan_client_admin_foreign_plan_forbidden():
    """client.admin recibe 403 al intentar borrar un plan del fabricante."""
    user = _user("client", "admin", CLIENT_TENANT_ID)
    _override(user)
    db = _make_db(plan=_plan_mock(owner_tenant_id=MFR_TENANT_ID))
    _override_db(db)
    resp = client.delete(f"/api/v1/maintenance/plans/{PLAN_ID}")
    assert resp.status_code == 403, f"client.admin borró plan ajeno — debería ser 403. Got {resp.status_code}"


# ── Fix R5: manufacturer.admin puede gestionar SU plan ───────────────────────

def test_update_plan_manufacturer_own_plan_r5_fix():
    """R5 FIX: manufacturer.admin ya puede actualizar su propio plan (antes 403 por assert_can_access_vehicle write)."""
    user = _user("manufacturer", "admin", MFR_TENANT_ID)
    _override(user)
    db = _make_db(
        plan=_plan_mock(owner_tenant_id=MFR_TENANT_ID),
        vehicle=_vehicle_mock(tenant_id=CLIENT_TENANT_ID, manufacturer_tenant_id=MFR_TENANT_ID),
    )
    _override_db(db)
    resp = client.put(f"/api/v1/maintenance/plans/{PLAN_ID}", json={"name": "Actualizado mfr"})
    assert resp.status_code != 403, f"manufacturer.admin bloqueado en su propio plan (R5 no arreglado). Got {resp.status_code}"


def test_delete_plan_manufacturer_own_plan_r5_fix():
    """R5 FIX: manufacturer.admin puede borrar su propio plan."""
    user = _user("manufacturer", "admin", MFR_TENANT_ID)
    _override(user)
    db = _make_db(plan=_plan_mock(owner_tenant_id=MFR_TENANT_ID))
    _override_db(db)
    resp = client.delete(f"/api/v1/maintenance/plans/{PLAN_ID}")
    assert resp.status_code == 204, f"manufacturer.admin no pudo borrar su plan. Got {resp.status_code}"


# ── Propiedad: manufacturer.admin NO toca el plan del cliente ─────────────────

def test_update_plan_manufacturer_foreign_plan_forbidden():
    """manufacturer.admin recibe 403 al intentar actualizar un plan de cliente."""
    user = _user("manufacturer", "admin", MFR_TENANT_ID)
    _override(user)
    db = _make_db(
        plan=_plan_mock(owner_tenant_id=CLIENT_TENANT_ID),
        vehicle=_vehicle_mock(tenant_id=CLIENT_TENANT_ID, manufacturer_tenant_id=MFR_TENANT_ID),
    )
    _override_db(db)
    resp = client.put(f"/api/v1/maintenance/plans/{PLAN_ID}", json={"name": "Hack mfr"})
    assert resp.status_code == 403, f"manufacturer.admin editó plan ajeno — debería ser 403. Got {resp.status_code}"


def test_delete_plan_manufacturer_foreign_plan_forbidden():
    """manufacturer.admin recibe 403 al intentar borrar un plan de cliente."""
    user = _user("manufacturer", "admin", MFR_TENANT_ID)
    _override(user)
    db = _make_db(plan=_plan_mock(owner_tenant_id=CLIENT_TENANT_ID))
    _override_db(db)
    resp = client.delete(f"/api/v1/maintenance/plans/{PLAN_ID}")
    assert resp.status_code == 403, f"manufacturer.admin borró plan ajeno — debería ser 403. Got {resp.status_code}"


# ── CMG puede gestionar cualquier plan ───────────────────────────────────────

def test_update_plan_cmg_admin_any_plan():
    """cmg.admin puede actualizar cualquier plan independientemente del owner."""
    user = _user("cmg", "admin", CMG_TENANT_ID)
    _override(user)
    db = _make_db(
        plan=_plan_mock(owner_tenant_id=CLIENT_TENANT_ID),
        vehicle=_vehicle_mock(tenant_id=CLIENT_TENANT_ID),
    )
    _override_db(db)
    resp = client.put(f"/api/v1/maintenance/plans/{PLAN_ID}", json={"name": "CMG override"})
    assert resp.status_code != 403, f"cmg.admin bloqueado en plan ajeno. Got {resp.status_code}"


def test_delete_plan_cmg_admin_any_plan():
    """cmg.admin puede borrar cualquier plan independientemente del owner."""
    user = _user("cmg", "admin", CMG_TENANT_ID)
    _override(user)
    db = _make_db(plan=_plan_mock(owner_tenant_id=MFR_TENANT_ID))
    _override_db(db)
    resp = client.delete(f"/api/v1/maintenance/plans/{PLAN_ID}")
    assert resp.status_code == 204, f"cmg.admin bloqueado en plan ajeno. Got {resp.status_code}"


# ── Cross-tenant: client.admin de otro tenant recibe 403 en gestión ──────────

def test_update_plan_cross_tenant_forbidden():
    """client.admin de OTRO tenant recibe 403 en plan que no le pertenece."""
    user = _user("client", "admin", OTHER_TENANT_ID)
    _override(user)
    db = _make_db(plan=_plan_mock(owner_tenant_id=CLIENT_TENANT_ID))
    _override_db(db)
    resp = client.put(f"/api/v1/maintenance/plans/{PLAN_ID}", json={"name": "Cross"})
    assert resp.status_code == 403, f"client.admin ajeno editó plan — debería ser 403. Got {resp.status_code}"


def test_delete_plan_cross_tenant_forbidden():
    """client.admin de OTRO tenant recibe 403 en plan que no le pertenece."""
    user = _user("client", "admin", OTHER_TENANT_ID)
    _override(user)
    db = _make_db(plan=_plan_mock(owner_tenant_id=CLIENT_TENANT_ID))
    _override_db(db)
    resp = client.delete(f"/api/v1/maintenance/plans/{PLAN_ID}")
    assert resp.status_code == 403, f"client.admin ajeno borró plan — debería ser 403. Got {resp.status_code}"


# ── viewer/driver de cualquier tier bloqueados en gestión ────────────────────

@pytest.mark.parametrize("tier,role", [
    ("cmg", "viewer"),
    ("cmg", "driver"),
    ("manufacturer", "viewer"),
    ("client", "viewer"),
    ("client", "driver"),
])
def test_create_plan_non_admin_roles_blocked(tier, role):
    """viewer y driver de cualquier tier obtienen 403 en creación de plan."""
    _override(_user(tier, role))
    resp = client.post("/api/v1/maintenance/plans", json=_PLAN_BODY)
    assert resp.status_code == 403, f"{tier}.{role} no bloqueado — debería ser 403. Got {resp.status_code}"
