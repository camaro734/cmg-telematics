"""
Test 2C — Gating de tier en gestión de planes de mantenimiento.
Verifica que:
  - client.admin → 403 en POST/PUT/DELETE /maintenance/plans
  - manufacturer.admin → pasa el gate (no 403)
  - cmg.admin → pasa el gate
  - client.operator → 403 (require_management_tier solo permite admin en planes)
"""
import uuid
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser

PLAN_ID = uuid.uuid4()
VEHICLE_ID = uuid.uuid4()
CLIENT_TENANT_ID = uuid.uuid4()
MFR_TENANT_ID = uuid.uuid4()
CMG_TENANT_ID = uuid.uuid4()


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
    ("client", "admin"),
    ("client", "operator"),
    ("subclient", "admin"),
])
def test_create_plan_client_blocked(tier, role):
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
    ("client", "admin"),
    ("client", "operator"),
    ("subclient", "admin"),
])
def test_update_plan_client_blocked(tier, role):
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
    ("client", "admin"),
    ("client", "operator"),
])
def test_delete_plan_client_blocked(tier, role):
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
