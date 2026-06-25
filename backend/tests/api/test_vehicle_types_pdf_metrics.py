"""Tests del schema PdfMetric (validación de keys + duplicados a nivel API)."""
import pytest
from pydantic import ValidationError


def test_pdfmetric_accepts_valid_payload():
    from app.schemas.vehicle import PdfMetric
    m = PdfMetric(key="pto_minutes", label="Tiempo PTO", unit="min", format="integer")
    assert m.key == "pto_minutes"
    assert m.source == "stop"            # default retrocompatible
    assert m.aggregate is None


def test_pdfmetric_accepts_sensor_key():
    """Cualquier key de sensor es válida con source='sensor' + agregado (contrato nuevo)."""
    from app.schemas.vehicle import PdfMetric
    m = PdfMetric(key="min_depresor", label="Presión depresor", unit="bar",
                  format="decimal1", source="sensor", aggregate="max")
    assert m.key == "min_depresor" and m.source == "sensor" and m.aggregate == "max"


def test_pdfmetric_rejects_blank_key():
    from app.schemas.vehicle import PdfMetric
    with pytest.raises(ValidationError):
        PdfMetric(key="", label="x", unit="u", format="integer")


def test_pdfmetric_rejects_unknown_aggregate():
    from app.schemas.vehicle import PdfMetric
    with pytest.raises(ValidationError):
        PdfMetric(key="x", label="x", unit="u", format="integer", source="sensor", aggregate="median")


def test_pdfmetric_rejects_unknown_format():
    from app.schemas.vehicle import PdfMetric
    with pytest.raises(ValidationError):
        PdfMetric(key="pto_minutes", label="x", unit="u", format="hex")


def test_pdfmetric_rejects_blank_label():
    from app.schemas.vehicle import PdfMetric
    with pytest.raises(ValidationError):
        PdfMetric(key="pto_minutes", label="", unit="u", format="integer")


def test_vehicle_type_update_accepts_pdf_metrics_list():
    from app.schemas.vehicle import VehicleTypeUpdate, PdfMetric
    u = VehicleTypeUpdate(pdf_metrics=[
        PdfMetric(key="pto_minutes", label="A", unit="min", format="integer"),
        PdfMetric(key="pressure_max", label="B", unit="bar", format="decimal1"),
    ])
    assert len(u.pdf_metrics) == 2
