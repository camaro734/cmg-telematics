import uuid
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser
from app.models.tenant import Tenant

CMG_ID = uuid.UUID("ee100000-0000-0000-0000-000000000001")
MFR_ID = uuid.UUID("aa100000-0000-0000-0000-000000000001")
CLIENT_ID = uuid.UUID("bb100000-0000-0000-0000-000000000001")

CMG_ADMIN = CurrentUser(user_id=uuid.uuid4(), tenant_id=CMG_ID, tenant_tier="cmg", role="admin", email="cmg@t.com")
MFR_ADMIN = CurrentUser(user_id=uuid.uuid4(), tenant_id=MFR_ID, tenant_tier="manufacturer", role="admin", email="m@t.com")


def _setup(user, db):
    app.dependency_overrides[get_current_user] = lambda: user
    async def _g():
        yield db
    app.dependency_overrides[get_db] = _g


@pytest.fixture(autouse=True)
def clear():
    yield
    app.dependency_overrides.clear()


class _MfrTenant:
    """Tenant fabricante mutable."""
    def __init__(self):
        self.id = MFR_ID
        self.tier = "manufacturer"
        self.parent_id = None
        self.parent_manufacturer_id = None
        self.name = "VPS"
        self.slug = "vps"
        self.active = True
        self.brand_name = None; self.brand_color = None; self.logo_url = None
        self.custom_domain = None; self.brand_tokens = None
        self.enabled_modules = []
        self.business_cif = None; self.business_address = None
        self.created_at = datetime.now(timezone.utc)
        self.manufacturer_can_view_operations = True
        self.manufacturer_can_view_can_data = True
        self.manufacturer_can_create_rules = True
        self.manufacturer_can_manage_clients = False
        self.manufacturer_can_transfer_vehicles = False


def test_manufacturer_without_flag_cannot_create_client_403():
    mfr = _MfrTenant()  # manage_clients = False
    db = AsyncMock()
    db.get = AsyncMock(return_value=mfr)
    _setup(MFR_ADMIN, db)
    resp = TestClient(app, raise_server_exceptions=False).post(
        "/api/v1/tenants",
        json={"tier": "client", "name": "Delimex", "slug": "delimex"},
    )
    assert resp.status_code == 403


def test_manufacturer_with_flag_creates_client_201():
    mfr = _MfrTenant()
    mfr.manufacturer_can_manage_clients = True
    db = AsyncMock()
    # db.get(Tenant, MFR_ID) → mfr;  slug-check select → None
    db.get = AsyncMock(return_value=mfr)
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None)))
    db.add = MagicMock()  # db.add es síncrono en SQLAlchemy; evita coroutine sin await
    # refresh simula lo que haría la BD: rellena los server_defaults que ORM no aplica en __init__
    async def _refresh(obj):
        obj.id = obj.id or uuid.uuid4()
        obj.active = True if obj.active is None else obj.active
        obj.created_at = obj.created_at or datetime.now(timezone.utc)
        obj.manufacturer_can_view_operations = True
        obj.manufacturer_can_view_can_data = True
        obj.manufacturer_can_create_rules = True
        obj.manufacturer_can_manage_clients = getattr(obj, "manufacturer_can_manage_clients", False) or False
        obj.manufacturer_can_transfer_vehicles = False
        obj.enabled_modules = obj.enabled_modules or []
        obj.compliance_level = getattr(obj, "compliance_level", "standard") or "standard"
    db.refresh = _refresh
    _setup(MFR_ADMIN, db)
    resp = TestClient(app, raise_server_exceptions=False).post(
        "/api/v1/tenants",
        json={"tier": "client", "name": "Delimex", "slug": "delimex"},
    )
    assert resp.status_code == 201


def test_cmg_can_set_manufacturer_flags():
    tenant = _MfrTenant()
    db = AsyncMock()
    db.get = AsyncMock(return_value=tenant)
    db.refresh = AsyncMock()
    _setup(CMG_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).patch(
        f"/api/v1/tenants/{MFR_ID}",
        json={"manufacturer_can_manage_clients": True, "manufacturer_can_transfer_vehicles": True},
    )
    assert resp.status_code == 200
    assert tenant.manufacturer_can_manage_clients is True
    assert tenant.manufacturer_can_transfer_vehicles is True
    body = resp.json()
    assert body["manufacturer_can_manage_clients"] is True


def test_manufacturer_without_flag_can_create_user_in_own_tenant_201():
    """
    Fabricante admin SIN el flag manage_clients puede crear usuarios en su PROPIO tenant.
    La puerta del flag solo aplica cuando target_tenant_id != user.tenant_id.

    Mock realista: db.get despacha por UUID mediante side_effect.
    assert_can_manage_tenant hace early-return en línea 66 de deps.py (target == propio
    tenant) sin llamar a db.get, así que el único db.get del endpoint es para verificar
    que el tenant destino está activo (línea ~429 de tenants.py).

    Se usa MagicMock con spec=None para el User porque SQLAlchemy impide instanciar
    modelos ORM mediante __new__ sin _sa_instance_state; db.refresh rellena los campos
    mínimos que UserOut requiere para serializar.
    """
    mfr = _MfrTenant()
    mfr.manufacturer_can_manage_clients = False  # flag desactivado deliberadamente

    async def _db_get(model, pk):
        # assert_can_manage_tenant no llega a db.get (early-return); solo llega la
        # llamada para verificar el tenant activo y, tras db.add, el db.refresh del User.
        if pk == MFR_ID:
            return mfr
        return None

    db = AsyncMock()
    db.get = AsyncMock(side_effect=_db_get)
    db.add = MagicMock()

    async def _refresh(obj):
        # Rellena atributos mínimos que UserOut necesita para serializar.
        # obj es el User ORM real creado por create_tenant_user; modificamos sus
        # atributos directamente (SQLAlchemy permite setattr sobre objetos en estado
        # transient/pending sin sesión activa real).
        if not obj.id:
            obj.id = uuid.uuid4()
        obj.active = True
        if not getattr(obj, "created_at", None):
            obj.created_at = datetime.now(timezone.utc)

    db.refresh = _refresh
    _setup(MFR_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        f"/api/v1/tenants/{MFR_ID}/users",
        json={"email": "nuevo@fabricante.com", "password": "Passw0rd!", "full_name": "Nuevo Usuario", "role": "operator"},
    )
    # Sin el fix → 403; con el fix → 201
    assert resp.status_code == 201


def test_manufacturer_without_flag_cannot_create_user_in_client_tenant_403():
    """
    Fabricante admin SIN el flag manage_clients NO puede crear usuarios en un tenant
    cliente (target_tenant_id != MFR_ID), y debe recibir 403.

    assert_can_manage_tenant llega hasta la comprobación manufacturer (línea 74-78 de
    deps.py) y llama a db.get(Tenant, CLIENT_ID) para verificar parent_manufacturer_id.
    Luego create_tenant_user comprueba el flag y lanza 403.
    """
    mfr = _MfrTenant()
    mfr.manufacturer_can_manage_clients = False

    # Tenant cliente cuyo parent_manufacturer_id apunta al fabricante
    client_tenant = _MfrTenant()
    client_tenant.id = CLIENT_ID
    client_tenant.tier = "client"
    client_tenant.parent_id = None
    client_tenant.parent_manufacturer_id = MFR_ID
    client_tenant.name = "ClienteCo"
    client_tenant.slug = "clienteco"
    client_tenant.manufacturer_can_manage_clients = False

    async def _db_get(model, pk):
        if pk == MFR_ID:
            return mfr
        if pk == CLIENT_ID:
            return client_tenant
        return None

    db = AsyncMock()
    db.get = AsyncMock(side_effect=_db_get)
    _setup(MFR_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        f"/api/v1/tenants/{CLIENT_ID}/users",
        json={"email": "nuevo@cliente.com", "password": "Passw0rd!", "full_name": "Nuevo Usuario", "role": "operator"},
    )
    assert resp.status_code == 403
    assert "fabricante" in resp.json()["detail"].lower()


def test_auth_me_returns_self_service_flags():
    mfr = _MfrTenant()
    mfr.manufacturer_can_manage_clients = True
    mfr.manufacturer_can_transfer_vehicles = False
    db = AsyncMock()
    db.get = AsyncMock(return_value=mfr)
    _setup(MFR_ADMIN, db)
    resp = TestClient(app, raise_server_exceptions=False).get("/api/v1/auth/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["manufacturer_can_manage_clients"] is True
    assert body["manufacturer_can_transfer_vehicles"] is False
