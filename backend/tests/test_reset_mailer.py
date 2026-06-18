# backend/tests/test_reset_mailer.py
import json
from unittest.mock import AsyncMock
import pytest
from app.core.reset_mailer import enqueue_reset_email


@pytest.mark.asyncio
async def test_enqueue_reset_email_encola_action_email_con_body_y_enlace():
    redis = AsyncMock()
    await enqueue_reset_email(redis, "user@example.com", "TOK123")

    redis.xadd.assert_awaited_once()
    args, kwargs = redis.xadd.call_args
    stream_key, fields = args[0], args[1]
    assert stream_key == "alerts.fire"

    actions = json.loads(fields["actions"])
    assert len(actions) == 1
    action = actions[0]
    assert action["type"] == "email"
    assert action["recipients"] == ["user@example.com"]
    assert "Recuperación de contraseña" in action["subject"]
    # El body contiene el enlace con el token en claro
    assert "https://cmgtrack.com/reset-password/TOK123" in action["body"]
