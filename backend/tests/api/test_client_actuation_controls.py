"""Tests — permiso por cliente para accionar controles (DOUT / Manual CAN).

- tenant_can_actuate_controls: lógica pura por tier/jerarquía/flag.
- POST /vehicles/{id}/dout: cliente bajo fabricante sin flag → 403.
- GET /tenants: búsqueda por q + filtro manufacturer_id (WHERE compilado).
"""
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser
from app.api.v1.access_v2 import tenant_can_actuate_controls

MFR_ID = uuid.UUID("b0000000-0000-0000-0000-000000000001")
CLIENT_ID = uuid.UUID("b0000000-0000-0000-0000-000000000002")
VEHICLE_ID = uuid.UUID("b0000000-0000-0000-0000-0000000000ff")


class _T:
    def __init__(self, parent_manufacturer_id=None, can_actuate_controls=False):
        self.parent_manufacturer_id = parent_manufacturer_id
        self.can_actuate_controls = can_actuate_controls


# --- Lógica pura -----------------------------------------------------------

def test_cmg_and_manufacturer_always_actuate():
    assert tenant_can_actuate_controls("cmg", _T()) is True
    assert tenant_can_actuate_controls("manufacturer", _T()) is True


def test_direct_cmg_client_actuates():
    # parent_manufacturer_id None → cliente directo de CMG → puede.
    assert tenant_can_actuate_controls("client", _T(parent_manufacturer_id=None)) is True


def test_client_under_manufacturer_blocked_without_flag():
    assert tenant_can_actuate_controls("client", _T(parent_manufacturer_id=MFR_ID, can_actuate_controls=False)) is False


def test_client_under_manufacturer_allowed_with_flag():
    assert tenant_can_actuate_controls("client", _T(parent_manufacturer_id=MFR_ID, can_actuate_controls=True)) is True


def test_subclient_under_manufacturer_blocked_without_flag():
    assert tenant_can_actuate_controls("subclient", _T(parent_manufacturer_id=MFR_ID, can_actuate_controls=False)) is False


# --- Endpoint DOUT ---------------------------------------------------------

def _setup(user: CurrentUser, db):
    app.dependency_overrides[get_current_user] = lambda: user

    async def _gen():
        yield db
    app.dependency_overrides[get_db] = _gen


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_dout_blocked_for_client_under_manufacturer_without_flag():
    """Cliente (admin) bajo un fabricante sin permiso → 403, sin tocar el dispositivo."""
    user = CurrentUser(
        user_id=uuid.uuid4(), tenant_id=CLIENT_ID,
        tenant_tier="client", role="admin", email="delimex@test.com",
    )
    db = AsyncMock()
    # assert_can_actuate_controls hace db.get(Tenant, user.tenant_id)
    db.get = AsyncMock(return_value=_T(parent_manufacturer_id=MFR_ID, can_actuate_controls=False))
    _setup(user, db)
    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.post(f"/api/v1/vehicles/{VEHICLE_ID}/dout", json={"slot": 1, "state": True})
    assert r.status_code == 403
    assert "lectura" in r.json()["detail"].lower()


# --- Búsqueda en GET /tenants ---------------------------------------------

def test_tenants_search_filters_by_manufacturer_and_query():
    user = CurrentUser(
        user_id=uuid.uuid4(), tenant_id=uuid.uuid4(),
        tenant_tier="cmg", role="admin", email="cmg@test.com",
    )
    captured = []
    result = MagicMock()
    result.scalars.return_value.all.return_value = []

    async def _execute(stmt, *a, **k):
        captured.append(stmt)
        return result

    db = AsyncMock()
    db.execute = _execute
    _setup(user, db)
    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.get(f"/api/v1/tenants?manufacturer_id={MFR_ID}&q=delim&limit=50")
    assert r.status_code == 200
    sql = str(captured[0]).upper()
    assert "PARENT_MANUFACTURER_ID" in sql
    assert "ILIKE" in sql or "LOWER(" in sql


def test_tenants_no_params_still_works():
    user = CurrentUser(
        user_id=uuid.uuid4(), tenant_id=uuid.uuid4(),
        tenant_tier="cmg", role="admin", email="cmg@test.com",
    )
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    _setup(user, db)
    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.get("/api/v1/tenants")
    assert r.status_code == 200
    assert r.json() == []
