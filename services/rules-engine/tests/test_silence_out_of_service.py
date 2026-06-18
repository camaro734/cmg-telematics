"""
Tests que verifican que sweep_silent_vehicles ignora dispositivos out_of_service.
No requieren BD real — usan AsyncMock para conn y redis (mismo patrón que test_silence_ws.py).
"""
import pytest
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime, timezone, timedelta

from src.silence import sweep_silent_vehicles


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.xadd   = AsyncMock(return_value=b"1-0")
    redis.exists = AsyncMock(return_value=0)
    redis.delete = AsyncMock()
    redis.set    = AsyncMock()
    redis.hget   = AsyncMock(return_value=None)
    return redis


def _make_db_pool(fetch_rows: list) -> MagicMock:
    """Devuelve un db_pool cuyo acquire() es un async context manager con conn mocked."""
    conn = AsyncMock()
    conn.fetch    = AsyncMock(return_value=fetch_rows)
    conn.fetchrow = AsyncMock(return_value=None)
    conn.execute  = AsyncMock()

    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=conn)
    cm.__aexit__  = AsyncMock(return_value=False)

    db_pool = MagicMock()
    db_pool.acquire = MagicMock(return_value=cm)
    return db_pool, conn


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sweep_sql_contains_out_of_service_filter():
    """
    El SELECT emitido a conn.fetch debe contener el filtro out_of_service = false
    para que dispositivos fuera de servicio queden excluidos del barrido.
    """
    db_pool, conn = _make_db_pool(fetch_rows=[])
    redis = _make_redis()

    await sweep_silent_vehicles(db_pool, redis)

    conn.fetch.assert_awaited_once()
    sql_called: str = conn.fetch.call_args[0][0]
    # Normalizar espacios en blanco para comparación robusta
    sql_normalized = " ".join(sql_called.split())
    assert "out_of_service = false" in sql_normalized, (
        f"El SQL del sweep no contiene 'out_of_service = false'.\nSQL: {sql_normalized}"
    )


@pytest.mark.asyncio
async def test_sweep_skips_out_of_service_device():
    """
    Si el mock devuelve un dispositivo con last_seen muy antiguo (>threshold),
    pero el filtro SQL con out_of_service=false está activo, conn.fetch devuelve
    lista vacía (el dispositivo ya fue filtrado en BD). Se verifica que no se
    crea ninguna alert_instance (conn.execute no se llama con INSERT).
    """
    # Simulamos que la BD ya filtró el device out_of_service: fetch devuelve vacío
    db_pool, conn = _make_db_pool(fetch_rows=[])
    redis = _make_redis()

    await sweep_silent_vehicles(db_pool, redis)

    # No debe haberse intentado crear ninguna alerta
    conn.execute.assert_not_awaited()
    redis.xadd.assert_not_awaited()
