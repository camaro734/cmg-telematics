"""Cálculo al vuelo de métricas de sensor por parada para el PDF de partes.

Las "métricas de parada" clásicas (pto_minutes, pressure_min, …) son columnas fijas
de work_order_stop que escribe el rules-engine. Para poder mostrar en el PDF
**cualquier señal del sensor_schema**, este servicio agrega la señal sobre la ventana
temporal de la parada leyendo telemetry_record (read-only), reutilizando el resolver
key→avl_<id> del detector de ciclos. NO escribe nada ni toca el rules-engine.
"""
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.cycle_detector import (
    _build_schema_index,
    _resolve_field_value,
    _ALLOWED_EXTRA_COLS,
)

__all__ = ["build_schema_index", "aggregate_rows", "fetch_stop_rows"]

# Reexport del indexador del schema (mismo que usa el detector).
build_schema_index = _build_schema_index

# Tope defensivo de filas por ventana de parada.
_MAX_ROWS = 5000


def _agg(values: list[float], aggregate: str) -> float | None:
    """Aplica el agregado a una lista de valores no nulos (en orden temporal)."""
    if not values:
        return None
    if aggregate == "max":
        return max(values)
    if aggregate == "min":
        return min(values)
    if aggregate == "avg":
        return round(sum(values) / len(values), 3)
    if aggregate == "last":
        return values[-1]
    return max(values)  # default defensivo


def aggregate_rows(
    rows: list[dict],
    sensor_metrics: list[dict],
    schema_by_key: dict[str, dict],
) -> dict[str, float | None]:
    """Agrega cada métrica de sensor sobre las filas de telemetría (ordenadas por tiempo).

    sensor_metrics: dicts con ``key`` (key del sensor_schema) y ``aggregate``
    (max|min|avg|last). Devuelve {key: valor agregado | None si no hay datos}.
    """
    out: dict[str, float | None] = {}
    for m in sensor_metrics:
        key = m["key"]
        aggregate = m.get("aggregate") or "max"
        values = [
            v for row in rows
            if (v := _resolve_field_value(key, row.get("can_data"), row, schema_by_key)) is not None
        ]
        out[key] = _agg(values, aggregate)
    return out


async def fetch_stop_rows(
    db: AsyncSession, vehicle_id, t0, t1
) -> list[dict]:
    """Telemetría del vehículo en la ventana [t0, t1) (read-only, filtro de tiempo + LIMIT)."""
    if vehicle_id is None or t0 is None or t1 is None or t1 <= t0:
        return []
    extra = ", ".join(sorted(_ALLOWED_EXTRA_COLS))  # columnas nativas para status_field
    result = await db.execute(
        text(f"""
            SELECT time AS recorded_at, can_data, {extra}
            FROM telemetry_record
            WHERE vehicle_id = :vid
              AND time >= :t0 AND time < :t1
            ORDER BY time
            LIMIT {_MAX_ROWS}
        """),
        {"vid": str(vehicle_id), "t0": t0, "t1": t1},
    )
    return [dict(row._mapping) for row in result]


async def compute_stop_sensor_metrics(
    db: AsyncSession,
    vehicle_id,
    t0,
    t1,
    sensor_metrics: list[dict],
    schema_by_key: dict[str, dict],
) -> dict[str, Any]:
    """Conveniencia: fetch + aggregate para una parada. {} si no hay ventana o métricas."""
    if not sensor_metrics or vehicle_id is None or t0 is None or t1 is None:
        return {}
    rows = await fetch_stop_rows(db, vehicle_id, t0, t1)
    if not rows:
        return {}
    return aggregate_rows(rows, sensor_metrics, schema_by_key)
