# services/ingest/src/writer.py
"""
Escribe registros telemetría en TimescaleDB via asyncpg (directo, no ORM).
Más rendimiento que SQLAlchemy para inserciones de alta frecuencia.
"""
import asyncpg
import logging
from datetime import datetime, timezone
from src.codec8 import AVLRecord

logger = logging.getLogger(__name__)

# Cualquier timestamp anterior a esta fecha indica RTC sin sincronizar (cold boot FMC650).
_MIN_VALID_TIME = datetime(2020, 1, 1, tzinfo=timezone.utc)

AVL_IGNITION = 239
AVL_DIN1 = 1   # Ignición via entrada digital (fallback si no llega RPM ni avl_239)
AVL_EXT_VOLTAGE = 66
AVL_PTO = 179
AVL_DIN2 = 2   # PTO via entrada digital (fallback si no llega avl_179)

# AVL IDs que reportan régimen del motor (RPM). Cualquiera > umbral → motor en marcha.
_RPM_AVL_IDS = (30, 36, 85, 269, 10309)
_RPM_IGNITION_THRESHOLD = 200


def _compute_ignition(io: dict) -> bool:
    """Detecta ignición. Prioridad:
    1) Cualquier AVL conocido de RPM > umbral → motor en marcha.
    2) Si la trama trae RPM pero está en 0 → motor parado (return False).
    3) Si NO trae ningún AVL de RPM → fallback DIN2 (avl_2) o CAN ignition (avl_239).
    """
    has_rpm_data = False
    for key in _RPM_AVL_IDS:
        v = io.get(key)
        if isinstance(v, (int, float)):
            has_rpm_data = True
            if v > _RPM_IGNITION_THRESHOLD:
                return True
    if has_rpm_data:
        return False
    return io.get(AVL_DIN1, 0) == 1 or io.get(AVL_IGNITION, 0) == 1


async def write_record(
    conn: asyncpg.Connection,
    avl: AVLRecord,
    device_id: str,
    vehicle_id: str,
    tenant_id: str,
) -> None:
    """Inserta un AVLRecord en telemetry_record."""
    ts = avl.datetime_utc
    if ts < _MIN_VALID_TIME:
        logger.warning(
            "Timestamp inválido descartado (RTC sin sync): %s — device_id=%s",
            ts.isoformat(), device_id,
        )
        return

    ignition = _compute_ignition(avl.io_elements)
    pto_active = bool(avl.io_elements.get(AVL_PTO, 0)) or bool(avl.io_elements.get(AVL_DIN2, 0))
    ext_voltage_mv = avl.io_elements.get(AVL_EXT_VOLTAGE)

    known_avl_ids = {AVL_IGNITION, AVL_PTO, AVL_EXT_VOLTAGE}
    can_data = {
        f"avl_{io_id}": value
        for io_id, value in avl.io_elements.items()
        if io_id not in known_avl_ids
    } or None

    await conn.execute("""
        INSERT INTO telemetry_record
            (time, device_id, vehicle_id, tenant_id,
             lat, lon, speed_kmh, heading, altitude_m,
             ignition, pto_active, ext_voltage_mv, can_data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT DO NOTHING
    """,
        ts, device_id, vehicle_id, tenant_id,
        avl.latitude if avl.latitude != 0 else None,
        avl.longitude if avl.longitude != 0 else None,
        float(avl.speed_kmh),
        avl.heading, avl.altitude_m,
        ignition, pto_active, ext_voltage_mv,
        can_data,
    )


async def get_device_info(
    conn: asyncpg.Connection, imei: str
) -> dict | None:
    """Devuelve {device_id, vehicle_id, tenant_id} para un IMEI. None si no existe."""
    row = await conn.fetchrow("""
        SELECT d.id AS device_id, d.vehicle_id, v.tenant_id
        FROM device d
        JOIN vehicle v ON v.id = d.vehicle_id
        WHERE d.imei = $1 AND d.active = true AND v.active = true
    """, imei)
    if not row:
        return None
    return {
        "device_id": str(row["device_id"]),
        "vehicle_id": str(row["vehicle_id"]),
        "tenant_id": str(row["tenant_id"]),
    }


async def update_device_online(
    conn: asyncpg.Connection, imei: str, online: bool
) -> None:
    await conn.execute("""
        UPDATE device SET online=$1, last_seen=now() WHERE imei=$2
    """, online, imei)
