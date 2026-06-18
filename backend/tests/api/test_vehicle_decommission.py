"""
Tests TDD — Dar de baja (soft-delete) y reactivar vehículo.

Cubre:
- Admin da de baja su vehículo → 204, active=False.
- Vehículo con órdenes abiertas bloquea → 409.
- Vehículo ya inactivo → 404 al intentar dar de baja de nuevo.
- No-admin (operator) → 403.
- Admin reactiva vehículo inactivo → 200, active=True.
- Reactivar vehículo ya activo → 400.
"""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient
import pytest

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser
from app.models.vehicle import Vehicle

CLIENT_ID = uuid.UUID("ff100000-0000-0000-0000-000000000001")
VEHICLE_ID = uuid.UUID("a1000000-0000-0000-0000-000000000099")

ADMIN = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CLIENT_ID,
    tenant_tier="client", role="admin", email="admin@test.com",
)
OPERATOR = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CLIENT_ID,
    tenant_tier="client", role="operator", email="op@test.com",
)


class _MockVehicle:
    def __init__(self, active: bool = True):
        self.id = VEHICLE_ID
        self.tenant_id = CLIENT_ID
        self.manufacturer_tenant_id = None
        self.vehicle_type_id = uuid.uuid4()
        self.name = "Cisterna 01"
        self.created_at = datetime.now(timezone.utc)
        self.active = active


def _scalar_none():
    return MagicMock(scalar_one_or_none=MagicMock(return_value=None))


def _scalar_val(val):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=val))


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
# Dar de baja
# ---------------------------------------------------------------------------
def test_admin_decommissions_vehicle_204():
    vehicle = _MockVehicle(active=True)
    db = AsyncMock()
    db.get = AsyncMock(return_value=vehicle)
    db.execute = AsyncMock(return_value=_scalar_none())  # sin órdenes abiertas
    _setup(ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).delete(
        f"/api/v1/vehicles/{VEHICLE_ID}"
    )
    assert resp.status_code == 204
    assert vehicle.active is False


def test_decommission_blocked_by_open_work_order_409():
    vehicle = _MockVehicle(active=True)
    db = AsyncMock()
    db.get = AsyncMock(return_value=vehicle)
    db.execute = AsyncMock(return_value=_scalar_val(uuid.uuid4()))  # hay orden abierta
    _setup(ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).delete(
        f"/api/v1/vehicles/{VEHICLE_ID}"
    )
    assert resp.status_code == 409
    assert vehicle.active is True  # no se tocó


def test_decommission_already_inactive_404():
    vehicle = _MockVehicle(active=False)
    db = AsyncMock()
    db.get = AsyncMock(return_value=vehicle)
    _setup(ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).delete(
        f"/api/v1/vehicles/{VEHICLE_ID}"
    )
    assert resp.status_code == 404


def test_operator_cannot_decommission_403():
    db = AsyncMock()
    db.get = AsyncMock(return_value=_MockVehicle(active=True))
    _setup(OPERATOR, db)

    resp = TestClient(app, raise_server_exceptions=False).delete(
        f"/api/v1/vehicles/{VEHICLE_ID}"
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Reactivar
# ---------------------------------------------------------------------------
def test_admin_reactivates_vehicle_200():
    vehicle = _MockVehicle(active=False)
    db = AsyncMock()
    db.get = AsyncMock(return_value=vehicle)
    db.refresh = AsyncMock()
    _setup(ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        f"/api/v1/vehicles/{VEHICLE_ID}/reactivate"
    )
    assert resp.status_code == 200
    assert vehicle.active is True


def test_reactivate_already_active_400():
    vehicle = _MockVehicle(active=True)
    db = AsyncMock()
    db.get = AsyncMock(return_value=vehicle)
    _setup(ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        f"/api/v1/vehicles/{VEHICLE_ID}/reactivate"
    )
    assert resp.status_code == 400
