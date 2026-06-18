"""
Tests para PATCH /api/v1/devices/{id} — campo out_of_service.
Verifica que el timestamp se sella al activar y se limpia al desactivar,
y que no hay error al resolver la alerta de silencio si hay vehicle_id.
"""
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime, timezone
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser
from app.models.device import Device

# --- IDs fijos ---
CMG_TENANT_ID = uuid.UUID("10000000-0000-0000-0000-000000000000")
DEVICE_ID     = uuid.UUID("d0000000-0000-0000-0000-000000000002")
VEHICLE_ID    = uuid.UUID("f0000000-0000-0000-0000-000000000002")

CMG_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CMG_TENANT_ID,
    tenant_tier="cmg", role="admin", email="cmg@test.com",
)


def _override_user(user: CurrentUser):
    app.dependency_overrides[get_current_user] = lambda: user


def _override_db(session):
    async def _gen():
        yield session
    app.dependency_overrides[get_db] = _gen


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def _make_device(
    *,
    out_of_service: bool = False,
    out_of_service_since: datetime | None = None,
    vehicle_id: uuid.UUID | None = None,
) -> MagicMock:
    """Crea un mock de Device con atributos completos para DeviceOut."""
    device = MagicMock(spec=Device)
    device.id = DEVICE_ID
    device.tenant_id = CMG_TENANT_ID
    device.vehicle_id = vehicle_id
    device.imei = "123456789012345"
    device.model = "FMC650"
    device.firmware_ver = None
    device.online = False
    device.last_seen = None
    device.sim_phone = None
    device.active = True
    device.created_at = datetime.now(timezone.utc)
    device.out_of_service = out_of_service
    device.out_of_service_since = out_of_service_since
    # total_bytes y month_bytes con default en DeviceOut
    device.total_bytes = 0
    device.month_bytes = 0
    return device


def _build_db(device: MagicMock) -> AsyncMock:
    """Construye un AsyncMock de AsyncSession que devuelve el device en get()."""
    db = AsyncMock()
    db.get = AsyncMock(return_value=device)
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    # Simular que setattr actualiza los atributos del mock
    # (el handler hace setattr(device, ...) antes del refresh)
    async def _refresh(obj):
        pass  # no-op; el handler ya mutó el objeto

    db.refresh.side_effect = _refresh
    return db


# ---------------------------------------------------------------------------
# Test 1 — PATCH out_of_service=True sella out_of_service_since
# ---------------------------------------------------------------------------
def test_patch_out_of_service_true_seals_timestamp():
    device = _make_device(out_of_service=False)
    db = _build_db(device)

    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.patch(f"/api/v1/devices/{DEVICE_ID}", json={"out_of_service": True})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["out_of_service"] is True
    assert body["out_of_service_since"] is not None


# ---------------------------------------------------------------------------
# Test 2 — PATCH out_of_service=False limpia out_of_service_since
# ---------------------------------------------------------------------------
def test_patch_out_of_service_false_clears_timestamp():
    device = _make_device(
        out_of_service=True,
        out_of_service_since=datetime.now(timezone.utc),
    )
    db = _build_db(device)

    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.patch(f"/api/v1/devices/{DEVICE_ID}", json={"out_of_service": False})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["out_of_service"] is False
    assert body["out_of_service_since"] is None


# ---------------------------------------------------------------------------
# Test 3 — PATCH out_of_service=True con vehicle_id no rompe (resuelve alerta)
# ---------------------------------------------------------------------------
def test_patch_out_of_service_true_with_vehicle_resolves_alert():
    device = _make_device(out_of_service=False, vehicle_id=VEHICLE_ID)
    db = _build_db(device)

    # Simular redis en app.state
    redis_mock = AsyncMock()
    app.state.redis = redis_mock

    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.patch(f"/api/v1/devices/{DEVICE_ID}", json={"out_of_service": True})

    assert resp.status_code == 200, resp.text
    assert resp.json()["out_of_service"] is True
    # db.execute fue llamado (UPDATE AlertInstance)
    db.execute.assert_awaited()


# ---------------------------------------------------------------------------
# Test 4 — Non-CMG admin recibe 403
# ---------------------------------------------------------------------------
def test_patch_out_of_service_forbidden_for_non_cmg():
    client_user = CurrentUser(
        user_id=uuid.uuid4(), tenant_id=uuid.uuid4(),
        tenant_tier="client", role="admin", email="client@test.com",
    )
    db = AsyncMock()

    _override_user(client_user)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.patch(f"/api/v1/devices/{DEVICE_ID}", json={"out_of_service": True})

    assert resp.status_code == 403
