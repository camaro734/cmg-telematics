"""
Tests para el guard de eventos no-telemetría en _process_one
y para _publish_alert_ws.

No requieren BD real ni Redis real — usan AsyncMock.
"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call

from src.main import _process_one, _publish_alert_ws, STREAM_KEY, CONSUMER_GROUP


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_redis(xadd_result=b"1-0") -> AsyncMock:
    redis = AsyncMock()
    redis.xadd = AsyncMock(return_value=xadd_result)
    redis.xack = AsyncMock(return_value=1)
    redis.exists = AsyncMock(return_value=0)
    return redis


def _fields_from(payload: dict) -> dict:
    return {"payload": json.dumps(payload)}


# ── Guard: eventos sin campo "time" ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_guard_xacks_event_without_time():
    """Un evento sin 'time' (p.ej. offline push) debe hacer XACK y salir."""
    redis = _make_redis()
    payload = {"vehicle_id": "v1", "tenant_id": "t1", "online": False}
    fields = _fields_from(payload)

    await _process_one(None, redis, "1-0", fields)

    redis.xack.assert_awaited_once_with(STREAM_KEY, CONSUMER_GROUP, "1-0")


@pytest.mark.asyncio
async def test_guard_does_not_process_rules_for_event_without_time():
    """Un evento sin 'time' no debe llegar a process_message."""
    redis = _make_redis()
    payload = {"_ws_type": "alert", "action": "fired", "tenant_id": "t1", "alert_id": "a1"}
    fields = _fields_from(payload)

    with patch("src.main.process_message") as mock_process:
        await _process_one(None, redis, "2-0", fields)
        mock_process.assert_not_called()


@pytest.mark.asyncio
async def test_guard_passes_for_event_with_time():
    """Un evento con 'time' debe pasar el guard y llegar a process_message."""
    redis = _make_redis()
    payload = {
        "time": "2026-06-11T10:00:00+00:00",
        "device_id": "d1",
        "vehicle_id": "v1",
        "tenant_id": "t1",
    }
    fields = _fields_from(payload)

    fake_match = MagicMock()
    fake_match.rule.tenant_id = "t1"

    with patch("src.main.process_message", new_callable=AsyncMock, return_value=[]) as mock_process, \
         patch("src.main.handle_field_operations", new_callable=AsyncMock):
        await _process_one(None, redis, "3-0", fields)
        mock_process.assert_awaited_once()


# ── _publish_alert_ws ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_publish_alert_ws_xadds_to_stream_key():
    """_publish_alert_ws debe publicar en STREAM_KEY."""
    redis = _make_redis()
    match = MagicMock()
    match.rule.tenant_id = "tenant-abc"

    await _publish_alert_ws(redis, "alert-123", match)

    redis.xadd.assert_awaited_once()
    stream_name = redis.xadd.call_args[0][0]
    assert stream_name == STREAM_KEY


@pytest.mark.asyncio
async def test_publish_alert_ws_payload_structure():
    """El payload publicado debe tener _ws_type, action, tenant_id y alert_id."""
    redis = _make_redis()
    match = MagicMock()
    match.rule.tenant_id = "tenant-xyz"

    await _publish_alert_ws(redis, "alert-999", match)

    raw_payload = redis.xadd.call_args[0][1]["payload"]
    data = json.loads(raw_payload)
    assert data["_ws_type"] == "alert"
    assert data["action"] == "fired"
    assert data["tenant_id"] == "tenant-xyz"
    assert data["alert_id"] == "alert-999"


@pytest.mark.asyncio
async def test_publish_alert_ws_sets_maxlen():
    """xadd debe llamarse con maxlen para evitar crecimiento ilimitado."""
    redis = _make_redis()
    match = MagicMock()
    match.rule.tenant_id = "t1"

    await _publish_alert_ws(redis, "a1", match)

    kwargs = redis.xadd.call_args[1]
    assert kwargs.get("maxlen", 0) > 0
    assert kwargs.get("approximate") is True
