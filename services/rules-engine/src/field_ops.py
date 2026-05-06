"""
Detección automática de inicio/fin de trabajo basada en PTO y geofence de llegada.

Lógica:
  - Cada paquete de telemetría: comprobar estado PTO anterior vs. actual.
  - PTO false→true: buscar la parada activa más próxima para este vehículo,
    marcarla como in_progress y grabar started_at.
  - PTO true→false: calcular pto_minutes, agregar telemetría de TimescaleDB
    entre started_at y ahora, marcar parada como done.
  - Cada paquete con lat/lon: si hay parada en pending con coordenadas,
    comprobar distancia — si < arrival_radius_m → marcar arrived.
"""
import logging
import math
from datetime import datetime, timezone

import asyncpg
from redis.asyncio import Redis

logger = logging.getLogger(__name__)

PTO_STATE_KEY   = "field:pto:{vehicle_id}"   # "1" | "0"
PTO_STARTED_KEY = "field:pto_started:{vehicle_id}:{stop_id}"
ACTIVE_STOP_KEY = "field:active_stop:{vehicle_id}"   # stop_id


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance in metres between two GPS points."""
    R = 6_371_000
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dφ = math.radians(lat2 - lat1)
    dλ = math.radians(lon2 - lon1)
    a = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def _get_active_stop(conn: asyncpg.Connection, vehicle_id: str) -> dict | None:
    """Find the first pending/arrived/in_progress stop for the vehicle's active work order."""
    row = await conn.fetchrow(
        """
        SELECT wos.id, wos.work_order_id, wos.status,
               wos.lat, wos.lon, wos.arrival_radius_m, wos.started_at
        FROM   work_order_stop wos
        JOIN   work_order wo ON wo.id = wos.work_order_id
        WHERE  wo.vehicle_id = $1::uuid
          AND  wo.status     = 'in_progress'
          AND  wos.status   IN ('pending', 'arrived', 'in_progress')
        ORDER BY wos.order_index ASC
        LIMIT 1
        """,
        vehicle_id,
    )
    return dict(row) if row else None


async def _mark_arrived(conn: asyncpg.Connection, stop_id: str) -> None:
    await conn.execute(
        "UPDATE work_order_stop SET status='arrived', arrived_at=now() WHERE id=$1::uuid AND status='pending'",
        stop_id,
    )
    logger.info("Stop %s marked as arrived", stop_id)


async def _mark_in_progress(conn: asyncpg.Connection, stop_id: str) -> None:
    await conn.execute(
        "UPDATE work_order_stop SET status='in_progress', started_at=now() WHERE id=$1::uuid AND status IN ('pending','arrived')",
        stop_id,
    )
    logger.info("Stop %s marked as in_progress (PTO on)", stop_id)


async def _aggregate_telemetry(
    conn: asyncpg.Connection,
    vehicle_id: str,
    started_at: datetime,
    ended_at: datetime,
) -> dict:
    """Query TimescaleDB for key aggregates during the work interval."""
    row = await conn.fetchrow(
        """
        SELECT
            ROUND(CAST(AVG(
                CASE WHEN can_data ? 'engine_rpm'    THEN (can_data->>'engine_rpm')::float
                     WHEN can_data ? 'rpm'           THEN (can_data->>'rpm')::float
                     ELSE NULL END
            ) AS NUMERIC), 0)::float                       AS rpm_avg,
            ROUND(CAST(SUM(
                CASE WHEN can_data ? 'pto_active' AND (can_data->>'pto_active')::bool
                     THEN 30.0 / 60.0   -- each record ≈ 30s, convert to minutes
                     ELSE 0 END
            ) AS NUMERIC), 1)::float                       AS pump_minutes,
            ROUND(CAST(MIN(
                CASE WHEN can_data ? 'presion_depresor' THEN (can_data->>'presion_depresor')::float
                     WHEN can_data ? 'pressure'         THEN (can_data->>'pressure')::float
                     ELSE NULL END
            ) AS NUMERIC), 0)::float                       AS pressure_min,
            ROUND(CAST(MAX(
                CASE WHEN can_data ? 'presion_depresor' THEN (can_data->>'presion_depresor')::float
                     WHEN can_data ? 'pressure'         THEN (can_data->>'pressure')::float
                     ELSE NULL END
            ) AS NUMERIC), 0)::float                       AS pressure_max
        FROM telemetry_record
        WHERE vehicle_id = $1::uuid
          AND time BETWEEN $2 AND $3
        """,
        vehicle_id,
        started_at,
        ended_at,
    )
    return dict(row) if row else {}


async def _mark_done(
    conn: asyncpg.Connection,
    stop_id: str,
    pto_minutes: float,
    agg: dict,
) -> None:
    await conn.execute(
        """
        UPDATE work_order_stop
        SET    status      = 'done',
               completed_at = now(),
               pto_minutes  = $2,
               pump_minutes = $3,
               rpm_avg      = $4,
               pressure_min = $5,
               pressure_max = $6
        WHERE  id = $1::uuid AND status = 'in_progress'
        """,
        stop_id,
        round(pto_minutes, 1),
        agg.get("pump_minutes"),
        agg.get("rpm_avg"),
        agg.get("pressure_min"),
        agg.get("pressure_max"),
    )
    logger.info("Stop %s done — %.1f min PTO", stop_id, pto_minutes)


async def handle_field_operations(
    db_pool: asyncpg.Pool,
    redis: Redis,
    vehicle_id: str,
    pto_active: bool,
    lat: float | None,
    lon: float | None,
) -> None:
    """
    Called once per telemetry message. Detects PTO edges and geofence arrival.
    Runs in a fire-and-forget fashion — errors are logged, never re-raised.
    """
    try:
        pto_key   = PTO_STATE_KEY.format(vehicle_id=vehicle_id)
        prev_raw  = await redis.get(pto_key)
        prev_pto  = (prev_raw == "1") if prev_raw is not None else None

        # Persist current PTO state
        await redis.set(pto_key, "1" if pto_active else "0", ex=3600 * 24)

        async with db_pool.acquire() as conn:
            stop = await _get_active_stop(conn, vehicle_id)
            if not stop:
                return

            stop_id = str(stop["id"])

            # ── Geofence arrival check ─────────────────────────────────────
            if (
                stop["status"] == "pending"
                and lat is not None and lon is not None
                and stop["lat"] is not None and stop["lon"] is not None
            ):
                dist = _haversine_m(lat, lon, float(stop["lat"]), float(stop["lon"]))
                if dist <= float(stop["arrival_radius_m"]):
                    await _mark_arrived(conn, stop_id)
                    stop["status"] = "arrived"

            # ── PTO rising edge: false → true ──────────────────────────────
            if pto_active and prev_pto is False and stop["status"] in ("pending", "arrived"):
                await _mark_in_progress(conn, stop_id)
                started_key = PTO_STARTED_KEY.format(vehicle_id=vehicle_id, stop_id=stop_id)
                await redis.set(started_key, datetime.now(timezone.utc).isoformat(), ex=3600 * 12)
                await redis.set(ACTIVE_STOP_KEY.format(vehicle_id=vehicle_id), stop_id, ex=3600 * 12)

            # ── PTO falling edge: true → false ─────────────────────────────
            elif not pto_active and prev_pto is True and stop["status"] == "in_progress":
                active_stop_key = ACTIVE_STOP_KEY.format(vehicle_id=vehicle_id)
                cached_stop_id  = await redis.get(active_stop_key) or stop_id
                started_key     = PTO_STARTED_KEY.format(vehicle_id=vehicle_id, stop_id=cached_stop_id)
                started_raw     = await redis.get(started_key)

                now = datetime.now(timezone.utc)
                if started_raw:
                    started_at  = datetime.fromisoformat(started_raw)
                    pto_minutes = (now - started_at).total_seconds() / 60
                    agg = await _aggregate_telemetry(conn, vehicle_id, started_at, now)
                else:
                    # Fallback: use started_at stored in DB
                    started_at  = stop["started_at"] or now
                    if started_at.tzinfo is None:
                        started_at = started_at.replace(tzinfo=timezone.utc)
                    pto_minutes = (now - started_at).total_seconds() / 60
                    agg = {}

                await _mark_done(conn, cached_stop_id, pto_minutes, agg)
                await redis.delete(started_key, active_stop_key)

    except Exception as exc:
        logger.error("field_ops error for vehicle %s: %s", vehicle_id, exc, exc_info=True)
