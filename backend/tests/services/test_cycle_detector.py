"""Tests del resolver de señales del detector de ciclos.

Cubren la causa raíz del cycle_data vacío: el detector debe traducir el nombre
(key de sensor_schema) a la clave real avl_<id> de can_data, aplicar bit_index
(digitales) y transform/scale (analógicas). Espejo de frontend/src/lib/sensorValue.ts.
"""
from app.services.cycle_detector import (
    _build_cycle_data,
    _build_schema_index,
    _resolve_field_value,
)

# sensor_schema representativo de un vehículo VPS (FUSO 3.5T).
SCHEMA = [
    {"key": "min_depresor", "label": "Min Depresor", "avl_id": 147, "gauge_type": "numeric"},
    {"key": "depresor_encendido", "label": "Depresor", "avl_id": 384, "bit_index": 0, "gauge_type": "led"},
    {"key": "rpm", "label": "RPM Motor", "avl_id": 10309, "scale": 0.125, "gauge_type": "numeric"},
    {"key": "ext_voltage", "label": "Voltaje", "status_field": "ext_voltage_mv", "gauge_type": "numeric"},
]
IDX = _build_schema_index(SCHEMA)


def test_resolve_translates_key_to_avl():
    """min_depresor (key) → avl_147 (clave real de can_data)."""
    row = {"can_data": {"avl_147": 12}}
    assert _resolve_field_value("min_depresor", row["can_data"], row, IDX) == 12.0


def test_resolve_bit_index_digital():
    """depresor_encendido es led bit 0: extrae el bit del byte crudo."""
    assert _resolve_field_value("depresor_encendido", {"avl_384": 5}, {}, IDX) == 1.0  # 0b101
    assert _resolve_field_value("depresor_encendido", {"avl_384": 4}, {}, IDX) == 0.0  # 0b100


def test_resolve_applies_scale():
    """rpm con scale 0.125: 800 → 100."""
    assert _resolve_field_value("rpm", {"avl_10309": 800}, {}, IDX) == 100.0


def test_resolve_status_field_native_column():
    """ext_voltage se lee de la columna nativa ext_voltage_mv del row."""
    row = {"can_data": {}, "ext_voltage_mv": 12500}
    assert _resolve_field_value("ext_voltage", row["can_data"], row, IDX) == 12500.0


def test_resolve_fallback_direct_key():
    """Field ausente del schema → clave directa en can_data (legado/retrocompat)."""
    assert _resolve_field_value("foo", {"foo": 7}, {}, {}) == 7.0


def test_resolve_j1939_na_ignored():
    """Valores J1939 'not available' (0xFF/0xFFFF/0xFFFFFFFF) se descartan."""
    assert _resolve_field_value("min_depresor", {"avl_147": 255}, {}, IDX) is None


def test_build_cycle_data_not_empty():
    """El bug original: con keys que casan vía schema, cycle_data deja de ser {}."""
    rows = [
        {"can_data": {"avl_147": 10, "avl_384": 1}},
        {"can_data": {"avl_147": 20, "avl_384": 1}},
        {"can_data": {"avl_147": 30, "avl_384": 0}},
    ]
    data = _build_cycle_data(rows, ["depresor_encendido"], ["min_depresor"], IDX)
    assert data != {}
    assert data["depresor_encendido_start"] == 1.0
    assert data["depresor_encendido_end"] == 0.0
    assert data["min_depresor_sum"] == 60.0
    assert data["min_depresor_avg"] == 20.0
    assert data["min_depresor_max"] == 30.0
    assert data["min_depresor_min"] == 10.0


def test_build_cycle_data_empty_without_match():
    """Sin schema y con can_data por avl_<id>, los nombres-key NO casan → {} (reproduce el bug)."""
    rows = [{"can_data": {"avl_147": 10}}]
    data = _build_cycle_data(rows, [], ["min_depresor"], {})
    assert data == {}
