"""
Test 2D — Gates adicionales seguros:
  - POST /vehicles: client.admin → 403; manufacturer.admin → pasa
  - POST /tenants/{id}/portal-token: operator → 403; admin → pasa
  - POST /maintenance/plans/{id}/complete: viewer → 403; operator → pasa
"""
import uuid
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser

TENANT_ID = uuid.uuid4()
PLAN_ID = uuid.uuid4()
VEHICLE_TYPE_ID = uuid.uuid4()
CMG_TENANT_ID = uuid.uuid4()
MFR_TENANT_ID = uuid.uuid4()
CLIENT_TENANT_ID = uuid.uuid4()


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


# ── POST /vehicles ─────────────────────────────────────────────────────────────

_VEHICLE_BODY = {
    "name": "Vehículo test",
    "vehicle_type_id": str(VEHICLE_TYPE_ID),
    "license_plate": "TEST-001",
}


@pytest.mark.parametrize("tier,role", [
    ("client", "admin"),
    ("client", "operator"),
    ("subclient", "admin"),
])
def test_create_vehicle_client_blocked(tier, role):
    _override(_user(tier, role))
    resp = client.post("/api/v1/vehicles", json=_VEHICLE_BODY)
    assert resp.status_code == 403, f"Esperado 403 para {tier}.{role}, got {resp.status_code}"


def test_create_vehicle_client_viewer_blocked():
    _override(_user("client", "viewer"))
    resp = client.post("/api/v1/vehicles", json=_VEHICLE_BODY)
    assert resp.status_code == 403


def test_create_vehicle_manufacturer_passes_gate():
    _override(_user("manufacturer", "admin", MFR_TENANT_ID))
    resp = client.post("/api/v1/vehicles", json=_VEHICLE_BODY)
    assert resp.status_code != 403, f"manufacturer.admin bloqueado — no debería. Got {resp.status_code}"


def test_create_vehicle_cmg_passes_gate():
    _override(_user("cmg", "admin", CMG_TENANT_ID))
    resp = client.post("/api/v1/vehicles", json=_VEHICLE_BODY)
    assert resp.status_code != 403, f"cmg.admin bloqueado — no debería. Got {resp.status_code}"


# ── POST /tenants/{id}/portal-token ───────────────────────────────────────────

def test_portal_token_operator_blocked():
    _override(_user("client", "operator", CLIENT_TENANT_ID))
    resp = client.post(f"/api/v1/tenants/{CLIENT_TENANT_ID}/portal-token")
    assert resp.status_code == 403, f"Esperado 403 para operator, got {resp.status_code}"


def test_portal_token_viewer_blocked():
    _override(_user("client", "viewer", CLIENT_TENANT_ID))
    resp = client.post(f"/api/v1/tenants/{CLIENT_TENANT_ID}/portal-token")
    assert resp.status_code == 403


def test_portal_token_admin_passes_gate():
    _override(_user("client", "admin", CLIENT_TENANT_ID))
    resp = client.post(f"/api/v1/tenants/{CLIENT_TENANT_ID}/portal-token")
    # Gate de rol pasa; puede fallar por DB — lo que no debe ser es 403
    assert resp.status_code != 403, f"client.admin bloqueado — no debería. Got {resp.status_code}"


def test_portal_token_cmg_admin_passes_gate():
    _override(_user("cmg", "admin", CMG_TENANT_ID))
    resp = client.post(f"/api/v1/tenants/{CLIENT_TENANT_ID}/portal-token")
    assert resp.status_code != 403, f"cmg.admin bloqueado — no debería. Got {resp.status_code}"


# ── POST /maintenance/plans/{id}/complete ─────────────────────────────────────

def test_complete_plan_viewer_blocked():
    _override(_user("client", "viewer", CLIENT_TENANT_ID))
    resp = client.post(f"/api/v1/maintenance/plans/{PLAN_ID}/complete")
    assert resp.status_code == 403, f"Esperado 403 para viewer, got {resp.status_code}"


def test_complete_plan_driver_blocked():
    _override(_user("client", "driver", CLIENT_TENANT_ID))
    resp = client.post(f"/api/v1/maintenance/plans/{PLAN_ID}/complete")
    assert resp.status_code == 403, f"Esperado 403 para driver, got {resp.status_code}"


def test_complete_plan_operator_passes_gate():
    _override(_user("client", "operator", CLIENT_TENANT_ID))
    resp = client.post(f"/api/v1/maintenance/plans/{PLAN_ID}/complete")
    assert resp.status_code != 403, f"operator bloqueado — no debería. Got {resp.status_code}"


def test_complete_plan_admin_passes_gate():
    _override(_user("cmg", "admin", CMG_TENANT_ID))
    resp = client.post(f"/api/v1/maintenance/plans/{PLAN_ID}/complete")
    assert resp.status_code != 403, f"cmg.admin bloqueado — no debería. Got {resp.status_code}"
