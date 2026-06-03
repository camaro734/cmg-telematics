"""Tests para GET /api/v1/sensors/catalog."""
from unittest.mock import AsyncMock, MagicMock
import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser

CMG_TENANT_ID    = uuid.UUID("10000000-0000-0000-0000-000000000000")
CLIENT_TENANT_ID = uuid.UUID("20000000-0000-0000-0000-000000000000")

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


def _db_with_schemas(schemas: list) -> AsyncMock:
    """DB mock que devuelve una lista de sensor_schema (JSONB)."""
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=MagicMock(
            scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=schemas)))
        )
    )
    return db


# ---------------------------------------------------------------------------

def test_catalog_returns_deduped_sensors():
    """Sensores con la misma key de distintos tipos aparecen una sola vez."""
    schemas = [
        [
            {"key": "avl_30", "label": "RPM", "unit": "rpm"},
            {"key": "avl_85", "label": "RPM 2", "unit": "rpm"},
        ],
        [
            {"key": "avl_30", "label": "RPM (duplicado)", "unit": "rpm"},  # debe ignorarse
            {"key": "can_presion", "label": "Presión hidráulica", "unit": "bar"},
        ],
    ]
    db = _db_with_schemas(schemas)
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/sensors/catalog")
    assert resp.status_code == 200
    data = resp.json()
    keys = [s["key"] for s in data]
    # 3 claves únicas
    assert len(data) == 3
    assert "avl_30" in keys
    assert "avl_85" in keys
    assert "can_presion" in keys
    # Primera definición de avl_30 gana
    avl30 = next(s for s in data if s["key"] == "avl_30")
    assert avl30["label"] == "RPM"


def test_catalog_sorted_by_label():
    """Resultado ordenado por label (case-insensitive)."""
    schemas = [
        [
            {"key": "z_sensor", "label": "Temperatura", "unit": "°C"},
            {"key": "a_sensor", "label": "Combustible", "unit": "l"},
            {"key": "m_sensor", "label": "Presión", "unit": "bar"},
        ]
    ]
    db = _db_with_schemas(schemas)
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/sensors/catalog")
    assert resp.status_code == 200
    labels = [s["label"] for s in resp.json()]
    assert labels == sorted(labels, key=str.lower)


def test_catalog_shape():
    """Cada entrada tiene key, label y unit (puede ser null)."""
    schemas = [[{"key": "avl_30", "label": "RPM", "unit": "rpm"}]]
    db = _db_with_schemas(schemas)
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/sensors/catalog")
    assert resp.status_code == 200
    item = resp.json()[0]
    assert "key" in item
    assert "label" in item
    assert "unit" in item


def test_catalog_empty_when_no_types():
    """Sin tipos de vehículo devuelve lista vacía."""
    db = _db_with_schemas([])
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/sensors/catalog")
    assert resp.status_code == 200
    assert resp.json() == []


def test_catalog_403_client():
    """Cliente no CMG → 403."""
    db = AsyncMock()
    _override_user(CLIENT_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/sensors/catalog")
    assert resp.status_code == 403
