# tests/api/conftest.py
# Env vars must be set before any app import
import os
import sys

os.environ.setdefault(
    "DB_URL",
    "postgresql+asyncpg://cmg:changeme_db@127.0.0.1:5432/cmg_telematics",
)
os.environ.setdefault(
    "DB_URL_SYNC",
    "postgresql://cmg:changeme_db@127.0.0.1:5432/cmg_telematics",
)
os.environ.setdefault("REDIS_URL", "redis://:changeme_redis@127.0.0.1:6379/0")
os.environ.setdefault(
    "SECRET_KEY",
    "changeme_secret_key_64_chars_minimum_replace_in_production",
)

# Add backend to path so `from app.* import` works
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../backend"))

import pytest
import pytest_asyncio
from collections.abc import AsyncGenerator
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import NullPool


def _make_test_engine():
    """Create a NullPool engine so connections are never reused across event loops."""
    from app.core.config import settings
    return create_async_engine(settings.db_url, poolclass=NullPool)


@pytest.fixture(scope="session")
def test_engine():
    return _make_test_engine()


@pytest.fixture
def override_get_db(test_engine):
    """Per-test async session factory using the NullPool engine."""
    from app.core.database import get_db
    from app.main import app

    session_factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

    async def _get_db_override() -> AsyncGenerator[AsyncSession, None]:
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _get_db_override
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
async def client(override_get_db):
    from app.main import app  # lazy import — env vars already set above

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def admin_token(client):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@cmg.es", "password": "Admin2026!"},
    )
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return resp.json()["access_token"]
