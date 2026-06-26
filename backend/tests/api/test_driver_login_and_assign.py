"""Tests del alta de chofer con login y del endpoint de asignación (Fase A, Commit 3).

- Alta de chofer creando un usuario `driver` (email+password) o vinculando uno existente.
- POST /work-orders/{id}/assign fija el driver_id validando tenant.
"""
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.schemas.auth import CurrentUser

CLIENT_ID = uuid.UUID("bb100000-0000-0000-0000-000000000001")
OTHER_ID = uuid.UUID("ff100000-0000-0000-0000-000000000009")
DRIVER_ID = uuid.UUID("d4100000-0000-0000-0000-00000000000a")
EXISTING_USER = uuid.UUID("e5100000-0000-0000-0000-00000000000e")

ADMIN = CurrentUser(user_id=uuid.uuid4(), tenant_id=CLIENT_ID, tenant_tier="client", role="admin", email="a@t.com")
VIEWER = CurrentUser(user_id=uuid.uuid4(), tenant_id=CLIENT_ID, tenant_tier="client", role="viewer", email="v@t.com")


def _setup(user, db):
    app.dependency_overrides[get_current_user] = lambda: user
    async def _g():
        yield db
    app.dependency_overrides[get_db] = _g


@pytest.fixture(autouse=True)
def clear():
    yield
    app.dependency_overrides.clear()


def _client():
    return TestClient(app, raise_server_exceptions=False)


def _scalar(value):
    r = MagicMock()
    r.scalar_one_or_none = MagicMock(return_value=value)
    return r


def _scalars(items):
    r = MagicMock()
    r.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=items)))
    return r


async def _refresh(obj):
    if getattr(obj, "id", None) is None:
        obj.id = uuid.uuid4()
    if getattr(obj, "active", None) is None:
        obj.active = True
    if getattr(obj, "created_at", None) is None:
        obj.created_at = datetime.now(timezone.utc)


# ── Alta de chofer con login ───────────────────────────────────────────────

def test_create_driver_with_inline_login_creates_driver_user():
    """email+password → se crea un User con rol 'driver' y se vincula al chofer."""
    db = AsyncMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock(side_effect=_refresh)
    _setup(ADMIN, db)
    resp = _client().post("/api/v1/drivers", json={
        "full_name": "Juan Chofer",
        "email": "juan@flota.com",
        "password": "secreto123",
    })
    assert resp.status_code == 201
    added_users = [c.args[0] for c in db.add.call_args_list if isinstance(c.args[0], User)]
    assert len(added_users) == 1
    assert added_users[0].role == "driver"
    assert added_users[0].email == "juan@flota.com"
    assert added_users[0].full_name == "Juan Chofer"


def test_create_driver_links_existing_user_same_tenant():
    """user_id de un usuario del mismo tenant, no vinculado → se vincula."""
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock(side_effect=_refresh)

    async def _get(model, _id):
        if getattr(model, "__name__", "") == "User":
            return SimpleNamespace(id=EXISTING_USER, tenant_id=CLIENT_ID)
        return None

    db.get = AsyncMock(side_effect=_get)
    db.execute = AsyncMock(return_value=_scalar(None))  # no vinculado a otro chofer
    _setup(ADMIN, db)
    resp = _client().post("/api/v1/drivers", json={
        "full_name": "Ana", "user_id": str(EXISTING_USER),
    })
    assert resp.status_code == 201
    assert resp.json()["user_id"] == str(EXISTING_USER)


def test_create_driver_link_user_other_tenant_404():
    db = AsyncMock()
    db.add = MagicMock()

    async def _get(model, _id):
        if getattr(model, "__name__", "") == "User":
            return SimpleNamespace(id=EXISTING_USER, tenant_id=OTHER_ID)  # otro tenant
        return None

    db.get = AsyncMock(side_effect=_get)
    _setup(ADMIN, db)
    resp = _client().post("/api/v1/drivers", json={
        "full_name": "Ana", "user_id": str(EXISTING_USER),
    })
    assert resp.status_code == 404


def test_create_driver_link_user_already_linked_409():
    db = AsyncMock()
    db.add = MagicMock()

    async def _get(model, _id):
        if getattr(model, "__name__", "") == "User":
            return SimpleNamespace(id=EXISTING_USER, tenant_id=CLIENT_ID)
        return None

    db.get = AsyncMock(side_effect=_get)
    db.execute = AsyncMock(return_value=_scalar(uuid.uuid4()))  # ya vinculado a otro chofer
    _setup(ADMIN, db)
    resp = _client().post("/api/v1/drivers", json={
        "full_name": "Ana", "user_id": str(EXISTING_USER),
    })
    assert resp.status_code == 409


def test_create_driver_email_without_password_422():
    db = AsyncMock()
    _setup(ADMIN, db)
    resp = _client().post("/api/v1/drivers", json={
        "full_name": "Ana", "email": "ana@flota.com",
    })
    assert resp.status_code == 422


# ── Endpoint de asignación ─────────────────────────────────────────────────

def _make_order():
    return SimpleNamespace(
        id=uuid.uuid4(), tenant_id=CLIENT_ID, title="OT", description=None,
        vehicle_id=None, driver_id=None, status="pending", priority="normal",
        scheduled_at=None, started_at=None, completed_at=None,
        location_address=None, location_lat=None, location_lon=None, notes=None,
        final_client_name=None, final_client_address=None, doc_number=None,
        created_by=None, created_at=datetime.now(timezone.utc), auto_close_config=None,
    )


def _assign_db(order, driver):
    db = AsyncMock()

    async def _get(model, _id):
        name = getattr(model, "__name__", "")
        if name == "Tenant":
            return SimpleNamespace(id=CLIENT_ID, tier="client", enabled_modules=["work-orders"])
        if name == "WorkOrder":
            return order
        if name == "Driver":
            return driver
        return None

    db.get = AsyncMock(side_effect=_get)
    db.execute = AsyncMock(return_value=_scalars([]))  # visible_tenant_ids: sin subclients
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


def test_assign_driver_to_order_ok():
    order = _make_order()
    driver = SimpleNamespace(id=DRIVER_ID, tenant_id=CLIENT_ID, active=True, full_name="Chofer")
    db = _assign_db(order, driver)
    _setup(ADMIN, db)
    resp = _client().post(f"/api/v1/work-orders/{order.id}/assign", json={"driver_id": str(DRIVER_ID)})
    assert resp.status_code == 200
    assert order.driver_id == DRIVER_ID


def test_assign_driver_other_tenant_400():
    order = _make_order()
    driver = SimpleNamespace(id=DRIVER_ID, tenant_id=OTHER_ID, active=True, full_name="Chofer")
    db = _assign_db(order, driver)
    _setup(ADMIN, db)
    resp = _client().post(f"/api/v1/work-orders/{order.id}/assign", json={"driver_id": str(DRIVER_ID)})
    assert resp.status_code == 400


def test_assign_unassign_with_null():
    order = _make_order()
    order.driver_id = DRIVER_ID
    db = _assign_db(order, None)
    _setup(ADMIN, db)
    resp = _client().post(f"/api/v1/work-orders/{order.id}/assign", json={"driver_id": None})
    assert resp.status_code == 200
    assert order.driver_id is None


def test_assign_forbidden_for_viewer_403():
    order = _make_order()
    db = _assign_db(order, None)
    _setup(VIEWER, db)
    resp = _client().post(f"/api/v1/work-orders/{order.id}/assign", json={"driver_id": str(DRIVER_ID)})
    assert resp.status_code == 403
