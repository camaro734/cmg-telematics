import asyncio
import logging
import smtplib
import time
from email.message import EmailMessage
import httpx
import asyncpg
from src.config import settings

logger = logging.getLogger(__name__)

_smtp_cache: dict | None = None
_smtp_cache_ts: float = 0.0
_SMTP_TTL = 300  # 5 minutos


async def _load_smtp_from_db(db_pool: asyncpg.Pool) -> dict:
    global _smtp_cache, _smtp_cache_ts
    now = time.monotonic()
    if _smtp_cache is not None and (now - _smtp_cache_ts) < _SMTP_TTL:
        return _smtp_cache
    try:
        row = await db_pool.fetchrow(
            "SELECT value FROM system_settings WHERE key = 'smtp'"
        )
        if row and row["value"].get("host"):
            _smtp_cache = row["value"]
            _smtp_cache_ts = now
            logger.debug("SMTP config loaded from DB: host=%s", _smtp_cache.get("host"))
            return _smtp_cache
    except Exception as exc:
        logger.warning("Could not load SMTP from DB (%s) — using env fallback", exc)

    _smtp_cache = {
        "host": settings.smtp_host,
        "port": settings.smtp_port,
        "user": settings.smtp_user,
        "password": settings.smtp_password,
        "from_addr": settings.smtp_from,
        "tls": True,
    }
    _smtp_cache_ts = now
    return _smtp_cache


async def dispatch_action(action: dict, context: dict, db_pool: asyncpg.Pool | None = None) -> None:
    atype = action.get("type")
    if atype == "email":
        await _send_email(action, context, db_pool)
    elif atype == "webhook":
        await _send_webhook(action, context)
    elif atype == "in_app":
        pass
    elif atype in ("push", "sms"):
        logger.info(
            "[stub] Would send %s to alert %s vehicle %s",
            atype, context.get("alert_id"), context.get("vehicle_id"),
        )
    else:
        logger.warning("Unknown action type: %s", atype)


async def _send_email(action: dict, context: dict, db_pool: asyncpg.Pool | None = None) -> None:
    recipients = action.get("recipients") or action.get("to", [])
    if isinstance(recipients, str):
        recipients = [recipients]
    if not recipients:
        return

    cfg = await _load_smtp_from_db(db_pool) if db_pool else {
        "host": settings.smtp_host,
        "port": settings.smtp_port,
        "user": settings.smtp_user,
        "password": settings.smtp_password,
        "from_addr": settings.smtp_from,
        "tls": True,
    }

    smtp_host = cfg.get("host", "")
    if not smtp_host:
        logger.info(
            "[stub] Email to %s — rule: %s vehicle: %s",
            recipients, context.get("rule_name"), context.get("vehicle_name", context.get("vehicle_id")),
        )
        return

    msg = EmailMessage()
    msg["From"] = cfg.get("from_addr", settings.smtp_from)
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = action.get(
        "subject", "[ALERTA] %s — %s" % (
            context.get("rule_name", "CMG Telematics"),
            context.get("vehicle_name", ""),
        )
    )
    msg.set_content(
        "Vehículo: %s\nSeveridad: %s\nValor disparado: %s\nRegla: %s" % (
            context.get("vehicle_name", context.get("vehicle_id")),
            context.get("severity"),
            context.get("trigger_value"),
            context.get("rule_name"),
        )
    )
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _smtp_send, msg, cfg)


def _smtp_send(msg: EmailMessage, cfg: dict) -> None:
    host = cfg.get("host", settings.smtp_host)
    port = cfg.get("port", settings.smtp_port)
    user = cfg.get("user", settings.smtp_user)
    password = cfg.get("password", settings.smtp_password)
    tls = cfg.get("tls", True)
    with smtplib.SMTP(host, port, timeout=30) as s:
        if tls or user:
            s.starttls()
        if user:
            s.login(user, password)
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
