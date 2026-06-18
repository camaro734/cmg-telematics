# backend/app/core/reset_mailer.py
"""Encola el correo de recuperación de contraseña en el stream de notify-svc.

Reutiliza el mismo stream (`alerts.fire`) y el mismo formato de action que
maintenance_notifier; la diferencia es que la action incluye `subject` y `body`
propios, de modo que notify-svc envía un correo con texto libre (ver
services/notify/src/dispatcher.py, Task 5).
"""
import json
import logging
import uuid

from redis.asyncio import Redis

from app.core.maintenance_notifier import STREAM_KEY

logger = logging.getLogger(__name__)

_RESET_BASE_URL = "https://cmgtrack.com"


async def enqueue_reset_email(redis: Redis, email: str, token: str) -> None:
    """Encola un correo con el enlace de recuperación para `email`."""
    link = f"{_RESET_BASE_URL}/reset-password/{token}"
    body = (
        "Hemos recibido una solicitud para restablecer tu contraseña en CMG Track.\n\n"
        f"Abre este enlace para crear una nueva contraseña (válido durante 1 hora):\n{link}\n\n"
        "Si no has solicitado este cambio, ignora este correo."
    )
    await redis.xadd(
        STREAM_KEY,
        {
            "alert_id": str(uuid.uuid4()),
            "rule_id": str(uuid.uuid4()),
            "vehicle_id": "",
            "tenant_id": "",
            "severity": "info",
            "trigger_value": json.dumps({"kind": "password_reset"}),
            "actions": json.dumps(
                [{
                    "type": "email",
                    "recipients": [email],
                    "subject": "Recuperación de contraseña — CMG Track",
                    "body": body,
                }]
            ),
            "escalation": json.dumps([]),
        },
        maxlen=10_000,
        approximate=True,
    )
    logger.info("Email de recuperación encolado para %s", email)
