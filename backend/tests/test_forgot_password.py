# backend/tests/test_forgot_password.py
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient
from app.main import app

GENERIC = "Si el correo está registrado, recibirás un enlace para restablecer la contraseña."


def _db_returning(user):
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=user)
    db.execute = AsyncMock(return_value=result)
    return db


def _override_db(session):
    from app.core.database import get_db
    async def _gen():
        yield session
    app.dependency_overrides[get_db] = _gen


def test_forgot_email_existente_encola_y_responde_generico():
    user = MagicMock(id="11111111-1111-1111-1111-111111111111", active=True)
    _override_db(_db_returning(user))
    app.state.redis = AsyncMock()
    app.state.redis.incr = AsyncMock(return_value=1)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/api/v1/auth/forgot-password", json={"email": "user@example.com"})
    assert resp.status_code == 200
    assert resp.json()["detail"] == GENERIC
    app.state.redis.set.assert_awaited_once()
    app.state.redis.xadd.assert_awaited_once()


def test_forgot_email_inexistente_mismo_mensaje_sin_encolar():
    _override_db(_db_returning(None))
    app.state.redis = AsyncMock()
    app.state.redis.incr = AsyncMock(return_value=1)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/api/v1/auth/forgot-password", json={"email": "nadie@example.com"})
    assert resp.status_code == 200
    assert resp.json()["detail"] == GENERIC
    app.state.redis.set.assert_not_awaited()
    app.state.redis.xadd.assert_not_awaited()
