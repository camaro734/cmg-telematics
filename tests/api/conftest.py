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
from httpx import AsyncClient, ASGITransport


@pytest.fixture
async def client():
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
