"""
Test 2B — Gate de rol en acknowledge de alertas.
Verifica que:
  - viewer (cualquier tier) → 403
  - driver (cualquier tier) → 403
  - operator (cualquier tier) → pasa el gate (puede fallar por DB mock; lo que NO debe ocurrir es 403)
  - admin (cualquier tier) → pasa el gate
"""
import uuid
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser

ALERT_ID = uuid.uuid4()


def _user(tier: str, role: str) -> CurrentUser:
    return CurrentUser(
        user_id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
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

_ACK_BODY = {"note": "Test acknowledge"}


# ── viewer bloqueado ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("tier", ["cmg", "client", "manufacturer"])
def test_acknowledge_viewer_blocked(tier):
    _override(_user(tier, "viewer"))
    resp = client.post(f"/api/v1/alerts/{ALERT_ID}/acknowledge", json=_ACK_BODY)
    assert resp.status_code == 403, f"Esperado 403 para {tier}.viewer, got {resp.status_code}"


# ── driver bloqueado ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("tier", ["client", "manufacturer"])
def test_acknowledge_driver_blocked(tier):
    _override(_user(tier, "driver"))
    resp = client.post(f"/api/v1/alerts/{ALERT_ID}/acknowledge", json=_ACK_BODY)
    assert resp.status_code == 403, f"Esperado 403 para {tier}.driver, got {resp.status_code}"


# ── operator pasa el gate ─────────────────────────────────────────────────────

@pytest.mark.parametrize("tier", ["cmg", "client", "manufacturer"])
def test_acknowledge_operator_passes_gate(tier):
    _override(_user(tier, "operator"))
    resp = client.post(f"/api/v1/alerts/{ALERT_ID}/acknowledge", json=_ACK_BODY)
    # El gate de rol deja pasar; puede fallar por módulo/BD — lo que no debe ser es 403
    assert resp.status_code != 403, f"{tier}.operator bloqueado por gate — no debería. Got {resp.status_code}"


# ── admin pasa el gate ────────────────────────────────────────────────────────

@pytest.mark.parametrize("tier", ["cmg", "client", "manufacturer"])
def test_acknowledge_admin_passes_gate(tier):
    _override(_user(tier, "admin"))
    resp = client.post(f"/api/v1/alerts/{ALERT_ID}/acknowledge", json=_ACK_BODY)
    assert resp.status_code != 403, f"{tier}.admin bloqueado por gate — no debería. Got {resp.status_code}"
