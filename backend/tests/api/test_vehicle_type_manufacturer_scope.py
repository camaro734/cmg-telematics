"""Tests — alcance de plantillas (tipos de vehículo) por fabricante.

Cubre:
- GET /vehicle-types como CMG → ve todas + manufacturer_ids poblado.
- GET /vehicle-types como manufacturer con asignación → solo las asignadas (+ en-uso).
- GET /vehicle-types como manufacturer sin asignación → lista vacía (lista blanca estricta).
- GET /vehicle-types como subclient → hereda parent_manufacturer_id.
- GET /vehicle-types como cliente directo de CMG (parent_manufacturer_id None) → ve todas.
- PATCH /vehicle-types/{id} con manufacturer_ids → reemplaza el set (valida tier manufacturer).
"""
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser

CMG_ID = uuid.UUID("c0000000-0000-0000-0000-000000000001")
MFR_ID = uuid.UUID("c0000000-0000-0000-0000-000000000002")
CLIENT_ID = uuid.UUID("c0000000-0000-0000-0000-000000000003")
SUBCLIENT_ID = uuid.UUID("c0000000-0000-0000-0000-000000000004")
VT1 = uuid.UUID("a0000000-0000-0000-0000-000000000001")
VT2 = uuid.UUID("a0000000-0000-0000-0000-000000000002")

CMG_ADMIN = CurrentUser(user_id=uuid.uuid4(), tenant_id=CMG_ID, tenant_tier="cmg", role="admin", email="cmg@test.com")
MFR_ADMIN = CurrentUser(user_id=uuid.uuid4(), tenant_id=MFR_ID, tenant_tier="manufacturer", role="admin", email="mfr@test.com")
CLIENT_ADMIN = CurrentUser(user_id=uuid.uuid4(), tenant_id=CLIENT_ID, tenant_tier="client", role="admin", email="client@test.com")
SUBCLIENT_ADMIN = CurrentUser(user_id=uuid.uuid4(), tenant_id=SUBCLIENT_ID, tenant_tier="subclient", role="admin", email="sub@test.com")


class _VType:
    def __init__(self, vid: uuid.UUID, slug: str, name: str):
        self.id = vid
        self.slug = slug
        self.name = name
        self.sensor_schema = []


class _MockTenant:
    def __init__(self, tid: uuid.UUID, tier: str, parent_manufacturer_id=None):
        self.id = tid
        self.tier = tier
        self.parent_manufacturer_id = parent_manufacturer_id


def _scalars(items: list) -> MagicMock:
    m = MagicMock()
    m.scalars.return_value.all.return_value = items
    return m


def _rows(rows: list) -> MagicMock:
    m = MagicMock()
    m.all.return_value = rows
    return m


def _setup(user: CurrentUser, db: AsyncMock) -> None:
    app.dependency_overrides[get_current_user] = lambda: user

    async def _gen():
        yield db
    app.dependency_overrides[get_db] = _gen


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_cmg_sees_all_types_with_manufacturer_ids():
    db = AsyncMock()
    db.execute.side_effect = [
        _scalars([_VType(VT1, "cisterna", "Cisterna"), _VType(VT2, "barredora", "Barredora")]),
        _rows([(VT1, MFR_ID)]),  # asociaciones para poblar manufacturer_ids
    ]
    _setup(CMG_ADMIN, db)
    with TestClient(app) as c:
        r = c.get("/api/v1/vehicle-types")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 2
    by_id = {d["id"]: d for d in data}
    assert by_id[str(VT1)]["manufacturer_ids"] == [str(MFR_ID)]
    assert by_id[str(VT2)]["manufacturer_ids"] == []


def test_manufacturer_sees_only_assigned():
    db = AsyncMock()
    db.execute.side_effect = [
        _scalars([_VType(VT1, "cisterna", "Cisterna"), _VType(VT2, "barredora", "Barredora")]),
        _scalars([VT1]),  # asignadas
        _scalars([]),     # en-uso
    ]
    _setup(MFR_ADMIN, db)
    with TestClient(app) as c:
        r = c.get("/api/v1/vehicle-types")
    assert r.status_code == 200
    ids = [d["id"] for d in r.json()]
    assert ids == [str(VT1)]


def test_manufacturer_without_assignment_sees_none():
    db = AsyncMock()
    db.execute.side_effect = [
        _scalars([_VType(VT1, "cisterna", "Cisterna"), _VType(VT2, "barredora", "Barredora")]),
        _scalars([]),  # sin asignaciones
        _scalars([]),  # sin vehículos
    ]
    _setup(MFR_ADMIN, db)
    with TestClient(app) as c:
        r = c.get("/api/v1/vehicle-types")
    assert r.status_code == 200
    assert r.json() == []


def test_manufacturer_includes_types_in_use():
    """Salvaguarda: un tipo en uso por sus vehículos aparece aunque no esté asignado."""
    db = AsyncMock()
    db.execute.side_effect = [
        _scalars([_VType(VT1, "cisterna", "Cisterna"), _VType(VT2, "barredora", "Barredora")]),
        _scalars([]),       # sin asignaciones
        _scalars([VT2]),    # VT2 en uso
    ]
    _setup(MFR_ADMIN, db)
    with TestClient(app) as c:
        r = c.get("/api/v1/vehicle-types")
    assert [d["id"] for d in r.json()] == [str(VT2)]


def test_subclient_inherits_manufacturer_scope():
    db = AsyncMock()
    db.get = AsyncMock(return_value=_MockTenant(SUBCLIENT_ID, "subclient", parent_manufacturer_id=MFR_ID))
    db.execute.side_effect = [
        _scalars([_VType(VT1, "cisterna", "Cisterna"), _VType(VT2, "barredora", "Barredora")]),
        _scalars([VT1]),  # asignadas al fabricante padre
        _scalars([]),
    ]
    _setup(SUBCLIENT_ADMIN, db)
    with TestClient(app) as c:
        r = c.get("/api/v1/vehicle-types")
    assert [d["id"] for d in r.json()] == [str(VT1)]


def test_direct_cmg_client_sees_all():
    """Cliente colgado directo de CMG (parent_manufacturer_id None) → ve todas."""
    db = AsyncMock()
    db.get = AsyncMock(return_value=_MockTenant(CLIENT_ID, "client", parent_manufacturer_id=None))
    db.execute.side_effect = [
        _scalars([_VType(VT1, "cisterna", "Cisterna"), _VType(VT2, "barredora", "Barredora")]),
    ]
    _setup(CLIENT_ADMIN, db)
    with TestClient(app) as c:
        r = c.get("/api/v1/vehicle-types")
    assert len(r.json()) == 2


def test_patch_assigns_manufacturers():
    db = AsyncMock()
    vt = _VType(VT1, "cisterna", "Cisterna")
    db.get.side_effect = [vt, _MockTenant(MFR_ID, "manufacturer")]
    db.execute.side_effect = [
        MagicMock(),          # delete asociaciones previas
        _scalars([MFR_ID]),   # select final para manufacturer_ids
    ]
    _setup(CMG_ADMIN, db)
    with TestClient(app) as c:
        r = c.patch(f"/api/v1/vehicle-types/{VT1}", json={"manufacturer_ids": [str(MFR_ID)]})
    assert r.status_code == 200
    assert r.json()["manufacturer_ids"] == [str(MFR_ID)]
    db.add.assert_called_once()


def test_patch_rejects_non_manufacturer_tenant():
    db = AsyncMock()
    vt = _VType(VT1, "cisterna", "Cisterna")
    db.get.side_effect = [vt, _MockTenant(CLIENT_ID, "client")]
    _setup(CMG_ADMIN, db)
    with TestClient(app) as c:
        r = c.patch(f"/api/v1/vehicle-types/{VT1}", json={"manufacturer_ids": [str(CLIENT_ID)]})
    assert r.status_code == 422
    assert "fabricante" in r.json()["detail"].lower()
