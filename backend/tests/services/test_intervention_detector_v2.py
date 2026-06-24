"""Validación EN FRÍO del detector de intervención v2.

Cubre la lógica nueva de la migración 062 (fin configurable, ventana de fusión,
radio de seguridad, asociación de OT por geofence) con:
  - datos REALES grabados del FUSO (fixture exportado, solo lectura), y
  - escenarios sintéticos deterministas para los casos límite.

Todo es lógica pura sobre listas de filas en memoria: NO toca la BD ni el flujo
en vivo del rules-engine. Espejo del contrato de cycle_detector.detect_and_store_cycles.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.services.cycle_detector import (
    _build_cycle_data,
    _build_schema_index,
    _classify_assignment,
    _group_with_merge,
    _make_bool_col_predicate,
    _make_end_predicate,
)

# sensor_schema real del FUSO 3.5T para las señales de la definición "Depresor ON".
FUSO_SCHEMA = [
    {"key": "min_depresor", "avl_id": 147, "gauge_type": "numeric"},
    {"key": "depresor_encendido", "avl_id": 384, "bit_index": 0, "gauge_type": "led"},
]
IDX = _build_schema_index(FUSO_SCHEMA)

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "fuso_pto_2026-06-22.json"
BASE = datetime(2026, 6, 22, 6, 0, 0, tzinfo=timezone.utc)


def _load_fuso_rows() -> list[dict]:
    """Carga la telemetría real del FUSO y normaliza recorded_at a datetime."""
    rows = json.loads(FIXTURE.read_text())
    for r in rows:
        r["recorded_at"] = datetime.fromisoformat(r["recorded_at"])
    return rows


def _row(offset_s: int, pto: bool, lat: float, lon: float, avl147: int = 10) -> dict:
    """Fila sintética con el shape de _query_telemetry."""
    return {
        "recorded_at": BASE + timedelta(seconds=offset_s),
        "pto_active": pto,
        "ignition": True,
        "lat": lat,
        "lon": lon,
        "can_data": {"avl_147": avl147, "avl_384": 1 if pto else 0},
    }


# ── (a) Datos reales: cycle_data poblado ─────────────────────────────────────

def test_real_fuso_day_produces_interventions_with_cycle_data():
    """El día real del FUSO (22-jun) genera 7 intervenciones con agregados correctos."""
    rows = _load_fuso_rows()
    groups = _group_with_merge(rows, _make_bool_col_predicate("pto_active"), 300, 150, None)
    assert len(groups) == 7

    for g in groups:
        gr = g["rows"]
        cd = _build_cycle_data(gr, ["depresor_encendido"], ["min_depresor"], IDX)
        # cycle_data NO vacío y con los 4 agregados de min_depresor
        assert cd, "cycle_data no debe estar vacío"
        for suffix in ("sum", "avg", "max", "min"):
            assert f"min_depresor_{suffix}" in cd
        assert cd["min_depresor_max"] >= cd["min_depresor_min"]
        # duración positiva y coherente con la ventana de filas
        dur = int((gr[-1]["recorded_at"] - gr[0]["recorded_at"]).total_seconds())
        assert dur > 0


def test_real_fuso_merge_window_bridges_a_gap():
    """Sobre datos reales, la ventana de fusión une un hueco: 8 periodos crudos → 7."""
    rows = _load_fuso_rows()
    raw = _group_with_merge(rows, _make_bool_col_predicate("pto_active"), 0, 150, None)
    merged = _group_with_merge(rows, _make_bool_col_predicate("pto_active"), 300, 150, None)
    assert len(raw) == 8
    assert len(merged) == 7


# ── (b) Ventana de fusión: off/on corto en el mismo sitio → UNA intervención ──

def test_merge_short_gap_same_place_is_one_intervention():
    A = (39.50, -0.40)
    rows = [
        _row(0, True, *A), _row(30, True, *A),
        _row(60, False, *A), _row(90, False, *A),   # hueco de 60s (< 300)
        _row(120, True, *A), _row(150, True, *A),
    ]
    groups = _group_with_merge(rows, _make_bool_col_predicate("pto_active"), 300, 150, None)
    assert len(groups) == 1
    gr = groups[0]["rows"]
    # La intervención abarca de 0 a 150s (puentea el hueco)
    dur = int((gr[-1]["recorded_at"] - gr[0]["recorded_at"]).total_seconds())
    assert dur == 150


# ── (c) Radio / ventana: apagado largo o salida del radio → cierra y abre otra ─

def test_long_gap_closes_and_opens_new_intervention():
    A = (39.50, -0.40)
    rows = [
        _row(0, True, *A), _row(30, True, *A),
        _row(400, False, *A),                 # hueco de 370s (> 300) → cierra
        _row(600, True, *A), _row(630, True, *A),
    ]
    groups = _group_with_merge(rows, _make_bool_col_predicate("pto_active"), 300, 150, None)
    assert len(groups) == 2
    # La primera cierra en la última fila activa (30s), no arrastra el hueco
    assert int((groups[0]["rows"][-1]["recorded_at"] - BASE).total_seconds()) == 30


def test_movement_outside_radius_closes_intervention():
    A = (39.50, -0.40)
    B = (39.51, -0.40)   # ~1.1 km de A, fuera del radio de 150 m
    rows = [
        _row(0, True, *A), _row(30, True, *A),
        _row(60, False, *B),                 # hueco corto PERO fuera del radio → cierra
        _row(90, True, *A),
    ]
    groups = _group_with_merge(rows, _make_bool_col_predicate("pto_active"), 300, 150, None)
    assert len(groups) == 2


# ── Fin configurable (end_trigger_type/end_trigger_config) ───────────────────

def test_configurable_end_closes_on_threshold():
    """Fin explícito: min_depresor < 5 cierra la intervención en esa fila."""
    A = (39.50, -0.40)
    is_end = _make_end_predicate(
        "threshold_exceeded", {"sensor": "min_depresor", "op": "<", "value": 5}, IDX
    )
    rows = [
        _row(0, True, *A, avl147=10), _row(30, True, *A, avl147=10),
        _row(60, True, *A, avl147=2),     # 2 < 5 → fin
        _row(90, True, *A, avl147=10),    # nueva intervención
    ]
    groups = _group_with_merge(rows, _make_bool_col_predicate("pto_active"), 300, 150, is_end)
    assert len(groups) == 2
    # La primera cierra en la fila del umbral (60s)
    assert int((groups[0]["rows"][-1]["recorded_at"] - BASE).total_seconds()) == 60


def test_no_end_trigger_means_implicit_end():
    """Sin end_trigger_type → fin implícito (None)."""
    assert _make_end_predicate(None, {}, IDX) is None
    assert _make_end_predicate("", {}, IDX) is None


# ── (d) Asociación de OT por geofence ────────────────────────────────────────

def _stop(stop_id: str, wo_id: str, lat: float, lon: float, radius: int = 150) -> dict:
    return {"id": stop_id, "work_order_id": wo_id, "lat": lat, "lon": lon, "arrival_radius_m": radius}


def test_assignment_auto_when_one_stop_in_radius():
    stops = [_stop("s1", "wo1", 39.5001, -0.40)]   # ~11 m del punto
    status, wo_id, stop_id = _classify_assignment(39.50, -0.40, stops)
    assert status == "auto"
    assert wo_id == "wo1" and stop_id == "s1"


def test_assignment_sin_asignar_when_no_stop():
    status, wo_id, stop_id = _classify_assignment(39.50, -0.40, [])
    assert status == "sin_asignar"
    assert wo_id is None and stop_id is None


def test_assignment_sin_asignar_when_stop_far():
    stops = [_stop("s1", "wo1", 39.60, -0.40)]   # ~11 km → fuera del radio
    status, _, _ = _classify_assignment(39.50, -0.40, stops)
    assert status == "sin_asignar"


def test_assignment_pending_when_multiple_stops_in_radius():
    stops = [
        _stop("s1", "wo1", 39.5001, -0.40),
        _stop("s2", "wo2", 39.5002, -0.40),   # ambas dentro del radio
    ]
    status, wo_id, stop_id = _classify_assignment(39.50, -0.40, stops)
    assert status == "pending"
    assert wo_id is None and stop_id is None


def test_assignment_sin_asignar_when_no_coords():
    stops = [_stop("s1", "wo1", 39.50, -0.40)]
    assert _classify_assignment(None, None, stops)[0] == "sin_asignar"
