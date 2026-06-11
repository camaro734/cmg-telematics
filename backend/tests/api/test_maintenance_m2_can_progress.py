"""
Tests de Mantenimiento v2 — Pieza M2, Commit 2.

Verifica:
1. _compute_progress con contador can_data (semantics="sum"): suma deltas positivos / 60.
2. _compute_progress con contador can_data (semantics="max_minus_min"): MAX-MIN en ventana.
3. _compute_progress con semántica desconocida en catálogo → ValueError.
4. GET /maintenance/counter-types/{vehicle_id} devuelve catálogo del vehicle_type.
5. _snapshot_counter_values captura lecturas CAN correctamente.
"""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1.maintenance import _compute_progress, _snapshot_counter_values
from app.schemas.maintenance import MaintenanceProgress


# ── Fixtures base ─────────────────────────────────────────────────────────────

VEHICLE_ID = uuid.uuid4()
VEHICLE_TYPE_ID = uuid.uuid4()
TENANT_ID = uuid.uuid4()


def _make_plan(thresholds: list[dict]) -> MagicMock:
    plan = MagicMock()
    plan.id = uuid.uuid4()
    plan.vehicle_id = VEHICLE_ID
    plan.tenant_id = TENANT_ID
    plan.created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    plan.trigger_condition = {"thresholds": thresholds}
    plan.warn_before_pct = 10
    return plan


def _make_vtype(extra_counters: list[dict]) -> MagicMock:
    vtype = MagicMock()
    vtype.id = VEHICLE_TYPE_ID
    vtype.maintenance_counters = [
        {"type": "pto_hours", "label": "PTO", "unit": "h",
         "source_type": "telemetry_1h", "source_key": "pto_active_minutes", "semantics": "sum"},
        {"type": "engine_hours", "label": "Motor", "unit": "h",
         "source_type": "telemetry_1h", "source_key": "engine_on_minutes", "semantics": "sum"},
        {"type": "calendar_days", "label": "Calendario", "unit": "días",
         "source_type": "calendar", "source_key": None, "semantics": None},
    ] + extra_counters
    return vtype


def _make_vehicle(vtype_id: uuid.UUID = VEHICLE_TYPE_ID) -> MagicMock:
    v = MagicMock()
    v.id = VEHICLE_ID
    v.tenant_id = TENANT_ID
    v.vehicle_type_id = vtype_id
    return v


# ── Test 1: suma de deltas positivos para semantics="sum" ─────────────────────

@pytest.mark.asyncio
async def test_compute_progress_can_sum_semantics():
    """pump_hours con semantics=sum: suma deltas positivos dividido por 60."""
    plan = _make_plan([{"type": "pump_hours", "value": 10.0}])
    vehicle = _make_vehicle()
    vtype = _make_vtype([
        {"type": "pump_hours", "label": "Bomba", "unit": "h",
         "source_type": "can_data", "source_key": "avl_148", "semantics": "sum"},
    ])

    # El SELECT de suma de deltas devuelve 300 min = 5.0 h
    mock_scalar_sum = MagicMock()
    mock_scalar_sum.scalar_one_or_none = MagicMock(return_value=None)  # baseline log
    mock_scalar_sum.scalar_one = MagicMock(return_value=5.0)  # resultado suma

    async def fake_execute(stmt, params=None):
        sql = str(stmt)
        if "maintenance_log" in sql.lower() or "performed_at" in sql.lower():
            # Consulta de baseline → sin log previo
            r = MagicMock()
            r.scalar_one_or_none = MagicMock(return_value=None)
            return r
        # Consulta de suma de deltas
        r = MagicMock()
        r.scalar_one = MagicMock(return_value=5.0)
        return r

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(side_effect=fake_execute)
    mock_db.get = AsyncMock(side_effect=lambda model, pk: vehicle if pk == VEHICLE_ID else vtype)

    result = await _compute_progress(plan, mock_db)
    assert isinstance(result, MaintenanceProgress)
    assert len(result.thresholds) == 1
    tp = result.thresholds[0]
    assert tp.type == "pump_hours"
    assert tp.current == 5.0
    assert tp.limit == 10.0
    assert tp.pct == 50.0


# ── Test 2: max-min para semantics="max_minus_min" ────────────────────────────

@pytest.mark.asyncio
async def test_compute_progress_can_max_minus_min_semantics():
    """odometer_km con semantics=max_minus_min: MAX-MIN en ventana."""
    plan = _make_plan([{"type": "odometer_km", "value": 500.0}])
    vehicle = _make_vehicle()
    vtype = _make_vtype([
        {"type": "odometer_km", "label": "Odómetro", "unit": "km",
         "source_type": "can_data", "source_key": "avl_10314", "semantics": "max_minus_min"},
    ])

    async def fake_execute(stmt, params=None):
        sql = str(stmt)
        if "maintenance_log" in sql.lower() or "performed_at" in sql.lower():
            r = MagicMock()
            r.scalar_one_or_none = MagicMock(return_value=None)
            return r
        r = MagicMock()
        r.scalar_one = MagicMock(return_value=150.0)  # 150 km desde última intervención
        return r

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(side_effect=fake_execute)
    mock_db.get = AsyncMock(side_effect=lambda model, pk: vehicle if pk == VEHICLE_ID else vtype)

    result = await _compute_progress(plan, mock_db)
    tp = result.thresholds[0]
    assert tp.type == "odometer_km"
    assert tp.current == 150.0
    assert tp.pct == 30.0  # 150/500*100


# ── Test 3: semántica desconocida en catálogo → ValueError ────────────────────

@pytest.mark.asyncio
async def test_compute_progress_unknown_semantics_raises():
    """Semántica no reconocida en catálogo debe lanzar ValueError."""
    plan = _make_plan([{"type": "pump_hours", "value": 10.0}])
    vehicle = _make_vehicle()
    vtype = _make_vtype([
        {"type": "pump_hours", "label": "Bomba", "unit": "h",
         "source_type": "can_data", "source_key": "avl_148", "semantics": "unknown_future"},
    ])

    async def fake_execute(stmt, params=None):
        r = MagicMock()
        r.scalar_one_or_none = MagicMock(return_value=None)
        return r

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(side_effect=fake_execute)
    mock_db.get = AsyncMock(side_effect=lambda model, pk: vehicle if pk == VEHICLE_ID else vtype)

    with pytest.raises(ValueError, match="unknown_future"):
        await _compute_progress(plan, mock_db)


# ── Test 4: _compute_progress sigue funcionando para pto_hours (regresión) ────

@pytest.mark.asyncio
async def test_compute_progress_pto_hours_regression():
    """Los contadores telemetry_1h no se ven afectados por la nueva rama CAN."""
    plan = _make_plan([{"type": "pto_hours", "value": 200.0}])

    async def fake_execute(stmt, params=None):
        sql = str(stmt)
        if "maintenance_log" in sql.lower() or "performed_at" in sql.lower():
            r = MagicMock()
            r.scalar_one_or_none = MagicMock(return_value=None)
            return r
        if "MIN(bucket)" in sql:
            r = MagicMock()
            r.scalar_one_or_none = MagicMock(return_value=None)
            return r
        r = MagicMock()
        r.scalar_one = MagicMock(return_value=100.0)
        return r

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(side_effect=fake_execute)

    result = await _compute_progress(plan, mock_db)
    assert result.thresholds[0].current == 100.0
    assert result.thresholds[0].pct == 50.0


# ── Test 5: _snapshot_counter_values captura lecturas CAN ─────────────────────

@pytest.mark.asyncio
async def test_snapshot_counter_values_can_data():
    """La foto captura el último valor raw de can_data para contadores PLC."""
    vtype = _make_vtype([
        {"type": "pump_hours", "label": "Bomba", "unit": "h",
         "source_type": "can_data", "source_key": "avl_148", "semantics": "sum"},
    ])

    async def fake_execute(stmt, params=None):
        sql = str(stmt)
        if "telemetry_1h" in sql:
            r = MagicMock()
            r.scalar_one_or_none = MagicMock(return_value=42.5)
            return r
        # can_data snapshot: último valor avl_148
        r = MagicMock()
        r.scalar_one_or_none = MagicMock(return_value=224.0)
        return r

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(side_effect=fake_execute)

    readings = await _snapshot_counter_values(
        VEHICLE_ID, vtype, ["pto_hours", "pump_hours"], mock_db
    )
    assert "pump_hours" in readings
    assert readings["pump_hours"] == 224.0
    assert "pto_hours" in readings


# ── Test 6: source_key inválido en snapshot → ignorado con warning ────────────

@pytest.mark.asyncio
async def test_snapshot_counter_values_unsafe_key_ignored():
    """Un source_key que no cumple avl_\\d+ se ignora y no lanza excepción."""
    vtype = _make_vtype([
        {"type": "pump_hours", "label": "Bomba", "unit": "h",
         "source_type": "can_data", "source_key": "'; DROP TABLE vehicle;--", "semantics": "sum"},
    ])
    mock_db = AsyncMock()

    readings = await _snapshot_counter_values(
        VEHICLE_ID, vtype, ["pump_hours"], mock_db
    )
    assert "pump_hours" not in readings
    # No debe haberse llamado execute para la clave insegura
    mock_db.execute.assert_not_called()


# ── Test 7: baseline foto usada cuando actual ≥ foto ─────────────────────────

@pytest.mark.asyncio
async def test_compute_progress_can_sum_photo_baseline_used():
    """Si hay foto en el último log y actual ≥ foto, usa (actual − foto) / 60 exacto."""
    plan = _make_plan([{"type": "pump_hours", "value": 200.0}])
    vehicle = _make_vehicle()
    vtype = _make_vtype([
        {"type": "pump_hours", "label": "Bomba", "unit": "h",
         "source_type": "can_data", "source_key": "avl_148", "semantics": "sum"},
    ])

    calls: list[str] = []

    async def fake_execute(stmt, params=None):
        sql = str(stmt)
        calls.append(sql)
        if "maintenance_log" in sql.lower() or "performed_at" in sql.lower():
            r = MagicMock()
            r.fetchone = MagicMock(return_value=(
                datetime(2026, 3, 1, tzinfo=timezone.utc),
                {"pump_hours": 6000.0},
            ))
            return r
        # Consulta de valor raw actual: avl_148 = 6720 min
        r = MagicMock()
        r.scalar_one_or_none = MagicMock(return_value=6720.0)
        return r

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(side_effect=fake_execute)
    mock_db.get = AsyncMock(side_effect=lambda model, pk: vehicle if pk == VEHICLE_ID else vtype)

    result = await _compute_progress(plan, mock_db)
    tp = result.thresholds[0]

    # (6720 − 6000) / 60 = 12.0 h
    assert tp.current == 12.0
    assert tp.type == "pump_hours"
    # La consulta de suma de deltas NO debe haberse ejecutado
    assert not any("LEAST" in s for s in calls)


# ── Test 8: reset manual detectado → fallback suma deltas + warning ───────────

@pytest.mark.asyncio
async def test_compute_progress_can_sum_photo_fallback_on_reset(caplog):
    """Si actual < foto (reset manual), avisa y usa suma de deltas como fallback."""
    import logging

    plan = _make_plan([{"type": "pump_hours", "value": 200.0}])
    vehicle = _make_vehicle()
    vtype = _make_vtype([
        {"type": "pump_hours", "label": "Bomba", "unit": "h",
         "source_type": "can_data", "source_key": "avl_148", "semantics": "sum"},
    ])

    calls: list[str] = []

    async def fake_execute(stmt, params=None):
        sql = str(stmt)
        calls.append(sql)
        if "maintenance_log" in sql.lower() or "performed_at" in sql.lower():
            r = MagicMock()
            r.fetchone = MagicMock(return_value=(
                datetime(2026, 3, 1, tzinfo=timezone.utc),
                {"pump_hours": 6000.0},
            ))
            return r
        if "LEAST" in sql:
            # Suma de deltas tras reset
            r = MagicMock()
            r.scalar_one = MagicMock(return_value=3.5)
            return r
        # Valor raw actual < foto → reset detectado
        r = MagicMock()
        r.scalar_one_or_none = MagicMock(return_value=500.0)
        return r

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(side_effect=fake_execute)
    mock_db.get = AsyncMock(side_effect=lambda model, pk: vehicle if pk == VEHICLE_ID else vtype)

    with caplog.at_level(logging.WARNING):
        result = await _compute_progress(plan, mock_db)

    tp = result.thresholds[0]
    # Fallback a deltas: 3.5 h
    assert tp.current == 3.5
    # La consulta de suma de deltas SÍ se ejecutó
    assert any("LEAST" in s for s in calls)
    # Se emitió warning de reset
    assert any("Reset manual" in r.message for r in caplog.records)


# ── Test 9: avl_146 incluye filtro módulo-60 en el SQL ───────────────────────

@pytest.mark.asyncio
async def test_compute_progress_avl146_modulo60_filter_present():
    """El SQL para avl_146 (transfer) debe incluir el filtro <= 59."""
    plan = _make_plan([{"type": "transfer_hours", "value": 50.0}])
    vehicle = _make_vehicle()
    vtype = _make_vtype([
        {"type": "transfer_hours", "label": "Transferencia", "unit": "h",
         "source_type": "can_data", "source_key": "avl_146", "semantics": "sum"},
    ])

    sql_calls: list[str] = []

    async def fake_execute(stmt, params=None):
        sql = str(stmt)
        sql_calls.append(sql)
        if "maintenance_log" in sql.lower() or "performed_at" in sql.lower():
            r = MagicMock()
            r.fetchone = MagicMock(return_value=None)
            return r
        r = MagicMock()
        r.scalar_one = MagicMock(return_value=1.0)
        return r

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(side_effect=fake_execute)
    mock_db.get = AsyncMock(side_effect=lambda model, pk: vehicle if pk == VEHICLE_ID else vtype)

    await _compute_progress(plan, mock_db)

    delta_sql = next((s for s in sql_calls if "LEAST" in s), None)
    assert delta_sql is not None, "No se encontró la consulta de suma de deltas"
    assert "<= 59" in delta_sql, "Falta el filtro módulo-60 para avl_146"


# ── Test 10: clamp elapsed_min presente en SQL para avl_148 ──────────────────

@pytest.mark.asyncio
async def test_compute_progress_can_sum_elapsed_clamp_present():
    """El SQL de suma de deltas debe incluir LEAST(delta, elapsed_min+1) para evitar artefactos."""
    plan = _make_plan([{"type": "pump_hours", "value": 100.0}])
    vehicle = _make_vehicle()
    vtype = _make_vtype([
        {"type": "pump_hours", "label": "Bomba", "unit": "h",
         "source_type": "can_data", "source_key": "avl_148", "semantics": "sum"},
    ])

    sql_calls: list[str] = []

    async def fake_execute(stmt, params=None):
        sql = str(stmt)
        sql_calls.append(sql)
        if "maintenance_log" in sql.lower() or "performed_at" in sql.lower():
            r = MagicMock()
            r.fetchone = MagicMock(return_value=None)
            return r
        r = MagicMock()
        r.scalar_one = MagicMock(return_value=1.0)
        return r

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(side_effect=fake_execute)
    mock_db.get = AsyncMock(side_effect=lambda model, pk: vehicle if pk == VEHICLE_ID else vtype)

    await _compute_progress(plan, mock_db)

    delta_sql = next((s for s in sql_calls if "LEAST" in s), None)
    assert delta_sql is not None, "No se encontró la consulta de suma de deltas"
    assert "elapsed_min" in delta_sql, "Falta la columna elapsed_min en el SQL"
    assert "WINDOW w AS" in delta_sql, "Falta la cláusula WINDOW"
    assert "<= 59" not in delta_sql, "avl_148 no debe tener el filtro módulo-60"
