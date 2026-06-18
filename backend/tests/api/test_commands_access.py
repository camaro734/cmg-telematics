"""TDD — control de acceso de GET /vehicles/{id}/commands.

Regresión del bug "vehículo no encontrado": el endpoint usaba un check propio
(tier=='cmg' o mismo tenant) que excluía al tier manufacturer, dando 404 a un
admin-fabricante con acceso operativo. Ahora delega en assert_can_access_vehicle
(scope='operational'), igual que status/track/maintenance/kpis.
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

VEHICLE = uuid.UUID("9130e55d-4504-4a8b-9bde-75d07dd253e9")
MFR_TENANT = uuid.UUID("99888600-1d87-4f88-a999-506933247140")

MANUFACTURER_ADMIN = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=MFR_TENANT, tenant_tier="manufacturer",
    role="admin", email="prueba@prueba.es",
)

URL = f"/api/v1/vehicles/{VEHICLE}/commands"


class _MockVehicle:
    active = True


def _setup(db):
    app.dependency_overrides[get_current_user] = lambda: MANUFACTURER_ADMIN
    async def _db_gen():
        yield db
    app.dependency_overrides[get_db] = _db_gen


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_manufacturer_with_operational_access_gets_200():
    """Si assert_can_access_vehicle concede acceso → 200, lista de comandos."""
    db = AsyncMock()
    exec_result = MagicMock()
    exec_result.scalars.return_value.all.return_value = []
    db.execute.return_value = exec_result
    _setup(db)

    with patch("app.api.v1.commands.assert_can_access_vehicle",
               new_callable=AsyncMock, return_value=_MockVehicle()) as mock_access:
        with TestClient(app) as c:
            r = c.get(URL)

    assert r.status_code == 200
    assert r.json() == []
    # Delegó en el control de acceso operativo (no el check propio anterior)
    mock_access.assert_awaited_once()
    assert mock_access.await_args.kwargs.get("scope") == "operational"


def test_no_access_returns_404():
    """Si assert_can_access_vehicle deniega → 404 (privacy by obscurity)."""
    db = AsyncMock()
    _setup(db)

    async def _deny(*a, **k):
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    with patch("app.api.v1.commands.assert_can_access_vehicle", side_effect=_deny):
        with TestClient(app) as c:
            r = c.get(URL)

    assert r.status_code == 404
