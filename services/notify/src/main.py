# services/notify/src/main.py
import asyncio
import json
import logging
import socket

import asyncpg
from redis.asyncio import Redis
from redis.exceptions import ResponseError

from src.config import settings
from src.dispatcher import dispatch_action
from src.escalation import schedule_escalation, pop_due_escalations

logger = logging.getLogger(__name__)

STREAM_KEY = "alerts.fire"
CONSUMER_GROUP = "notify-workers"
CONSUMER_NAME = "notifier-%s" % socket.gethostname()


async def _process_alert(db_pool: asyncpg.Pool, redis: Redis, fields: dict) -> None:
    alert_id = fields.get("alert_id", "")
    rule_id = fields.get("rule_id", "")
    vehicle_id = fields.get("vehicle_id", "")
    tenant_id = fields.get("tenant_id", "")
    severity = fields.get("severity", "info")
    trigger_value = json.loads(fields.get("trigger_value", "{}"))
    actions = json.loads(fields.get("actions", "[]"))
    escalation = json.loads(fields.get("escalation", "[]"))

    async with db_pool.acquire() as conn:
        rule_row = await conn.fetchrow(
            "SELECT name FROM alert_rule WHERE id = $1::uuid", rule_id
        )
        vehicle_row = await conn.fetchrow(
            "SELECT name FROM vehicle WHERE id = $1::uuid", vehicle_id
        )
        tenant_row = await conn.fetchrow(
            "SELECT notification_email FROM tenant WHERE id = $1::uuid", tenant_id
        )

    rule_name = rule_row["name"] if rule_row else "unknown"
    vehicle_name = vehicle_row["name"] if vehicle_row else vehicle_id
    tenant_email = tenant_row["notification_email"] if tenant_row else None

    context = {
        "alert_id": alert_id,
        "rule_id": rule_id,
        "rule_name": rule_name,
        "vehicle_id": vehicle_id,
        "vehicle_name": vehicle_name,
        "tenant_id": tenant_id,
        "severity": severity,
        "trigger_value": trigger_value,
    }

    email_dispatched = any(a.get("type") == "email" for a in actions)

    for action in actions:
        await dispatch_action(action, context)

    # Tenant email fallback: only if no email action was in the rule
    if not email_dispatched and tenant_email:
        logger.info(
            "No rule-level email action — sending tenant fallback to %s for alert %s",
            tenant_email, alert_id,
        )
        await dispatch_action(
            {"type": "email", "recipients": [tenant_email]},
            context,
        )

    if not email_dispatched and not tenant_email:
        logger.debug("No email recipients configured for alert %s", alert_id)

    for step in escalation:
        await schedule_escalation(
            redis, alert_id, rule_id, vehicle_id,
            step, step.get("delay_minutes", 10),
        )


async def _drain_pending(db_pool: asyncpg.Pool, redis: Redis) -> None:
    """Re-procesa mensajes pendientes de este consumer tras un crash.

    Usa seen-set anti-loop: mensajes que fallan (sin XACK) quedan en
    el PEL para reintento en el próximo arranque.
    """
    seen: set[str] = set()
    while True:
        entries = await redis.xreadgroup(
            CONSUMER_GROUP, CONSUMER_NAME, {STREAM_KEY: "0"}, count=50
        )
        if not entries:
            break
        new_work = False
        for _stream, messages in entries:
            for msg_id, fields in messages:
                if msg_id in seen:
                    continue
                seen.add(msg_id)
                new_work = True
                if not fields:
                    await redis.xack(STREAM_KEY, CONSUMER_GROUP, msg_id)
                    continue
                try:
                    await _process_alert(db_pool, redis, fields)
                    await redis.xack(STREAM_KEY, CONSUMER_GROUP, msg_id)
                except Exception as exc:
                    logger.error("PEL drain failed %s: %s", msg_id, exc, exc_info=True)
                    # Sin XACK — queda en PEL para reintento en el próximo arranque
        if not new_work:
            break


async def _process_stream(db_pool: asyncpg.Pool, redis: Redis) -> None:
    await _drain_pending(db_pool, redis)
    while True:
        try:
            entries = await redis.xreadgroup(
                CONSUMER_GROUP, CONSUMER_NAME, {STREAM_KEY: ">"}, count=10, block=2000
            )
            if not entries:
                continue
            for _stream, messages in entries:
                for msg_id, fields in messages:
                    try:
                        await _process_alert(db_pool, redis, fields)
                        await redis.xack(STREAM_KEY, CONSUMER_GROUP, msg_id)
                    except Exception as exc:
                        logger.error("Error on alert %s: %s", msg_id, exc, exc_info=True)
                        # Sin XACK — queda en PEL, recuperado por _drain_pending al reiniciar
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error("Stream error: %s", exc)
            await asyncio.sleep(1)


async def _escalation_worker(db_pool: asyncpg.Pool, redis: Redis) -> None:
    while True:
        await asyncio.sleep(30)
        try:
            due = await pop_due_escalations(redis)
            for item in due:
                rule_id = item["rule_id"]
                vehicle_id = item["vehicle_id"]
                async with db_pool.acquire() as conn:
                    rule_row = await conn.fetchrow(
                        "SELECT name FROM alert_rule WHERE id = $1::uuid", rule_id
                    )
                    vehicle_row = await conn.fetchrow(
                        "SELECT name FROM vehicle WHERE id = $1::uuid", vehicle_id
                    )
                context = {
                    "alert_id": item["alert_id"],
                    "rule_id": rule_id,
                    "rule_name": rule_row["name"] if rule_row else "unknown",
                    "vehicle_id": vehicle_id,
                    "vehicle_name": vehicle_row["name"] if vehicle_row else vehicle_id,
                    "severity": "escalated",
                    "trigger_value": {},
                }
                for action in item.get("actions", []):
                    await dispatch_action(action, context)
                logger.info("Escalation fired for alert %s", item["alert_id"])
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error("Escalation worker error: %s", exc)


async def main() -> None:
    dsn = settings.db_url.replace("+asyncpg", "")
    db_pool = await asyncpg.create_pool(dsn=dsn, min_size=2, max_size=5)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)

    try:
        await redis.xgroup_create(STREAM_KEY, CONSUMER_GROUP, id="0", mkstream=True)
    except ResponseError as exc:
        if "BUSYGROUP" not in str(exc):
            raise

    logger.info("Notify service started as %s", CONSUMER_NAME)
    await asyncio.gather(
        _process_stream(db_pool, redis),
        _escalation_worker(db_pool, redis),
    )


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    asyncio.run(main())
