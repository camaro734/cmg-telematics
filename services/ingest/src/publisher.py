# services/ingest/src/publisher.py
"""
Publica registros en Redis Stream 'telemetry.raw' y actualiza el hash de estado
vehicle:{vehicle_id}:status que consume el core-api para el mapa y estado online.
"""
import json
import logging
from redis.asyncio import Redis
from src.codec8 import AVLRecord
from src.config import settings

logger = logging.getLogger(__name__)
STREAM_KEY = "telemetry.raw"
STATUS_TTL = 7 * 24 * 3600  # 7 días — se actualiza en cada paquete

# AVL IDs reportando RPM. Cualquiera > umbral → motor en marcha. Si la trama no
# trae ninguno, caemos a DIN2 (avl_2) o CAN ignition (avl_239) como fallback.
_RPM_AVL_IDS = (30, 36, 85, 269, 10309)
_RPM_IGNITION_THRESHOLD = 200
_AVL_DIN1 = 1     # Ignición via entrada digital
_AVL_DIN2 = 2     # PTO via entrada digital
_AVL_IGNITION = 239
_AVL_PTO = 179


def _compute_ignition(io: dict) -> bool:
    """RPM primario; DIN2 o avl_239 como fallback sólo si no llega RPM."""
    has_rpm_data = False
    for key in _RPM_AVL_IDS:
        v = io.get(key)
        if isinstance(v, (int, float)):
            has_rpm_data = True
            if v > _RPM_IGNITION_THRESHOLD:
                return True
    if has_rpm_data:
        return False
    return io.get(_AVL_DIN1, 0) == 1 or io.get(_AVL_IGNITION, 0) == 1


def _compute_pto(io: dict) -> bool:
    return io.get(_AVL_PTO, 0) == 1 or io.get(_AVL_DIN2, 0) == 1


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
    from datetime import datetime, timezone as _tz
    _now = datetime.now(_tz.utc)
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
        "ignition": 1 if _compute_ignition(avl.io_elements) else 0,
        "pto_active": 1 if _compute_pto(avl.io_elements) else 0,
        "ext_voltage_mv": avl.io_elements.get(66),
        "can_data": can_data,
        # received_at = hora del servidor (no del dispositivo) para calcular online
        "received_at": _now.isoformat(),
        # last_seen = timestamp del dispositivo, para mostrar al usuario
        "last_seen": avl.datetime_utc.isoformat(),
        "online": True,
    }
    await redis.xadd(
        STREAM_KEY,
        {"payload": json.dumps(payload)},
        maxlen=settings.stream_maxlen,
        approximate=True,
    )
    await _update_status_hash(redis, avl, vehicle_id, can_data, _now.isoformat())


async def _update_status_hash(
    redis: Redis,
    avl: AVLRecord,
    vehicle_id: str,
    can_data: dict,
    received_at: str,
) -> None:
    """Escribe el hash vehicle:{vehicle_id}:status que lee el core-api."""
    lat = avl.latitude if avl.latitude and avl.latitude != 0 else None
    lon = avl.longitude if avl.longitude and avl.longitude != 0 else None
    ignition = _compute_ignition(avl.io_elements)
    pto_active = _compute_pto(avl.io_elements)

    ext_voltage_mv = avl.io_elements.get(66)
    mapping = {
        "online": "true",
        "last_seen": avl.datetime_utc.isoformat(),
        "received_at": received_at,
        "speed_kmh": str(avl.speed_kmh) if avl.speed_kmh is not None else "",
        "ignition": "true" if ignition else "false",
        "pto_active": "true" if pto_active else "false",
        "can_data": json.dumps(can_data),
    }
    if ext_voltage_mv is not None:
        mapping["ext_voltage_mv"] = str(ext_voltage_mv)
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
