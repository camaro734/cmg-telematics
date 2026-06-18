"""Tests para update_device_online: verifica SQL generado para reconexión y desconexión."""
import pytest
from unittest.mock import AsyncMock

TEST_IMEI = "123456789012345"


@pytest.fixture()
def db_conn():
    conn = AsyncMock()
    conn.execute = AsyncMock()
    return conn


@pytest.mark.asyncio
async def test_reconnect_clears_out_of_service(db_conn):
    """online=True debe incluir out_of_service=false y out_of_service_since=NULL."""
    from src.writer import update_device_online

    await update_device_online(db_conn, TEST_IMEI, True)

    db_conn.execute.assert_awaited_once()
    sql = db_conn.execute.call_args.args[0]
    assert "out_of_service=false" in sql.lower()
    assert "out_of_service_since=null" in sql.lower()


@pytest.mark.asyncio
async def test_disconnect_does_not_touch_out_of_service(db_conn):
    """online=False (desconexión) NO debe tocar out_of_service."""
    from src.writer import update_device_online

    await update_device_online(db_conn, TEST_IMEI, False)

    db_conn.execute.assert_awaited_once()
    sql = db_conn.execute.call_args.args[0]
    assert "out_of_service" not in sql.lower()
