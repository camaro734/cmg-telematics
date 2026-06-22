import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user, get_redis
from app.core.database import get_db
from app.schemas.auth import CurrentUser

CMG_TENANT_ID = uuid.UUID("10000000-0000-0000-0000-000000000000")
VEHICLE_ID = uuid.uuid4()
CMG_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CMG_TENANT_ID,
    tenant_tier="cmg", role="admin", email="cmg@test.com",
)


def _override(user, db, redis):
    app.dependency_overrides[get_current_user] = lambda: user
    async def _db_gen(): yield db
    app.dependency_overrides[get_db] = _db_gen
    app.dependency_overrides[get_redis] = lambda: redis


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def _vehicle():
    v = MagicMock()
    v.id = VEHICLE_ID
    v.tenant_id = CMG_TENANT_ID
    v.active = True
    return v


def test_post_destination_creates(monkeypatch):
    db = AsyncMock()
    # Simula que no existe destino previo: execute devuelve resultado con scalar_one_or_none=None
    no_existing = MagicMock()
    no_existing.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=no_existing)
    redis = AsyncMock()
    _override(CMG_USER, db, redis)

    async def _fake_access(*a, **k): return _vehicle()
    monkeypatch.setattr("app.api.v1.destinations.assert_can_access_vehicle", _fake_access)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post(f"/api/v1/vehicles/{VEHICLE_ID}/destination",
                       json={"lat": 39.47, "lon": -0.38, "label": "Valencia"})
    assert resp.status_code == 200
    assert resp.json()["label"] == "Valencia"
    db.add.assert_called_once()


def test_get_destination_includes_remaining(monkeypatch):
    db = AsyncMock()
    dest = MagicMock()
    dest.vehicle_id = VEHICLE_ID; dest.label = "Valencia"; dest.lat = 39.47; dest.lon = -0.38
    dest.status = "active"; dest.arrived_at = None
    dest.assigned_at = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
    result = MagicMock(); result.scalar_one_or_none.return_value = dest
    db.execute = AsyncMock(return_value=result)
    redis = AsyncMock()
    _override(CMG_USER, db, redis)

    async def _fake_access(*a, **k): return _vehicle()
    monkeypatch.setattr("app.api.v1.destinations.assert_can_access_vehicle", _fake_access)
    async def _fake_pos(*a, **k): return (40.0, -0.5)
    monkeypatch.setattr("app.api.v1.destinations._get_vehicle_latlon", _fake_pos)

    from app.services.routing import RouteResult
    async def _fake_route(*a, **k):
        return RouteResult(distance_m=8000, duration_s=420, geometry=[(40.0, -0.5), (39.47, -0.38)])
    monkeypatch.setattr("app.api.v1.destinations.valhalla_route", _fake_route)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicles/{VEHICLE_ID}/destination")
    assert resp.status_code == 200
    body = resp.json()
    assert body["remaining_distance_m"] == 8000
    assert body["remaining_duration_s"] == 420
    assert len(body["route"]["geometry"]) == 2


def test_get_destination_404_when_none(monkeypatch):
    db = AsyncMock()
    result = MagicMock(); result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=result)
    _override(CMG_USER, db, AsyncMock())
    async def _fake_access(*a, **k): return _vehicle()
    monkeypatch.setattr("app.api.v1.destinations.assert_can_access_vehicle", _fake_access)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicles/{VEHICLE_ID}/destination")
    assert resp.status_code == 404
