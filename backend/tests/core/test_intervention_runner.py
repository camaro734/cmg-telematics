"""Tests del runner programado del detector de intervención (Paso 2b-2).

Verifican la seguridad del runner SIN tocar la BD: parsing de la allowlist,
que una allowlist vacía no procesa nada, y que el default arranca con el FUSO.
"""
import uuid

import pytest

from app.core import intervention_runner as ir


def test_allowlist_default_is_only_test_fuso():
    """El default de la allowlist contiene SOLO el FUSO de pruebas."""
    ids = ir._allowlist()
    assert ids == [uuid.UUID("8120ac70-7dc4-4af8-9afd-0cc61bde690a")]


def test_allowlist_parses_csv_and_skips_invalid(monkeypatch):
    a, b = uuid.uuid4(), uuid.uuid4()
    monkeypatch.setattr(ir.settings, "intervention_runner_vehicle_ids", f" {a} , no-uuid, {b} ")
    assert ir._allowlist() == [a, b]


def test_allowlist_empty_means_nothing(monkeypatch):
    monkeypatch.setattr(ir.settings, "intervention_runner_vehicle_ids", "")
    assert ir._allowlist() == []


@pytest.mark.asyncio
async def test_run_once_empty_allowlist_touches_no_db(monkeypatch):
    """Allowlist vacía → run_once devuelve 0 y NO abre sesión a la BD."""
    monkeypatch.setattr(ir.settings, "intervention_runner_vehicle_ids", "")

    def _boom(*a, **k):  # pragma: no cover - debe no llamarse nunca
        raise AssertionError("run_once no debe abrir sesión a la BD con allowlist vacía")

    monkeypatch.setattr(ir, "AsyncSessionLocal", _boom)
    assert await ir.run_once() == 0
