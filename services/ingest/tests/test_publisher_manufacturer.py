"""
Tests: publish_record y set_vehicle_offline incluyen manufacturer_tenant_id en el payload.
"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock

from src.publisher import publish_record, set_vehicle_offline


def _make_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.xadd = AsyncMock(return_value=b"1-0")
    redis.hset = AsyncMock()
    redis.expire = AsyncMock()
    return redis


def _make_avl(dt_utc=None) -> MagicMock:
    from datetime import datetime, timezone
    avl = MagicMock()
    avl.datetime_utc = dt_utc or datetime(2026, 6, 11, 17, 0, 0, tzinfo=timezone.utc)
    avl.latitude = 39.4
    avl.longitude = -0.4
    avl.speed_kmh = 0.0
    avl.heading = 180
    avl.altitude_m = 10
    avl.io_elements = {}
    return avl


@pytest.mark.asyncio
async def test_publish_record_includes_manufacturer_when_provided():
    redis = _make_redis()
    avl = _make_avl()

    await publish_record(redis, avl, "d1", "v1", "tenant-a", manufacturer_tenant_id="mfr-x")

    raw = redis.xadd.call_args[0][1]["payload"]
    data = json.loads(raw)
    assert data["manufacturer_tenant_id"] == "mfr-x"
    assert data["tenant_id"] == "tenant-a"


@pytest.mark.asyncio
async def test_publish_record_manufacturer_none_when_not_provided():
    redis = _make_redis()
    avl = _make_avl()

    await publish_record(redis, avl, "d1", "v1", "tenant-a")

    raw = redis.xadd.call_args[0][1]["payload"]
    data = json.loads(raw)
    assert data["manufacturer_tenant_id"] is None


@pytest.mark.asyncio
async def test_set_vehicle_offline_includes_manufacturer():
    redis = _make_redis()

    await set_vehicle_offline(redis, "v1", "tenant-a", manufacturer_tenant_id="mfr-x")

    raw = redis.xadd.call_args[0][1]["payload"]
    data = json.loads(raw)
    assert data["manufacturer_tenant_id"] == "mfr-x"
    assert data["online"] is False


@pytest.mark.asyncio
async def test_set_vehicle_offline_manufacturer_none_by_default():
    redis = _make_redis()

    await set_vehicle_offline(redis, "v1", "tenant-a")

    raw = redis.xadd.call_args[0][1]["payload"]
    data = json.loads(raw)
    assert data["manufacturer_tenant_id"] is None
