"""
Tests de Mantenimiento v2 — Pieza M1, Commit 2.

Verifica:
1. Crear plan con threshold.type fuera del catálogo → 422.
2. _compute_progress con tipo desconocido → ValueError con mensaje claro.
3. El notifier aísla el fallo de un plan y continúa con los demás (R1 mitigado).
"""
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.api.v1.maintenance import _compute_progress
from app.schemas.auth import CurrentUser

# ── Helpers ────────────────────────────────────────────────────────────────────

VEHICLE_ID = uuid.uuid4()
VEHICLE_TYPE_ID = uuid.uuid4()
TENANT_ID = uuid.uuid4()
CMG_TENANT_ID = uuid.uuid4()


def _cmg_admin() -> CurrentUser:
    return CurrentUser(
        user_id=uuid.uuid4(),
        tenant_id=CMG_TENANT_ID,
        tenant_tier="cmg",
        role="admin",
        email="cmg.admin@test.com",
    )


def _vehicle_with_type(counter_types: list[str]):
    """Devuelve mocks de Vehicle y VehicleType con el catálogo indicado."""
    vtype = MagicMock()
    vtype.id = VEHICLE_TYPE_ID
    vtype.maintenance_counters = [
        {"type": t, "label": t, "unit": "h", "source_type": "telemetry_1h",
         "source_key": "pto_active_minutes", "semantics": "sum"}
        for t in counter_types
    ]

    vehicle = MagicMock()
    vehicle.id = VEHICLE_ID
    vehicle.tenant_id = TENANT_ID
    vehicle.vehicle_type_id = VEHICLE_TYPE_ID
    vehicle.name = "Vehículo test"

    return vehicle, vtype


client = TestClient(app, raise_server_exceptions=False)

_BODY_INVALID = {
    "vehicle_id": str(VEHICLE_ID),
    "name": "Plan test catálogo",
    "trigger_condition": {
        "thresholds": [{"type": "pump_hours", "value": 200}],
        "op": "OR",
    },
    "warn_before_pct": 10,
    "active": True,
}

_BODY_VALID = {
    "vehicle_id": str(VEHICLE_ID),
    "name": "Plan test catálogo",
    "trigger_condition": {
        "thresholds": [{"type": "pto_hours", "value": 200}],
        "op": "OR",
    },
    "warn_before_pct": 10,
    "active": True,
}


@pytest.fixture(autouse=True)
def cleanup():
    yield
    app.dependency_overrides.pop(get_current_user, None)


# ── Test 1: tipo fuera de catálogo → 422 ──────────────────────────────────────

@pytest.mark.asyncio
async def test_validate_counter_types_invalid_raises_422():
    """_validate_counter_types debe lanzar HTTPException 422 para tipo no en catálogo."""
    from fastapi import HTTPException as FastAPIHTTPException
    from app.api.v1.maintenance import _validate_counter_types

    vehicle, vtype = _vehicle_with_type(["pto_hours", "engine_hours", "calendar_days"])

    mock_db = AsyncMock()
    mock_db.get = AsyncMock(return_value=vtype)

    thresholds = [MagicMock(type="pump_hours")]
    with pytest.raises(FastAPIHTTPException) as exc_info:
        await _validate_counter_types(vehicle, thresholds, mock_db)

    assert exc_info.value.status_code == 422
    assert "pump_hours" in exc_info.value.detail


@pytest.mark.asyncio
async def test_validate_counter_types_valid_passes():
    """_validate_counter_types no debe lanzar para tipo presente en catálogo."""
    from app.api.v1.maintenance import _validate_counter_types

    vehicle, vtype = _vehicle_with_type(["pto_hours", "engine_hours", "calendar_days"])

    mock_db = AsyncMock()
    mock_db.get = AsyncMock(return_value=vtype)

    thresholds = [MagicMock(type="pto_hours")]
    # No debe lanzar
    await _validate_counter_types(vehicle, thresholds, mock_db)


@pytest.mark.asyncio
async def test_validate_counter_types_empty_catalog_passes():
    """Si el catálogo está vacío, la validación no bloquea (compatibilidad)."""
    from app.api.v1.maintenance import _validate_counter_types

    vehicle, vtype = _vehicle_with_type([])  # catálogo vacío
    mock_db = AsyncMock()
    mock_db.get = AsyncMock(return_value=vtype)

    thresholds = [MagicMock(type="any_future_type")]
    await _validate_counter_types(vehicle, thresholds, mock_db)


# ── Test 2: _compute_progress con tipo desconocido → ValueError ───────────────

@pytest.mark.asyncio
async def test_compute_progress_unknown_type_raises():
    """_compute_progress debe lanzar ValueError para tipos no implementados."""
    plan = MagicMock()
    plan.id = uuid.uuid4()
    plan.vehicle_id = uuid.uuid4()
    plan.created_at = __import__("datetime").datetime(2026, 1, 1, tzinfo=__import__("datetime").timezone.utc)
    plan.trigger_condition = {
        "thresholds": [{"type": "pump_hours", "value": 200.0}]
    }
    plan.warn_before_pct = 10

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None)))

    with pytest.raises(ValueError, match="pump_hours"):
        await _compute_progress(plan, mock_db)


# ── Test 3: notifier aísla fallos por plan ────────────────────────────────────

@pytest.mark.asyncio
async def test_notifier_isolates_plan_failure():
    """Un plan que falla en _compute_progress no debe detener el barrido del notifier."""
    from app.core.maintenance_notifier import _check_and_notify

    plan_id_ok = uuid.uuid4()
    plan_id_fail = uuid.uuid4()
    plan_ids_to_process = [plan_id_fail, plan_id_ok]

    processed = []

    async def fake_compute_progress(plan, db, baselines=None):
        if plan.id == plan_id_fail:
            raise ValueError("Tipo no implementado (test)")
        processed.append(plan.id)
        from app.schemas.maintenance import MaintenanceProgress
        return MaintenanceProgress(status="ok", thresholds=[])

    mock_plan_ok = MagicMock()
    mock_plan_ok.id = plan_id_ok
    mock_plan_ok.active = True
    mock_plan_ok.tenant_id = uuid.uuid4()
    mock_plan_ok.vehicle_id = uuid.uuid4()

    mock_plan_fail = MagicMock()
    mock_plan_fail.id = plan_id_fail
    mock_plan_fail.active = True
    mock_plan_fail.tenant_id = uuid.uuid4()
    mock_plan_fail.vehicle_id = uuid.uuid4()

    plans_by_id = {plan_id_ok: mock_plan_ok, plan_id_fail: mock_plan_fail}

    class FakeQueryResult:
        def __iter__(self):
            return iter([(r,) for r in plan_ids_to_process])

    async def fake_db_get(model, pk):
        # Devuelve el plan si existe, None para tenant/vehicle (el notifier lo maneja)
        return plans_by_id.get(pk)

    mock_db = AsyncMock()
    mock_db.get = AsyncMock(side_effect=fake_db_get)
    mock_db.execute = AsyncMock(return_value=FakeQueryResult())
    mock_db.commit = AsyncMock()

    # Cada llamada a AsyncSessionLocal() devuelve un context manager que produce mock_db
    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_db)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    mock_redis = AsyncMock()

    # _compute_progress, _ensure_maintenance_rule y _resolve_maintenance_alert_for_plan
    # se importan con lazy "from … import" dentro de _check_and_notify → parchear en fuente.
    with patch("app.core.maintenance_notifier.AsyncSessionLocal", return_value=mock_cm):
        with patch("app.api.v1.maintenance._compute_progress", fake_compute_progress):
            with patch("app.api.v1.maintenance._ensure_maintenance_rule",
                       AsyncMock(return_value=uuid.uuid4())):
                with patch("app.api.v1.maintenance._resolve_maintenance_alert_for_plan",
                           AsyncMock()):
                    await _check_and_notify(mock_redis)

    assert plan_id_ok in processed, "El notifier se detuvo antes de procesar el plan válido"
