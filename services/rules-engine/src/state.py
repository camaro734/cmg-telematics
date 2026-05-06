from redis.asyncio import Redis


async def is_in_cooldown(redis: Redis, rule_id: str, vehicle_id: str) -> bool:
    return await redis.exists(f"rule:cooldown:{rule_id}:{vehicle_id}") > 0


async def set_cooldown(redis: Redis, rule_id: str, vehicle_id: str, minutes: int) -> None:
    await redis.setex(f"rule:cooldown:{rule_id}:{vehicle_id}", minutes * 60, "1")


async def get_sustained_start(redis: Redis, rule_id: str, vehicle_id: str) -> float | None:
    val = await redis.hget(f"rule:state:{rule_id}:{vehicle_id}", "first_triggered_at")
    return float(val) if val is not None else None


async def set_sustained_start(redis: Redis, rule_id: str, vehicle_id: str, ts: float) -> None:
    await redis.hset(f"rule:state:{rule_id}:{vehicle_id}", "first_triggered_at", ts)


async def clear_sustained_start(redis: Redis, rule_id: str, vehicle_id: str) -> None:
    await redis.hdel(f"rule:state:{rule_id}:{vehicle_id}", "first_triggered_at")


async def get_accumulator(redis: Redis, rule_id: str, vehicle_id: str) -> float:
    val = await redis.get(f"rule:accum:{rule_id}:{vehicle_id}")
    return float(val) if val is not None else 0.0


async def increment_accumulator(redis: Redis, rule_id: str, vehicle_id: str, delta: float) -> float:
    return float(await redis.incrbyfloat(f"rule:accum:{rule_id}:{vehicle_id}", delta))


async def get_geofence_state(redis: Redis, rule_id: str, vehicle_id: str) -> bool | None:
    """Retorna True/False si hay estado conocido, None si es la primera vez."""
    val = await redis.hget(f"rule:geofence:{rule_id}:{vehicle_id}", "inside")
    if val is None:
        return None
    return val == b"1" or val == "1"


async def set_geofence_state(redis: Redis, rule_id: str, vehicle_id: str, inside: bool) -> None:
    await redis.hset(f"rule:geofence:{rule_id}:{vehicle_id}", "inside", "1" if inside else "0")
