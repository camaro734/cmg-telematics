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
from sqlalchemy import text

from app.models.work_cycle import WorkCycleDefinition, WorkCycle


# Whitelist of allowed extra columns in _query_telemetry.
# Protection against accidental exposure of non-scoped fields in future changes.
_ALLOWED_EXTRA_COLS = frozenset({"pto_active", "ignition"})


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
        groups = _group_threshold_periods(rows, sensor, threshold, operator)
    elif trigger_type == "sensor_pulse":
        sensor = config.get("sensor", "")
        min_gap = int(config.get("min_gap_seconds", 30))
        rows = await _query_telemetry(db, vehicle_id, from_dt, to_dt, extra_cols=[])
        groups = _detect_pulses(rows, sensor, min_gap)
    else:
        return 0

    snapshot_fields: list[str] = definition.snapshot_fields or []
    aggregate_fields: list[str] = definition.aggregate_fields or []
    is_pulse = trigger_type == "sensor_pulse"

    for g in groups:
        group_rows = g["rows"]
        if not group_rows:
            continue
        cycle_data = _build_cycle_data(group_rows, snapshot_fields, aggregate_fields)
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
    rows: list[dict], sensor: str, threshold: float, op: str
) -> list[dict]:
    def matches(row: dict) -> bool:
        raw = (row.get("can_data") or {}).get(sensor)
        if raw is None:
            return False
        try:
            v = float(raw)
        except (TypeError, ValueError):
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
    rows: list[dict], sensor: str, min_gap_seconds: int
) -> list[dict]:
    pulses: list[dict] = []
    last_t: datetime | None = None
    for row in rows:
        val = (row.get("can_data") or {}).get(sensor)
        if val in (True, "true", "1", 1):
            t: datetime = row["recorded_at"]
            if last_t is None or (t - last_t).total_seconds() >= min_gap_seconds:
                pulses.append({"rows": [row]})
                last_t = t
    return pulses


def _build_cycle_data(
    rows: list[dict],
    snapshot_fields: list[str],
    aggregate_fields: list[str],
) -> dict[str, Any]:
    data: dict[str, Any] = {}
    if not rows:
        return data

    can_start = rows[0].get("can_data") or {}
    can_end = rows[-1].get("can_data") or {}

    for field in snapshot_fields:
        if (v := can_start.get(field)) is not None:
            data[f"{field}_start"] = v
        if (v := can_end.get(field)) is not None:
            data[f"{field}_end"] = v

    for field in aggregate_fields:
        values = []
        for row in rows:
            raw = (row.get("can_data") or {}).get(field)
            if raw is not None:
                try:
                    values.append(float(raw))
                except (TypeError, ValueError):
                    pass
        if values:
            data[f"{field}_sum"] = round(sum(values), 3)
            data[f"{field}_avg"] = round(sum(values) / len(values), 3)
            data[f"{field}_max"] = round(max(values), 3)

    return data
