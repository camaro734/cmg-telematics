"""Tests del descenso jerárquico del jefe de flota (Fase A, Commit 2).

`visible_tenant_ids` devuelve el subárbol visible (tenant + descendientes directos)
y se aplica a los listados/acceso de /work-orders, /drivers y /vehicles para que un
admin de tenant `client` (jefe de flota) vea también lo de sus subclients. Aditivo:
nunca reduce la visibilidad previa (filtro por tenant_id exacto).
"""
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api.v1.deps import visible_tenant_ids
from app.schemas.auth import CurrentUser

CLIENT_ID = uuid.UUID("bb100000-0000-0000-0000-000000000001")
SUB1 = uuid.UUID("cc100000-0000-0000-0000-000000000001")
SUB2 = uuid.UUID("cc100000-0000-0000-0000-000000000002")
MFR_ID = uuid.UUID("aa100000-0000-0000-0000-000000000001")

CMG = CurrentUser(user_id=uuid.uuid4(), tenant_id=uuid.uuid4(), tenant_tier="cmg", role="admin", email="c@t.com")
CLIENT_ADMIN = CurrentUser(user_id=uuid.uuid4(), tenant_id=CLIENT_ID, tenant_tier="client", role="admin", email="a@t.com")
MFR_ADMIN = CurrentUser(user_id=uuid.uuid4(), tenant_id=MFR_ID, tenant_tier="manufacturer", role="admin", email="m@t.com")
SUBCLIENT_ADMIN = CurrentUser(user_id=uuid.uuid4(), tenant_id=SUB1, tenant_tier="subclient", role="admin", email="s@t.com")


def _scalars(items):
    r = MagicMock()
    r.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=items)))
    return r


@pytest.mark.asyncio
async def test_cmg_sees_everything_no_filter():
    db = AsyncMock()
    assert await visible_tenant_ids(CMG, db) is None
    db.execute.assert_not_awaited()  # cmg no consulta descendientes


@pytest.mark.asyncio
async def test_client_admin_includes_own_tenant_and_subclients():
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_scalars([SUB1, SUB2]))
    ids = await visible_tenant_ids(CLIENT_ADMIN, db)
    assert ids[0] == CLIENT_ID            # su propio tenant siempre primero
    assert set(ids) == {CLIENT_ID, SUB1, SUB2}
    # la query desciende por parent_id
    stmt = str(db.execute.call_args.args[0])
    assert "tenant.parent_id" in stmt


@pytest.mark.asyncio
async def test_client_admin_without_subclients_is_just_self():
    """Caso producción actual (sin subclients): idéntico al filtro exacto previo."""
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_scalars([]))
    ids = await visible_tenant_ids(CLIENT_ADMIN, db)
    assert ids == [CLIENT_ID]


@pytest.mark.asyncio
async def test_manufacturer_includes_own_clients_via_manufacturer_parent():
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_scalars([CLIENT_ID]))
    ids = await visible_tenant_ids(MFR_ADMIN, db)
    assert set(ids) == {MFR_ID, CLIENT_ID}
    stmt = str(db.execute.call_args.args[0])
    assert "tenant.parent_manufacturer_id" in stmt


@pytest.mark.asyncio
async def test_subclient_sees_only_itself():
    db = AsyncMock()
    ids = await visible_tenant_ids(SUBCLIENT_ADMIN, db)
    assert ids == [SUB1]
    db.execute.assert_not_awaited()  # subclient no tiene descendientes que consultar
