"""
Tests TDD — CRUD de vehicle_manual_can_slot.

1. Crear slot → 201, aparece en listado.
2. Crear slot duplicado (mismo slot) → 409.
3. Crear en vehículo de otro tenant → 404.
4. Editar param_id → 200, valor cambiado.
5. Borrar → 204, desaparece del listado.
6. Operator intenta crear → 403 (solo admin).
7. Listar como operator → 200 (permitido).
"""
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser
from app.models.vehicle_manual_can_slot import VehicleManualCanSlot

TENANT_A = uuid.UUID("da100000-0000-0000-0000-000000000001")
TENANT_B = uuid.UUID("da100000-0000-0000-0000-000000000002")
VEHICLE_A = uuid.UUID("da200000-0000-0000-0000-000000000001")
SLOT_ID = uuid.UUID("da300000-0000-0000-0000-000000000001")

ADMIN_A = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=TENANT_A,
    tenant_tier="client", role="admin", email="admin@a.com",
)
OPERATOR_A = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=TENANT_A,
    tenant_tier="client", role="operator", email="op@a.com",
)

URL_LIST = f"/api/v1/vehicles/{VEHICLE_A}/manual-can-slots"
URL_SLOT = f"/api/v1/vehicles/{VEHICLE_A}/manual-can-slots/{SLOT_ID}"
CREATE_BODY = {"slot": 0, "param_id": 31412, "description": "PTO bomba", "active": True}


class _MockVehicle:
    def __init__(self, tenant_id=TENANT_A, active=True):
        self.id = VEHICLE_A
        self.tenant_id = tenant_id
        self.active = active


class _MockSlot:
    def __init__(self, slot=0, param_id=31412, description="PTO bomba"):
        self.id = SLOT_ID
        self.vehicle_id = VEHICLE_A
        self.tenant_id = TENANT_A
        self.slot = slot
        self.param_id = param_id
        self.description = description
        self.active = True


def _make_db(*execute_returns):
    db = AsyncMock()
    db.execute.side_effect = [
        MagicMock(scalar_one_or_none=MagicMock(return_value=r),
                  scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[r] if r else []))))
        for r in execute_returns
    ]
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    return db


def _setup(user, db):
    app.dependency_overrides[get_current_user] = lambda: user
    async def _db_gen():
        yield db
    app.dependency_overrides[get_db] = _db_gen


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


# ─── 1. Crear slot → 201, aparece en listado ──────────────────────────────────
def test_create_slot_201():
    """POST crea slot y devuelve 201 con los datos."""
    db = AsyncMock()
    # execute para check duplicado → None; commit/refresh mock
    db.execute.return_value = MagicMock(scalar_one_or_none=MagicMock(return_value=None))
    db.commit = AsyncMock()
    new_slot = _MockSlot()

    async def _refresh(obj):
        obj.id = new_slot.id
        obj.vehicle_id = new_slot.vehicle_id
        obj.tenant_id = new_slot.tenant_id
        obj.slot = new_slot.slot
        obj.param_id = new_slot.param_id
        obj.description = new_slot.description
        obj.active = new_slot.active

    db.refresh = _refresh
    _setup(ADMIN_A, db)

    with patch("app.api.v1.vehicles.assert_can_access_vehicle", new_callable=AsyncMock) as mock_access:
        mock_access.return_value = _MockVehicle()
        with TestClient(app) as c:
            r = c.post(URL_LIST, json=CREATE_BODY)

    assert r.status_code == 201
    body = r.json()
    assert body["slot"] == 0
    assert body["param_id"] == 31412
    assert body["description"] == "PTO bomba"
    assert body["active"] is True


# ─── 2. Slot duplicado → 409 ──────────────────────────────────────────────────
def test_create_duplicate_slot_409():
    """Mismo slot para mismo vehículo → 409."""
    db = AsyncMock()
    db.execute.return_value = MagicMock(scalar_one_or_none=MagicMock(return_value=_MockSlot()))
    _setup(ADMIN_A, db)

    with patch("app.api.v1.vehicles.assert_can_access_vehicle", new_callable=AsyncMock) as mock_access:
        mock_access.return_value = _MockVehicle()
        with TestClient(app) as c:
            r = c.post(URL_LIST, json=CREATE_BODY)

    assert r.status_code == 409
    assert "ya está configurado" in r.json()["detail"]


# ─── 3. Vehículo de otro tenant → 404 ────────────────────────────────────────
def test_create_wrong_tenant_404():
    """assert_can_access_vehicle lanza 404 para cross-tenant."""
    db = AsyncMock()
    _setup(ADMIN_A, db)

    async def _raise_404(*args, **kwargs):
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    with patch("app.api.v1.vehicles.assert_can_access_vehicle", side_effect=_raise_404):
        with TestClient(app) as c:
            r = c.post(URL_LIST, json=CREATE_BODY)

    assert r.status_code == 404


# ─── 4. Editar param_id → 200, valor cambiado ────────────────────────────────
def test_patch_param_id_200():
    """PATCH cambia param_id, devuelve 200 con el nuevo valor."""
    existing = _MockSlot(param_id=31412)
    db = AsyncMock()
    db.execute.return_value = MagicMock(scalar_one_or_none=MagicMock(return_value=existing))
    db.commit = AsyncMock()

    async def _refresh(obj):
        # simular que el commit guardó el nuevo valor
        pass

    db.refresh = _refresh
    _setup(ADMIN_A, db)

    with patch("app.api.v1.vehicles.assert_can_access_vehicle", new_callable=AsyncMock) as mock_access:
        mock_access.return_value = _MockVehicle()
        with TestClient(app) as c:
            r = c.patch(URL_SLOT, json={"param_id": 99999})

    assert r.status_code == 200
    # El objeto mutado en el endpoint tiene el nuevo param_id
    assert existing.param_id == 99999


# ─── 5. Borrar → 204, desaparece ─────────────────────────────────────────────
def test_delete_slot_204():
    """DELETE elimina el slot y devuelve 204."""
    existing = _MockSlot()
    db = AsyncMock()
    db.execute.return_value = MagicMock(scalar_one_or_none=MagicMock(return_value=existing))
    db.commit = AsyncMock()
    db.delete = AsyncMock()
    _setup(ADMIN_A, db)

    with patch("app.api.v1.vehicles.assert_can_access_vehicle", new_callable=AsyncMock) as mock_access:
        mock_access.return_value = _MockVehicle()
        with TestClient(app) as c:
            r = c.delete(URL_SLOT)

    assert r.status_code == 204
    db.delete.assert_called_once_with(existing)
    db.commit.assert_called_once()


# ─── 6. Operator crea → 403 ───────────────────────────────────────────────────
def test_operator_create_403():
    """Operator no puede crear slots (solo admin)."""
    db = AsyncMock()
    _setup(OPERATOR_A, db)

    with TestClient(app) as c:
        r = c.post(URL_LIST, json=CREATE_BODY)

    assert r.status_code == 403
    db.execute.assert_not_called()


# ─── 7. Operator lista → 200 ─────────────────────────────────────────────────
def test_operator_list_200():
    """Operator puede listar slots (lectura permitida)."""
    slot = _MockSlot()
    db = AsyncMock()

    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [slot]
    db.execute.return_value = mock_result
    _setup(OPERATOR_A, db)

    with patch("app.api.v1.vehicles.assert_can_access_vehicle", new_callable=AsyncMock) as mock_access:
        mock_access.return_value = _MockVehicle()
        with TestClient(app) as c:
            r = c.get(URL_LIST)

    assert r.status_code == 200
