import logging
import operator
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from src.loader import Rule
from src.state import (
    is_in_cooldown,
    set_cooldown,
    get_sustained_start,
    set_sustained_start,
    clear_sustained_start,
    get_accumulator,
    increment_accumulator,
)

logger = logging.getLogger(__name__)

# Map operator strings to callable comparators
_OPS: dict[str, Any] = {
    ">":  operator.gt,
    "<":  operator.lt,
    ">=": operator.ge,
    "<=": operator.le,
    "==": operator.eq,
    "!=": operator.ne,
}


@dataclass
class TelemetryMsg:
    time: datetime
    device_id: str
    vehicle_id: str
    tenant_id: str
    lat: float
    lon: float
    speed_kmh: float
    ignition: bool
    pto_active: bool
    can_data: dict = field(default_factory=dict)


@dataclass
class RuleMatch:
    rule: Rule
    vehicle_id: str
    trigger_value: dict


def _get_field(msg: TelemetryMsg, field_name: str) -> Any:
    """Retrieve a field from top-level TelemetryMsg attributes or from can_data."""
    # Check top-level fields first
    top_level = ("speed_kmh", "ignition", "pto_active", "lat", "lon")
    if field_name in top_level:
        return getattr(msg, field_name, None)
    # Fall back to can_data
    return msg.can_data.get(field_name)


def _apply_op(value: Any, op: str, threshold: Any) -> bool:
    """Apply a comparison operator to value vs threshold."""
    fn = _OPS.get(op)
    if fn is None:
        return False
    return fn(value, threshold)


def _check_schedule(schedule: dict, ts: datetime) -> bool:
    """
    Returns True if ts falls within the schedule window.

    schedule types:
      - {"type": "always"}
      - {"type": "time_window", "days": [0..6], "start": "HH:MM", "end": "HH:MM"}
        days: 0=Monday ... 6=Sunday (Python weekday convention)
    """
    sched_type = schedule.get("type", "always")
    if sched_type == "always":
        return True
    if sched_type == "time_window":
        days = schedule.get("days", list(range(7)))
        start_str = schedule.get("start", "00:00")
        end_str = schedule.get("end", "23:59")
        # Convert ts to UTC weekday and time
        weekday = ts.weekday()  # 0=Monday
        if weekday not in days:
            return False
        start_h, start_m = (int(p) for p in start_str.split(":"))
        end_h, end_m = (int(p) for p in end_str.split(":"))
        current_minutes = ts.hour * 60 + ts.minute
        start_minutes = start_h * 60 + start_m
        end_minutes = end_h * 60 + end_m
        return start_minutes <= current_minutes < end_minutes
    # Unknown type — default to active
    return True


async def _eval_condition(cond: dict, rule: Rule, msg: TelemetryMsg, redis: Any) -> RuleMatch | None:
    """
    Evaluate a single condition dict.
    Returns a RuleMatch on fire, None otherwise.
    """
    cond_type = cond.get("type")

    if cond_type == "threshold":
        field_name = cond["field"]
        op = cond["op"]
        threshold = cond["value"]
        value = _get_field(msg, field_name)
        if value is None:
            return None
        if _apply_op(value, op, threshold):
            return RuleMatch(rule=rule, vehicle_id=msg.vehicle_id, trigger_value={"field": field_name, "value": value})
        return None

    if cond_type == "threshold_sustained":
        field_name = cond["field"]
        op = cond["op"]
        threshold = cond["value"]
        minutes = cond["minutes"]
        value = _get_field(msg, field_name)
        if value is None:
            return None

        if _apply_op(value, op, threshold):
            # Condition is currently met — check sustained timer
            start = await get_sustained_start(redis, rule.id, msg.vehicle_id)
            if start is None:
                # First time condition is met — record start timestamp
                await set_sustained_start(redis, rule.id, msg.vehicle_id, msg.time.timestamp())
                return None
            # Timer already running — check duration
            elapsed_minutes = (msg.time.timestamp() - start) / 60.0
            if elapsed_minutes >= minutes:
                return RuleMatch(rule=rule, vehicle_id=msg.vehicle_id, trigger_value={"field": field_name, "value": value, "elapsed_minutes": elapsed_minutes})
            return None
        else:
            # Condition no longer met — clear the sustained timer
            await clear_sustained_start(redis, rule.id, msg.vehicle_id)
            return None

    if cond_type == "accumulation":
        val = _get_field(msg, cond["field"])
        if val is not None:
            increment_when = bool(cond.get("increment_when", True))
            if increment_when:
                should_increment = bool(val)
            else:
                should_increment = not bool(val)

            if should_increment:
                total = await increment_accumulator(redis, rule.id, msg.vehicle_id, 1.0)
            else:
                total = await get_accumulator(redis, rule.id, msg.vehicle_id)

            if total >= float(cond.get("limit", float("inf"))):
                return RuleMatch(rule=rule, vehicle_id=msg.vehicle_id, trigger_value={"field": cond["field"], "accumulated": total})
        return None

    if cond_type == "composite":
        op = cond.get("op_composite") or cond.get("op", "AND")
        if op == "AND":
            for sub in cond.get("conditions", []):
                r = await _eval_condition(sub, rule, msg, redis)
                if r is None:
                    return None
            return RuleMatch(rule=rule, vehicle_id=msg.vehicle_id, trigger_value={"composite_op": op})
        else:  # OR
            for sub in cond.get("conditions", []):
                r = await _eval_condition(sub, rule, msg, redis)
                if r is not None:
                    return RuleMatch(rule=rule, vehicle_id=msg.vehicle_id, trigger_value={"composite_op": op})
        return None

    if cond_type == "schedule":
        # Fires when the sensor is in an unexpected state outside the defined schedule
        field_name = cond.get("field")
        expected_outside = cond.get("expected_outside")
        schedule = cond.get("schedule", {"type": "always"})
        value = _get_field(msg, field_name)
        in_schedule = _check_schedule(schedule, msg.time)
        if not in_schedule and value != expected_outside:
            return RuleMatch(rule=rule, vehicle_id=msg.vehicle_id, trigger_value={"field": field_name, "value": value})
        return None

    # Unknown condition type — do not fire
    return None


async def evaluate_rule(rule: Rule, msg: TelemetryMsg, redis: Any) -> RuleMatch | None:
    """
    Evaluate a single rule against a telemetry message.
    Checks schedule first, then delegates to _eval_condition.
    Does NOT check cooldown — that is handled in process_message.
    """
    # Schedule check
    if not _check_schedule(rule.schedule, msg.time):
        return None

    return await _eval_condition(rule.condition, rule, msg, redis)


async def process_message(
    rules: list[Rule],
    msg: TelemetryMsg,
    redis: Any,
    vehicle_type_map: dict[str, str] | None = None,
) -> list[RuleMatch]:
    """
    Process a telemetry message against all applicable rules.

    Filters applied (in order):
    1. tenant_id match
    2. vehicle_filter scope
    3. cooldown check
    4. rule evaluation
    """
    matches: list[RuleMatch] = []

    for rule in rules:
        # 1. Tenant isolation
        if rule.tenant_id != msg.tenant_id:
            continue

        # 2. Vehicle filter
        scope = rule.vehicle_filter.get("scope", "all")
        if scope == "all":
            pass
        elif scope == "vehicle":
            if rule.vehicle_filter.get("vehicle_id") != msg.vehicle_id:
                continue
        elif scope == "type":
            if vehicle_type_map is None:
                logger.warning(
                    "vehicle_type_map not provided — skipping scope:type rule %s", rule.id
                )
                continue
            vehicle_type_id = vehicle_type_map.get(msg.vehicle_id)
            if vehicle_type_id is None:
                # vehicle not yet in map (new vehicle or map stale) — skip safely
                continue
            if vehicle_type_id != rule.vehicle_filter.get("vehicle_type_id"):
                continue
        else:
            logger.warning(
                "Unknown vehicle_filter scope %r for rule %s, skipping", scope, rule.id
            )
            continue

        # 3. Cooldown check
        in_cooldown = await is_in_cooldown(redis, rule.id, msg.vehicle_id)
        if in_cooldown:
            continue

        # 4. Evaluate rule
        match = await evaluate_rule(rule, msg, redis)
        if match is not None:
            await set_cooldown(redis, rule.id, msg.vehicle_id, rule.cooldown_minutes)
            matches.append(match)

    return matches
