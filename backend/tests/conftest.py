"""
Configuración global de pytest.
Parchea el lifespan de FastAPI para evitar conexiones reales a Redis/DB durante tests.
"""
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


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
