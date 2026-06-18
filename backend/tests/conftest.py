"""
Configuración global de pytest.
Parchea el lifespan de FastAPI para evitar conexiones reales a Redis/DB durante tests.
"""
import os
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Variables de entorno mínimas requeridas por Pydantic Settings antes de importar la app.
# Usan valores ficticios: los tests mockean DB y Redis, nunca abren conexiones reales.
_TEST_ENV = {
    "DB_URL": "postgresql+asyncpg://test:test@localhost/test",
    "DB_URL_SYNC": "postgresql+psycopg2://test:test@localhost/test",
    "REDIS_URL": "redis://localhost:6379/15",
    "SECRET_KEY": "0000000000000000000000000000000000000000000000000000000000000000",
}
for _k, _v in _TEST_ENV.items():
    os.environ.setdefault(_k, _v)


@asynccontextmanager
async def _mock_lifespan(app):
    # Simula el estado que el lifespan real establece
    app.state.redis = AsyncMock()
    app.state.ws_manager = MagicMock()
    yield


@pytest.fixture(scope="session", autouse=True)
def patch_lifespan():
    with patch("app.main.lifespan", _mock_lifespan):
        yield
