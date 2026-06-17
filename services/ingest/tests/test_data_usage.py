"""Tests para src/data_usage.py — captura de bytes para consumo SIM."""
from unittest.mock import AsyncMock

import pytest

from src.data_usage import record_device_data_usage


@pytest.mark.asyncio
async def test_record_device_data_usage_executes_upsert():
    conn = AsyncMock()
    await record_device_data_usage(conn, "123456789012345", 512)

    conn.execute.assert_awaited_once()
    args = conn.execute.await_args.args
    sql = args[0]
    assert "device_data_usage" in sql
    assert "ON CONFLICT" in sql
    assert args[1] == "123456789012345"
    assert args[2] == 512


@pytest.mark.asyncio
async def test_record_device_data_usage_ignores_zero_or_negative():
    conn = AsyncMock()
    await record_device_data_usage(conn, "123456789012345", 0)
    conn.execute.assert_not_awaited()
