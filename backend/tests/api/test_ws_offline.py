"""Tests para _enrich_payload: online:False se preserva (evento de desconexión TCP)."""
import pytest
from app.api.v1.ws import _enrich_payload


def test_enrich_calculates_online_for_recent_packet():
    from datetime import datetime, timezone, timedelta
    recent = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    payload = {"vehicle_id": "v1", "received_at": recent}
    result = _enrich_payload(payload)
    assert result["online"] is True
    assert result["device_last_seen"] == recent


def test_enrich_calculates_offline_for_old_packet():
    from datetime import datetime, timezone, timedelta
    old = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    payload = {"vehicle_id": "v1", "received_at": old}
    result = _enrich_payload(payload)
    assert result["online"] is False


def test_enrich_preserves_explicit_online_false():
    """Evento de desconexión TCP: online:False nunca debe ser sobreescrito."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    payload = {"vehicle_id": "v1", "tenant_id": "t1", "online": False, "received_at": now}
    result = _enrich_payload(payload)
    assert result["online"] is False


def test_enrich_maps_received_at_to_device_last_seen():
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    payload = {"vehicle_id": "v1", "received_at": now, "online": True}
    result = _enrich_payload(payload)
    assert result["device_last_seen"] == now
