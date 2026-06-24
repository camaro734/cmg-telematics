import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser

USER = CurrentUser(user_id=uuid.uuid4(), tenant_id=uuid.uuid4(),
                   tenant_tier="cmg", role="admin", email="a@b.com")


@pytest.fixture(autouse=True)
def clear_overrides():
    app.dependency_overrides[get_current_user] = lambda: USER
    yield
    app.dependency_overrides.clear()


def test_geocode(monkeypatch):
    from app.services.geocoding import GeoResult
    async def _fake(q, limit=5): return [GeoResult(label="Valencia", lat=39.47, lon=-0.38)]
    monkeypatch.setattr("app.api.v1.destinations.nominatim_search", _fake)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/geocode?q=valencia")
    assert resp.status_code == 200
    assert resp.json()[0]["label"] == "Valencia"


def test_route(monkeypatch):
    from app.services.routing import RouteResult
    async def _fake(o, d): return RouteResult(distance_m=8000, duration_s=420, geometry=[(0, 0), (1, 1)])
    monkeypatch.setattr("app.api.v1.destinations.valhalla_route", _fake)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/route?from_lat=40&from_lon=-0.5&to_lat=39.47&to_lon=-0.38")
    assert resp.status_code == 200
    assert resp.json()["distance_m"] == 8000


def test_route_lat_out_of_range():
    """Latitud fuera del rango válido [-90, 90] debe devolver 422."""
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/route?from_lat=200&from_lon=-0.5&to_lat=39.47&to_lon=-0.38")
    assert resp.status_code == 422


def test_geocode_unauthenticated():
    """Sin autenticación, /geocode debe devolver 403."""
    app.dependency_overrides = {}
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/geocode?q=valencia")
    assert resp.status_code == 403


def test_route_unauthenticated():
    """Sin autenticación, /route debe devolver 403."""
    app.dependency_overrides = {}
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/route?from_lat=40&from_lon=-0.5&to_lat=39.47&to_lon=-0.38")
    assert resp.status_code == 403
