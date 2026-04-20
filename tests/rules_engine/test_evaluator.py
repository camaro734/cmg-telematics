# tests/rules_engine/test_evaluator.py
from datetime import datetime, timezone
from unittest.mock import AsyncMock
import pytest
from src.evaluator import evaluate_rule, process_message, TelemetryMsg, _check_schedule
from src.loader import Rule


def make_rule(**kwargs) -> Rule:
    defaults = dict(
        id="rule-1",
        tenant_id="tenant-1",
        name="Test",
        active=True,
        vehicle_filter={"scope": "all"},
        condition={},
        severity="warning",
        actions=[],
        escalation=[],
        schedule={"type": "always"},
        cooldown_minutes=30,
    )
    defaults.update(kwargs)
    return Rule(**defaults)


def make_msg(**kwargs) -> TelemetryMsg:
    defaults = dict(
        time=datetime(2024, 6, 15, 10, 0, 0, tzinfo=timezone.utc),
        device_id="dev-1",
        vehicle_id="veh-1",
        tenant_id="tenant-1",
        lat=39.0,
        lon=-0.4,
        speed_kmh=50.0,
        ignition=True,
        pto_active=False,
        can_data={"hydraulic_pressure_1": 230.0, "oil_temp_c": 80.0},
    )
    defaults.update(kwargs)
    return TelemetryMsg(**defaults)


# --- threshold ---

async def test_threshold_fires_when_above():
    rule = make_rule(condition={"type": "threshold", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0})
    msg = make_msg()
    redis = AsyncMock()
    result = await evaluate_rule(rule, msg, redis)
    assert result is not None
    assert result.trigger_value["value"] == 230.0


async def test_threshold_no_fire_when_below():
    rule = make_rule(condition={"type": "threshold", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0})
    msg = make_msg(can_data={"hydraulic_pressure_1": 100.0})
    redis = AsyncMock()
    result = await evaluate_rule(rule, msg, redis)
    assert result is None


async def test_threshold_missing_field_no_fire():
    rule = make_rule(condition={"type": "threshold", "field": "nonexistent_field", "op": ">", "value": 10.0})
    msg = make_msg(can_data={})
    redis = AsyncMock()
    result = await evaluate_rule(rule, msg, redis)
    assert result is None


# --- threshold_sustained ---

async def test_threshold_sustained_starts_timer_first_occurrence():
    rule = make_rule(condition={"type": "threshold_sustained", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0, "minutes": 5})
    msg = make_msg()
    redis = AsyncMock()
    redis.hget.return_value = None  # no timer yet
    result = await evaluate_rule(rule, msg, redis)
    assert result is None  # first occurrence: timer started, not fired
    redis.hset.assert_called_once()  # timer was set


async def test_threshold_sustained_fires_after_duration():
    rule = make_rule(condition={"type": "threshold_sustained", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0, "minutes": 5})
    ts = datetime(2024, 6, 15, 10, 0, 0, tzinfo=timezone.utc)
    msg = make_msg(time=ts)
    redis = AsyncMock()
    start = ts.timestamp() - 600  # 10 minutes ago
    redis.hget.return_value = str(start)
    result = await evaluate_rule(rule, msg, redis)
    assert result is not None


async def test_threshold_sustained_clears_when_condition_not_met():
    rule = make_rule(condition={"type": "threshold_sustained", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0, "minutes": 5})
    msg = make_msg(can_data={"hydraulic_pressure_1": 100.0})  # below threshold
    redis = AsyncMock()
    await evaluate_rule(rule, msg, redis)
    redis.hdel.assert_called_once()  # timer cleared


# --- accumulation ---

async def test_accumulation_fires_when_limit_reached():
    rule = make_rule(condition={"type": "accumulation", "field": "pto_active", "increment_when": True, "limit": 3})
    msg = make_msg(pto_active=True)
    redis = AsyncMock()
    redis.incrbyfloat.return_value = 3.0  # limit reached
    result = await evaluate_rule(rule, msg, redis)
    assert result is not None


async def test_accumulation_no_fire_below_limit():
    rule = make_rule(condition={"type": "accumulation", "field": "pto_active", "increment_when": True, "limit": 10})
    msg = make_msg(pto_active=True)
    redis = AsyncMock()
    redis.incrbyfloat.return_value = 2.0  # below limit
    result = await evaluate_rule(rule, msg, redis)
    assert result is None


# --- composite ---

async def test_composite_and_fires_when_both_conditions_met():
    rule = make_rule(condition={
        "type": "composite",
        "op": "AND",
        "conditions": [
            {"type": "threshold", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0},
            {"type": "threshold", "field": "oil_temp_c", "op": ">", "value": 70.0},
        ],
    })
    msg = make_msg(can_data={"hydraulic_pressure_1": 230.0, "oil_temp_c": 80.0})
    redis = AsyncMock()
    result = await evaluate_rule(rule, msg, redis)
    assert result is not None


async def test_composite_and_no_fire_when_one_fails():
    rule = make_rule(condition={
        "type": "composite",
        "op": "AND",
        "conditions": [
            {"type": "threshold", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0},
            {"type": "threshold", "field": "oil_temp_c", "op": ">", "value": 70.0},
        ],
    })
    msg = make_msg(can_data={"hydraulic_pressure_1": 230.0, "oil_temp_c": 50.0})
    redis = AsyncMock()
    result = await evaluate_rule(rule, msg, redis)
    assert result is None


async def test_composite_or_fires_when_any_condition_met():
    """Composite OR rule fires when at least one condition matches."""
    rule = make_rule(
        condition={
            "type": "composite",
            "op_composite": "OR",
            "conditions": [
                {"type": "threshold", "field": "hydraulic_pressure_1", "op": ">", "value": 9999.0},  # no disparará
                {"type": "threshold", "field": "hydraulic_pressure_1", "op": ">", "value": 200.0},   # disparará
            ],
        },
    )
    msg = make_msg()
    redis = AsyncMock()
    redis.exists.return_value = 0
    redis.set.return_value = True
    results = await process_message([rule], msg, redis)
    assert len(results) == 1


# --- schedule filter ---

def test_schedule_always_returns_true():
    assert _check_schedule({"type": "always"}, datetime.now(timezone.utc)) is True


def test_schedule_time_window_active_hours():
    ts = datetime(2024, 6, 17, 10, 0, tzinfo=timezone.utc)  # Monday 10:00
    sched = {"type": "time_window", "days": [0, 1, 2, 3, 4], "start": "08:00", "end": "18:00"}
    assert _check_schedule(sched, ts) is True


def test_schedule_time_window_outside_hours():
    ts = datetime(2024, 6, 17, 22, 0, tzinfo=timezone.utc)  # Monday 22:00
    sched = {"type": "time_window", "days": [0, 1, 2, 3, 4], "start": "08:00", "end": "18:00"}
    assert _check_schedule(sched, ts) is False


# --- cooldown + vehicle filter in process_message ---

async def test_process_message_respects_cooldown():
    rule = make_rule(condition={"type": "threshold", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0})
    msg = make_msg()
    redis = AsyncMock()
    redis.exists.return_value = 1  # in cooldown
    results = await process_message([rule], msg, redis)
    assert results == []


async def test_process_message_skips_wrong_tenant():
    rule = make_rule(tenant_id="other-tenant")
    msg = make_msg(tenant_id="tenant-1")
    redis = AsyncMock()
    redis.exists.return_value = 0
    results = await process_message([rule], msg, redis)
    assert results == []


# --- vehicle_filter scope:"type" ---

async def test_process_message_scope_type_matches_vehicle():
    rule = make_rule(
        condition={"type": "threshold", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0},
        vehicle_filter={"scope": "type", "vehicle_type_id": "vtype-vacuum"},
    )
    msg = make_msg()
    redis = AsyncMock()
    redis.exists.return_value = 0
    redis.set.return_value = True
    vehicle_type_map = {"veh-1": "vtype-vacuum"}
    results = await process_message([rule], msg, redis, vehicle_type_map=vehicle_type_map)
    assert len(results) == 1


async def test_process_message_scope_type_skips_wrong_type():
    rule = make_rule(
        condition={"type": "threshold", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0},
        vehicle_filter={"scope": "type", "vehicle_type_id": "vtype-sweeper"},
    )
    msg = make_msg()
    redis = AsyncMock()
    redis.exists.return_value = 0
    vehicle_type_map = {"veh-1": "vtype-vacuum"}
    results = await process_message([rule], msg, redis, vehicle_type_map=vehicle_type_map)
    assert results == []


async def test_process_message_scope_type_skips_when_no_map():
    """When vehicle_type_map is not provided, scope:'type' rules are skipped."""
    rule = make_rule(
        condition={"type": "threshold", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0},
        vehicle_filter={"scope": "type", "vehicle_type_id": "vtype-vacuum"},
    )
    msg = make_msg()
    redis = AsyncMock()
    redis.exists.return_value = 0
    results = await process_message([rule], msg, redis)
    assert results == []
