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


# ---------------------------------------------------------------------------
# Helpers para tests CRUD de plantillas
# ---------------------------------------------------------------------------

TPL_ID = uuid.UUID("b0000000-0000-0000-0000-000000000001")


def _make_custom_tpl(
    slug: str = "mi_plantilla",
    name: str = "Mi Plantilla",
    is_builtin: bool = False,
    blocks: list | None = None,
) -> MagicMock:
    """Mock de SystemBlockTemplate con campos completos para serialización."""
    from app.models.system_block_template import SystemBlockTemplate
    tpl = MagicMock(spec=SystemBlockTemplate)
    tpl.id = TPL_ID
    tpl.slug = slug
    tpl.name = name
    tpl.description = "Desc de prueba"
    tpl.blocks = blocks if blocks is not None else list(_GENERICO_BLOCKS)
    tpl.is_builtin = is_builtin
    tpl.created_by = None
    tpl.created_at = "2026-06-03T12:00:00+00:00"
    tpl.updated_at = "2026-06-03T12:00:00+00:00"
    return tpl


def _db_single_tpl(tpl) -> AsyncMock:
    """DB mock que devuelve un único template en scalar_one_or_none."""
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=tpl))
    )
    return db


def _make_tpl_refresh():
    """AsyncMock para db.refresh que inyecta id y timestamps en objetos nuevos.

    SQLAlchemy aplica los default (uuid4, now()) solo en el flush real.
    Con db mockeada nunca hay flush, así que hay que setearlos aquí.
    """
    from datetime import datetime, timezone

    async def _refresh(obj):
        if getattr(obj, "id", None) is None:
            obj.id = TPL_ID
        if getattr(obj, "created_at", None) is None:
            obj.created_at = datetime(2026, 6, 3, 12, 0, 0, tzinfo=timezone.utc)
        if getattr(obj, "updated_at", None) is None:
            obj.updated_at = datetime(2026, 6, 3, 12, 0, 0, tzinfo=timezone.utc)

    return AsyncMock(side_effect=_refresh)


# ---------------------------------------------------------------------------
# GET /vehicle-types/system-blocks/templates/{template_id}
# ---------------------------------------------------------------------------

def test_get_template_by_id_ok():
    """GET por UUID devuelve la plantilla con sus campos."""
    tpl = _make_custom_tpl()
    db = _db_single_tpl(tpl)
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicle-types/system-blocks/templates/{TPL_ID}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["slug"] == "mi_plantilla"
    assert data["name"] == "Mi Plantilla"
    assert data["is_builtin"] is False
    assert len(data["blocks"]) == len(_GENERICO_BLOCKS)


def test_get_template_by_id_404():
    """UUID inexistente → 404."""
    db = _db_single_tpl(None)
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicle-types/system-blocks/templates/{uuid.uuid4()}")
    assert resp.status_code == 404


def test_get_template_by_id_403():
    """Cliente no CMG → 403."""
    db = AsyncMock()
    _override_user(CLIENT_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/vehicle-types/system-blocks/templates/{TPL_ID}")
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# POST /vehicle-types/system-blocks/templates  (crear)
# ---------------------------------------------------------------------------

def test_create_template_ok():
    """POST crea plantilla; slug autogenerado del name; is_builtin=false."""
    db = AsyncMock()
    # _unique_slug llama a db.execute una vez y no encuentra conflicto
    db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None))
    )
    db.commit = AsyncMock()
    db.refresh = _make_tpl_refresh()
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post(
        "/api/v1/vehicle-types/system-blocks/templates",
        json={"name": "Test Plantilla", "description": "Desc", "blocks": []},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["slug"] == "test_plantilla"
    assert data["is_builtin"] is False
    db.commit.assert_awaited_once()


def test_create_template_slug_collision_increments():
    """Si 'mi_nombre' ya existe, el segundo se llama 'mi_nombre_2'."""
    existing = _make_custom_tpl(slug="mi_nombre")
    db = AsyncMock()
    # Primera llamada (slug=mi_nombre): existe; segunda (slug=mi_nombre_2): libre
    db.execute = AsyncMock(side_effect=[
        MagicMock(scalar_one_or_none=MagicMock(return_value=existing)),
        MagicMock(scalar_one_or_none=MagicMock(return_value=None)),
    ])
    db.commit = AsyncMock()
    db.refresh = _make_tpl_refresh()
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post(
        "/api/v1/vehicle-types/system-blocks/templates",
        json={"name": "Mi Nombre", "blocks": []},
    )
    assert resp.status_code == 201
    assert resp.json()["slug"] == "mi_nombre_2"


def test_create_template_403():
    """Cliente no CMG → 403."""
    db = AsyncMock()
    _override_user(CLIENT_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post(
        "/api/v1/vehicle-types/system-blocks/templates",
        json={"name": "Test", "blocks": []},
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# PUT /vehicle-types/system-blocks/templates/{template_id}  (editar)
# ---------------------------------------------------------------------------

def test_update_template_ok():
    """PUT actualiza name, description y blocks."""
    tpl = _make_custom_tpl(is_builtin=False)
    db = _db_single_tpl(tpl)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    _override_user(CMG_USER)
    _override_db(db)

    new_blocks = [{"id": "block_motor", "name": "Motor", "icon": "ti-engine",
                   "sensor_keys": ["avl_30"], "key_sensor_keys": ["avl_30"], "key_count": 1}]
    with patch("app.api.v1.vehicles.flag_modified"):
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.put(
            f"/api/v1/vehicle-types/system-blocks/templates/{TPL_ID}",
            json={"name": "Nuevo Nombre", "description": "Nueva desc", "blocks": new_blocks},
        )
    assert resp.status_code == 200
    assert tpl.name == "Nuevo Nombre"
    assert tpl.description == "Nueva desc"
    db.commit.assert_awaited_once()


def test_update_builtin_template_ok():
    """Las plantillas de fábrica también se pueden editar."""
    tpl = _make_custom_tpl(is_builtin=True)
    db = _db_single_tpl(tpl)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    _override_user(CMG_USER)
    _override_db(db)

    with patch("app.api.v1.vehicles.flag_modified"):
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.put(
            f"/api/v1/vehicle-types/system-blocks/templates/{TPL_ID}",
            json={"name": "VPS Cuba v2", "description": None, "blocks": []},
        )
    assert resp.status_code == 200
    db.commit.assert_awaited_once()


def test_update_template_404():
    """UUID inexistente → 404."""
    db = _db_single_tpl(None)
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.put(
        f"/api/v1/vehicle-types/system-blocks/templates/{uuid.uuid4()}",
        json={"name": "X", "description": None, "blocks": []},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /vehicle-types/system-blocks/templates/{template_id}
# ---------------------------------------------------------------------------

def test_delete_template_ok():
    """DELETE elimina una plantilla no-builtin."""
    tpl = _make_custom_tpl(is_builtin=False)
    db = _db_single_tpl(tpl)
    db.delete = AsyncMock()
    db.commit = AsyncMock()
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.delete(f"/api/v1/vehicle-types/system-blocks/templates/{TPL_ID}")
    assert resp.status_code == 204
    db.delete.assert_awaited_once_with(tpl)
    db.commit.assert_awaited_once()


def test_delete_builtin_blocked():
    """DELETE en plantilla de fábrica → 400."""
    tpl = _make_custom_tpl(is_builtin=True)
    db = _db_single_tpl(tpl)
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.delete(f"/api/v1/vehicle-types/system-blocks/templates/{TPL_ID}")
    assert resp.status_code == 400
    assert "fábrica" in resp.json()["detail"]


def test_delete_template_404():
    """UUID inexistente → 404."""
    db = _db_single_tpl(None)
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.delete(f"/api/v1/vehicle-types/system-blocks/templates/{uuid.uuid4()}")
    assert resp.status_code == 404


def test_delete_template_403():
    """Cliente no CMG → 403."""
    db = AsyncMock()
    _override_user(CLIENT_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.delete(f"/api/v1/vehicle-types/system-blocks/templates/{TPL_ID}")
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# POST /vehicle-types/{type_id}/save-as-template
# ---------------------------------------------------------------------------

_BLOCKS_WITH_SENSORS = [
    {"id": "block_motor", "name": "Motor", "icon": "ti-engine",
     "sensor_keys": ["avl_30", "avl_85"], "key_sensor_keys": ["avl_30"], "key_count": 2},
    {"id": "block_hidraulico", "name": "Hidráulico", "icon": "ti-arrows-right-left",
     "sensor_keys": ["can_presion_alta"], "key_sensor_keys": ["can_presion_alta"], "key_count": 1},
]


def test_save_as_template_ok():
    """POST save-as crea plantilla nueva a partir del tipo de vehículo."""
    vt = _make_vtype(system_blocks=_BLOCKS_WITH_SENSORS)
    db = AsyncMock()
    # Call 1: get vtype; Call 2: slug check (_unique_slug → sin conflicto)
    db.execute = AsyncMock(side_effect=[
        MagicMock(scalar_one_or_none=MagicMock(return_value=vt)),
        MagicMock(scalar_one_or_none=MagicMock(return_value=None)),
    ])
    db.commit = AsyncMock()
    db.refresh = _make_tpl_refresh()
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post(
        f"/api/v1/vehicle-types/{VTYPE_ID}/save-as-template",
        json={"name": "Cisterna Config Real", "description": "Con sensores reales"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["slug"] == "cisterna_config_real"
    assert data["is_builtin"] is False
    db.commit.assert_awaited_once()


def test_save_as_template_copies_sensor_keys():
    """Los bloques copiados conservan sensor_keys (no se vacían)."""
    vt = _make_vtype(system_blocks=_BLOCKS_WITH_SENSORS)
    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[
        MagicMock(scalar_one_or_none=MagicMock(return_value=vt)),
        MagicMock(scalar_one_or_none=MagicMock(return_value=None)),
    ])
    db.commit = AsyncMock()
    captured: dict = {}

    async def _capture(obj):
        if hasattr(obj, "blocks"):
            captured["blocks"] = obj.blocks

    db.refresh = AsyncMock(side_effect=_capture)
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    client.post(
        f"/api/v1/vehicle-types/{VTYPE_ID}/save-as-template",
        json={"name": "Test Copia", "description": None},
    )
    assert captured["blocks"] == _BLOCKS_WITH_SENSORS


def test_save_as_template_404_vtype():
    """Tipo de vehículo inexistente → 404."""
    db = _db_single_tpl(None)
    _override_user(CMG_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post(
        f"/api/v1/vehicle-types/{uuid.uuid4()}/save-as-template",
        json={"name": "Test", "description": None},
    )
    assert resp.status_code == 404


def test_save_as_template_403():
    """Cliente no CMG → 403."""
    db = AsyncMock()
    _override_user(CLIENT_USER)
    _override_db(db)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post(
        f"/api/v1/vehicle-types/{VTYPE_ID}/save-as-template",
        json={"name": "Test", "description": None},
    )
    assert resp.status_code == 403
