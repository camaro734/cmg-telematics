# services/ingest/src/publisher.py
"""
Publica registros en Redis Stream 'telemetry.raw' y actualiza el hash de estado
vehicle:{vehicle_id}:status que consume el core-api para el mapa y estado online.
"""
import json
import logging
from redis.asyncio import Redis
from src.codec8 import AVLRecord

logger = logging.getLogger(__name__)
STREAM_KEY = "telemetry.raw"
MAX_STREAM_LEN = 100_000
STATUS_TTL = 7 * 24 * 3600  # 7 días — se actualiza en cada paquete


async def publish_record(
    redis: Redis,
    avl: AVLRecord,
    device_id: str,
    vehicle_id: str,
    tenant_id: str,
) -> None:
    """Publica un AVL record al stream Redis y actualiza el hash de estado."""
    can_data = {
        f"avl_{k}": v for k, v in avl.io_elements.items()
        if k not in {239, 179, 66}
    }
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
        "can_data": can_data,
    }
    await redis.xadd(
        STREAM_KEY,
        {"payload": json.dumps(payload)},
        maxlen=MAX_STREAM_LEN,
        approximate=True,
    )
    await _update_status_hash(redis, avl, vehicle_id, can_data)


async def _update_status_hash(
    redis: Redis,
    avl: AVLRecord,
    vehicle_id: str,
    can_data: dict,
) -> None:
    """Escribe el hash vehicle:{vehicle_id}:status que lee el core-api."""
    lat = avl.latitude if avl.latitude and avl.latitude != 0 else None
    lon = avl.longitude if avl.longitude and avl.longitude != 0 else None
    ignition = avl.io_elements.get(239, 0) == 1
    pto_active = avl.io_elements.get(179, 0) == 1

    mapping = {
        "online": "true",
        "last_seen": avl.datetime_utc.isoformat(),
        "speed_kmh": str(avl.speed_kmh) if avl.speed_kmh is not None else "",
        "ignition": "true" if ignition else "false",
        "pto_active": "true" if pto_active else "false",
        "can_data": json.dumps(can_data),
    }
    if lat is not None:
        mapping["lat"] = str(lat)
        mapping["lon"] = str(lon)

    key = f"vehicle:{vehicle_id}:status"
    await redis.hset(key, mapping=mapping)
    await redis.expire(key, STATUS_TTL)


async def set_vehicle_offline(redis: Redis, vehicle_id: str) -> None:
    """Marca el vehículo como offline en Redis al cerrar la conexión TCP."""
    key = f"vehicle:{vehicle_id}:status"
    await redis.hset(key, mapping={"online": "false"})
    await redis.expire(key, STATUS_TTL)
