"""
Tests TDD — Pieza A: alta de vehículo con tenant destino para manufacturer.

Cubre:
- Manufacturer crea vehículo en cliente propio → 201, tenant_id correcto, manufacturer_tenant_id=VPS.
- Manufacturer crea vehículo en cliente AJENO → 403 con mensaje claro (no silencioso).
- Manufacturer sin tenant_id en body → su propio tenant, manufacturer_tenant_id=VPS.
- CMG crea para cliente con parent_manufacturer_id → manufacturer_tenant_id deducido.
- Client no puede llamar al endpoint → 403 por require_management_tier.
"""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser
from app.models.vehicle import Vehicle
from app.models.vehicle_type import VehicleType
from app.models.tenant import Tenant

# --- IDs fijos ---
VPS_TENANT_ID   = uuid.UUID("aa000000-0000-0000-0000-000000000001")   # fabricante
AGUAS_TENANT_ID = uuid.UUID("bb000000-0000-0000-0000-000000000001")   # cliente de VPS
OTHER_MFR_ID    = uuid.UUID("cc000000-0000-0000-0000-000000000001")   # otro fabricante
OTHER_CLIENT_ID = uuid.UUID("dd000000-0000-0000-0000-000000000001")   # cliente de OTHER_MFR
CMG_TENANT_ID   = uuid.UUID("ee000000-0000-0000-0000-000000000001")
CLIENT_ONLY_ID  = uuid.UUID("ff000000-0000-0000-0000-000000000001")   # tier=client puro
VTYPE_ID        = uuid.UUID("0f000000-0000-0000-0000-000000000001")

# --- Usuarios ---
VPS_ADMIN = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=VPS_TENANT_ID,
    tenant_tier="manufacturer", role="admin", email="vps@test.com",
)
CMG_ADMIN = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CMG_TENANT_ID,
    tenant_tier="cmg", role="admin", email="cmg@test.com",
)
CLIENT_ADMIN = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CLIENT_ONLY_ID,
    tenant_tier="client", role="admin", email="client@test.com",
)

_BODY = {"name": "Camión Test", "vehicle_type_id": str(VTYPE_ID)}


def _mock_vtype() -> MagicMock:
    vt = MagicMock(spec=VehicleType)
    vt.id = VTYPE_ID
    vt.slug = "test-type"
    vt.maintenance_templates = []
    return vt


def _mock_tenant(tid: uuid.UUID, parent_manufacturer_id: uuid.UUID | None) -> MagicMock:
    t = MagicMock(spec=Tenant)
    t.id = tid
    t.parent_manufacturer_id = parent_manufacturer_id
    t.active = True
    return t


_VEHICLE_ID = uuid.UUID("a0000000-0000-0000-0000-000000000099")


async def _fake_refresh(obj):
    """Simula el DB refresh: rellena los campos generados por el servidor.
    No toca tenant_id ni manufacturer_tenant_id para verificar lo que el endpoint estableció."""
    obj.id = _VEHICLE_ID
    obj.active = True
    obj.created_at = datetime.now(timezone.utc)


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
# Test 1 — manufacturer crea vehículo en cliente propio → 201
# ---------------------------------------------------------------------------
def test_manufacturer_creates_for_own_client_201():
    db = AsyncMock()

    def _get(model, pk):
        if model is VehicleType:
            return _mock_vtype()
        if model is Tenant and str(pk) == str(AGUAS_TENANT_ID):
            return _mock_tenant(AGUAS_TENANT_ID, VPS_TENANT_ID)
        return None

    db.get = AsyncMock(side_effect=_get)
    db.refresh = _fake_refresh
    _setup(VPS_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        "/api/v1/vehicles", json={**_BODY, "tenant_id": str(AGUAS_TENANT_ID)},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert str(data["tenant_id"]) == str(AGUAS_TENANT_ID)
    assert data.get("manufacturer_tenant_id") == str(VPS_TENANT_ID)


# ---------------------------------------------------------------------------
# Test 2 — manufacturer crea en cliente AJENO → 403 explícito, mensaje claro
# ---------------------------------------------------------------------------
def test_manufacturer_creates_for_foreign_client_403():
    db = AsyncMock()

    def _get(model, pk):
        if model is VehicleType:
            return _mock_vtype()
        if model is Tenant and str(pk) == str(OTHER_CLIENT_ID):
            return _mock_tenant(OTHER_CLIENT_ID, OTHER_MFR_ID)
        return None

    db.get = AsyncMock(side_effect=_get)
    _setup(VPS_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        "/api/v1/vehicles", json={**_BODY, "tenant_id": str(OTHER_CLIENT_ID)},
    )
    assert resp.status_code == 403
    assert "clientes propios" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Test 3 — manufacturer sin tenant_id → su propio tenant, manufacturer_tenant_id seteado
# ---------------------------------------------------------------------------
def test_manufacturer_creates_without_tenant_id_goes_to_own():
    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, pk:
        _mock_vtype() if model is VehicleType else None
    )
    db.refresh = _fake_refresh
    _setup(VPS_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        "/api/v1/vehicles", json=_BODY,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert str(data["tenant_id"]) == str(VPS_TENANT_ID)
    assert data.get("manufacturer_tenant_id") == str(VPS_TENANT_ID)


# ---------------------------------------------------------------------------
# Test 4 — CMG crea para cliente con parent_manufacturer_id → manufacturer_tenant_id deducido
# ---------------------------------------------------------------------------
def test_cmg_creates_for_client_deduces_manufacturer_tenant_id():
    db = AsyncMock()

    def _get(model, pk):
        if model is VehicleType:
            return _mock_vtype()
        if model is Tenant and str(pk) == str(AGUAS_TENANT_ID):
            return _mock_tenant(AGUAS_TENANT_ID, VPS_TENANT_ID)
        return None

    db.get = AsyncMock(side_effect=_get)
    db.refresh = _fake_refresh
    _setup(CMG_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        "/api/v1/vehicles", json={**_BODY, "tenant_id": str(AGUAS_TENANT_ID)},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert str(data["tenant_id"]) == str(AGUAS_TENANT_ID)
    assert data.get("manufacturer_tenant_id") == str(VPS_TENANT_ID)


# ---------------------------------------------------------------------------
# Test 5 — client no puede crear vehículos → 403 por require_management_tier
# ---------------------------------------------------------------------------
def test_client_cannot_create_vehicle_403():
    _setup(CLIENT_ADMIN, AsyncMock())

    resp = TestClient(app, raise_server_exceptions=False).post(
        "/api/v1/vehicles", json=_BODY,
    )
    assert resp.status_code == 403
