"""
Tests TDD — Acceso manufacturer a vehículos de sus clientes (BLOQUE 3).

Cubre:
- Manufacturer con flag=true puede ver status de vehículo de su cliente → 200.
- Manufacturer con flag=false → 404 (flag revocado por el cliente).
- Manufacturer de OTRO fabricante (manufacturer_tenant_id no coincide) → 404.
- Manufacturer ve bulk statuses → incluye vehículo cuando flag=true.
- Manufacturer bulk con flag=false → excluye silenciosamente (lista vacía).
- Cliente (tier=client) ve sus propios vehículos → 200 (regresión).
"""
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser

# ---------------------------------------------------------------------------
# IDs fijos
# ---------------------------------------------------------------------------
MANUFACTURER_ID = uuid.UUID("ae200000-0000-0000-0000-000000000001")  # VPS
OTHER_MFR_ID    = uuid.UUID("ae200000-0000-0000-0000-000000000002")
CLIENT_ID       = uuid.UUID("ae300000-0000-0000-0000-000000000001")  # DELIMEX
VEHICLE_ID      = uuid.UUID("ae500000-0000-0000-0000-000000000001")  # FUSO 3.5

# ---------------------------------------------------------------------------
# Usuarios
# ---------------------------------------------------------------------------
MANUFACTURER_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=MANUFACTURER_ID,
    tenant_tier="manufacturer", role="admin", email="vps@test.com",
)
OTHER_MFR_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=OTHER_MFR_ID,
    tenant_tier="manufacturer", role="admin", email="othermfr@test.com",
)
CLIENT_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CLIENT_ID,
    tenant_tier="client", role="admin", email="delimex@test.com",
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _MockTenant:
    def __init__(self, tid: uuid.UUID, tier: str,
                 can_view_ops: bool = True, can_view_can: bool = True):
        self.id = tid
        self.tier = tier
        self.manufacturer_can_view_operations = can_view_ops
        self.manufacturer_can_view_can_data = can_view_can
        self.parent_manufacturer_id = None


class _MockVehicle:
    def __init__(self, manufacturer_tenant_id: uuid.UUID = MANUFACTURER_ID,
                 tenant_id: uuid.UUID = CLIENT_ID):
        self.id = VEHICLE_ID
        self.tenant_id = tenant_id
        self.manufacturer_tenant_id = manufacturer_tenant_id
        self.name = "FUSO 3.5"
        self.plate = "TEST1234"
        self.active = True
        self.vehicle_type_id = None


def _make_db(get_side_effects: list) -> AsyncMock:
    db = AsyncMock()
    db.get.side_effect = get_side_effects
    db.scalar = AsyncMock(return_value=None)
    db.scalars = AsyncMock()
    db.execute = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    return db


def _setup(user: CurrentUser, db: AsyncMock) -> None:
    app.dependency_overrides[get_current_user] = lambda: user
    async def _db_gen():
        yield db
    app.dependency_overrides[get_db] = _db_gen


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Tests GET /vehicles/{id}/status
# ---------------------------------------------------------------------------

def test_manufacturer_can_view_status_when_flag_true():
    """Manufacturer con flag=true pasa el gate de acceso en /status (retorna 200 con offline)."""
    vehicle = _MockVehicle()
    client_tenant = _MockTenant(CLIENT_ID, "client", can_view_ops=True)
    db = _make_db([vehicle, client_tenant])
    _setup(MANUFACTURER_USER, db)

    fake_redis = AsyncMock()
    fake_redis.hgetall = AsyncMock(return_value={})

    with TestClient(app) as c:
        c.app.state.redis = fake_redis
        r = c.get(f"/api/v1/vehicles/{VEHICLE_ID}/status")
    # Redis vacío → online=false (200), no 404 por gate de acceso
    assert r.status_code == 200
    assert r.json()["online"] is False


def test_manufacturer_blocked_when_flag_false():
    """Manufacturer con flag=false recibe 404 aunque sea su vehículo."""
    vehicle = _MockVehicle()
    client_tenant = _MockTenant(CLIENT_ID, "client", can_view_ops=False)
    db = _make_db([vehicle, client_tenant])
    _setup(MANUFACTURER_USER, db)

    with TestClient(app) as c:
        r = c.get(f"/api/v1/vehicles/{VEHICLE_ID}/status")
    assert r.status_code == 404


def test_other_manufacturer_blocked():
    """Manufacturer cuyo ID no coincide con manufacturer_tenant_id → 404."""
    vehicle = _MockVehicle(manufacturer_tenant_id=MANUFACTURER_ID)
    db = _make_db([vehicle])
    _setup(OTHER_MFR_USER, db)

    with TestClient(app) as c:
        r = c.get(f"/api/v1/vehicles/{VEHICLE_ID}/status")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Tests acceso técnico (avl-series scope="technical")
# ---------------------------------------------------------------------------

def test_manufacturer_can_view_avl_series_when_can_data_true():
    """Manufacturer con can_data=true puede llamar avl-series → no bloquea en gate."""
    vehicle = _MockVehicle()
    client_tenant = _MockTenant(CLIENT_ID, "client", can_view_ops=True, can_view_can=True)
    db = _make_db([vehicle, client_tenant])
    # execute devuelve resultado vacío (no hay telemetría en test)
    mock_result = MagicMock()
    mock_result.fetchall.return_value = []
    db.execute = AsyncMock(return_value=mock_result)
    _setup(MANUFACTURER_USER, db)

    with TestClient(app) as c:
        r = c.get(f"/api/v1/vehicles/{VEHICLE_ID}/avl-series?avl_id=145")
    assert r.status_code == 200
    assert r.json() == []


def test_manufacturer_blocked_avl_series_when_can_data_false():
    """Manufacturer con can_data=false → 404 en avl-series."""
    vehicle = _MockVehicle()
    client_tenant = _MockTenant(CLIENT_ID, "client", can_view_ops=True, can_view_can=False)
    db = _make_db([vehicle, client_tenant])
    _setup(MANUFACTURER_USER, db)

    with TestClient(app) as c:
        r = c.get(f"/api/v1/vehicles/{VEHICLE_ID}/avl-series?avl_id=145")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Regresión: cliente ve sus propios vehículos
# ---------------------------------------------------------------------------

def test_client_can_access_own_vehicle_status():
    """tenant_id == user.tenant_id → acceso directo sin check de flags (nivel 2)."""
    vehicle = _MockVehicle(tenant_id=CLIENT_ID)
    db = _make_db([vehicle])
    _setup(CLIENT_USER, db)

    fake_redis = AsyncMock()
    fake_redis.hgetall = AsyncMock(return_value={})

    with TestClient(app) as c:
        c.app.state.redis = fake_redis
        r = c.get(f"/api/v1/vehicles/{VEHICLE_ID}/status")
    assert r.status_code == 200
    assert r.json()["online"] is False
