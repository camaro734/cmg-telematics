"""Retroactive work cycle detection from telemetry_record.

detect_and_store_cycles() is the public entry point. It queries telemetry_record
for the given vehicle+period, groups records into cycles per trigger_type, builds
cycle_data from snapshot/aggregate fields, and writes work_cycle rows to the DB.
"""
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from app.models.work_cycle import WorkCycleDefinition, WorkCycle
from app.models.vehicle_type import VehicleType
from app.services.sensor_transform import apply_transform


# Whitelist of allowed extra columns in _query_telemetry.
# Protection against accidental exposure of non-scoped fields in future changes.
# status_field de sensor_schema puede apuntar a estas columnas nativas del row.
_ALLOWED_EXTRA_COLS = frozenset({"pto_active", "ignition", "ext_voltage_mv", "speed_kmh"})

# Valores "not available" del estándar J1939 (1/2/4 bytes). Espejo de
# frontend/src/lib/sensorValue.ts::J1939_NA.
_J1939_NA = frozenset({0xFF, 0xFFFF, 0xFFFFFFFF})


def _build_schema_index(sensor_schema: list | None) -> dict[str, dict]:
    """Indexa el sensor_schema por su ``key`` para resolver señales por nombre."""
    index: dict[str, dict] = {}
    for s in sensor_schema or []:
        if isinstance(s, dict) and s.get("key"):
            index[s["key"]] = s
    return index


def _resolve_field_value(
    field: str, can_data: dict | None, row: dict, schema_by_key: dict[str, dict]
) -> float | None:
    """Resuelve el valor físico de un ``field`` (key de sensor_schema) en una fila.

    Traduce ``key`` → ``avl_<id>`` (o columna nativa vía ``status_field``), aplica
    ``bit_index`` para señales digitales y ``apply_transform`` (scale/transform)
    para analógicas. Espejo de ``frontend/src/lib/sensorValue.ts``.
    Fallback retrocompatible: si ``field`` no está en el schema, se busca como clave
    directa de ``can_data`` (comportamiento legado para definiciones antiguas/tests).
    """
    sensor = schema_by_key.get(field)
    can = can_data or {}
    if sensor is None:
        return _to_float(can.get(field))

    status_field = sensor.get("status_field")
    if status_field:
        val = row.get(status_field)
        if isinstance(val, bool):
            return 1.0 if val else 0.0
        return _to_float(val)

    avl_id = sensor.get("avl_id")
    if avl_id is None:
        return None
    raw = _to_float(can.get(f"avl_{avl_id}"))
    if raw is None:
        return None
    if raw in _J1939_NA or raw in (sensor.get("invalid_values") or []):
        return None

    bit_index = sensor.get("bit_index")
    if bit_index is not None:
        return float((int(raw) >> int(bit_index)) & 1)
    return apply_transform(raw, sensor)


def _to_float(raw: Any) -> float | None:
    if raw is None or isinstance(raw, bool):
        return 1.0 if raw is True else (0.0 if raw is False else None)
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


async def detect_and_store_cycles(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    tenant_id: uuid.UUID,
    definition: WorkCycleDefinition,
    from_dt: datetime,
    to_dt: datetime,
) -> int:
    """Detect cycles and persist them. Returns number of cycles written."""
    await db.execute(
        text("""
            DELETE FROM work_cycle
            WHERE vehicle_id = :vid AND definition_id = :did
              AND tenant_id = :tid
              AND started_at >= :from_dt AND started_at < :to_dt
        """),
        {"vid": str(vehicle_id), "did": str(definition.id), "tid": str(tenant_id), "from_dt": from_dt, "to_dt": to_dt},
    )

    trigger_type = definition.trigger_type
    config = definition.trigger_config or {}

    # Catálogo de señales del tipo de vehículo: necesario para traducir los nombres
    # (key) de las definiciones a las claves reales avl_<id> de can_data.
    sensor_schema = await db.scalar(
        select(VehicleType.sensor_schema).where(VehicleType.id == definition.vehicle_type_id)
    )
    schema_by_key = _build_schema_index(sensor_schema)

    if trigger_type == "pto_change":
        rows = await _query_telemetry(db, vehicle_id, from_dt, to_dt, extra_cols=["pto_active"])
        groups = _group_boolean_periods(rows, "pto_active", True)
    elif trigger_type == "ignition_period":
        rows = await _query_telemetry(db, vehicle_id, from_dt, to_dt, extra_cols=["ignition"])
        groups = _group_boolean_periods(rows, "ignition", True)
    elif trigger_type == "threshold_exceeded":
        sensor = config.get("sensor", "")
        threshold = float(config.get("threshold", 0))
        operator = config.get("op", ">")
        rows = await _query_telemetry(db, vehicle_id, from_dt, to_dt, extra_cols=[])
        groups = _group_threshold_periods(rows, sensor, threshold, operator, schema_by_key)
    elif trigger_type == "sensor_pulse":
        sensor = config.get("sensor", "")
        min_gap = int(config.get("min_gap_seconds", 30))
        rows = await _query_telemetry(db, vehicle_id, from_dt, to_dt, extra_cols=[])
        groups = _detect_pulses(rows, sensor, min_gap, schema_by_key)
    else:
        return 0

    snapshot_fields: list[str] = definition.snapshot_fields or []
    aggregate_fields: list[str] = definition.aggregate_fields or []
    is_pulse = trigger_type == "sensor_pulse"

    for g in groups:
        group_rows = g["rows"]
        if not group_rows:
            continue
        cycle_data = _build_cycle_data(group_rows, snapshot_fields, aggregate_fields, schema_by_key)
        start_row = group_rows[0]
        end_row = group_rows[-1]
        started_at: datetime = start_row["recorded_at"]
        ended_at: datetime | None = None if is_pulse else end_row["recorded_at"]
        duration: int | None = (
            None if is_pulse
            else int((end_row["recorded_at"] - started_at).total_seconds())
        )
        db.add(WorkCycle(
            vehicle_id=vehicle_id,
            definition_id=definition.id,
            tenant_id=tenant_id,
            started_at=started_at,
            ended_at=ended_at,
            duration_seconds=duration,
            cycle_data=cycle_data,
            lat=start_row.get("lat"),
            lon=start_row.get("lon"),
        ))

    await db.commit()
    return len(groups)


async def _query_telemetry(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    from_dt: datetime,
    to_dt: datetime,
    extra_cols: list[str],
) -> list[dict]:
    safe_extras = [c for c in extra_cols if c in _ALLOWED_EXTRA_COLS]
    col_list = ", ".join(["time AS recorded_at", "lat", "lon", "can_data"] + safe_extras)
    result = await db.execute(
        text(f"""
            SELECT {col_list}
            FROM telemetry_record
            WHERE vehicle_id = :vid
              AND time >= :from_dt AND time < :to_dt
            ORDER BY time
        """),
        {"vid": str(vehicle_id), "from_dt": from_dt, "to_dt": to_dt},
    )
    return [dict(row._mapping) for row in result]


def _group_boolean_periods(rows: list[dict], col: str, active_value: bool) -> list[dict]:
    cycles: list[dict] = []
    current: list[dict] = []
    for row in rows:
        if row.get(col) == active_value:
            current.append(row)
        else:
            if current:
                cycles.append({"rows": current})
                current = []
    if current:
        cycles.append({"rows": current})
    return cycles


def _group_threshold_periods(
    rows: list[dict], sensor: str, threshold: float, op: str, schema_by_key: dict[str, dict]
) -> list[dict]:
    def matches(row: dict) -> bool:
        v = _resolve_field_value(sensor, row.get("can_data"), row, schema_by_key)
        if v is None:
            return False
        if op == ">":   return v > threshold
        if op == ">=":  return v >= threshold
        if op == "<":   return v < threshold
        if op == "<=":  return v <= threshold
        return v == threshold

    cycles: list[dict] = []
    current: list[dict] = []
    for row in rows:
        if matches(row):
            current.append(row)
        else:
            if current:
                cycles.append({"rows": current})
                current = []
    if current:
        cycles.append({"rows": current})
    return cycles


def _detect_pulses(
    rows: list[dict], sensor: str, min_gap_seconds: int, schema_by_key: dict[str, dict]
) -> list[dict]:
    pulses: list[dict] = []
    last_t: datetime | None = None
    for row in rows:
        val = _resolve_field_value(sensor, row.get("can_data"), row, schema_by_key)
        if val is not None and val != 0:
            t: datetime = row["recorded_at"]
            if last_t is None or (t - last_t).total_seconds() >= min_gap_seconds:
                pulses.append({"rows": [row]})
                last_t = t
    return pulses


def _build_cycle_data(
    rows: list[dict],
    snapshot_fields: list[str],
    aggregate_fields: list[str],
    schema_by_key: dict[str, dict],
) -> dict[str, Any]:
    """Construye cycle_data resolviendo cada field (key de sensor_schema) a su valor
    físico (avl_<id> traducido + bit_index/transform). Ver _resolve_field_value."""
    data: dict[str, Any] = {}
    if not rows:
        return data

    first, last = rows[0], rows[-1]
    for field in snapshot_fields:
        if (v := _resolve_field_value(field, first.get("can_data"), first, schema_by_key)) is not None:
            data[f"{field}_start"] = v
        if (v := _resolve_field_value(field, last.get("can_data"), last, schema_by_key)) is not None:
            data[f"{field}_end"] = v

    for field in aggregate_fields:
        values = [
            v for row in rows
            if (v := _resolve_field_value(field, row.get("can_data"), row, schema_by_key)) is not None
        ]
        if values:
            data[f"{field}_sum"] = round(sum(values), 3)
            data[f"{field}_avg"] = round(sum(values) / len(values), 3)
            data[f"{field}_max"] = round(max(values), 3)
            data[f"{field}_min"] = round(min(values), 3)

    return data
