"""Tests para DELETE /api/v1/vehicle-types/{type_id}."""
from unittest.mock import AsyncMock, MagicMock
import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser
from app.models.vehicle_type import VehicleType
from app.models.vehicle import Vehicle

VTYPE_ID     = uuid.UUID("a0000000-0000-0000-0000-000000000001")
CMG_TENANT   = uuid.UUID("10000000-0000-0000-0000-000000000000")
CLIENT_TENANT = uuid.UUID("20000000-0000-0000-0000-000000000000")

CMG_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CMG_TENANT,
    tenant_tier="cmg", role="admin", email="cmg@test.com",
)
CLIENT_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CLIENT_TENANT,
    tenant_tier="client", role="admin", email="client@test.com",
)


def _override_user(user: CurrentUser):
    app.dependency_overrides[get_current_user] = lambda: user


def _override_db(session):
    async def _gen():
        yield session
    app.dependency_overrides[get_db] = _gen


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def _make_vtype() -> MagicMock:
    vt = MagicMock(spec=VehicleType)
    vt.id = VTYPE_ID
    vt.slug = "cisterna"
    vt.name = "Cisterna"
    vt.sensor_schema = []
    vt.maintenance_templates = []
    vt.historic_metrics = []
    vt.dout_config = []
    vt.pdf_metrics = []
    vt.system_blocks = []
    return vt


def _make_vehicle() -> MagicMock:
    v = MagicMock(spec=Vehicle)
    v.id = uuid.uuid4()
    v.vehicle_type_id = VTYPE_ID
    return v


# ---------------------------------------------------------------------------

def test_delete_vehicle_type_ok_no_vehicles():
    """DELETE tipo sin vehículos → 204."""
    vtype = _make_vtype()
    db = AsyncMock()
    # db.get → vtype; db.execute (count) → 0 vehículos
    db.get = AsyncMock(return_value=vtype)
    db.execute = AsyncMock(
        return_value=MagicMock(scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[]))))
    )
    db.delete = AsyncMock()
    db.commit = AsyncMock()
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.delete(f"/api/v1/vehicle-types/{VTYPE_ID}")
    assert resp.status_code == 204
    db.delete.assert_awaited_once_with(vtype)
    db.commit.assert_awaited_once()


def test_delete_vehicle_type_blocked_with_vehicles():
    """DELETE tipo con vehículos → 400 con mensaje de cuántos."""
    vtype = _make_vtype()
    vehicle1 = _make_vehicle()
    vehicle2 = _make_vehicle()
    db = AsyncMock()
    db.get = AsyncMock(return_value=vtype)
    db.execute = AsyncMock(
        return_value=MagicMock(
            scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[vehicle1, vehicle2])))
        )
    )
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.delete(f"/api/v1/vehicle-types/{VTYPE_ID}")
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert "2" in detail
    assert "No se puede borrar" in detail


def test_delete_vehicle_type_blocked_with_one_vehicle():
    """Con 1 vehículo → 400 con singular correcto."""
    vtype = _make_vtype()
    db = AsyncMock()
    db.get = AsyncMock(return_value=vtype)
    db.execute = AsyncMock(
        return_value=MagicMock(
            scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[_make_vehicle()])))
        )
    )
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.delete(f"/api/v1/vehicle-types/{VTYPE_ID}")
    assert resp.status_code == 400
    assert "1" in resp.json()["detail"]


def test_delete_vehicle_type_404():
    """Tipo inexistente → 404."""
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.delete(f"/api/v1/vehicle-types/{uuid.uuid4()}")
    assert resp.status_code == 404


def test_delete_vehicle_type_403_client():
    """Cliente no CMG → 403."""
    db = AsyncMock()
    _override_user(CLIENT_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.delete(f"/api/v1/vehicle-types/{VTYPE_ID}")
    assert resp.status_code == 403
