"""Tests del schema XOR firma/no-firma en WorkReportCreate.

Tests unitarios del validador (no requieren DB).
"""
import pytest
from pydantic import ValidationError


def test_schema_accepts_signed_payload():
    from app.schemas.work_report import WorkReportCreate
    r = WorkReportCreate(
        description="trabajo ok",
        signature_data="data:image/png;base64,iVBORw0KGgoAAAANS",
        client_signee_name="Juan Garcia",
        client_signee_dni="12345678A",
    )
    assert r.client_signee_name == "Juan Garcia"
    assert r.unsigned_reason is None


def test_schema_accepts_unsigned_with_reason():
    from app.schemas.work_report import WorkReportCreate
    r = WorkReportCreate(
        description="ok",
        unsigned_reason="Cliente ausente",
    )
    assert r.unsigned_reason == "Cliente ausente"
    assert r.signature_data is None


def test_schema_rejects_signed_and_unsigned_mixed():
    from app.schemas.work_report import WorkReportCreate
    with pytest.raises(ValidationError) as exc:
        WorkReportCreate(
            signature_data="data:image/png;base64,abc",
            client_signee_name="X",
            client_signee_dni="Y",
            unsigned_reason="Otro",
        )
    msg = str(exc.value).lower()
    assert "firma" in msg or "motivo" in msg


def test_schema_allows_empty_draft():
    """Permitido en draft — la regla 'uno obligatorio' solo aplica al cerrar."""
    from app.schemas.work_report import WorkReportCreate
    r = WorkReportCreate(description="borrador")
    assert r.signature_data is None and r.unsigned_reason is None
