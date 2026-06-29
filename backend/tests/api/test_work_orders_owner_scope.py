"""Tests de privacidad de los partes: dueño-exacto, sin bypass de niveles superiores.

Los partes de trabajo (`work_order` + `work_report`) son PRIVADOS del tenant que los
crea y de sus choferes. Ningún nivel superior (cmg/manufacturer/"VPS") los ve, ni en
lista, ni en detalle, ni en PDF, ni en el reporte agregado. Estos tests verifican el
cierre de los puntos de fuga de la auditoría sin tocar telemetría ni el toggle de
ubicación (mecanismos aparte).
"""
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser

# Tenant creador de los partes (cliente final, p. ej. DELIMEX) y su chofer.
CLIENT_ID = uuid.UUID("bb200000-0000-0000-0000-000000000001")
DRIVER_A = uuid.UUID("d4200000-0000-0000-0000-00000000000a")

# Niveles superiores: NO deben ver los partes del cliente.
CMG_USER = CurrentUser(user_id=uuid.uuid4(), tenant_id=uuid.uuid4(), tenant_tier="cmg", role="admin", email="cmg@t.com")
MFR_USER = CurrentUser(user_id=uuid.uuid4(), tenant_id=uuid.uuid4(), tenant_tier="manufacturer", role="admin", email="vps@t.com")
# Jefe de flota del cliente creador: SÍ debe verlos.
CLIENT_ADMIN = CurrentUser(user_id=uuid.uuid4(), tenant_id=CLIENT_ID, tenant_tier="client", role="admin", email="jefe@t.com")


def _setup(user, db):
    app.dependency_overrides[get_current_user] = lambda: user
    async def _g():
        yield db
    app.dependency_overrides[get_db] = _g


def _client():
    return TestClient(app, raise_server_exceptions=False)


def _make_tenant(tier, tid):
    return SimpleNamespace(id=tid, tier=tier, enabled_modules=["work-orders"])


def _make_order():
    """OT propiedad de CLIENT_ID (el cliente creador)."""
    return SimpleNamespace(
        id=uuid.uuid4(), tenant_id=CLIENT_ID, title="OT", description=None,
        vehicle_id=None, driver_id=DRIVER_A, status="done", priority="normal",
        scheduled_at=None, started_at=None, completed_at=None,
        location_address=None, location_lat=None, location_lon=None, notes=None,
        final_client_name=None, final_client_address=None, doc_number="PT-2026-00001",
        created_by=None, created_at=datetime.now(timezone.utc), auto_close_config=None,
    )


def _scalar(value):
    r = MagicMock()
    r.scalar_one_or_none = MagicMock(return_value=value)
    return r


def _scalars(items):
    r = MagicMock()
    r.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=items)))
    return r


def _smart_get(user, order):
    """db.get que discrimina por modelo. Tenant devuelve el del usuario que consulta."""
    async def _get(model, _id):
        name = getattr(model, "__name__", "")
        if name == "Tenant":
            return _make_tenant(user.tenant_tier, user.tenant_id)
        if name == "WorkOrder":
            return order
        if name == "Driver":
            return SimpleNamespace(full_name="Chofer")
        return None
    return AsyncMock(side_effect=_get)


@pytest.fixture(autouse=True)
def clear():
    yield
    app.dependency_overrides.clear()


# ── (a) CMG no ve los partes del cliente ────────────────────────────────────────

def test_cmg_list_filtered_to_own_tenant_only():
    """CMG admin: el listado se acota a SU tenant (no ve los de DELIMEX)."""
    db = AsyncMock()
    db.get = _smart_get(CMG_USER, None)
    db.execute = AsyncMock(side_effect=[_scalars([])])  # ninguna OT propia de CMG
    _setup(CMG_USER, db)
    resp = _client().get("/api/v1/work-orders")
    assert resp.status_code == 200
    assert resp.json() == []
    stmt = str(db.execute.call_args_list[0].args[0])
    assert "work_order.tenant_id =" in stmt        # filtra por tenant propio
    assert "work_order.tenant_id IN" not in stmt   # sin "ve todo" jerárquico


def test_cmg_cannot_open_client_order_detail_404():
    """CMG admin pide el detalle de una OT de DELIMEX → 404 (no revela existencia)."""
    db = AsyncMock()
    order = _make_order()
    db.get = _smart_get(CMG_USER, order)
    _setup(CMG_USER, db)
    resp = _client().get(f"/api/v1/work-orders/{order.id}")
    assert resp.status_code == 404


def test_cmg_cannot_get_client_report_403():
    """CMG admin pide el parte (report) de una OT de DELIMEX → 403."""
    db = AsyncMock()
    order = _make_order()
    db.get = _smart_get(CMG_USER, order)
    db.execute = AsyncMock(return_value=_scalar(order))  # _get_order_authorized lee la OT
    _setup(CMG_USER, db)
    resp = _client().get(f"/api/v1/work-orders/{order.id}/report")
    assert resp.status_code == 403


def test_cmg_cannot_download_client_pdf_403():
    """CMG admin pide el PDF del parte de una OT de DELIMEX → 403."""
    db = AsyncMock()
    order = _make_order()
    db.get = _smart_get(CMG_USER, order)
    db.execute = AsyncMock(return_value=_scalar(order))
    _setup(CMG_USER, db)
    resp = _client().get(f"/api/v1/work-orders/{order.id}/report/pdf")
    assert resp.status_code == 403


# ── (b) VPS/manufacturer tampoco ────────────────────────────────────────────────

def test_manufacturer_cannot_open_client_order_detail_404():
    """Manufacturer (VPS) pide el detalle de una OT de su cliente → 404."""
    db = AsyncMock()
    order = _make_order()
    db.get = _smart_get(MFR_USER, order)
    _setup(MFR_USER, db)
    resp = _client().get(f"/api/v1/work-orders/{order.id}")
    assert resp.status_code == 404


def test_manufacturer_cannot_get_client_report_403():
    """Manufacturer (VPS) pide el parte de una OT de su cliente → 403."""
    db = AsyncMock()
    order = _make_order()
    db.get = _smart_get(MFR_USER, order)
    db.execute = AsyncMock(return_value=_scalar(order))
    _setup(MFR_USER, db)
    resp = _client().get(f"/api/v1/work-orders/{order.id}/report")
    assert resp.status_code == 403


# ── (c) El jefe de flota del cliente creador SÍ ve sus partes ───────────────────

def test_client_admin_opens_own_order_detail_ok():
    """Jefe de flota de DELIMEX abre el detalle de su propia OT → 200."""
    db = AsyncMock()
    order = _make_order()
    db.get = _smart_get(CLIENT_ADMIN, order)
    _setup(CLIENT_ADMIN, db)
    resp = _client().get(f"/api/v1/work-orders/{order.id}")
    assert resp.status_code == 200
    assert resp.json()["doc_number"] == "PT-2026-00001"


def test_client_admin_list_scoped_to_own_tenant():
    """Jefe de flota: el listado filtra por su tenant y devuelve sus OTs."""
    db = AsyncMock()
    order = _make_order()
    db.get = _smart_get(CLIENT_ADMIN, order)
    db.execute = AsyncMock(side_effect=[_scalars([order])])
    _setup(CLIENT_ADMIN, db)
    resp = _client().get("/api/v1/work-orders")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    stmt = str(db.execute.call_args_list[0].args[0])
    assert "work_order.tenant_id =" in stmt


# ── Reporte agregado (P5/P6): el scope nunca es None, ni siquiera para CMG ───────

def test_report_scope_never_none_for_cmg():
    """`_resolve_scope` acota SIEMPRE al tenant propio → cierra la fuga del LEFT JOIN.

    Con scope != None, el SQL aplica `v.tenant_id = :scope` y CMG no recibe filas
    (ni datos de `work_order`) de otros tenants en el reporte de intervenciones.
    """
    from app.api.v1.work_cycle_reports import _resolve_scope
    assert _resolve_scope(CMG_USER, None) == CMG_USER.tenant_id
    assert _resolve_scope(MFR_USER, None) == MFR_USER.tenant_id
    assert _resolve_scope(CLIENT_ADMIN, None) == CLIENT_ID
