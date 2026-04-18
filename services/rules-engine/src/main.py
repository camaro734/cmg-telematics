import asyncio
import json
import logging
import uuid as _uuid
from datetime import datetime

import asyncpg
from redis.asyncio import Redis

from src.config import settings
from src.loader import load_rules, Rule
from src.evaluator import process_message, TelemetryMsg, RuleMatch
from src.state import set_cooldown

logger = logging.getLogger(__name__)

STREAM_KEY = "telemetry.raw"
ALERTS_KEY = "alerts.fire"
CONSUMER_GROUP = "rules-workers"
CONSUMER_NAME = f"worker-{_uuid.uuid4().hex[:8]}"
ALERTS_MAX_LEN = 10_000

_rules: list[Rule] = []


async def _write_alert(conn: asyncpg.Connection, match: RuleMatch) -> str:
    alert_id = str(_uuid.uuid4())
    await conn.execute(
        """
        INSERT INTO alert_instance
            (id, rule_id, vehicle_id, tenant_id, triggered_at, status, trigger_value)
        VALUES ($1, $2::uuid, $3::uuid, $4::uuid, now(), 'firing', $5)
        """,
        alert_id,
        match.rule.id,
        match.vehicle_id,
        match.rule.tenant_id,
        json.dumps(match.trigger_value),
    )
    return alert_id


async def _publish_alert(redis: Redis, alert_id: str, match: RuleMatch) -> None:
    await redis.xadd(
        ALERTS_KEY,
        {
            "alert_id": alert_id,
            "rule_id": match.rule.id,
            "vehicle_id": match.vehicle_id,
            "tenant_id": match.rule.tenant_id,
            "severity": match.rule.severity,
            "trigger_value": json.dumps(match.trigger_value),
            "actions": json.dumps(match.rule.actions),
            "escalation": json.dumps(match.rule.escalation),
        },
        maxlen=ALERTS_MAX_LEN,
        approximate=True,
    )


async def _process_stream(db_pool: asyncpg.Pool, redis: Redis) -> None:
    while True:
        try:
            entries = await redis.xreadgroup(
                CONSUMER_GROUP,
                CONSUMER_NAME,
                {STREAM_KEY: ">"},
                count=50,
                block=2000,
            )
            if not entries:
                continue
            for _stream, messages in entries:
                for msg_id, fields in messages:
                    try:
                        raw = fields.get("payload") or fields.get(b"payload", "{}")
                        payload = json.loads(raw)
                        can = payload.get("can_data") or {}
                        if isinstance(can, str):
                            can = json.loads(can)
                        msg = TelemetryMsg(
                            time=datetime.fromisoformat(payload["time"]),
                            device_id=payload["device_id"],
                            vehicle_id=payload["vehicle_id"],
                            tenant_id=payload["tenant_id"],
                            lat=payload.get("lat"),
                            lon=payload.get("lon"),
                            speed_kmh=payload.get("speed_kmh"),
                            ignition=bool(payload.get("ignition")),
                            pto_active=bool(payload.get("pto_active")),
                            can_data=can,
                        )
                        matches = await process_message(_rules, msg, redis)
                        if matches:
                            async with db_pool.acquire() as conn:
                                for match in matches:
                                    alert_id = await _write_alert(conn, match)
                                    await _publish_alert(redis, alert_id, match)
                                    await set_cooldown(
                                        redis, match.rule.id, match.vehicle_id,
                                        match.rule.cooldown_minutes
                                    )
                        await redis.xack(STREAM_KEY, CONSUMER_GROUP, msg_id)
                    except Exception as exc:
                        logger.error("Error processing %s: %s", msg_id, exc, exc_info=True)
                        await redis.xack(STREAM_KEY, CONSUMER_GROUP, msg_id)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error("Stream read error: %s", exc)
            await asyncio.sleep(1)


async def _reload_rules(db_pool: asyncpg.Pool) -> None:
    global _rules
    try:
        async with db_pool.acquire() as conn:
            _rules = await load_rules(conn)
        logger.info("Hot-reloaded %d rules", len(_rules))
    except Exception as exc:
        logger.error("Rule reload failed: %s", exc)


async def _listen_rule_changes(db_pool: asyncpg.Pool) -> None:
    dsn = settings.db_url.replace("+asyncpg", "")
    conn = await asyncpg.connect(dsn=dsn)
    try:
        def _on_notify(conn, pid, channel, payload):
            asyncio.ensure_future(_reload_rules(db_pool))

        await conn.add_listener("rules_changed", _on_notify)
        logger.info("Listening for rule changes on PostgreSQL NOTIFY 'rules_changed'")
        while True:
            await asyncio.sleep(3600)
    except asyncio.CancelledError:
        pass
    finally:
        await conn.close()


async def main() -> None:
    global _rules

    def _encode_json(v):
        return json.dumps(v)

    def _decode_json(v):
        return json.loads(v)

    async def _init_conn(conn):
        await conn.set_type_codec(
            "jsonb", encoder=_encode_json, decoder=_decode_json, schema="pg_catalog"
        )

    dsn = settings.db_url.replace("+asyncpg", "")
    db_pool = await asyncpg.create_pool(dsn=dsn, min_size=2, max_size=10, init=_init_conn)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)

    async with db_pool.acquire() as conn:
        _rules = await load_rules(conn)
    logger.info("Loaded %d rules at startup", len(_rules))

    try:
        await redis.xgroup_create(STREAM_KEY, CONSUMER_GROUP, id="0", mkstream=True)
    except Exception:
        pass  # group already exists

    logger.info("Rules engine started as %s", CONSUMER_NAME)
    await asyncio.gather(
        _process_stream(db_pool, redis),
        _listen_rule_changes(db_pool),
    )


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    asyncio.run(main())
