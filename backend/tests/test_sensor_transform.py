"""Tests de paridad para apply_transform — misma matemática que el frontend
(lib/sensorValue.ts applyTransform). Caso real: sensor de vacío 4-20 mA."""
from app.services.sensor_transform import apply_transform


def test_linear_range_extremo_inferior():
    sensor = {"transform": {"type": "linear_range", "in_min": 4000, "in_max": 20000, "out_min": -1, "out_max": 10}}
    assert apply_transform(4000, sensor) == -1.0


def test_linear_range_extremo_superior():
    sensor = {"transform": {"type": "linear_range", "in_min": 4000, "in_max": 20000, "out_min": -1, "out_max": 10}}
    assert apply_transform(20000, sensor) == 10.0


def test_linear_range_punto_medio():
    sensor = {"transform": {"type": "linear_range", "in_min": 4000, "in_max": 20000, "out_min": -1, "out_max": 10}}
    assert apply_transform(12000, sensor) == 4.5


def test_linear_range_extrapola_sin_recortar():
    sensor = {"transform": {"type": "linear_range", "in_min": 4000, "in_max": 20000, "out_min": -1, "out_max": 10}}
    assert abs(apply_transform(2000, sensor) - (-2.375)) < 1e-9


def test_linear_range_span_cero_devuelve_none():
    sensor = {"transform": {"type": "linear_range", "in_min": 5, "in_max": 5, "out_min": 0, "out_max": 10}}
    assert apply_transform(5, sensor) is None


def test_raw_none_devuelve_none():
    sensor = {"transform": {"type": "linear_range", "in_min": 4000, "in_max": 20000, "out_min": -1, "out_max": 10}}
    assert apply_transform(None, sensor) is None


def test_linear_range_4_20ma_raw_cero_es_sin_senal():
    sensor = {"transform": {"type": "linear_range", "in_min": 4000, "in_max": 20000, "out_min": -1, "out_max": 10}}
    assert apply_transform(0, sensor) is None


def test_linear_range_in_min_cero_raw_cero_valido():
    sensor = {"transform": {"type": "linear_range", "in_min": 0, "in_max": 100, "out_min": 0, "out_max": 10}}
    assert apply_transform(0, sensor) == 0


def test_fallback_scale_offset():
    sensor = {"scale": 0.1, "offset": 5}
    assert apply_transform(100, sensor) == 15.0


def test_sin_transform_ni_scale_offset_identidad():
    assert apply_transform(42, {}) == 42


def test_minutes_to_hours():
    sensor = {"transform": {"type": "minutes_to_hours"}}
    assert apply_transform(150, sensor) == 2.5
    assert apply_transform(None, sensor) is None


def test_schema_acepta_minutes_to_hours():
    from app.schemas.vehicle import VehicleTypeSensorSchemaUpdate
    payload = {"sensor_schema": [
        {"key": "min_t", "label": "Min transfer", "gauge_type": "numeric",
         "transform": {"type": "minutes_to_hours"}},
    ]}
    assert VehicleTypeSensorSchemaUpdate.model_validate(payload)


# ── Validación de schema ─────────────────────────────────────────────────────
import pytest
from pydantic import ValidationError
from app.schemas.vehicle import VehicleTypeSensorSchemaUpdate


def test_schema_acepta_linear_range_valido():
    payload = {"sensor_schema": [
        {"key": "vacio", "label": "Vacío", "gauge_type": "linear",
         "transform": {"type": "linear_range", "in_min": 4000, "in_max": 20000, "out_min": -1, "out_max": 10}},
    ]}
    obj = VehicleTypeSensorSchemaUpdate.model_validate(payload)
    assert obj.sensor_schema[0]["transform"]["out_max"] == 10


def test_schema_acepta_sensores_sin_transform():
    payload = {"sensor_schema": [{"key": "x", "label": "X", "gauge_type": "numeric", "scale": 0.1}]}
    assert VehicleTypeSensorSchemaUpdate.model_validate(payload)


def test_schema_rechaza_transform_incompleto():
    payload = {"sensor_schema": [
        {"key": "vacio", "label": "Vacío", "transform": {"type": "linear_range", "in_min": 4000}},
    ]}
    with pytest.raises(ValidationError):
        VehicleTypeSensorSchemaUpdate.model_validate(payload)


def test_schema_rechaza_tipo_transform_desconocido():
    payload = {"sensor_schema": [
        {"key": "vacio", "label": "Vacío", "transform": {"type": "polinomial"}},
    ]}
    with pytest.raises(ValidationError):
        VehicleTypeSensorSchemaUpdate.model_validate(payload)
