"""
Cierre automático de paradas de orden de trabajo por geocerca + señal CAN.

Corrutina periódica (cada 30 s) que, para cada parada activa en una orden con
auto_close_config.enabled=true, evalúa una ventana de telemetría ORDENADA por
device-time y transiciona el estado de la parada según el predicado:
    dentro_geocerca(haversine + histéresis) AND señal_activa(signal_op)

Diseño clave:
- Ventana por device-time (ORDER BY time ASC): tolerante a registros desordenados
  (buffer offline FMC650). No reactivo al stream.
- Guardado de cierre (R1): si el vehículo está mudo (último punto > freshness),
  no marca done aunque el timer se haya cumplido. Espera a que vuelva telemetría
  fresca y reevalúa la ventana completa.
- Idempotente: reevaluar la misma ventana produce el mismo resultado.
- Inerte en prod hasta que alguna orden tenga auto_close_config.enabled=true.
- Sin regresión en field_ops: _get_active_stop excluye paradas auto-close
  (guarda añadida en field_ops.py para evitar doble escritura).
"""
import logging
import operator
from datetime import datetime, timezone
from typing import Any

import asyncpg
from redis.asyncio import Redis

from src.config import settings
from src.field_ops import _haversine_m

logger = logging.getLogger(__name__)

_OPS: dict[str, Any] = {
    "==": operator.eq,
    ">":  operator.gt,
    ">=": operator.ge,
    "<":  operator.lt,
    "<=": operator.le,
}
_MAX_WINDOW_ROWS = 5_000
AUTOCLOSE_STATE_KEY = "stop:autoclose:{stop_id}:state"


def _resolve_signal(
    cfg: dict,
    row: dict,
    schema_map: dict[str, dict] | None = None,
) -> bool:
    """True si la señal del punto de telemetría cumple la condición configurada.

    Orden de resolución:
    1. top_level  — campos directos del row (pto_active, ignition, speed_kmh…).
    2. schema_map — key semántica del sensor_schema del vehículo; se traduce a
                    can_data["avl_<id>"] y se extrae el bit si hay bit_index.
    3. fallback   — acceso directo a can_data["<key>"] (claves avl_<n> explícitas).
    """
    key       = cfg["service_signal_key"]
    op_fn     = _OPS.get(cfg.get("signal_op", "=="))
    threshold = cfg.get("signal_value", True)

    top_level = {"speed_kmh", "ignition", "pto_active", "lat", "lon"}

    if key in top_level:
        value = row.get(key)
    elif schema_map and key in schema_map:
        # Señal semántica del sensor_schema → busca avl_<id> en can_data
        ch      = schema_map[key]
        avl_key = f"avl_{ch['avl_id']}"
        raw     = (row.get("can_data") or {}).get(avl_key)
        if raw is None:
            return False
        bit_index = ch.get("bit_index")
        value = bool((int(raw) >> int(bit_index)) & 1) if bit_index is not None else raw
    else:
        value = (row.get("can_data") or {}).get(key)

    if value is None or op_fn is None:
        return False
    try:
        return bool(op_fn(value, threshold))
    except (TypeError, ValueError):
        return False


def _eval_stop_window(
    rows: list[dict],
    stop: dict,
    cfg: dict,
    now: datetime,
    freshness_seconds: float,
    schema_map: dict[str, dict] | None = None,
) -> dict | None:
    """
    Evalúa la ventana de telemetría (rows ordenados por time ASC) y devuelve
    un dict de campos a actualizar en BD, o None si no hay cambio.

    Función pura — sin I/O. Segura para tests unitarios.

    Args:
        rows:              puntos de telemetría ordenados por device-time ASC.
        stop:              dict con campos del work_order_stop actual.
        cfg:               contenido de work_order.auto_close_config.
        now:               instante de evaluación (para el guardado de cierre).
        freshness_seconds: umbral de "vehículo mudo" — no cierra si el último
                           punto es más antiguo que esto.
    """
    if not rows:
        return None

    exit_margin_m  = int(cfg.get("exit_margin_m", 0))
    min_active_s   = float(cfg.get("min_active_seconds", 30))
    min_inactive_s = float(cfg.get("min_inactive_seconds", 30))
    radius_m       = int(stop["arrival_radius_m"])
    stop_lat       = float(stop["lat"])
    stop_lon       = float(stop["lon"])

    final_state           = stop["status"]
    geo_inside            = False
    signal_start_epoch:   float | None = None   # epoch del primer punto con predicado=True
    signal_off_epoch:     float | None = None   # epoch del primer punto con predicado=False (tras True)
    last_active_time:     datetime | None = None  # device-time del último predicado=True

    new_arrived_at:   datetime | None = stop.get("arrived_at")
    new_started_at:   datetime | None = stop.get("started_at")
    new_completed_at: datetime | None = None

    for row in rows:
        t: datetime = row["time"]
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        t_epoch = t.timestamp()

        lat = row.get("lat")
        lon = row.get("lon")

        if lat is not None and lon is not None:
            dist = _haversine_m(lat, lon, stop_lat, stop_lon)
            # Histéresis: para SALIR se requiere superar radius + exit_margin
            effective_r = (radius_m + exit_margin_m) if geo_inside else radius_m
            geo_inside  = dist <= effective_r

        sig_active = _resolve_signal(cfg, row, schema_map)
        predicate  = geo_inside and sig_active

        # pending → arrived: primer punto dentro de la geocerca
        if final_state == "pending" and geo_inside:
            new_arrived_at = t
            final_state = "arrived"

        # arrived → in_progress: predicado sostenido >= min_active_seconds
        if final_state == "arrived":
            if predicate:
                if signal_start_epoch is None:
                    signal_start_epoch = t_epoch
                if (t_epoch - signal_start_epoch) >= min_active_s:
                    new_started_at = datetime.fromtimestamp(signal_start_epoch, tz=timezone.utc)
                    final_state = "in_progress"
                    signal_off_epoch = None
            else:
                signal_start_epoch = None   # reset si el predicado se rompe antes del mínimo

        # in_progress → done: predicado falso sostenido >= min_inactive_seconds
        if final_state == "in_progress":
            if predicate:
                last_active_time = t
                signal_off_epoch = None
            else:
                if signal_off_epoch is None:
                    signal_off_epoch = t_epoch
                if (t_epoch - signal_off_epoch) >= min_inactive_s:
                    new_completed_at = last_active_time   # device-time del último punto activo
                    final_state = "done"

    # Guardado de cierre (R1): NO marcar done si el vehículo está mudo.
    # Si hay un hueco de cobertura, el algoritmo pudo haber disparado done basándose
    # en el silencio. Revertimos a in_progress y esperamos a que llegue telemetría
    # fresca; la siguiente pasada reevaluará la ventana completa con los datos reales.
    if final_state == "done":
        last_t = rows[-1]["time"]
        if last_t.tzinfo is None:
            last_t = last_t.replace(tzinfo=timezone.utc)
        stale_s = (now - last_t).total_seconds()
        if stale_s > freshness_seconds:
            logger.debug(
                "stop:autoclose %s — guardado de cierre: vehículo mudo %.0fs, manteniendo in_progress",
                stop.get("id", "?"), stale_s,
            )
            final_state      = "in_progress"
            new_completed_at = None

    updates: dict = {}
    if final_state != stop["status"]:
        updates["status"] = final_state
    # Solo escribir timestamps si aún no están fijados en BD (COALESCE en SQL también protege)
    if new_arrived_at is not None and stop.get("arrived_at") is None:
        updates["arrived_at"] = new_arrived_at
    if new_started_at is not None and stop.get("started_at") is None:
        updates["started_at"] = new_started_at
    if new_completed_at is not None:
        updates["completed_at"] = new_completed_at

    return updates if updates else None


async def _persist_update(
    conn: asyncpg.Connection,
    redis: Redis,
    stop_id: str,
    updates: dict,
) -> None:
    """Escribe la transición de estado en BD (asyncpg directo) y actualiza Redis cache."""
    new_status = updates.get("status")
    if new_status is None:
        return

    await conn.execute(
        """
        UPDATE work_order_stop
        SET    status        = $2,
               arrived_at   = COALESCE(arrived_at,   $3),
               started_at   = COALESCE(started_at,   $4),
               completed_at = COALESCE(completed_at, $5)
        WHERE  id     = $1::uuid
          AND  status NOT IN ('done', 'skipped')
        """,
        stop_id,
        new_status,
        updates.get("arrived_at"),
        updates.get("started_at"),
        updates.get("completed_at"),
    )
    key = AUTOCLOSE_STATE_KEY.format(stop_id=stop_id)
    await redis.set(key, new_status, ex=86_400)
    logger.info("stop:autoclose %s → %s", stop_id, new_status)


async def sweep_stop_autoclose(db_pool: asyncpg.Pool, redis: Redis) -> None:
    """Evalúa candidatos con auto_close_config.enabled y transiciona sus paradas."""
    # Reutiliza el umbral de silencio del vehículo en movimiento como referencia de frescura
    freshness_s = settings.silence_moving_hours * 3600
    now = datetime.now(timezone.utc)

    try:
        async with db_pool.acquire() as conn:
            candidates = await conn.fetch(
                """
                SELECT wos.id::text          AS id,
                       wos.status,
                       wos.lat,
                       wos.lon,
                       wos.arrival_radius_m,
                       wos.arrived_at,
                       wos.started_at,
                       wo.vehicle_id::text   AS vehicle_id,
                       wo.created_at         AS order_created_at,
                       wo.auto_close_config,
                       vt.sensor_schema      AS sensor_schema
                FROM   work_order_stop wos
                JOIN   work_order    wo  ON wo.id  = wos.work_order_id
                JOIN   vehicle       v   ON v.id   = wo.vehicle_id
                JOIN   vehicle_type  vt  ON vt.id  = v.vehicle_type_id
                WHERE  (wo.auto_close_config ->> 'enabled')::bool = true
                  AND  wos.status NOT IN ('done', 'skipped')
                  AND  wos.lat IS NOT NULL
                  AND  wos.lon IS NOT NULL
                """
            )

            if not candidates:
                return

            logger.debug("stop:autoclose sweep — %d candidatos", len(candidates))

            for stop_rec in candidates:
                try:
                    stop = dict(stop_rec)
                    cfg  = stop["auto_close_config"]
                    if not isinstance(cfg, dict):
                        continue

                    # Ventana mínima necesaria según estado actual
                    if stop["status"] == "in_progress":
                        ws = stop["started_at"] or stop["arrived_at"] or stop["order_created_at"]
                    elif stop["status"] == "arrived":
                        ws = stop["arrived_at"] or stop["order_created_at"]
                    else:
                        ws = stop["order_created_at"]

                    if ws is not None and ws.tzinfo is None:
                        ws = ws.replace(tzinfo=timezone.utc)

                    rows = [
                        dict(r)
                        for r in await conn.fetch(
                            """
                            SELECT time, lat, lon,
                                   pto_active, ignition, speed_kmh, can_data
                            FROM   telemetry_record
                            WHERE  vehicle_id = $1::uuid
                              AND  time >= $2
                            ORDER BY time ASC
                            LIMIT  $3
                            """,
                            stop["vehicle_id"],
                            ws,
                            _MAX_WINDOW_ROWS,
                        )
                    ]

                    sensor_schema = stop.get("sensor_schema") or []
                    schema_map = {
                        ch["key"]: ch
                        for ch in sensor_schema
                        if ch.get("key") and ch.get("avl_id") is not None
                    }
                    updates = _eval_stop_window(rows, stop, cfg, now, freshness_s, schema_map)
                    if updates:
                        await _persist_update(conn, redis, stop["id"], updates)

                except Exception as exc:
                    logger.error(
                        "stop:autoclose error for stop %s: %s",
                        stop_rec.get("id", "?"), exc, exc_info=True,
                    )

    except Exception as exc:
        logger.error("stop:autoclose sweep failed: %s", exc, exc_info=True)
