"""Tests para endpoints de system_blocks en /api/v1/vehicle-types."""
from unittest.mock import AsyncMock, MagicMock, patch
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser
from app.models.vehicle_type import VehicleType

CMG_TENANT_ID    = uuid.UUID("10000000-0000-0000-0000-000000000000")
CLIENT_TENANT_ID = uuid.UUID("20000000-0000-0000-0000-000000000000")
VTYPE_ID         = uuid.UUID("a0000000-0000-0000-0000-000000000001")

CMG_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CMG_TENANT_ID,
    tenant_tier="cmg", role="admin", email="cmg@test.com",
)
CLIENT_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CLIENT_TENANT_ID,
    tenant_tier="client", role="admin", email="client@test.com",
)
CMG_OPERATOR = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CMG_TENANT_ID,
    tenant_tier="cmg", role="operator", email="op@test.com",
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


def _make_vtype(system_blocks: list | None = None) -> MagicMock:
    vt = MagicMock(spec=VehicleType)
    vt.id = VTYPE_ID
    vt.slug = "cisterna"
    vt.name = "Cisterna"
    vt.icon_url = None
    vt.sensor_schema = []
    vt.maintenance_templates = []
    vt.historic_metrics = []
    vt.dout_config = []
    vt.pdf_metrics = []
    vt.system_blocks = system_blocks if system_blocks is not None else []
    return vt


BLOCK_PAYLOAD = [
    {
        "id": "block_motor",
        "name": "Motor",
        "icon": "ti-engine",
        "sensor_keys": ["avl_30", "avl_85"],
        "key_sensor_keys": ["avl_30"],
        "key_count": 2,
    }
]


# ---------------------------------------------------------------------------
# GET /vehicle-types/{id}/system-blocks
# ---------------------------------------------------------------------------

def test_get_system_blocks_empty_by_default():
    """GET devuelve [] cuando el tipo no tiene bloques configurados."""
    db = AsyncMock()
    vt = _make_vtype()
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=vt)))
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicle-types/{VTYPE_ID}/system-blocks")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_system_blocks_returns_existing():
    """GET devuelve los bloques almacenados."""
    db = AsyncMock()
    vt = _make_vtype(system_blocks=BLOCK_PAYLOAD)
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=vt)))
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicle-types/{VTYPE_ID}/system-blocks")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["id"] == "block_motor"


def test_get_system_blocks_404_unknown_type():
    """GET con tipo inexistente → 404."""
    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None)))
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicle-types/{uuid.uuid4()}/system-blocks")
    assert resp.status_code == 404


def test_get_system_blocks_403_client_admin():
    """Cliente no CMG → 403."""
    db = AsyncMock()
    _override_user(CLIENT_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicle-types/{VTYPE_ID}/system-blocks")
    assert resp.status_code == 403


def test_get_system_blocks_403_cmg_operator():
    """CMG operator (no admin) → 403."""
    db = AsyncMock()
    _override_user(CMG_OPERATOR)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicle-types/{VTYPE_ID}/system-blocks")
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# PATCH /vehicle-types/{id}/system-blocks
# ---------------------------------------------------------------------------

def test_patch_system_blocks_updates_and_persists():
    """PATCH reemplaza los bloques y los devuelve en la respuesta."""
    db = AsyncMock()
    vt = _make_vtype()
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=vt)))
    db.commit = AsyncMock()
    db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "system_blocks", BLOCK_PAYLOAD))
    _override_user(CMG_USER)
    _override_db(db)

    with patch("app.api.v1.vehicles.flag_modified") as mock_flag:
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.patch(
            f"/api/v1/vehicle-types/{VTYPE_ID}/system-blocks",
            json={"system_blocks": BLOCK_PAYLOAD},
        )
    assert resp.status_code == 200
    assert resp.json()["system_blocks"] == BLOCK_PAYLOAD
    db.commit.assert_awaited_once()
    mock_flag.assert_called_once_with(vt, "system_blocks")


def test_patch_system_blocks_empty_clears():
    """PATCH con lista vacía borra todos los bloques."""
    db = AsyncMock()
    vt = _make_vtype(system_blocks=BLOCK_PAYLOAD)
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=vt)))
    db.commit = AsyncMock()
    db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "system_blocks", []))
    _override_user(CMG_USER)
    _override_db(db)

    with patch("app.api.v1.vehicles.flag_modified"):
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.patch(
            f"/api/v1/vehicle-types/{VTYPE_ID}/system-blocks",
            json={"system_blocks": []},
        )
    assert resp.status_code == 200
    assert resp.json()["system_blocks"] == []


def test_patch_system_blocks_403_client():
    """Cliente no CMG → 403."""
    db = AsyncMock()
    _override_user(CLIENT_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.patch(
        f"/api/v1/vehicle-types/{VTYPE_ID}/system-blocks",
        json={"system_blocks": []},
    )
    assert resp.status_code == 403


def test_patch_system_blocks_404_unknown_type():
    """Tipo inexistente → 404."""
    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None)))
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.patch(
        f"/api/v1/vehicle-types/{uuid.uuid4()}/system-blocks",
        json={"system_blocks": []},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /vehicle-types/system-blocks/templates
# ---------------------------------------------------------------------------

_GENERICO_BLOCKS = [
    {"id": "block_motor",        "name": "Motor",        "icon": "ti-engine",      "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
    {"id": "block_electrico",    "name": "Eléctrico",    "icon": "ti-bolt",        "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
    {"id": "block_combustible",  "name": "Combustible",  "icon": "ti-gas-station", "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
    {"id": "block_localizacion", "name": "Localización", "icon": "ti-map-pin",     "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
    {"id": "block_seguridad",    "name": "Seguridad",    "icon": "ti-shield",      "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
    {"id": "block_mantenimiento","name": "Mantenimiento","icon": "ti-tool",        "sensor_keys": [], "key_sensor_keys": [], "key_count": 2},
]


def _make_tpl(slug: str, name: str, blocks: list | None = None) -> MagicMock:
    """Crea un mock de SystemBlockTemplate para usar en tests."""
    from app.models.system_block_template import SystemBlockTemplate
    tpl = MagicMock(spec=SystemBlockTemplate)
    tpl.slug = slug
    tpl.name = name
    tpl.description = f"Descripción de {name}"
    tpl.is_builtin = True
    tpl.blocks = blocks if blocks is not None else _GENERICO_BLOCKS
    return tpl


def _db_returning_templates(templates: list) -> AsyncMock:
    """DB mock que devuelve una lista de plantillas en scalars().all()."""
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=MagicMock(scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=templates))))
    )
    return db


def test_get_templates_returns_four():
    """GET templates devuelve exactamente las 4 plantillas desde la BD."""
    slugs = ["vps_cuba", "max_barredora", "basura_recolectora", "generico"]
    rows = [_make_tpl(s, s.replace("_", " ").title()) for s in slugs]
    db = _db_returning_templates(rows)
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/vehicle-types/system-blocks/templates")
    assert resp.status_code == 200
    data = resp.json()
    assert set(data.keys()) == {"vps_cuba", "max_barredora", "basura_recolectora", "generico"}


def test_get_templates_403_client():
    """Cliente no CMG → 403."""
    db = AsyncMock()
    _override_user(CLIENT_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/vehicle-types/system-blocks/templates")
    assert resp.status_code == 403


def test_templates_blocks_have_required_fields():
    """Cada bloque de cada plantilla tiene los campos requeridos."""
    rows = [_make_tpl("generico", "Genérico")]
    db = _db_returning_templates(rows)
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/vehicle-types/system-blocks/templates")
    assert resp.status_code == 200
    for _slug, tpl in resp.json().items():
        for block in tpl["blocks"]:
            assert "id" in block
            assert "name" in block
            assert "icon" in block
            assert "sensor_keys" in block
            assert "key_sensor_keys" in block


# ---------------------------------------------------------------------------
# POST /vehicle-types/{id}/apply-template
# ---------------------------------------------------------------------------

def test_apply_template_replaces_blocks():
    """POST apply-template reemplaza los bloques con los de la plantilla."""
    tpl = _make_tpl("generico", "Genérico")
    vt = _make_vtype()

    db = AsyncMock()
    # Primera llamada: buscar la plantilla; segunda: buscar el vehicle_type
    db.execute = AsyncMock(side_effect=[
        MagicMock(scalar_one_or_none=MagicMock(return_value=tpl)),
        MagicMock(scalar_one_or_none=MagicMock(return_value=vt)),
    ])
    db.commit = AsyncMock()
    db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "system_blocks", tpl.blocks))
    _override_user(CMG_USER)
    _override_db(db)

    with patch("app.api.v1.vehicles.flag_modified"):
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post(
            f"/api/v1/vehicle-types/{VTYPE_ID}/apply-template",
            json={"template_id": "generico"},
        )
    assert resp.status_code == 200
    assert resp.json()["system_blocks"] == tpl.blocks
    db.commit.assert_awaited_once()


def test_apply_template_400_unknown_template():
    """Plantilla inexistente en BD → 400."""
    db = AsyncMock()
    # La búsqueda de la plantilla devuelve None
    db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None))
    )
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post(
        f"/api/v1/vehicle-types/{VTYPE_ID}/apply-template",
        json={"template_id": "no_existe"},
    )
    assert resp.status_code == 400


def test_apply_template_404_unknown_type():
    """Tipo inexistente → 404."""
    tpl = _make_tpl("generico", "Genérico")
    db = AsyncMock()
    # Primera llamada: plantilla encontrada; segunda: vehicle_type no existe
    db.execute = AsyncMock(side_effect=[
        MagicMock(scalar_one_or_none=MagicMock(return_value=tpl)),
        MagicMock(scalar_one_or_none=MagicMock(return_value=None)),
    ])
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post(
        f"/api/v1/vehicle-types/{uuid.uuid4()}/apply-template",
        json={"template_id": "generico"},
    )
    assert resp.status_code == 404


def test_apply_template_403_client():
    """Cliente no CMG → 403."""
    db = AsyncMock()
    _override_user(CLIENT_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post(
        f"/api/v1/vehicle-types/{VTYPE_ID}/apply-template",
        json={"template_id": "generico"},
    )
    assert resp.status_code == 403
