# tests/api/test_ws_api.py
# WS tests use starlette TestClient (sync) — no async fixtures.
# Env vars already set by tests/api/conftest.py (processed first by pytest).
import uuid
from starlette.testclient import TestClient


def _make_valid_token() -> str:
    """Creates a valid JWT without hitting the DB."""
    import os
    os.environ.setdefault("DB_URL", "postgresql+asyncpg://cmg:changeme_db@127.0.0.1:5432/cmg_telematics")
    os.environ.setdefault("DB_URL_SYNC", "postgresql://cmg:changeme_db@127.0.0.1:5432/cmg_telematics")
    os.environ.setdefault("REDIS_URL", "redis://:changeme_redis@127.0.0.1:6379/0")
    os.environ.setdefault("SECRET_KEY", "changeme_secret_key_64_chars_minimum_replace_in_production")
    from app.core.security import create_access_token
    # create_access_token takes a single dict argument
    return create_access_token(data={
        "sub": str(uuid.uuid4()),
        "tenant_id": str(uuid.uuid4()),
        "tenant_tier": "cmg",
        "role": "admin",
        "email": "ws-test@cmg.es",
    })


def test_ws_rejects_missing_token():
    from app.main import app
    with TestClient(app) as tc:
        with tc.websocket_connect("/ws/fleet") as ws:
            data = ws.receive_json()
            assert data.get("error") == "unauthenticated"


def test_ws_rejects_invalid_token():
    from app.main import app
    with TestClient(app) as tc:
        with tc.websocket_connect("/ws/fleet?token=bad.token.here") as ws:
            data = ws.receive_json()
            assert data.get("error") == "invalid_token"


def test_ws_accepts_valid_token():
    from app.main import app
    token = _make_valid_token()
    with TestClient(app) as tc:
        with tc.websocket_connect(f"/ws/fleet?token={token}") as ws:
            data = ws.receive_json()
            assert data.get("type") == "connected"
