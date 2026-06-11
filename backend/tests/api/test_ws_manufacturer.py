"""
Tests para _broadcast_channels: lógica de dispatch al fabricante del vehículo.
"""
import pytest
from app.api.v1.ws import _broadcast_channels


# ── Telemetría ─────────────────────────────────────────────────────────────────

def test_manufacturer_different_from_tenant_receives_telemetry():
    """Fabricante ≠ tenant → ambos canales (más __cmg__)."""
    channels = _broadcast_channels("tenant-a", "mfr-x", "telemetry")
    assert "tenant-a" in channels
    assert "mfr-x" in channels
    assert "__cmg__" in channels
    assert len(channels) == 3


def test_manufacturer_same_as_tenant_no_duplicate():
    """Fabricante == tenant → canal único (más __cmg__), sin duplicado."""
    channels = _broadcast_channels("tenant-a", "tenant-a", "telemetry")
    assert channels.count("tenant-a") == 1
    assert "__cmg__" in channels
    assert len(channels) == 2


def test_manufacturer_none_only_tenant_and_cmg():
    """Sin fabricante → solo el tenant propietario + __cmg__."""
    channels = _broadcast_channels("tenant-a", None, "telemetry")
    assert channels == ["tenant-a", "__cmg__"]


def test_no_tenant_no_manufacturer_only_cmg():
    """Sin tenant ni fabricante → solo __cmg__ (vehículo huérfano)."""
    channels = _broadcast_channels(None, None, "telemetry")
    assert channels == ["__cmg__"]


# ── Alertas — fabricante NO recibe ────────────────────────────────────────────

def test_alert_event_does_not_reach_manufacturer():
    """Las alertas son del tenant propietario; el fabricante no las recibe."""
    channels = _broadcast_channels("tenant-a", "mfr-x", "alert")
    assert "mfr-x" not in channels
    assert "tenant-a" in channels
    assert "__cmg__" in channels
    assert len(channels) == 2


def test_alert_event_with_same_manufacturer_no_duplicate():
    """Alerta con fabricante == tenant → sin duplicado."""
    channels = _broadcast_channels("tenant-a", "tenant-a", "alert")
    assert channels.count("tenant-a") == 1
    assert len(channels) == 2


# ── Offline event (telemetría sin ignición) ────────────────────────────────────

def test_offline_event_reaches_manufacturer():
    """El evento offline tiene ws_type 'telemetry' → el fabricante lo recibe."""
    channels = _broadcast_channels("tenant-a", "mfr-x", "telemetry")
    assert "mfr-x" in channels
