"""Tests para backend/app/api/v1/access_v2.py — helper de permisos v2.

Patrón: llamadas async directas al helper (no TestClient) con db mockeado.
asyncio_mode=auto en pyproject.toml → no necesitan decoradores.
"""
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.api.v1.access_v2 import assert_can_access_vehicle, list_accessible_vehicle_ids
from app.models.access_audit_log import AccessAuditLog
from app.models.driver import VehicleDriverAssignment
from app.models.tenant import Tenant
from app.models.vehicle import Vehicle
from app.schemas.auth import CurrentUser

# ---------------------------------------------------------------------------
# IDs fijos de prueba
# ---------------------------------------------------------------------------
CMG_TENANT_ID    = uuid.UUID("10000000-0000-0000-0000-000000000001")
CLIENT_TENANT_ID = uuid.UUID("20000000-0000-0000-0000-000000000002")
MANUF_TENANT_ID  = uuid.UUID("30000000-0000-0000-0000-000000000003")
OTHER_TENANT_ID  = uuid.UUID("40000000-0000-0000-0000-000000000004")
VEHICLE_ID       = uuid.UUID("a0000000-0000-0000-0000-000000000001")
DRIVER_USER_ID   = uuid.UUID("b0000000-0000-0000-0000-000000000001")

# ---------------------------------------------------------------------------
# Usuarios de prueba — constantes de módulo, inmutables entre tests
# ---------------------------------------------------------------------------
CMG_USER = CurrentUser(
    user_id=uuid.uuid4(),
    tenant_id=CMG_TENANT_ID,
    tenant_tier="cmg",
    role="admin",
    email="cmg@test.com",
)

CLIENT_USER = CurrentUser(
    user_id=uuid.uuid4(),
    tenant_id=CLIENT_TENANT_ID,
    tenant_tier="client",
    role="admin",
    email="client@test.com",
)

CLIENT_VIEWER = CurrentUser(
    user_id=uuid.uuid4(),
    tenant_id=CLIENT_TENANT_ID,
    tenant_tier="client",
    role="viewer",
    email="viewer@test.com",
)

DRIVER_USER = CurrentUser(
    user_id=DRIVER_USER_ID,
    tenant_id=CLIENT_TENANT_ID,
    tenant_tier="client",
    role="driver",
    email="driver@test.com",
)

MANUFACTURER_USER = CurrentUser(
    user_id=uuid.uuid4(),
    tenant_id=MANUF_TENANT_ID,
    tenant_tier="manufacturer",
    role="admin",
    email="manuf@test.com",
)


# ---------------------------------------------------------------------------
# Constructores de mocks
# ---------------------------------------------------------------------------

def _make_vehicle(
    tenant_id: uuid.UUID = CLIENT_TENANT_ID,
    manufacturer_tenant_id: uuid.UUID | None = None,
) -> MagicMock:
    v = MagicMock(spec=Vehicle)
    v.id = VEHICLE_ID
    v.tenant_id = tenant_id
    v.manufacturer_tenant_id = manufacturer_tenant_id
    return v


def _make_tenant(manufacturer_can_view_operations: bool = False) -> MagicMock:
    t = MagicMock(spec=Tenant)
    t.id = CLIENT_TENANT_ID
    t.manufacturer_can_view_operations = manufacturer_can_view_operations
    return t


def _make_assignment() -> MagicMock:
    a = MagicMock(spec=VehicleDriverAssignment)
    a.vehicle_id = VEHICLE_ID
    return a


def _make_db(
    vehicle: MagicMock | None = None,
    tenant: MagicMock | None = None,
    assignment: MagicMock | None = None,
) -> AsyncMock:
    """AsyncMock de AsyncSession para tests de access_v2.

    - db.get discrimina por tipo (Vehicle vs Tenant) via side_effect.
    - db.scalar devuelve la asignación de driver.
    - db.begin_nested devuelve un AsyncMock que actúa como async context
      manager (savepoint para el audit log).
    """
    db = AsyncMock()

    async def _get_side_effect(model, _id):
        if model is Vehicle:
            return vehicle
        if model is Tenant:
            return tenant
        return None

    db.get = AsyncMock(side_effect=_get_side_effect)
    db.scalar = AsyncMock(return_value=assignment)
    db.scalars = AsyncMock(return_value=[])
    db.begin_nested = MagicMock(return_value=AsyncMock())
    db.add = MagicMock()
    db.flush = AsyncMock()

    return db


# ===========================================================================
# Tests 1–3: CMG
# ===========================================================================

async def test_cmg_reads_cross_tenant_vehicle():
    """CMG accede a vehículo de otro tenant → devuelve vehicle."""
    vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)
    db = _make_db(vehicle=vehicle)

    result = await assert_can_access_vehicle(CMG_USER, VEHICLE_ID, db)

    assert result is vehicle


async def test_cmg_reads_own_tenant_vehicle_no_audit():
    """CMG accede a vehículo de su propio tenant → devuelve vehicle sin audit log."""
    vehicle = _make_vehicle(tenant_id=CMG_TENANT_ID)
    db = _make_db(vehicle=vehicle)

    result = await assert_can_access_vehicle(CMG_USER, VEHICLE_ID, db)

    assert result is vehicle
    db.begin_nested.assert_not_called()


async def test_cmg_cross_tenant_triggers_audit():
    """CMG accede a vehículo de otro tenant → crea entrada en AccessAuditLog."""
    vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)
    db = _make_db(vehicle=vehicle)

    await assert_can_access_vehicle(CMG_USER, VEHICLE_ID, db, operation="read", scope="all")

    db.begin_nested.assert_called_once()
    db.add.assert_called_once()
    added = db.add.call_args[0][0]
    assert isinstance(added, AccessAuditLog)
    assert added.user_tenant_tier == "cmg"
    assert added.target_tenant_id == CLIENT_TENANT_ID
    assert added.operation == "read"


# ===========================================================================
# Tests 4–5: Client admin
# ===========================================================================

async def test_client_admin_reads_own_vehicle():
    """Client admin accede a vehículo de su tenant → devuelve vehicle, sin audit."""
    vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)
    db = _make_db(vehicle=vehicle)

    result = await assert_can_access_vehicle(CLIENT_USER, VEHICLE_ID, db)

    assert result is vehicle
    db.begin_nested.assert_not_called()


async def test_client_admin_other_tenant_returns_404():
    """Client admin intenta acceder a vehículo de otro tenant → 404."""
    vehicle = _make_vehicle(tenant_id=OTHER_TENANT_ID)
    db = _make_db(vehicle=vehicle)

    with pytest.raises(HTTPException) as exc_info:
        await assert_can_access_vehicle(CLIENT_USER, VEHICLE_ID, db)

    assert exc_info.value.status_code == 404


# ===========================================================================
# Tests 6–10: Driver y viewer
# ===========================================================================

async def test_driver_reads_assigned_vehicle():
    """Driver con asignación activa (ended_at IS NULL) → devuelve vehicle."""
    vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)
    assignment = _make_assignment()
    db = _make_db(vehicle=vehicle, assignment=assignment)

    result = await assert_can_access_vehicle(DRIVER_USER, VEHICLE_ID, db)

    assert result is vehicle


async def test_driver_no_assignment_returns_404():
    """Driver sin asignación activa → 404."""
    vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)
    db = _make_db(vehicle=vehicle, assignment=None)

    with pytest.raises(HTTPException) as exc_info:
        await assert_can_access_vehicle(DRIVER_USER, VEHICLE_ID, db)

    assert exc_info.value.status_code == 404


async def test_driver_write_without_operational_returns_403():
    """Driver con asignación, write + scope!=operational → 403."""
    vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)
    assignment = _make_assignment()
    db = _make_db(vehicle=vehicle, assignment=assignment)

    with pytest.raises(HTTPException) as exc_info:
        await assert_can_access_vehicle(
            DRIVER_USER, VEHICLE_ID, db, operation="write", scope="all"
        )

    assert exc_info.value.status_code == 403


async def test_driver_write_with_operational_scope_ok():
    """Driver con asignación, write + scope=operational → devuelve vehicle (parte de servicio)."""
    vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)
    assignment = _make_assignment()
    db = _make_db(vehicle=vehicle, assignment=assignment)

    result = await assert_can_access_vehicle(
        DRIVER_USER, VEHICLE_ID, db, operation="write", scope="operational"
    )

    assert result is vehicle


async def test_client_viewer_reads_own_vehicle():
    """Client viewer (no admin, no driver) accede a vehículo del tenant → devuelve vehicle."""
    vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)
    db = _make_db(vehicle=vehicle)

    result = await assert_can_access_vehicle(CLIENT_VIEWER, VEHICLE_ID, db)

    assert result is vehicle
    db.begin_nested.assert_not_called()


# ===========================================================================
# Tests 11–14 + 16-bis: Manufacturer
# ===========================================================================

async def test_manufacturer_reads_own_manufactured_vehicle():
    """Manufacturer accede a vehículo que él fabricó → devuelve vehicle y registra audit."""
    vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID, manufacturer_tenant_id=MANUF_TENANT_ID)
    db = _make_db(vehicle=vehicle)

    result = await assert_can_access_vehicle(MANUFACTURER_USER, VEHICLE_ID, db)

    assert result is vehicle
    db.begin_nested.assert_called_once()


async def test_manufacturer_other_manufacturer_returns_404():
    """Manufacturer intenta acceder a vehículo fabricado por otro → 404."""
    vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID, manufacturer_tenant_id=OTHER_TENANT_ID)
    db = _make_db(vehicle=vehicle)

    with pytest.raises(HTTPException) as exc_info:
        await assert_can_access_vehicle(MANUFACTURER_USER, VEHICLE_ID, db)

    assert exc_info.value.status_code == 404


async def test_manufacturer_write_returns_403():
    """Manufacturer intenta modificar vehículo que fabricó → 403 (read-only)."""
    vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID, manufacturer_tenant_id=MANUF_TENANT_ID)
    db = _make_db(vehicle=vehicle)

    with pytest.raises(HTTPException) as exc_info:
        await assert_can_access_vehicle(MANUFACTURER_USER, VEHICLE_ID, db, operation="write")

    assert exc_info.value.status_code == 403


async def test_manufacturer_operational_flag_false_returns_404():
    """Manufacturer pide scope=operational pero el cliente no habilitó el flag → 404."""
    vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID, manufacturer_tenant_id=MANUF_TENANT_ID)
    client_tenant = _make_tenant(manufacturer_can_view_operations=False)
    db = _make_db(vehicle=vehicle, tenant=client_tenant)

    with pytest.raises(HTTPException) as exc_info:
        await assert_can_access_vehicle(
            MANUFACTURER_USER, VEHICLE_ID, db, scope="operational"
        )

    assert exc_info.value.status_code == 404


async def test_manufacturer_operational_flag_true_ok():
    """Manufacturer pide scope=operational y el cliente habilitó el flag → devuelve vehicle."""
    vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID, manufacturer_tenant_id=MANUF_TENANT_ID)
    client_tenant = _make_tenant(manufacturer_can_view_operations=True)
    db = _make_db(vehicle=vehicle, tenant=client_tenant)

    result = await assert_can_access_vehicle(
        MANUFACTURER_USER, VEHICLE_ID, db, scope="operational"
    )

    assert result is vehicle


# ===========================================================================
# Test 15: edge case — vehículo no existe
# ===========================================================================

async def test_vehicle_not_found_returns_404():
    """Vehicle no existe en DB → 404 inmediato sin consultas adicionales."""
    db = _make_db(vehicle=None)

    with pytest.raises(HTTPException) as exc_info:
        await assert_can_access_vehicle(CMG_USER, VEHICLE_ID, db)

    assert exc_info.value.status_code == 404
    db.begin_nested.assert_not_called()


# ===========================================================================
# Tests 16–19: list_accessible_vehicle_ids
# ===========================================================================

async def test_list_cmg_returns_all_sentinel():
    """CMG → devuelve 'ALL' sin consultar la DB."""
    db = _make_db()

    result = await list_accessible_vehicle_ids(CMG_USER, db)

    assert result == "ALL"
    db.scalars.assert_not_called()


async def test_list_manufacturer_returns_manufactured_ids():
    """Manufacturer → devuelve IDs de vehículos donde manufacturer_tenant_id coincide."""
    ids = [uuid.uuid4(), uuid.uuid4()]
    db = _make_db()
    db.scalars = AsyncMock(return_value=ids)

    result = await list_accessible_vehicle_ids(MANUFACTURER_USER, db)

    assert result == ids
    db.scalars.assert_called_once()


async def test_list_driver_returns_assigned_ids():
    """Driver → devuelve IDs de vehículos con asignación activa (ended_at IS NULL)."""
    ids = [VEHICLE_ID]
    db = _make_db()
    db.scalars = AsyncMock(return_value=ids)

    result = await list_accessible_vehicle_ids(DRIVER_USER, db)

    assert result == ids
    db.scalars.assert_called_once()


async def test_list_client_returns_own_tenant_ids():
    """Client admin → devuelve todos los IDs de vehículos de su tenant."""
    ids = [uuid.uuid4(), uuid.uuid4(), uuid.uuid4()]
    db = _make_db()
    db.scalars = AsyncMock(return_value=ids)

    result = await list_accessible_vehicle_ids(CLIENT_USER, db)

    assert result == ids
    db.scalars.assert_called_once()
