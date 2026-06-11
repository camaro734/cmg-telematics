"""
Tests de Mantenimiento v2 — Pieza M2, Commit 3.

Verifica:
1. get_plan_projection devuelve days_remaining correcto cuando hay uso histórico.
2. get_plan_projection devuelve days_remaining=None cuando current=0.
3. El notifier procesa correctamente un plan con contador CAN (pump_hours).
4. El notifier aísla fallos de un plan CAN y continúa con los demás.
"""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1.maintenance import _compute_progress
from app.schemas.maintenance import MaintenanceProgress, ThresholdProgress


# ── Helpers ───────────────────────────────────────────────────────────────────

VEHICLE_ID = uuid.uuid4()
VEHICLE_TYPE_ID = uuid.uuid4()
TENANT_ID = uuid.uuid4()


def _make_plan(thresholds: list[dict], created_at: datetime | None = None) -> MagicMock:
    plan = MagicMock()
    plan.id = uuid.uuid4()
    plan.vehicle_id = VEHICLE_ID
    plan.tenant_id = TENANT_ID
    plan.created_at = created_at or datetime(2026, 1, 1, tzinfo=timezone.utc)
    plan.trigger_condition = {"thresholds": thresholds}
    plan.warn_before_pct = 10
    return plan


def _make_vtype_cisterna() -> MagicMock:
    vtype = MagicMock()
    vtype.id = VEHICLE_TYPE_ID
    vtype.maintenance_counters = [
        {"type": "pto_hours", "label": "PTO", "unit": "h",
         "source_type": "telemetry_1h", "source_key": "pto_active_minutes", "semantics": "sum"},
        {"type": "pump_hours", "label": "Bomba", "unit": "h",
         "source_type": "can_data", "source_key": "avl_148", "semantics": "sum"},
        {"type": "odometer_km", "label": "Odómetro", "unit": "km",
         "source_type": "can_data", "source_key": "avl_10314", "semantics": "max_minus_min"},
    ]
    return vtype


# ── Test 1: proyección con uso real ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_projection_days_remaining_calculated():
    """Proyección con tasa de uso: días restantes = (limit - current) / rate_per_day."""
    from app.api.v1.maintenance import get_plan_projection

    plan_id = uuid.uuid4()
    plan = _make_plan(
        [{"type": "pump_hours", "value": 100.0}],
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    plan.id = plan_id

    vehicle = MagicMock()
    vehicle.id = VEHICLE_ID
    vehicle.vehicle_type_id = VEHICLE_TYPE_ID
    vtype = _make_vtype_cisterna()

    # _compute_progress devuelve 50h usadas de 100h límite
    mock_progress = MaintenanceProgress(
        status="ok",
        thresholds=[ThresholdProgress(type="pump_hours", current=50.0, limit=100.0, pct=50.0)],
    )

    async def fake_execute(stmt, params=None):
        sql = str(stmt)
        if "maintenance_log" in sql.lower() or "performed_at" in sql.lower():
            r = MagicMock()
            r.scalar_one_or_none = MagicMock(return_value=None)
            return r
        r = MagicMock()
        r.scalar_one = MagicMock(return_value=50.0)
        return r

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(side_effect=fake_execute)
    mock_db.get = AsyncMock(side_effect=lambda model, pk: plan if pk == plan_id else vehicle)

    with patch("app.api.v1.maintenance._compute_progress", AsyncMock(return_value=mock_progress)):
        with patch("app.api.v1.maintenance.assert_can_access_vehicle", AsyncMock(return_value=vehicle)):
            from fastapi import Request
            from app.schemas.auth import CurrentUser

            user = CurrentUser(
                user_id=uuid.uuid4(),
                tenant_id=TENANT_ID,
                tenant_tier="cmg",
                role="admin",
                email="test@test.com",
            )
            result = await get_plan_projection(plan_id, user=user, _=None, db=mock_db)

    assert result.status == "ok"
    assert len(result.thresholds) == 1
    tp = result.thresholds[0]
    assert tp.type == "pump_hours"
    assert tp.current == 50.0
    assert tp.days_remaining is not None
    assert tp.days_remaining >= 0


# ── Test 2: proyección con current=0 → days_remaining=None ───────────────────

@pytest.mark.asyncio
async def test_projection_days_remaining_none_when_no_usage():
    """Si current=0 no hay tasa calculable → days_remaining=None."""
    mock_progress = MaintenanceProgress(
        status="ok",
        thresholds=[ThresholdProgress(type="pump_hours", current=0.0, limit=100.0, pct=0.0)],
    )
    from app.api.v1.maintenance import get_plan_projection

    plan_id = uuid.uuid4()
    plan = _make_plan([{"type": "pump_hours", "value": 100.0}])
    plan.id = plan_id
    vehicle = MagicMock()

    mock_db = AsyncMock()
    mock_db.get = AsyncMock(return_value=plan)

    with patch("app.api.v1.maintenance._compute_progress", AsyncMock(return_value=mock_progress)):
        with patch("app.api.v1.maintenance.assert_can_access_vehicle", AsyncMock(return_value=vehicle)):
            from app.schemas.auth import CurrentUser
            user = CurrentUser(
                user_id=uuid.uuid4(), tenant_id=TENANT_ID, tenant_tier="cmg",
                role="admin", email="test@test.com",
            )
            result = await get_plan_projection(plan_id, user=user, _=None, db=mock_db)

    assert result.thresholds[0].days_remaining is None


# ── Test 3: notifier procesa plan con contador CAN ────────────────────────────

@pytest.mark.asyncio
async def test_notifier_processes_can_counter_plan():
    """El notifier debe procesar planes con pump_hours igual que con pto_hours."""
    from app.core.maintenance_notifier import _check_and_notify

    plan_id = uuid.uuid4()
    processed = []

    async def fake_compute(plan, db, baselines=None):
        processed.append(plan.id)
        return MaintenanceProgress(status="ok", thresholds=[])

    mock_plan = MagicMock()
    mock_plan.id = plan_id
    mock_plan.active = True
    mock_plan.tenant_id = uuid.uuid4()
    mock_plan.vehicle_id = uuid.uuid4()
    mock_plan.trigger_condition = {"thresholds": [{"type": "pump_hours", "value": 200.0}]}

    class FakeQueryResult:
        def __iter__(self):
            return iter([(plan_id,)])

    async def fake_db_get(model, pk):
        if pk == plan_id:
            return mock_plan
        return None

    mock_db = AsyncMock()
    mock_db.get = AsyncMock(side_effect=fake_db_get)
    mock_db.execute = AsyncMock(return_value=FakeQueryResult())
    mock_db.commit = AsyncMock()

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_db)
    mock_cm.__aexit__ = AsyncMock(return_value=False)
    mock_redis = AsyncMock()

    with patch("app.core.maintenance_notifier.AsyncSessionLocal", return_value=mock_cm):
        with patch("app.api.v1.maintenance._compute_progress", fake_compute):
            with patch("app.api.v1.maintenance._ensure_maintenance_rule",
                       AsyncMock(return_value=uuid.uuid4())):
                with patch("app.api.v1.maintenance._resolve_maintenance_alert_for_plan",
                           AsyncMock()):
                    await _check_and_notify(mock_redis)

    assert plan_id in processed


# ── Test 4: notifier aísla fallo de plan CAN ─────────────────────────────────

@pytest.mark.asyncio
async def test_notifier_isolates_can_counter_plan_failure():
    """Fallo en _compute_progress para contador CAN no interrumpe el resto del barrido."""
    from app.core.maintenance_notifier import _check_and_notify

    plan_id_ok = uuid.uuid4()
    plan_id_fail = uuid.uuid4()
    processed = []

    async def fake_compute(plan, db, baselines=None):
        if plan.id == plan_id_fail:
            raise ValueError("Semántica CAN desconocida (test)")
        processed.append(plan.id)
        return MaintenanceProgress(status="ok", thresholds=[])

    def _mock_plan(pid):
        p = MagicMock()
        p.id = pid
        p.active = True
        p.tenant_id = uuid.uuid4()
        p.vehicle_id = uuid.uuid4()
        return p

    plans = {plan_id_ok: _mock_plan(plan_id_ok), plan_id_fail: _mock_plan(plan_id_fail)}

    class FakeQueryResult:
        def __iter__(self):
            return iter([(plan_id_fail,), (plan_id_ok,)])

    mock_db = AsyncMock()
    mock_db.get = AsyncMock(side_effect=lambda model, pk: plans.get(pk))
    mock_db.execute = AsyncMock(return_value=FakeQueryResult())
    mock_db.commit = AsyncMock()

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_db)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    with patch("app.core.maintenance_notifier.AsyncSessionLocal", return_value=mock_cm):
        with patch("app.api.v1.maintenance._compute_progress", fake_compute):
            with patch("app.api.v1.maintenance._ensure_maintenance_rule",
                       AsyncMock(return_value=uuid.uuid4())):
                with patch("app.api.v1.maintenance._resolve_maintenance_alert_for_plan",
                           AsyncMock()):
                    await _check_and_notify(AsyncMock())

    assert plan_id_ok in processed
    assert plan_id_fail not in processed
