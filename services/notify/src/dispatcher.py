# services/notify/src/dispatcher.py
import asyncio
import logging
import smtplib
from email.message import EmailMessage
import httpx
from src.config import settings

logger = logging.getLogger(__name__)


async def dispatch_action(action: dict, context: dict) -> None:
    atype = action.get("type")
    if atype == "email":
        await _send_email(action, context)
    elif atype == "webhook":
        await _send_webhook(action, context)
    elif atype == "in_app":
        pass  # already persisted in alert_instance by rules-engine
    elif atype in ("push", "sms"):
        logger.info(
            "[stub] Would send %s to alert %s vehicle %s",
            atype, context.get("alert_id"), context.get("vehicle_id"),
        )
    else:
        logger.warning("Unknown action type: %s", atype)


async def _send_email(action: dict, context: dict) -> None:
    recipients = action.get("recipients", [])
    if not recipients:
        return
    if not settings.smtp_host:
        logger.info(
            "[stub] Email to %s — rule: %s vehicle: %s",
            recipients, context.get("rule_name"), context.get("vehicle_id"),
        )
        return

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = action.get(
        "subject", "Alerta: %s" % context.get("rule_name", "CMG Telematics")
    )
    msg.set_content(
        "Vehículo: %s\nSeveridad: %s\nValor disparado: %s\nRegla: %s" % (
            context.get("vehicle_id"),
            context.get("severity"),
            context.get("trigger_value"),
            context.get("rule_name"),
        )
    )
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _smtp_send, msg)


def _smtp_send(msg: EmailMessage) -> None:
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as s:
        if settings.smtp_user:
            s.starttls()
            s.login(settings.smtp_user, settings.smtp_password)
        s.send_message(msg)


async def _send_webhook(action: dict, context: dict) -> None:
    url = action.get("url", "")
    if not url:
        logger.warning("Webhook action has no URL")
        return
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.request(
                method=action.get("method", "POST").upper(),
                url=url,
                json=context,
            )
        logger.info("Webhook sent to %s for alert %s", url, context.get("alert_id"))
    except Exception as exc:
        logger.error("Webhook %s failed: %s", url, exc)
