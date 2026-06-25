"""Tests del agregador de métricas de sensor por parada (PDF de partes).

Puros (sin BD): resuelven señales del sensor_schema (avl_<id>, bit_index, escala) y
agregan max/min/avg/last sobre la ventana de la parada. Espejo de test_cycle_detector.
"""
from app.services.stop_metrics import aggregate_rows, build_schema_index

SCHEMA = [
    {"key": "min_depresor", "avl_id": 147, "gauge_type": "numeric"},
    {"key": "rpm", "avl_id": 10309, "scale": 0.125, "gauge_type": "numeric"},
    {"key": "depresor_on", "avl_id": 384, "bit_index": 0, "gauge_type": "led"},
]
IDX = build_schema_index(SCHEMA)


def _rows(vals147):
    return [{"can_data": {"avl_147": v}} for v in vals147]


def test_aggregate_max_min_avg():
    rows = _rows([10, 14, 6, 12])
    out = aggregate_rows(
        rows,
        [
            {"key": "min_depresor", "aggregate": "max"},
            {"key": "min_depresor", "aggregate": "min"},
            {"key": "min_depresor", "aggregate": "avg"},
        ],
        IDX,
    )
    # aggregate_rows indexa por key: la última métrica con esa key gana (avg)
    assert out["min_depresor"] == round((10 + 14 + 6 + 12) / 4, 3)


def test_aggregate_max_single_metric():
    out = aggregate_rows(_rows([10, 14, 6, 12]), [{"key": "min_depresor", "aggregate": "max"}], IDX)
    assert out["min_depresor"] == 14.0


def test_aggregate_min_single_metric():
    out = aggregate_rows(_rows([10, 14, 6, 12]), [{"key": "min_depresor", "aggregate": "min"}], IDX)
    assert out["min_depresor"] == 6.0


def test_aggregate_last_in_time_order():
    out = aggregate_rows(_rows([10, 14, 6, 12]), [{"key": "min_depresor", "aggregate": "last"}], IDX)
    assert out["min_depresor"] == 12.0


def test_aggregate_applies_scale():
    rows = [{"can_data": {"avl_10309": 800}}, {"can_data": {"avl_10309": 1600}}]
    out = aggregate_rows(rows, [{"key": "rpm", "aggregate": "max"}], IDX)
    assert out["rpm"] == 200.0  # 1600 * 0.125


def test_aggregate_bit_index():
    rows = [{"can_data": {"avl_384": 5}}, {"can_data": {"avl_384": 4}}]  # bit0: 1, 0
    out = aggregate_rows(rows, [{"key": "depresor_on", "aggregate": "max"}], IDX)
    assert out["depresor_on"] == 1.0


def test_aggregate_no_data_is_none():
    out = aggregate_rows([{"can_data": {}}], [{"key": "min_depresor", "aggregate": "max"}], IDX)
    assert out["min_depresor"] is None


def test_aggregate_default_aggregate_is_max():
    out = aggregate_rows(_rows([3, 9, 5]), [{"key": "min_depresor"}], IDX)
    assert out["min_depresor"] == 9.0
