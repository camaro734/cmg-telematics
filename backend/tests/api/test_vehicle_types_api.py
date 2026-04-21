"""Tests para PATCH /api/v1/vehicle-types/{id}/sensor-schema."""
from unittest.mock import AsyncMock, MagicMock, patch
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser
from app.models.vehicle_type import VehicleType

CMG_TENANT_ID    = uuid.UUID("10000000-0000-0000-0000-000000000000")
CLIENT_TENANT_ID = uuid.UUID("20000000-0000-0000-0000-000000000000")
VTYPE_ID         = uuid.UUID("a0000000-0000-0000-0000-000000000001")

CMG_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CMG_TENANT_ID,
    tenant_tier="cmg", role="admin", email="cmg@test.com",
)
CLIENT_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CLIENT_TENANT_ID,
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
    return vt


SENSOR_PAYLOAD = [
    {
        "key": "avl_87",
        "label": "Nivel combustible",
        "unit": "%",
        "min": 0,
        "max": 100,
        "gauge_type": "battery",
        "avl_id": 87,
    }
]


def test_cmg_admin_can_update_sensor_schema():
    """CMG admin PATCH sensor-schema → 200 con schema actualizado."""
    db = AsyncMock()
    vt = _make_vtype()
    db.get = AsyncMock(return_value=vt)
    db.commit = AsyncMock()
    db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "sensor_schema", SENSOR_PAYLOAD))
    _override_user(CMG_USER)
    _override_db(db)

    # flag_modified requiere _sa_instance_state — no disponible en MagicMock
    with patch("sqlalchemy.orm.attributes.flag_modified"):
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.patch(
            f"/api/v1/vehicle-types/{VTYPE_ID}/sensor-schema",
            json={"sensor_schema": SENSOR_PAYLOAD},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["sensor_schema"] == SENSOR_PAYLOAD


def test_client_admin_cannot_update_sensor_schema():
    """Usuario no CMG → 403."""
    db = AsyncMock()
    _override_user(CLIENT_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.patch(
        f"/api/v1/vehicle-types/{VTYPE_ID}/sensor-schema",
        json={"sensor_schema": []},
    )
    assert resp.status_code == 403


def test_unknown_vehicle_type_returns_404():
    """Tipo de vehículo inexistente → 404."""
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.patch(
        f"/api/v1/vehicle-types/{uuid.uuid4()}/sensor-schema",
        json={"sensor_schema": []},
    )
    assert resp.status_code == 404


def test_empty_schema_clears_sensors():
    """Enviar lista vacía borra todos los sensores."""
    db = AsyncMock()
    vt = _make_vtype()
    vt.sensor_schema = SENSOR_PAYLOAD
    db.get = AsyncMock(return_value=vt)
    db.commit = AsyncMock()
    db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "sensor_schema", []))
    _override_user(CMG_USER)
    _override_db(db)

    # flag_modified requiere _sa_instance_state — no disponible en MagicMock
    with patch("sqlalchemy.orm.attributes.flag_modified"):
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.patch(
            f"/api/v1/vehicle-types/{VTYPE_ID}/sensor-schema",
            json={"sensor_schema": []},
        )
    assert resp.status_code == 200
    assert resp.json()["sensor_schema"] == []
