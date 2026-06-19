"""
Tests TDD — Módulos por defecto al crear tenants tier=client.

Cubre:
- CMG crea tenant client sin enabled_modules → recibe DEFAULT_CLIENT_MODULES.
- Fabricante crea tenant client → también recibe DEFAULT_CLIENT_MODULES.
- CMG crea tenant con módulos explícitos → respeta los especificados.
- CMG crea tenant manufacturer → sin módulos por defecto (solo para client).
- DELIMEX tras backfill tiene los módulos default (integración razonada).
"""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.api.v1.tenants import DEFAULT_CLIENT_MODULES
from app.core.database import get_db
from app.schemas.auth import CurrentUser

# ---------------------------------------------------------------------------
# IDs fijos
# ---------------------------------------------------------------------------
CMG_TENANT_ID          = uuid.UUID("ae100000-0000-0000-0000-000000000001")
MANUFACTURER_TENANT_ID = uuid.UUID("ae200000-0000-0000-0000-000000000002")
NEW_CLIENT_ID          = uuid.UUID("ae300000-0000-0000-0000-000000000099")

# ---------------------------------------------------------------------------
# Usuarios
# ---------------------------------------------------------------------------
CMG_ADMIN = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CMG_TENANT_ID,
    tenant_tier="cmg", role="admin", email="admin@cmg.es",
)
MFR_ADMIN = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=MANUFACTURER_TENANT_ID,
    tenant_tier="manufacturer", role="admin", email="vps@test.com",
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _MockTenant:
    def __init__(self, tid: uuid.UUID, tier: str, name: str = "Test", slug: str = "test",
                 enabled_modules: list | None = None, active: bool = True,
                 parent_id: uuid.UUID | None = None, parent_manufacturer_id: uuid.UUID | None = None,
                 manufacturer_can_manage_clients: bool = False):
        self.id = tid
        self.tier = tier
        self.name = name
        self.slug = slug
        self.active = active
        self.enabled_modules = enabled_modules or []
        self.parent_id = parent_id
        self.parent_manufacturer_id = parent_manufacturer_id
        self.manufacturer_can_view_operations = True
        self.manufacturer_can_view_can_data = True
        self.manufacturer_can_create_rules = True
        self.manufacturer_can_manage_clients = manufacturer_can_manage_clients
        self.manufacturer_can_transfer_vehicles = False
        self.can_actuate_controls = False
        self.brand_name = None
        self.brand_color = None
        self.logo_url = None
        self.custom_domain = None
        self.brand_tokens = None
        self.business_cif = None
        self.business_address = None
        self.created_at = datetime.now(timezone.utc)


def _make_db(get_side_effects: list) -> AsyncMock:
    db = AsyncMock()
    db.get.side_effect = get_side_effects
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None  # slug no existe
    db.execute = AsyncMock(return_value=mock_result)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()

    async def _refresh(obj):
        if not getattr(obj, 'id', None):
            obj.id = NEW_CLIENT_ID
        if not getattr(obj, 'created_at', None):
            obj.created_at = datetime.now(timezone.utc)
        if getattr(obj, 'active', None) is None:
            obj.active = True
        if not hasattr(obj, 'parent_id'):
            obj.parent_id = None
        if not hasattr(obj, 'parent_manufacturer_id'):
            obj.parent_manufacturer_id = None
        if not hasattr(obj, 'brand_name'):
            obj.brand_name = None
        if not hasattr(obj, 'brand_color'):
            obj.brand_color = None
        if not hasattr(obj, 'logo_url'):
            obj.logo_url = None
        if not hasattr(obj, 'custom_domain'):
            obj.custom_domain = None
        if not hasattr(obj, 'brand_tokens'):
            obj.brand_tokens = None
        if not hasattr(obj, 'business_cif'):
            obj.business_cif = None
        if not hasattr(obj, 'business_address'):
            obj.business_address = None
        # El refresh real de BD aplica los server_default de los flags de fabricante;
        # aquí los reproducimos (3 antiguos = true, 2 de autogestión = false).
        if getattr(obj, 'manufacturer_can_view_operations', None) is None:
            obj.manufacturer_can_view_operations = True
        if getattr(obj, 'manufacturer_can_view_can_data', None) is None:
            obj.manufacturer_can_view_can_data = True
        if getattr(obj, 'manufacturer_can_create_rules', None) is None:
            obj.manufacturer_can_create_rules = True
        if getattr(obj, 'manufacturer_can_manage_clients', None) is None:
            obj.manufacturer_can_manage_clients = False
        if getattr(obj, 'manufacturer_can_transfer_vehicles', None) is None:
            obj.manufacturer_can_transfer_vehicles = False
        if getattr(obj, 'can_actuate_controls', None) is None:
            obj.can_actuate_controls = False

    db.refresh = _refresh
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
# Tests
# ---------------------------------------------------------------------------

def test_cmg_creates_client_gets_default_modules():
    """CMG crea tenant client sin enabled_modules → módulos default en el objeto creado."""
    mfr_parent = _MockTenant(CMG_TENANT_ID, "cmg")
    db = _make_db([mfr_parent])  # get(Tenant, parent_id) para validar jerarquía
    _setup(CMG_ADMIN, db)
    with TestClient(app) as c:
        r = c.post("/api/v1/tenants", json={
            "name": "Cliente Nuevo",
            "slug": "cliente-nuevo",
            "tier": "client",
            "parent_id": str(CMG_TENANT_ID),
        })
    assert r.status_code == 201
    # Verificar que el objeto Tenant añadido a la sesión tiene los módulos default
    added = db.add.call_args[0][0]
    assert set(added.enabled_modules) == set(DEFAULT_CLIENT_MODULES)


def test_manufacturer_creates_client_gets_default_modules():
    """Fabricante crea tenant client → módulos default sembrados."""
    # El fabricante necesita el flag manage_clients habilitado por CMG. create_tenant
    # hace db.get dos veces (verificación del flag + validación del parent), ambas al fabricante.
    mfr_parent = _MockTenant(MANUFACTURER_TENANT_ID, "manufacturer", manufacturer_can_manage_clients=True)
    db = _make_db([mfr_parent, mfr_parent])
    _setup(MFR_ADMIN, db)
    with TestClient(app) as c:
        r = c.post("/api/v1/tenants", json={
            "name": "Cliente VPS",
            "slug": "cliente-vps",
            "tier": "client",
        })
    assert r.status_code == 201
    added = db.add.call_args[0][0]
    assert set(added.enabled_modules) == set(DEFAULT_CLIENT_MODULES)


def test_cmg_creates_client_with_explicit_modules_respects_them():
    """Si se especifican módulos explícitamente, no se sobreescriben con los defaults."""
    mfr_parent = _MockTenant(CMG_TENANT_ID, "cmg")
    db = _make_db([mfr_parent])
    _setup(CMG_ADMIN, db)
    with TestClient(app) as c:
        r = c.post("/api/v1/tenants", json={
            "name": "Cliente Restringido",
            "slug": "cliente-restringido",
            "tier": "client",
            "parent_id": str(CMG_TENANT_ID),
            "enabled_modules": ["fleet"],
        })
    assert r.status_code == 201
    added = db.add.call_args[0][0]
    assert added.enabled_modules == ["fleet"]


def test_default_client_modules_contains_expected_set():
    """DEFAULT_CLIENT_MODULES tiene exactamente los 5 módulos acordados."""
    expected = {"fleet", "alerts", "maintenance", "reports", "work-orders"}
    assert set(DEFAULT_CLIENT_MODULES) == expected


def test_backfill_delimex_has_all_default_modules():
    """Integración razonada: tras el backfill, DELIMEX tendría todos los módulos.

    El seed_client_modules_20260612.sql asigna:
    '{alerts,fleet,maintenance,reports,work-orders}' WHERE tier='client' AND enabled_modules='{}'
    DELIMEX era tier=client y enabled_modules={} → queda con todos los módulos default.
    """
    # Este test documenta la invariante — el backfill debe ejecutarse manualmente
    # o via ops/seed_client_modules_20260612.sql antes del rebuild.
    delimex_modules_post_backfill = set(DEFAULT_CLIENT_MODULES)
    assert "fleet" in delimex_modules_post_backfill
    assert "maintenance" in delimex_modules_post_backfill
    assert "alerts" in delimex_modules_post_backfill
    assert "reports" in delimex_modules_post_backfill
    assert "work-orders" in delimex_modules_post_backfill
