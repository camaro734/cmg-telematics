"""TDD — _restore_manual_can_state: reproduce pendientes Manual CAN al reconectar."""
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.server import TeltonikaConnection

VEHICLE_ID = "ce400000-0000-0000-0000-000000000001"
IMEI = "862272089079729"


def _make_conn(pending: dict):
    reader = MagicMock()
    writer = MagicMock()
    writer.write = MagicMock()
    writer.drain = AsyncMock()
    redis = AsyncMock()
    redis.hgetall.return_value = pending
    conn = TeltonikaConnection(reader, writer, db_pool=MagicMock(), redis=redis)
    conn.imei = IMEI
    conn.device_info = {"vehicle_id": VEHICLE_ID}
    return conn, writer, redis


@pytest.mark.asyncio
async def test_restore_set_writes_and_confirms():
    pending = {"31412": json.dumps({
        "type": "set", "commands": ["setparam 31412:0100000000000000"],
        "log_id": "log-1", "slot": 0, "value_hex": "0100000000000000"})}
    conn, writer, redis = _make_conn(pending)

    with patch("src.server._confirm_command", new_callable=AsyncMock) as mock_confirm, \
         patch("src.server.build_codec12_command", return_value=b"PKT") as mock_build:
        await conn._restore_manual_can_state()

    mock_build.assert_called_once_with("setparam 31412:0100000000000000")
    writer.write.assert_called_once_with(b"PKT")
    mock_confirm.assert_awaited_once_with("log-1", "OK (entrega diferida)")
    redis.hset.assert_awaited()  # actualiza vehicle:{id}:can_outputs
    redis.delete.assert_awaited_with(f"vehicle:{VEHICLE_ID}:manual_can_pending")


@pytest.mark.asyncio
async def test_restore_pulse_writes_two_packets():
    pending = {"31412": json.dumps({
        "type": "pulse",
        "commands": ["setparam 31412:0400000000000000", "setparam 31412:0000000000000000"],
        "log_id": "log-2", "slot": 0, "value_hex": "0000000000000000"})}
    conn, writer, redis = _make_conn(pending)

    with patch("src.server._confirm_command", new_callable=AsyncMock), \
         patch("src.server.build_codec12_command", return_value=b"PKT"):
        await conn._restore_manual_can_state()

    assert writer.write.call_count == 2  # ON y OFF


@pytest.mark.asyncio
async def test_restore_empty_is_noop():
    conn, writer, redis = _make_conn({})
    await conn._restore_manual_can_state()
    writer.write.assert_not_called()
    redis.delete.assert_not_awaited()
