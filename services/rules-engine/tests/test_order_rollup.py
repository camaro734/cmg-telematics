"""Tests unitarios para maybe_rollup_order."""
import pytest
from unittest.mock import AsyncMock

from src.order_rollup import maybe_rollup_order


def _make_conn(row, fetchval_return=None):
    conn = AsyncMock()
    conn.fetchrow.return_value = row
    conn.fetchval.return_value = fetchval_return
    return conn


@pytest.mark.asyncio
async def test_rollup_all_done_asigna_doc_number():
    conn = _make_conn(
        {"id": "aaa", "status": "in_progress", "tenant_id": "ttt",
         "doc_number": None, "total": 2, "closed": 2},
        fetchval_return=7,
    )
    await maybe_rollup_order(conn, "aaa")
    conn.fetchval.assert_called_once()        # asignó número
    conn.execute.assert_called_once()         # actualizó work_order
    sql, work_order_id, _ts, doc = conn.execute.call_args[0]
    assert "PT-" in doc
    assert "00007" in doc


@pytest.mark.asyncio
async def test_rollup_paradas_parciales_no_hace_nada():
    conn = _make_conn(
        {"id": "aaa", "status": "in_progress", "tenant_id": "ttt",
         "doc_number": None, "total": 3, "closed": 2},
    )
    await maybe_rollup_order(conn, "aaa")
    conn.fetchval.assert_not_called()
    conn.execute.assert_not_called()


@pytest.mark.asyncio
async def test_rollup_orden_ya_done_no_hace_nada():
    conn = _make_conn(
        {"id": "aaa", "status": "done", "tenant_id": "ttt",
         "doc_number": "PT-2026-00001", "total": 2, "closed": 2},
    )
    await maybe_rollup_order(conn, "aaa")
    conn.fetchval.assert_not_called()
    conn.execute.assert_not_called()


@pytest.mark.asyncio
async def test_rollup_con_skipped_cuenta_como_cerrada():
    conn = _make_conn(
        {"id": "bbb", "status": "in_progress", "tenant_id": "ttt",
         "doc_number": None, "total": 3, "closed": 3},
        fetchval_return=1,
    )
    await maybe_rollup_order(conn, "bbb")
    conn.execute.assert_called_once()


@pytest.mark.asyncio
async def test_rollup_idempotente_doc_number_existente():
    conn = _make_conn(
        {"id": "ccc", "status": "in_progress", "tenant_id": "ttt",
         "doc_number": "PT-2025-00005", "total": 1, "closed": 1},
    )
    await maybe_rollup_order(conn, "ccc")
    conn.fetchval.assert_not_called()         # no asigna nuevo número
    conn.execute.assert_called_once()         # pero sí cierra la orden


@pytest.mark.asyncio
async def test_rollup_sin_paradas_no_hace_nada():
    conn = _make_conn(
        {"id": "ddd", "status": "in_progress", "tenant_id": "ttt",
         "doc_number": None, "total": 0, "closed": 0},
    )
    await maybe_rollup_order(conn, "ddd")
    conn.execute.assert_not_called()
