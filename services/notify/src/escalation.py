# services/notify/src/escalation.py
import json
import time
from redis.asyncio import Redis

ESCALATION_KEY = "escalation"


async def schedule_escalation(
    redis: Redis,
    alert_id: str,
    rule_id: str,
    vehicle_id: str,
    step: dict,
    delay_minutes: int,
) -> None:
    score = time.time() + delay_minutes * 60
    payload = json.dumps(
        {"alert_id": alert_id, "rule_id": rule_id, "vehicle_id": vehicle_id, "actions": step.get("actions", [])}
    )
    await redis.zadd(ESCALATION_KEY, {payload: score})


async def pop_due_escalations(redis: Redis) -> list[dict]:
    now = time.time()
    items = await redis.zrangebyscore(ESCALATION_KEY, 0, now)
    if items:
        await redis.zremrangebyscore(ESCALATION_KEY, 0, now)
    return [json.loads(item) for item in items]
