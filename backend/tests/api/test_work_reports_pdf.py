"""Tests del template PDF — render directo (sin DB)."""
import pytest


def test_format_metric_handles_all_formats():
    from app.api.v1.work_reports import format_metric
    assert format_metric(None, "integer", "min") == "—"
    assert format_metric(22.7, "integer", "min") == "22 min"
    assert format_metric(8.456, "decimal1", "bar") == "8.5 bar"
    assert format_metric(8.456, "decimal2", "bar") == "8.46 bar"
    assert format_metric(1850, "integer", "rpm") == "1850 rpm"


def test_template_renders_with_branding():
    from app.api.v1.work_reports import _template
    html = _template.render(
        brand_name="Aguas de Valencia",
        business_cif="A-46123456",
        business_address="Av. del Puerto 102, Valencia",
        primary_color="#0EA5E9",
        logo_url=None,
        doc_number="PT-2026-00001",
        order_title="Limpieza fosa séptica",
        completed_date="08/05/2026",
        completed_time="13:45",
        vehicle_label="ISUZU M27 · 1234ABC",
        driver_name="Juan Garcia",
        duration_label="3h 15min",
        description="Trabajo realizado sin incidencias",
        materials_used=[],
        photo_urls=[],
        signature_url=None,
        signee_name=None,
        signee_dni=None,
        unsigned_reason=None,
        final_client_name="Comunidad El Pinar",
        final_client_address="C/ Mayor 12, Valencia",
        pdf_metrics=[
            {"key": "pto_minutes", "label": "Tiempo PTO", "unit": "min", "format": "integer"},
            {"key": "pressure_max", "label": "Presión máx.", "unit": "bar", "format": "decimal1"},
        ],
        stops=[
            {"address": "C/ Mayor 12", "client_name": "Comunidad",
             "pto_minutes": 22, "pressure_max": 8.4, "pressure_min": 7.8,
             "rpm_avg": 1850, "pump_minutes": 18, "fuel_l": 4.2},
            {"address": "Plaza Sol",   "client_name": None,
             "pto_minutes": 18, "pressure_max": 7.9, "pressure_min": 7.1,
             "rpm_avg": 1820, "pump_minutes": 15, "fuel_l": 3.5},
        ],
    )
    # branding tenant aparece
    assert "Aguas de Valencia" in html
    assert "#0EA5E9" in html
    assert "A-46123456" in html
    assert "Av. del Puerto 102" in html
    # documento
    assert "PT-2026-00001" in html
    # cliente final
    assert "Comunidad El Pinar" in html
    assert "C/ Mayor 12, Valencia" in html
    # tabla de paradas con métricas formateadas
    assert "Tiempo PTO" in html
    assert "Presión máx" in html
    assert "22 min" in html       # integer
    assert "8.4 bar" in html      # decimal1
    # NO mostrar bloque de firma del operario antiguo (era operario, ahora no aplica)
    assert "Firma del operario" not in html


def test_template_renders_unsigned_with_reason():
    from app.api.v1.work_reports import _template
    html = _template.render(
        brand_name="Test", primary_color="#F97316", logo_url=None,
        doc_number="PT-2026-00010", order_title="X",
        completed_date="08/05/2026", completed_time="10:00",
        vehicle_label=None, driver_name=None, duration_label=None,
        description=None, materials_used=[], photo_urls=[],
        signature_url=None, signee_name=None, signee_dni=None,
        unsigned_reason="Cliente ausente",
        final_client_name=None, final_client_address=None,
        business_cif=None, business_address=None,
        pdf_metrics=[], stops=[],
    )
    assert "Cliente ausente" in html
    assert "sin firma del cliente" in html.lower()
    # nota discreta gris (no sello rojo)
    assert "unsigned-note" in html


def test_template_renders_signed_with_dni():
    from app.api.v1.work_reports import _template
    html = _template.render(
        brand_name="Test", primary_color="#F97316", logo_url=None,
        doc_number=None, order_title="X",
        completed_date=None, completed_time=None,
        vehicle_label=None, driver_name=None, duration_label=None,
        description=None, materials_used=[], photo_urls=[],
        signature_url="file:///app/uploads/work_reports/x/signature.png",
        signee_name="Juan García",
        signee_dni="12345678A",
        unsigned_reason=None,
        final_client_name=None, final_client_address=None,
        business_cif=None, business_address=None,
        pdf_metrics=[], stops=[],
    )
    assert "Juan García" in html
    assert "12345678A" in html
    assert "signature.png" in html
    # No debe renderizar el bloque de "sin firma" (el CSS sí está, el div no)
    assert 'class="unsigned-note"' not in html
    assert "Parte cerrado sin firma" not in html
