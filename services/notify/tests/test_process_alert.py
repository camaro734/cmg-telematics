"""Tests de _process_alert: tolerancia a mensajes genéricos sin vehículo/tenant.

Un correo de recuperación de contraseña se encola en el stream alerts.fire con
vehicle_id y tenant_id vacíos. El consumer no debe intentar castear '' a UUID
(asyncpg lanza DataError), sino saltar esas consultas y despachar el correo.
"""
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.main import _process_alert


def _mock_pool(conn):
    pool = MagicMock()
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=conn)
    cm.__aexit__ = AsyncMock(return_value=False)
    pool.acquire = MagicMock(return_value=cm)
    return pool


@pytest.mark.asyncio
async def test_process_alert_no_consulta_con_uuid_vacio_y_despacha_email():
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(return_value=None)
    pool = _mock_pool(conn)
    redis = AsyncMock()
    fields = {
        "alert_id": "x",
        "rule_id": "",
        "vehicle_id": "",
        "tenant_id": "",
        "severity": "info",
        "trigger_value": "{}",
        "actions": json.dumps([
            {"type": "email", "recipients": ["a@b.com"], "subject": "S", "body": "cuerpo"}
        ]),
        "escalation": "[]",
    }
    with patch("src.main.dispatch_action", new=AsyncMock()) as disp:
        await _process_alert(pool, redis, fields)

    # Ningún fetchrow debe recibir un id vacío (asyncpg rechazaría '' como UUID)
    for call in conn.fetchrow.call_args_list:
        assert call.args[1] != "", f"fetchrow llamado con id vacío: {call}"

    # El correo SÍ se despacha pese a no haber vehículo/tenant
    disp.assert_awaited_once()
    action_arg = disp.await_args.args[0]
    assert action_arg["type"] == "email"
    assert action_arg["body"] == "cuerpo"
