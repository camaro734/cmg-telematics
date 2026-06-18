from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient
from app.main import app
from app.core.reset_token import reset_key_for


def _override_db(session):
    from app.core.database import get_db
    async def _gen():
        yield session
    app.dependency_overrides[get_db] = _gen


def _db_with_user(user):
    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    db.commit = AsyncMock()
    return db


def test_reset_token_invalido_devuelve_400():
    _override_db(_db_with_user(None))
    app.state.redis = AsyncMock()
    app.state.redis.incr = AsyncMock(return_value=1)
    app.state.redis.get = AsyncMock(return_value=None)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/api/v1/auth/reset-password", json={"token": "malo", "new_password": "nuevapass123"})
    assert resp.status_code == 400


def test_reset_token_valido_cambia_password_e_incrementa_pwd_version():
    user = MagicMock(id="22222222-2222-2222-2222-222222222222", hashed_password="old", pwd_version=3)
    _override_db(_db_with_user(user))
    app.state.redis = AsyncMock()
    app.state.redis.incr = AsyncMock(return_value=1)
    app.state.redis.get = AsyncMock(return_value=str(user.id))
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/api/v1/auth/reset-password", json={"token": "buen-token", "new_password": "nuevapass123"})
    assert resp.status_code == 200
    assert user.pwd_version == 4
    assert user.hashed_password != "old"
    # token de un solo uso: se borra
    app.state.redis.delete.assert_awaited_once_with(reset_key_for("buen-token"))


def test_reset_password_corta_devuelve_422():
    _override_db(_db_with_user(None))
    app.state.redis = AsyncMock()
    app.state.redis.incr = AsyncMock(return_value=1)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/api/v1/auth/reset-password", json={"token": "x", "new_password": "corta"})
    assert resp.status_code == 422
