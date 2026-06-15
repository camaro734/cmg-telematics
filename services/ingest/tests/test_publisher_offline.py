"""Tests para set_vehicle_offline: verifica hset + xadd al stream."""
import json
import pytest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, call

VEHICLE_ID = "aaaa0000-0000-0000-0000-000000000001"
TENANT_ID  = "bbbb0000-0000-0000-0000-000000000002"


def _fake_avl(ts: datetime):
    return SimpleNamespace(
        datetime_utc=ts, io_elements={}, latitude=None, longitude=None,
        speed_kmh=0.0, heading=None,
    )


@pytest.fixture()
def redis_mock():
    r = AsyncMock()
    r.hset = AsyncMock()
    r.expire = AsyncMock()
    r.xadd = AsyncMock()
    return r


@pytest.mark.asyncio
async def test_offline_updates_hash(redis_mock):
    from src.publisher import set_vehicle_offline
    await set_vehicle_offline(redis_mock, VEHICLE_ID, TENANT_ID)

    redis_mock.hset.assert_awaited_once()
    key, kwargs = redis_mock.hset.call_args.args[0], redis_mock.hset.call_args.kwargs
    assert key == f"vehicle:{VEHICLE_ID}:status"
    mapping = kwargs["mapping"]
    assert mapping["online"] == "false"
    assert "received_at" in mapping


@pytest.mark.asyncio
async def test_offline_xadds_to_stream(redis_mock):
    from src.publisher import set_vehicle_offline, STREAM_KEY
    await set_vehicle_offline(redis_mock, VEHICLE_ID, TENANT_ID)

    redis_mock.xadd.assert_awaited_once()
    stream, fields = redis_mock.xadd.call_args.args
    assert stream == STREAM_KEY
    payload = json.loads(fields["payload"])
    assert payload["vehicle_id"] == VEHICLE_ID
    assert payload["tenant_id"] == TENANT_ID
    assert payload["online"] is False
    assert "received_at" in payload


@pytest.mark.asyncio
async def test_status_guard_skips_older_record(redis_mock):
    """Un registro más antiguo que el last_seen guardado NO debe pisar el hash."""
    from src.publisher import _update_status_hash
    redis_mock.hget = AsyncMock(return_value="2026-06-15T11:00:00+00:00")
    avl = _fake_avl(datetime(2026, 6, 15, 10, 15, tzinfo=timezone.utc))  # más antiguo
    await _update_status_hash(redis_mock, avl, VEHICLE_ID, {}, "2026-06-15T11:05:00+00:00")
    redis_mock.hset.assert_not_awaited()


@pytest.mark.asyncio
async def test_status_guard_allows_newer_record(redis_mock):
    """Un registro más reciente que el last_seen guardado SÍ actualiza el hash."""
    from src.publisher import _update_status_hash
    redis_mock.hget = AsyncMock(return_value="2026-06-15T10:00:00+00:00")
    avl = _fake_avl(datetime(2026, 6, 15, 11, 0, tzinfo=timezone.utc))  # más reciente
    await _update_status_hash(redis_mock, avl, VEHICLE_ID, {}, "2026-06-15T11:00:05+00:00")
    redis_mock.hset.assert_awaited_once()


@pytest.mark.asyncio
async def test_offline_hash_and_stream_share_received_at(redis_mock):
    """received_at del hash y del evento deben ser iguales (misma llamada)."""
    from src.publisher import set_vehicle_offline
    await set_vehicle_offline(redis_mock, VEHICLE_ID, TENANT_ID)

    hash_received_at = redis_mock.hset.call_args.kwargs["mapping"]["received_at"]
    stream_payload   = json.loads(redis_mock.xadd.call_args.args[1]["payload"])
    assert hash_received_at == stream_payload["received_at"]
