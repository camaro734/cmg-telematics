"""Detección de vehículo mudo (Art. 5 GDPR / operacional).

Barrido periódico que detecta vehículos sin telemetría durante más tiempo
del umbral adaptativo según ignición. Crea una alert_instance de tipo
'silence' visible en Alertas. Se auto-resuelve cuando vuelve el primer
paquete.
"""
import json
import logging
import uuid
from datetime import datetime, timezone

import asyncpg
from redis.asyncio import Redis

from src.config import settings

logger = logging.getLogger(__name__)

_SILENCE_KEY = "silence:firing:{vehicle_id}"
_STREAM_KEY  = "telemetry.raw"


async def _publish_alert_ws(
    redis: Redis,
    action: str,
    alert_id: str,
    tenant_id: str,
    vehicle_id: str,
) -> None:
    """Notifica al frontend vía telemetry.raw para que invalide la caché de alertas."""
    await redis.xadd(
        _STREAM_KEY,
        {"payload": json.dumps({
            "_ws_type":  "alert",
            "action":    action,
            "tenant_id": tenant_id,
            "alert_id":  alert_id,
            "vehicle_id": vehicle_id,
        })},
        maxlen=50_000,
        approximate=True,
    )


def _silence_key(vehicle_id: str) -> str:
    return _SILENCE_KEY.format(vehicle_id=vehicle_id)


async def _ensure_silence_rule(conn: asyncpg.Connection, tenant_id: str) -> str:
    """Garantiza UNA regla __silence__ por tenant. Idempotente."""
    row = await conn.fetchrow(
        """
        SELECT id::text FROM alert_rule
        WHERE tenant_id = $1::uuid AND condition->>'type' = 'silence'
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
             'Sistema: vehículo sin reportar',
             '{"type":"silence"}'::jsonb,
             '{"scope":"all"}'::jsonb,
             'critical', '[]'::jsonb, '[]'::jsonb, '{"type":"always"}'::jsonb,
             false, 0, now())
        """,
        rule_id,
        tenant_id,
    )
    logger.info("Regla __silence__ creada para tenant=%s rule=%s", tenant_id, rule_id)
    return rule_id


async def maybe_resolve_silence(
    conn: asyncpg.Connection,
    redis: Redis,
    vehicle_id: str,
    tenant_id: str,
) -> None:
    """Llamar desde _process_one cuando llega un paquete.

    Fast-path: si no hay Redis key de silencio activo, retorna sin tocar BD.
    Si la hay: resuelve la alert_instance firing y limpia la key.
    """
    key = _silence_key(vehicle_id)
    if not await redis.exists(key):
        return

    row = await conn.fetchrow(
        """
        SELECT id::text FROM alert_rule
        WHERE tenant_id = $1::uuid AND condition->>'type' = 'silence'
        LIMIT 1
        """,
        tenant_id,
    )
    if not row:
        await redis.delete(key)
        return

    resolved_rows = await conn.fetch(
        """
        UPDATE alert_instance
        SET status = 'resolved', resolved_at = now()
        WHERE vehicle_id = $1::uuid
          AND rule_id    = $2::uuid
          AND status     = 'firing'
        RETURNING id::text
        """,
        vehicle_id,
        row["id"],
    )
    await redis.delete(key)
    for r in resolved_rows:
        await _publish_alert_ws(redis, "resolved", r["id"], tenant_id, vehicle_id)
    logger.info("Silencio resuelto: vehicle=%s (%d alertas)", vehicle_id, len(resolved_rows))


async def sweep_silent_vehicles(db_pool: asyncpg.Pool, redis: Redis) -> None:
    """Barrido: detecta y alerta vehículos mudos. Sin efectos si todo está OK."""
    moving_secs = settings.silence_moving_hours * 3600
    parked_secs = settings.silence_parked_hours * 3600

    try:
        async with db_pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT v.id::text    AS vehicle_id,
                       v.tenant_id::text AS tenant_id,
                       d.last_seen
                FROM   vehicle v
                JOIN   device  d ON d.vehicle_id = v.id
                                 AND d.active = true
                                 AND d.out_of_service = false
                WHERE  v.active       = true
                  AND  d.last_seen   IS NOT NULL
                """
            )

            # Mapa tenant → rule_id (construido dinámicamente para no hacer N queries)
            silence_rules: dict[str, str] = {}
            now = datetime.now(timezone.utc)
            fired = 0

            for row in rows:
                vehicle_id = row["vehicle_id"]
                tenant_id  = row["tenant_id"]
                last_seen  = row["last_seen"]
                if last_seen.tzinfo is None:
                    last_seen = last_seen.replace(tzinfo=timezone.utc)

                silence_secs = (now - last_seen).total_seconds()

                # Ignición última conocida desde Redis hash del vehículo
                ign_raw = await redis.hget(f"vehicle:{vehicle_id}:status", "ignition")
                is_moving = ign_raw in ("true", "1", b"true", b"1")
                threshold  = moving_secs if is_moving else parked_secs

                if silence_secs < threshold:
                    continue

                # Regla __silence__ del tenant
                if tenant_id not in silence_rules:
                    silence_rules[tenant_id] = await _ensure_silence_rule(conn, tenant_id)
                rule_id = silence_rules[tenant_id]

                # Dedup fuente de verdad = BD (índice vehicle_id, rule_id, status)
                existing = await conn.fetchrow(
                    """
                    SELECT id FROM alert_instance
                    WHERE vehicle_id = $1::uuid
                      AND rule_id    = $2::uuid
                      AND status     = 'firing'
                    LIMIT 1
                    """,
                    vehicle_id,
                    rule_id,
                )
                if existing:
                    # Mantener Redis key como pista de auto-resolve
                    await redis.set(
                        _silence_key(vehicle_id), "1",
                        ex=int(threshold * 3),
                    )
                    continue

                # Crear alerta
                alert_id = str(uuid.uuid4())
                trigger_value = {
                    "last_seen":     last_seen.isoformat(),
                    "silence_hours": round(silence_secs / 3600, 1),
                    "last_ignition": "on" if is_moving else "off",
                }
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
                await redis.set(
                    _silence_key(vehicle_id), "1",
                    ex=int(threshold * 3),
                )
                await _publish_alert_ws(redis, "silence", alert_id, tenant_id, vehicle_id)
                fired += 1
                logger.info(
                    "Vehículo mudo: vehicle=%s %.1fh sin reportar ignición=%s",
                    vehicle_id,
                    trigger_value["silence_hours"],
                    trigger_value["last_ignition"],
                )

            if fired:
                logger.info("Sweep silencio: %d nuevas alertas creadas", fired)

    except Exception as exc:
        logger.error("Sweep silencio fallido: %s", exc, exc_info=True)
