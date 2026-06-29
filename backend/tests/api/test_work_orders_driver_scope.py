"""Tests del auto-scoping del rol chofer sobre las órdenes de trabajo (Fase A, Commit 1).

Un usuario con rol `driver` solo ve/accede a las OTs asignadas a su ficha `driver`
(`driver.user_id == user.user_id` y `work_order.driver_id == driver.id`).
No cambia nada para admin/operator/viewer.
"""
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser

CLIENT_ID = uuid.UUID("bb100000-0000-0000-0000-000000000001")
DRIVER_A = uuid.UUID("d4100000-0000-0000-0000-00000000000a")
DRIVER_B = uuid.UUID("d4100000-0000-0000-0000-00000000000b")
USER_DRIVER = uuid.uuid4()

DRIVER_USER = CurrentUser(user_id=USER_DRIVER, tenant_id=CLIENT_ID, tenant_tier="client", role="driver", email="chofer@t.com")
ADMIN_USER = CurrentUser(user_id=uuid.uuid4(), tenant_id=CLIENT_ID, tenant_tier="client", role="admin", email="admin@t.com")


def _setup(user, db):
    app.dependency_overrides[get_current_user] = lambda: user
    async def _g():
        yield db
    app.dependency_overrides[get_db] = _g
    # require_module hace db.get(Tenant) → tenant con work-orders habilitado
    return db


def _client():
    return TestClient(app, raise_server_exceptions=False)


def _make_tenant():
    return SimpleNamespace(id=CLIENT_ID, tier="client", enabled_modules=["work-orders"])


def _make_order(driver_id):
    return SimpleNamespace(
        id=uuid.uuid4(), tenant_id=CLIENT_ID, title="OT", description=None,
        vehicle_id=None, driver_id=driver_id, status="pending", priority="normal",
        scheduled_at=None, started_at=None, completed_at=None,
        location_address=None, location_lat=None, location_lon=None, notes=None,
        final_client_name=None, final_client_address=None, doc_number=None,
        created_by=None, created_at=datetime.now(timezone.utc), auto_close_config=None,
    )


def _scalar(value):
    r = MagicMock()
    r.scalar_one_or_none = MagicMock(return_value=value)
    return r


def _scalars(items):
    r = MagicMock()
    r.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=items)))
    return r


def _smart_get(order=None):
    """db.get que discrimina por modelo: Tenant (require_module), WorkOrder, Driver."""
    async def _get(model, _id):
        name = getattr(model, "__name__", "")
        if name == "Tenant":
            return _make_tenant()
        if name == "WorkOrder":
            return order
        if name == "Driver":
            return SimpleNamespace(full_name="Chofer")
        return None
    return AsyncMock(side_effect=_get)


import pytest


@pytest.fixture(autouse=True)
def clear():
    yield
    app.dependency_overrides.clear()


def test_driver_without_linked_driver_row_gets_empty_list():
    """Chofer sin ficha `driver` vinculada → lista vacía (no filtra por error a otro)."""
    db = AsyncMock()
    db.get = _smart_get()  # require_module
    # _driver_id_for_user → None
    db.execute = AsyncMock(return_value=_scalar(None))
    _setup(DRIVER_USER, db)
    resp = _client().get("/api/v1/work-orders")
    assert resp.status_code == 200
    assert resp.json() == []


def test_driver_list_scoped_to_own_orders():
    """Chofer vinculado a DRIVER_A → el listado se filtra a sus OTs."""
    db = AsyncMock()
    order = _make_order(DRIVER_A)
    db.get = _smart_get(order)
    # 1ª execute: resolver driver_id (DRIVER_A). 2ª execute: query de OTs.
    db.execute = AsyncMock(side_effect=[_scalar(DRIVER_A), _scalars([order])])
    _setup(DRIVER_USER, db)
    resp = _client().get("/api/v1/work-orders")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["driver_id"] == str(DRIVER_A)
    # La query de OTs debe llevar el filtro por el driver propio
    second_stmt = str(db.execute.call_args_list[1].args[0])
    assert "work_order.driver_id" in second_stmt


def test_driver_cannot_access_other_drivers_order_404():
    """Chofer A pide el detalle de una OT de chofer B → 404 (no revela existencia)."""
    db = AsyncMock()
    order = _make_order(DRIVER_B)
    db.get = _smart_get(order)  # db.get(WorkOrder) → order ajena
    db.execute = AsyncMock(return_value=_scalar(DRIVER_A))  # _driver_id_for_user → A
    _setup(DRIVER_USER, db)
    resp = _client().get(f"/api/v1/work-orders/{order.id}")
    assert resp.status_code == 404


def test_driver_accesses_own_order_ok():
    """Chofer A pide el detalle de su propia OT → 200."""
    db = AsyncMock()
    order = _make_order(DRIVER_A)
    db.get = _smart_get(order)
    db.execute = AsyncMock(return_value=_scalar(DRIVER_A))
    _setup(DRIVER_USER, db)
    resp = _client().get(f"/api/v1/work-orders/{order.id}")
    assert resp.status_code == 200
    assert resp.json()["driver_id"] == str(DRIVER_A)


def test_admin_list_not_driver_scoped():
    """Admin del tenant: sin auto-scope de chofer, pero acotado a SU propio tenant.

    Partes privados (no jerárquicos): el listado filtra por `tenant_id` exacto, sin
    descenso a subclients y sin bypass de niveles superiores.
    """
    db = AsyncMock()
    order = _make_order(DRIVER_B)
    db.get = _smart_get(order)
    # Solo una execute: la query de OTs (ya no se consulta visible_tenant_ids).
    db.execute = AsyncMock(side_effect=[_scalars([order])])
    _setup(ADMIN_USER, db)
    resp = _client().get("/api/v1/work-orders")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    stmt = str(db.execute.call_args_list[0].args[0])
    assert "work_order.driver_id =" not in stmt   # no auto-scope de chofer
    assert "work_order.tenant_id =" in stmt       # dueño-exacto (no IN subárbol)
    assert "work_order.tenant_id IN" not in stmt  # sin descenso a subclients
