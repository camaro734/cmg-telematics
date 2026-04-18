# services/ingest/src/publisher.py
"""
Publica registros en Redis Stream 'telemetry.raw'.
"""
import json
import logging
from redis.asyncio import Redis
from src.codec8 import AVLRecord

logger = logging.getLogger(__name__)
STREAM_KEY = "telemetry.raw"
MAX_STREAM_LEN = 100_000


async def publish_record(
    redis: Redis,
    avl: AVLRecord,
    device_id: str,
    vehicle_id: str,
    tenant_id: str,
) -> None:
    """Publica un AVL record al stream Redis. Non-blocking."""
    payload = {
        "time": avl.datetime_utc.isoformat(),
        "device_id": device_id,
        "vehicle_id": vehicle_id,
        "tenant_id": tenant_id,
        "lat": avl.latitude,
        "lon": avl.longitude,
        "speed_kmh": avl.speed_kmh,
        "heading": avl.heading,
        "altitude_m": avl.altitude_m,
        "ignition": avl.io_elements.get(239, 0),
        "pto_active": avl.io_elements.get(179, 0),
        "ext_voltage_mv": avl.io_elements.get(66),
        "can_data": {
            f"avl_{k}": v for k, v in avl.io_elements.items()
            if k not in {239, 179, 66}
        },
    }
    await redis.xadd(
        STREAM_KEY,
        {"payload": json.dumps(payload)},
        maxlen=MAX_STREAM_LEN,
        approximate=True,
    )
