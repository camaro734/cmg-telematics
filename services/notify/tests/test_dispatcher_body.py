from unittest.mock import patch
import pytest
from src.dispatcher import _send_email


@pytest.mark.asyncio
async def test_send_email_usa_body_personalizado_cuando_existe():
    action = {
        "type": "email",
        "recipients": ["user@example.com"],
        "subject": "Asunto propio",
        "body": "Cuerpo libre con enlace https://cmgtrack.com/reset-password/TOK",
    }
    cfg = {"host": "smtp.test", "port": 587, "user": "", "password": "", "from_addr": "no-reply@cmg.es", "tls": True}
    captured = {}

    def _fake_send(msg, _cfg):
        captured["subject"] = msg["Subject"]
        captured["body"] = msg.get_content()

    with patch("src.dispatcher._load_smtp_from_db", return_value=cfg), \
         patch("src.dispatcher._smtp_send", _fake_send):
        await _send_email(action, {}, db_pool=object())

    assert captured["subject"] == "Asunto propio"
    assert "reset-password/TOK" in captured["body"]
