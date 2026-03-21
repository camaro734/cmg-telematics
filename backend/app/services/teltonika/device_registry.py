"""
Tracks active TCP connections in Redis and in-memory writer map.
"""
import asyncio
from datetime import datetime, timezone
from typing import Optional
from app.core.redis_client import get_redis

# In-memory: imei -> asyncio.StreamWriter
_active_writers: dict[str, asyncio.StreamWriter] = {}


async def register_device_online(imei: str, writer: asyncio.StreamWriter):
    _active_writers[imei] = writer
    r = await get_redis()
    await r.set(
        f"device:{imei}:online",
        datetime.now(timezone.utc).isoformat(),
        ex=300,  # 5 min TTL, refreshed on each packet
    )


async def refresh_device_ttl(imei: str):
    r = await get_redis()
    await r.expire(f"device:{imei}:online", 300)


async def unregister_device(imei: str):
    _active_writers.pop(imei, None)
    r = await get_redis()
    await r.delete(f"device:{imei}:online")


def get_writer(imei: str) -> Optional[asyncio.StreamWriter]:
    return _active_writers.get(imei)


def is_connected(imei: str) -> bool:
    return imei in _active_writers


async def publish_telemetry(device_id: str, payload: dict):
    import json
    r = await get_redis()
    await r.publish(f"telemetry:{device_id}", json.dumps(payload))


async def publish_alert(device_id: str, payload: dict):
    """Publish alert event to Redis pub/sub channel."""
    import json
    channel = f"alert:{device_id}"
    r = await get_redis()
    await r.publish(channel, json.dumps(payload))
