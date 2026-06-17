"""Tests del timeout de inactividad del receive loop.

Una conexión TCP que deja de enviar datos (socket medio-abierto por pérdida de
señal/corriente) debe cerrarse al agotar el idle_timeout, para que corra el
cleanup de handle() que marca el dispositivo offline. Sin esto, el loop se
bloquea para siempre en readexactly() y el flag `online` queda pegado en true.
"""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.fixture()
def handler():
    from src.server import TeltonikaConnection
    reader = MagicMock()
    writer = MagicMock()
    writer.get_extra_info.return_value = ("10.0.0.1", 5027)
    db_pool = MagicMock()
    redis = AsyncMock()
    h = TeltonikaConnection(reader, writer, db_pool, redis)
    h.imei = "864275075510100"
    h.device_info = {"device_id": "d", "vehicle_id": "v", "tenant_id": "t"}
    return h


@pytest.mark.asyncio
async def test_receive_loop_returns_on_idle(handler, monkeypatch):
    """Sin un solo byte dentro del idle_timeout, _receive_loop retorna limpio."""
    from src import server

    monkeypatch.setattr(server.settings, "idle_timeout_s", 0.05)

    async def _never(_n):
        await asyncio.sleep(3600)

    handler.reader.readexactly = _never

    # No debe colgarse: con timeout pequeño retorna en <1 s (sin levantar excepción).
    await asyncio.wait_for(handler._receive_loop(), timeout=1.0)


@pytest.mark.asyncio
async def test_receive_loop_does_not_timeout_with_traffic(handler, monkeypatch):
    """Si llegan bytes dentro de la ventana, el timeout no se dispara: el cierre
    llega por IncompleteReadError normal (conexión cerrada por el dispositivo)."""
    from src import server

    monkeypatch.setattr(server.settings, "idle_timeout_s", 0.5)

    # Primer readexactly devuelve un header válido enseguida; el siguiente simula
    # cierre del dispositivo. El timeout (0.5 s) no debe entrar en juego.
    calls = {"n": 0}

    async def _reader(_n):
        calls["n"] += 1
        if calls["n"] == 1:
            return b"\x00\x00\x00\x00\x00\x00\x00\x00"  # data_length = 0
        raise asyncio.IncompleteReadError(partial=b"", expected=4)

    handler.reader.readexactly = _reader

    with pytest.raises(asyncio.IncompleteReadError):
        await asyncio.wait_for(handler._receive_loop(), timeout=1.0)
