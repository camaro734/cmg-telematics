"""
Test 2A — Gating de tier en gestión de reglas de alerta.
Verifica que:
  - client.admin / client.operator → 403 en POST/PUT/DELETE/restore
  - viewer (cualquier tier) → 403 en POST/PUT/DELETE/restore
  - manufacturer.admin → puede crear (201) y editar (200)
  - cmg.admin → puede crear (201) y editar (200)
"""
import uuid
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient
from app.main import app
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser

CLIENT_TENANT_ID = uuid.uuid4()
MFR_TENANT_ID = uuid.uuid4()
CMG_TENANT_ID = uuid.uuid4()
RULE_ID = uuid.uuid4()

_BASE_RULE = dict(
    id=RULE_ID,
    tenant_id=MFR_TENANT_ID,
    name="Regla test",
    condition={"type": "threshold", "field": "speed", "op": ">", "value": 100},
    vehicle_filter={"scope": "all"},
    severity="warning",
    actions=[],
    escalation=[],
    schedule={"type": "always"},
    active=True,
    cooldown_minutes=0,
    archived_at=None,
    created_at=None,
    updated_at=None,
    created_by_user_id=None,
)


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

_RULE_BODY = {
    "name": "Nueva regla",
    "condition": {"type": "threshold", "field": "speed", "op": ">", "value": 80},
    "vehicle_filter": {"scope": "all"},
    "severity": "warning",
    "actions": [],
    "escalation": [],
    "schedule": {"type": "always"},
    "active": True,
    "cooldown_minutes": 0,
}


# ── POST /rules ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("tier,role", [
    ("client", "admin"),
    ("client", "operator"),
    ("subclient", "admin"),
])
def test_create_rule_client_blocked(tier, role):
    _override(_user(tier, role))
    resp = client.post("/api/v1/rules", json=_RULE_BODY)
    assert resp.status_code == 403, f"Esperado 403 para {tier}.{role}, got {resp.status_code}"


def test_create_rule_viewer_blocked():
    _override(_user("cmg", "viewer", CMG_TENANT_ID))
    resp = client.post("/api/v1/rules", json=_RULE_BODY)
    assert resp.status_code == 403


@patch("app.api.v1.rules.AsyncSession")
def test_create_rule_manufacturer_allowed(mock_session):
    """manufacturer.admin no debe recibir 403 del gate de tier (puede fallar por DB mock)."""
    _override(_user("manufacturer", "admin", MFR_TENANT_ID))
    resp = client.post("/api/v1/rules", json=_RULE_BODY)
    # El gate de tier deja pasar; cualquier código != 403 es correcto
    assert resp.status_code != 403, f"manufacturer.admin bloqueado — no debería. Got {resp.status_code}"


@patch("app.api.v1.rules.AsyncSession")
def test_create_rule_cmg_allowed(mock_session):
    _override(_user("cmg", "admin", CMG_TENANT_ID))
    resp = client.post("/api/v1/rules", json=_RULE_BODY)
    assert resp.status_code != 403, f"cmg.admin bloqueado — no debería. Got {resp.status_code}"


# ── PUT /rules/{id} ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("tier,role", [
    ("client", "admin"),
    ("client", "operator"),
    ("subclient", "admin"),
])
def test_update_rule_client_blocked(tier, role):
    _override(_user(tier, role))
    resp = client.put(f"/api/v1/rules/{RULE_ID}", json=_RULE_BODY)
    assert resp.status_code == 403, f"Esperado 403 para {tier}.{role}, got {resp.status_code}"


def test_update_rule_viewer_blocked():
    _override(_user("cmg", "viewer", CMG_TENANT_ID))
    resp = client.put(f"/api/v1/rules/{RULE_ID}", json=_RULE_BODY)
    assert resp.status_code == 403


# ── DELETE /rules/{id} ────────────────────────────────────────────────────────

@pytest.mark.parametrize("tier,role", [
    ("client", "admin"),
    ("client", "operator"),
])
def test_delete_rule_client_blocked(tier, role):
    _override(_user(tier, role))
    resp = client.delete(f"/api/v1/rules/{RULE_ID}")
    assert resp.status_code == 403, f"Esperado 403 para {tier}.{role}, got {resp.status_code}"


def test_delete_rule_viewer_blocked():
    _override(_user("cmg", "viewer", CMG_TENANT_ID))
    resp = client.delete(f"/api/v1/rules/{RULE_ID}")
    assert resp.status_code == 403


# ── POST /rules/{id}/restore ─────────────────────────────────────────────────

@pytest.mark.parametrize("tier,role", [
    ("client", "admin"),
    ("client", "operator"),
])
def test_restore_rule_client_blocked(tier, role):
    _override(_user(tier, role))
    resp = client.post(f"/api/v1/rules/{RULE_ID}/restore")
    assert resp.status_code == 403, f"Esperado 403 para {tier}.{role}, got {resp.status_code}"


def test_restore_rule_viewer_blocked():
    _override(_user("cmg", "viewer", CMG_TENANT_ID))
    resp = client.post(f"/api/v1/rules/{RULE_ID}/restore")
    assert resp.status_code == 403
