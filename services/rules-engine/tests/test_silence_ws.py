"""
Tests para el push de WS al crear/resolver alertas de silencio.
No requieren BD real — usan AsyncMock para conn y redis.
"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.silence import sweep_silent_vehicles, maybe_resolve_silence, _publish_alert_ws


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_redis(silence_key_exists: bool = False) -> AsyncMock:
    redis = AsyncMock()
    redis.xadd  = AsyncMock(return_value=b"1-0")
    redis.exists = AsyncMock(return_value=1 if silence_key_exists else 0)
    redis.delete = AsyncMock()
    redis.set    = AsyncMock()
    redis.hget   = AsyncMock(return_value=None)
    return redis


# ── _publish_alert_ws ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_publish_alert_ws_structure():
    """_publish_alert_ws publica payload con todos los campos requeridos."""
    redis = _make_redis()

    await _publish_alert_ws(redis, "silence", "alert-1", "tenant-t", "vehicle-v")

    redis.xadd.assert_awaited_once()
    raw = redis.xadd.call_args[0][1]["payload"]
    data = json.loads(raw)
    assert data["_ws_type"]   == "alert"
    assert data["action"]     == "silence"
    assert data["alert_id"]   == "alert-1"
    assert data["tenant_id"]  == "tenant-t"
    assert data["vehicle_id"] == "vehicle-v"


@pytest.mark.asyncio
async def test_publish_alert_ws_resolved():
    redis = _make_redis()

    await _publish_alert_ws(redis, "resolved", "alert-2", "tenant-t", "vehicle-v")

    raw = redis.xadd.call_args[0][1]["payload"]
    data = json.loads(raw)
    assert data["action"] == "resolved"


# ── maybe_resolve_silence ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_resolve_publishes_ws_event():
    """Cuando hay una alerta firing, la resolución publica action:'resolved'."""
    redis = _make_redis(silence_key_exists=True)

    conn = AsyncMock()
    # Devuelve regla de silencio
    conn.fetchrow = AsyncMock(return_value={"id": "rule-123"})
    # RETURNING id de la alert_instance resuelta
    conn.fetch = AsyncMock(return_value=[{"id": "alert-resolved-1"}])

    await maybe_resolve_silence(conn, redis, "v1", "tenant-a")

    redis.xadd.assert_awaited_once()
    raw = redis.xadd.call_args[0][1]["payload"]
    data = json.loads(raw)
    assert data["action"]     == "resolved"
    assert data["alert_id"]   == "alert-resolved-1"
    assert data["tenant_id"]  == "tenant-a"
    assert data["vehicle_id"] == "v1"


@pytest.mark.asyncio
async def test_resolve_no_ws_event_when_no_silence_key():
    """Si no hay Redis key de silencio activo, no se publica nada."""
    redis = _make_redis(silence_key_exists=False)
    conn = AsyncMock()

    await maybe_resolve_silence(conn, redis, "v1", "tenant-a")

    redis.xadd.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolve_no_ws_event_when_no_firing_alert():
    """Si no hay alert_instance firing (RETURNING vacío), no se publica."""
    redis = _make_redis(silence_key_exists=True)
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(return_value={"id": "rule-123"})
    conn.fetch    = AsyncMock(return_value=[])  # ninguna fila resuelta

    await maybe_resolve_silence(conn, redis, "v1", "tenant-a")

    redis.xadd.assert_not_awaited()


# ── sweep_silent_vehicles — publicación al crear ──────────────────────────────

@pytest.mark.asyncio
async def test_sweep_publishes_silence_event_on_new_alert():
    """El sweep publica action:'silence' cuando crea una nueva alerta."""
    from datetime import datetime, timezone, timedelta

    redis = _make_redis()
    redis.hget = AsyncMock(return_value=None)  # ignición OFF

    # Un vehículo mudo desde hace 100 horas (supera umbral parked=72h)
    old_time = datetime.now(timezone.utc) - timedelta(hours=100)
    fake_row = {"vehicle_id": "v-mudo", "tenant_id": "t-1", "last_seen": old_time}

    conn = AsyncMock()
    conn.fetch    = AsyncMock(return_value=[fake_row])
    conn.fetchrow = AsyncMock(return_value=None)   # no hay alerta existente
    conn.execute  = AsyncMock()

    db_pool = AsyncMock()
    db_pool.acquire = MagicMock(return_value=AsyncMock(
        __aenter__=AsyncMock(return_value=conn),
        __aexit__=AsyncMock(return_value=False),
    ))

    with patch("src.silence._ensure_silence_rule", new_callable=AsyncMock, return_value="rule-x"):
        await sweep_silent_vehicles(db_pool, redis)

    # Debe haber al menos una llamada a xadd (el evento WS)
    xadd_calls = redis.xadd.call_args_list
    assert len(xadd_calls) >= 1
    ws_calls = [c for c in xadd_calls if json.loads(c[0][1]["payload"]).get("_ws_type") == "alert"]
    assert len(ws_calls) == 1
    data = json.loads(ws_calls[0][0][1]["payload"])
    assert data["action"]    == "silence"
    assert data["tenant_id"] == "t-1"
    assert data["vehicle_id"] == "v-mudo"
