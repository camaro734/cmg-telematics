"""Detector de GPS congelado por Static Navigation Filter (Teltonika param 106).

Firma inequivoca: saltos de posicion > 300 m con speed_kmh = 0 entre registros
consecutivos. Imposible en conduccion normal; solo Static Navigation produce un
teletransporte a velocidad cero.

Ventana unica de 30 min: dispara si hay >= 2 saltos; resuelve si hay 0 saltos.
El TTL del key Redis se refresca en cada sweep para que episodios de horas
no dejen alertas huerfanas en estado firing.
"""
import json
import logging
import math
import uuid

import asyncpg
from redis.asyncio import Redis

logger = logging.getLogger(__name__)

_FROZEN_KEY  = "frozen_gps:firing:{vehicle_id}"
_STREAM_KEY  = "telemetry.raw"

_MIN_JUMPS   = 2       # saltos necesarios para disparar / mantener
_JUMP_M      = 300     # distancia minima de un salto (metros)
_WINDOW_MIN  = 30      # ventana unica para deteccion y resolucion
_MAX_RECORDS = 50      # registros maximos a consultar por vehiculo
_KEY_TTL_S   = 3_600   # TTL Redis — se refresca en cada sweep activo


def _frozen_key(vehicle_id: str) -> str:
    return _FROZEN_KEY.format(vehicle_id=vehicle_id)


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia en metros entre dos puntos GPS (formula haversine)."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi    = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _count_jumps(records: list) -> list[dict]:
    """
    Retorna lista de saltos > _JUMP_M con speed_kmh = 0 entre registros
    consecutivos. records debe estar ordenado por time ASC.
    Solo usa columnas de primera clase: lat, lon, speed_kmh.
    """
    jumps = []
    for i in range(1, len(records)):
        prev, curr = records[i - 1], records[i]
        if None in (prev["lat"], prev["lon"], curr["lat"], curr["lon"]):
            continue
        dist = _haversine_m(prev["lat"], prev["lon"], curr["lat"], curr["lon"])
        if dist > _JUMP_M and (curr["speed_kmh"] or 0) == 0:
            jumps.append({
                "time":   curr["time"],
                "dist_m": dist,
                "lat":    curr["lat"],
                "lon":    curr["lon"],
            })
    return jumps


async def _publish_alert_ws(
    redis: Redis,
    action: str,
    alert_id: str,
    tenant_id: str,
    vehicle_id: str,
) -> None:
    await redis.xadd(
        _STREAM_KEY,
        {"payload": json.dumps({
            "_ws_type":   "alert",
            "action":     action,
            "tenant_id":  tenant_id,
            "alert_id":   alert_id,
            "vehicle_id": vehicle_id,
        })},
        maxlen=50_000,
        approximate=True,
    )


async def _ensure_frozen_gps_rule(conn: asyncpg.Connection, tenant_id: str) -> str:
    """Garantiza UNA regla frozen_gps por tenant. Idempotente."""
    row = await conn.fetchrow(
        """
        SELECT id::text FROM alert_rule
        WHERE  tenant_id = $1::uuid
          AND  condition->>'type' = 'frozen_gps'
        LIMIT 1
        """,
        tenant_id,
    )
    if row:
        return row["id"]

    rule_id = str(uuid.uuid4())
    await conn.execute(
        """
        INSERT INTO alert_rule
            (id, tenant_id, name, condition, vehicle_filter,
             severity, actions, escalation, schedule,
             active, cooldown_minutes, created_at)
        VALUES
            ($1::uuid, $2::uuid,
             'Sistema: GPS congelado (Static Navigation)',
             '{"type":"frozen_gps"}'::jsonb,
             '{"scope":"all"}'::jsonb,
             'warning', '[]'::jsonb, '[]'::jsonb, '{"type":"always"}'::jsonb,
             false, 0, now())
        """,
        rule_id,
        tenant_id,
    )
    logger.info("Regla __frozen_gps__ creada: tenant=%s rule=%s", tenant_id, rule_id)
    return rule_id


async def _resolve_existing(
    conn: asyncpg.Connection,
    redis: Redis,
    vehicle_id: str,
    tenant_id: str,
    frozen_rules: dict[str, str],
) -> None:
    """Resuelve alerta firing de frozen_gps si existe. Fast-path via Redis key."""
    redis_key = _frozen_key(vehicle_id)
    if not await redis.exists(redis_key):
        return

    if tenant_id not in frozen_rules:
        row = await conn.fetchrow(
            """
            SELECT id::text FROM alert_rule
            WHERE  tenant_id = $1::uuid
              AND  condition->>'type' = 'frozen_gps'
            LIMIT 1
            """,
            tenant_id,
        )
        if not row:
            await redis.delete(redis_key)
            return
        frozen_rules[tenant_id] = row["id"]

    rule_id = frozen_rules[tenant_id]
    resolved = await conn.fetch(
        """
        UPDATE alert_instance
        SET    status = 'resolved', resolved_at = now()
        WHERE  vehicle_id = $1::uuid
          AND  rule_id    = $2::uuid
          AND  status     = 'firing'
        RETURNING id::text
        """,
        vehicle_id,
        rule_id,
    )
    await redis.delete(redis_key)
    for r in resolved:
        await _publish_alert_ws(redis, "resolved", r["id"], tenant_id, vehicle_id)
    if resolved:
        logger.info(
            "GPS-frozen resuelto: vehicle=%s (%d alertas)", vehicle_id, len(resolved)
        )


async def sweep_frozen_gps(db_pool: asyncpg.Pool, redis: Redis) -> None:
    """Barrido periodico: detecta GPS congelado por Static Navigation.

    Ventana unica de _WINDOW_MIN minutos. Para cada vehiculo activo:
    - Consulta registros de los ultimos _WINDOW_MIN min (solo lat/lon/speed_kmh/time).
    - Dispara si jumps >= _MIN_JUMPS (patron activo).
    - Resuelve si jumps == 0 (patron desaparecido).
    - Entre 1..(_MIN_JUMPS-1) saltos: mantiene estado anterior (sin cambio).
    """
    try:
        async with db_pool.acquire() as conn:
            vehicles = await conn.fetch(
                """
                SELECT v.id::text        AS vehicle_id,
                       v.tenant_id::text AS tenant_id
                FROM   vehicle v
                JOIN   device  d ON d.vehicle_id = v.id AND d.active = true
                WHERE  v.active      = true
                  AND  d.last_seen  IS NOT NULL
                """
            )

            frozen_rules: dict[str, str] = {}
            fired = 0

            for row in vehicles:
                vehicle_id = row["vehicle_id"]
                tenant_id  = row["tenant_id"]

                records = await conn.fetch(
                    f"""
                    SELECT time, lat, lon, speed_kmh
                    FROM   telemetry_record
                    WHERE  vehicle_id = $1::uuid
                      AND  time >= now() - interval '{_WINDOW_MIN} minutes'
                      AND  lat  IS NOT NULL
                      AND  lon  IS NOT NULL
                    ORDER BY time ASC
                    LIMIT  {_MAX_RECORDS}
                    """,
                    vehicle_id,
                )

                if len(records) < 2:
                    await _resolve_existing(conn, redis, vehicle_id, tenant_id, frozen_rules)
                    continue

                jumps = _count_jumps(records)

                if len(jumps) >= _MIN_JUMPS:
                    # Patron activo
                    if tenant_id not in frozen_rules:
                        frozen_rules[tenant_id] = await _ensure_frozen_gps_rule(conn, tenant_id)
                    rule_id = frozen_rules[tenant_id]

                    # Refrescar TTL en cada sweep activo (episodio puede durar horas)
                    redis_key = _frozen_key(vehicle_id)
                    await redis.set(redis_key, "1", ex=_KEY_TTL_S)

                    # Dedup fuente de verdad = BD
                    existing = await conn.fetchrow(
                        """
                        SELECT id FROM alert_instance
                        WHERE  vehicle_id = $1::uuid
                          AND  rule_id    = $2::uuid
                          AND  status     = 'firing'
                        LIMIT 1
                        """,
                        vehicle_id,
                        rule_id,
                    )
                    if existing:
                        continue

                    max_dist = max(j["dist_m"] for j in jumps)
                    trigger_value = {
                        "first_jump_at": jumps[0]["time"].isoformat(),
                        "jump_count":    len(jumps),
                        "max_jump_m":    round(max_dist),
                        "lat":           jumps[-1]["lat"],
                        "lon":           jumps[-1]["lon"],
                    }
                    alert_id = str(uuid.uuid4())
                    await conn.execute(
                        """
                        INSERT INTO alert_instance
                            (id, rule_id, vehicle_id, tenant_id,
                             triggered_at, status, trigger_value)
                        VALUES
                            ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
                             now(), 'firing', $5::jsonb)
                        """,
                        alert_id, rule_id, vehicle_id, tenant_id,
                        trigger_value,
                    )
                    await _publish_alert_ws(redis, "fired", alert_id, tenant_id, vehicle_id)
                    fired += 1
                    logger.info(
                        "GPS frozen: vehicle=%s %d saltos max=%.0fm",
                        vehicle_id, len(jumps), max_dist,
                    )

                elif len(jumps) == 0:
                    # Sin ningun salto en la ventana: resolver si habia alerta
                    await _resolve_existing(conn, redis, vehicle_id, tenant_id, frozen_rules)
                # 1 salto: zona gris — mantener estado anterior sin cambio

            if fired:
                logger.info("Sweep frozen_gps: %d nuevas alertas", fired)

    except Exception as exc:
        logger.error("Sweep frozen_gps fallido: %s", exc, exc_info=True)
