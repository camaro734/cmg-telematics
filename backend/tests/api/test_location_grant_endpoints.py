"""TDD — Pieza 6: endpoints POST/DELETE /vehicles/{id}/location-grant.

Cubre:
  - Autorización: dueño puede conceder; intermediario sin grant → 403; intermediario con grant → 201.
  - POST duplicado → 409.
  - Revocación en cascada: revocar borra grants de eslabones superiores + actualiza Redis.
  - 404 cuando el vehículo no existe o no hay grant que revocar.
  - Redis: SET loc_viewers actualizado tras POST y DELETE.

Estrategia de mock:
  Las funciones auxiliares _cascade_grant_ids y _refresh_vehicle_viewers_cache se
  parchean directamente para aislar la lógica de autorización/HTTP del acceso a BD.
  Esto permite que los tests de endpoint sean precisos sin conocer el detalle
  interno de cada función auxiliar (que se testa por separado si es necesario).
"""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.api.v1.deps import get_current_user, get_db, get_redis
from app.main import app
from app.schemas.auth import CurrentUser

# ─── IDs fijos ────────────────────────────────────────────────────────────────
CMG_TENANT_ID    = uuid.UUID("10000000-0000-0000-0000-000000000001")
MANUF_TENANT_ID  = uuid.UUID("30000000-0000-0000-0000-000000000001")
CLIENT_TENANT_ID = uuid.UUID("20000000-0000-0000-0000-000000000001")
VEHICLE_ID       = uuid.UUID("a0000000-0000-0000-0000-000000000001")

CLIENT_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CLIENT_TENANT_ID,
    tenant_tier="client", role="admin", email="client@test.com",
)
MANUF_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=MANUF_TENANT_ID,
    tenant_tier="manufacturer", role="admin", email="manuf@test.com",
)
CMG_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CMG_TENANT_ID,
    tenant_tier="cmg", role="admin", email="cmg@test.com",
)

_MODULE = "app.api.v1.location_grant"


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_vehicle(tenant_id=CLIENT_TENANT_ID):
    v = MagicMock()
    v.id = VEHICLE_ID
    v.tenant_id = tenant_id
    return v


def _make_grant(vehicle_id=VEHICLE_ID, granting_tenant_id=CLIENT_TENANT_ID):
    g = MagicMock()
    g.vehicle_id = vehicle_id
    g.granting_tenant_id = granting_tenant_id
    g.granted_at = datetime.now(timezone.utc)
    return g


def _mock_redis() -> MagicMock:
    pipe = MagicMock()
    pipe.delete = MagicMock()
    pipe.sadd = MagicMock()
    pipe.expire = MagicMock()
    pipe.execute = AsyncMock(return_value=[1, 1, 1])
    redis = MagicMock()
    redis.pipeline = MagicMock(return_value=pipe)
    return redis


def _db_returning_vehicle(vehicle, extra_execute_results=None):
    """Mock de db que devuelve vehicle en .get y resultados configurables en .execute."""
    mock_db = AsyncMock()
    mock_db.get.return_value = vehicle

    if extra_execute_results is None:
        result = MagicMock()
        result.scalar_one_or_none.return_value = None
        result.all.return_value = []
        mock_db.execute.return_value = result
    else:
        mock_db.execute.side_effect = extra_execute_results

    return mock_db


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _override_user(user: CurrentUser) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


def _setup_db_and_redis(mock_db, redis=None):
    async def _db_gen():
        yield mock_db

    app.dependency_overrides[get_db] = _db_gen
    app.dependency_overrides[get_redis] = lambda: (redis or _mock_redis())
    return redis or _mock_redis()


# ═══════════════════════════════════════════════════════════════════════════════
# POST /vehicles/{id}/location-grant
# ═══════════════════════════════════════════════════════════════════════════════

class TestPostLocationGrant:

    def test_owner_can_grant_returns_201(self):
        """El dueño del vehículo concede acceso a su parent → 201 y Redis actualizado."""
        _override_user(CLIENT_USER)
        vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)

        # execute 1: check own grant ya existe → None
        own_check = MagicMock()
        own_check.scalar_one_or_none.return_value = None
        # execute 2 (dentro de _refresh_vehicle_viewers_cache): sin grants aún
        viewers_refresh = MagicMock()
        viewers_refresh.all.return_value = []

        mock_db = _db_returning_vehicle(vehicle, [own_check, viewers_refresh])
        redis = _mock_redis()

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen
        app.dependency_overrides[get_redis] = lambda: redis

        with patch(f"{_MODULE}._cascade_grant_ids", AsyncMock(return_value=[CLIENT_TENANT_ID, MANUF_TENANT_ID])):
            with TestClient(app) as client:
                resp = client.post(f"/api/v1/vehicles/{VEHICLE_ID}/location-grant")

        assert resp.status_code == 201, resp.text
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()
        redis.pipeline.assert_called()

    def test_non_owner_without_received_grant_gets_403(self):
        """El fabricante sin grant recibido del cliente obtiene 403."""
        _override_user(MANUF_USER)
        vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)  # dueño = CLIENT

        # execute 1: check grant recibido → None (no existe)
        received_check = MagicMock()
        received_check.scalar_one_or_none.return_value = None
        mock_db = _db_returning_vehicle(vehicle, [received_check])

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen
        app.dependency_overrides[get_redis] = lambda: _mock_redis()

        with TestClient(app) as client:
            resp = client.post(f"/api/v1/vehicles/{VEHICLE_ID}/location-grant")

        assert resp.status_code == 403, resp.text
        mock_db.add.assert_not_called()

    def test_intermediate_with_received_grant_can_re_grant(self):
        """El fabricante que recibió grant del cliente puede re-conceder a CMG → 201."""
        _override_user(MANUF_USER)
        vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)

        # execute 1: check grant recibido → existe (el del cliente)
        received_check = MagicMock()
        received_check.scalar_one_or_none.return_value = _make_grant(
            granting_tenant_id=CLIENT_TENANT_ID
        )
        # execute 2: check own grant ya existe → None
        own_check = MagicMock()
        own_check.scalar_one_or_none.return_value = None
        # execute 3 (refresh viewers): el grant del cliente
        viewers_refresh = MagicMock()
        viewers_refresh.all.return_value = []

        mock_db = _db_returning_vehicle(vehicle, [received_check, own_check, viewers_refresh])
        redis = _mock_redis()

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen
        app.dependency_overrides[get_redis] = lambda: redis

        with patch(f"{_MODULE}._cascade_grant_ids", AsyncMock(return_value=[MANUF_TENANT_ID, CMG_TENANT_ID])):
            with TestClient(app) as client:
                resp = client.post(f"/api/v1/vehicles/{VEHICLE_ID}/location-grant")

        assert resp.status_code == 201, resp.text
        mock_db.add.assert_called_once()

    def test_duplicate_grant_returns_409(self):
        """POST cuando el grant propio ya existe → 409 Conflict."""
        _override_user(CLIENT_USER)
        vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)

        # Para el dueño: solo se comprueba el grant propio (no received)
        own_check = MagicMock()
        own_check.scalar_one_or_none.return_value = _make_grant()  # ya existe
        mock_db = _db_returning_vehicle(vehicle, [own_check])

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen
        app.dependency_overrides[get_redis] = lambda: _mock_redis()

        with TestClient(app) as client:
            resp = client.post(f"/api/v1/vehicles/{VEHICLE_ID}/location-grant")

        assert resp.status_code == 409, resp.text
        mock_db.add.assert_not_called()

    def test_vehicle_not_found_returns_404(self):
        """POST con vehicle_id inexistente → 404."""
        _override_user(CLIENT_USER)
        mock_db = AsyncMock()
        mock_db.get.return_value = None  # vehículo no existe

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen
        app.dependency_overrides[get_redis] = lambda: _mock_redis()

        with TestClient(app) as client:
            resp = client.post(f"/api/v1/vehicles/{VEHICLE_ID}/location-grant")

        assert resp.status_code == 404, resp.text

    def test_cmg_cannot_grant_upward(self):
        """CMG no puede conceder (no hay nivel superior) → 403."""
        _override_user(CMG_USER)
        vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)
        mock_db = _db_returning_vehicle(vehicle)

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen
        app.dependency_overrides[get_redis] = lambda: _mock_redis()

        with TestClient(app) as client:
            resp = client.post(f"/api/v1/vehicles/{VEHICLE_ID}/location-grant")

        assert resp.status_code == 403, resp.text


# ═══════════════════════════════════════════════════════════════════════════════
# DELETE /vehicles/{id}/location-grant
# ═══════════════════════════════════════════════════════════════════════════════

class TestDeleteLocationGrant:

    def test_owner_revoke_cascades_and_updates_redis(self):
        """El dueño revoca → DELETE en cascada + Redis vacío para ese vehículo."""
        _override_user(CLIENT_USER)
        vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)

        # execute 1: check own grant existe → sí
        own_check = MagicMock()
        own_check.scalar_one_or_none.return_value = _make_grant()
        # execute 2: DELETE cascade (borra CLIENT + MANUF)
        delete_result = MagicMock()
        # execute 3: recalculate viewers → vacío (ambos grants borrados)
        viewers_result = MagicMock()
        viewers_result.all.return_value = []

        mock_db = _db_returning_vehicle(vehicle, [own_check, delete_result, viewers_result])
        redis = _mock_redis()

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen
        app.dependency_overrides[get_redis] = lambda: redis

        cascade_ids = [CLIENT_TENANT_ID, MANUF_TENANT_ID, CMG_TENANT_ID]
        with patch(f"{_MODULE}._cascade_grant_ids", AsyncMock(return_value=cascade_ids)):
            with TestClient(app) as client:
                resp = client.delete(f"/api/v1/vehicles/{VEHICLE_ID}/location-grant")

        assert resp.status_code == 204, resp.text
        # Redis: key borrada (sin viewers)
        pipe = redis.pipeline.return_value
        pipe.delete.assert_called_with(f"loc_viewers:{VEHICLE_ID}")
        pipe.sadd.assert_not_called()

    def test_manufacturer_revoke_preserves_client_grant_in_redis(self):
        """El fabricante revoca su grant; el del cliente permanece → SET Redis con MANUF."""
        _override_user(MANUF_USER)
        vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)

        # execute 1: check own grant existe (el del fabricante)
        own_check = MagicMock()
        own_check.scalar_one_or_none.return_value = _make_grant(
            granting_tenant_id=MANUF_TENANT_ID
        )
        # execute 2: DELETE cascade solo borra MANUF (CMG no tiene grant)
        delete_result = MagicMock()
        # execute 3: recalculate → sigue el grant del cliente (client tier → viewer=MANUF)
        grant_row = MagicMock()
        grant_row.granting_tenant_id = CLIENT_TENANT_ID
        grant_row.tier = "client"
        grant_row.parent_manufacturer_id = MANUF_TENANT_ID
        viewers_result = MagicMock()
        viewers_result.all.return_value = [grant_row]

        mock_db = _db_returning_vehicle(vehicle, [own_check, delete_result, viewers_result])
        redis = _mock_redis()

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen
        app.dependency_overrides[get_redis] = lambda: redis

        cascade_ids = [MANUF_TENANT_ID, CMG_TENANT_ID]
        with patch(f"{_MODULE}._cascade_grant_ids", AsyncMock(return_value=cascade_ids)):
            with TestClient(app) as client:
                resp = client.delete(f"/api/v1/vehicles/{VEHICLE_ID}/location-grant")

        assert resp.status_code == 204, resp.text
        # Redis: sigue habiendo viewers (el fabricante, gracias al grant del cliente)
        pipe = redis.pipeline.return_value
        pipe.sadd.assert_called_with(f"loc_viewers:{VEHICLE_ID}", str(MANUF_TENANT_ID))

    def test_delete_when_user_has_no_grant_returns_404(self):
        """DELETE cuando el usuario no tiene grant propio → 404."""
        _override_user(MANUF_USER)
        vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)

        # execute 1: check own grant → no existe
        own_check = MagicMock()
        own_check.scalar_one_or_none.return_value = None
        mock_db = _db_returning_vehicle(vehicle, [own_check])

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen
        app.dependency_overrides[get_redis] = lambda: _mock_redis()

        with TestClient(app) as client:
            resp = client.delete(f"/api/v1/vehicles/{VEHICLE_ID}/location-grant")

        assert resp.status_code == 404, resp.text

    def test_vehicle_not_found_returns_404(self):
        """DELETE con vehicle_id inexistente → 404."""
        _override_user(CLIENT_USER)
        mock_db = AsyncMock()
        mock_db.get.return_value = None

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen
        app.dependency_overrides[get_redis] = lambda: _mock_redis()

        with TestClient(app) as client:
            resp = client.delete(f"/api/v1/vehicles/{VEHICLE_ID}/location-grant")

        assert resp.status_code == 404, resp.text


# ═══════════════════════════════════════════════════════════════════════════════
# Tests unitarios de la función auxiliar _cascade_grant_ids
# ═══════════════════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════════
# GET /vehicles/{id}/location-grant/status
# ═══════════════════════════════════════════════════════════════════════════════

class TestGetLocationGrantStatus:
    """Los tres estados de la tabla can_grant × has_granted + current_level."""

    def _db_for_status(self, vehicle, count_val, has_own_grant, received_grant=None):
        mock_db = AsyncMock()
        mock_db.get.return_value = vehicle

        count_result = MagicMock()
        count_result.scalar.return_value = count_val

        own_result = MagicMock()
        own_result.scalar_one_or_none.return_value = (
            _make_grant() if has_own_grant else None
        )

        if received_grant is not None:
            received_result = MagicMock()
            received_result.scalar_one_or_none.return_value = (
                _make_grant() if received_grant else None
            )
            mock_db.execute.side_effect = [count_result, own_result, received_result]
        else:
            mock_db.execute.side_effect = [count_result, own_result]

        return mock_db

    def test_owner_without_grants_returns_level0_can_grant_not_granted(self):
        """Dueño sin grants activos: Privada, puede conceder, no ha concedido."""
        _override_user(CLIENT_USER)
        vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)
        mock_db = self._db_for_status(vehicle, count_val=0, has_own_grant=False)

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with TestClient(app) as client:
            resp = client.get(f"/api/v1/vehicles/{VEHICLE_ID}/location-grant/status")

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["current_level"] == 0
        assert data["can_grant"] is True
        assert data["has_granted"] is False

    def test_owner_with_own_grant_returns_level1_has_granted(self):
        """Dueño que ya concedió: Nivel 1, puede revocar, ha concedido."""
        _override_user(CLIENT_USER)
        vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)
        mock_db = self._db_for_status(vehicle, count_val=1, has_own_grant=True)

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with TestClient(app) as client:
            resp = client.get(f"/api/v1/vehicles/{VEHICLE_ID}/location-grant/status")

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["current_level"] == 1
        assert data["can_grant"] is True
        assert data["has_granted"] is True

    def test_cmg_returns_can_grant_false(self):
        """CMG ve el nivel actual pero can_grant=False (no hay nivel superior)."""
        _override_user(CMG_USER)
        vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)
        mock_db = self._db_for_status(vehicle, count_val=2, has_own_grant=False)

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with TestClient(app) as client:
            resp = client.get(f"/api/v1/vehicles/{VEHICLE_ID}/location-grant/status")

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["current_level"] == 2
        assert data["can_grant"] is False
        assert data["has_granted"] is False

    def test_manufacturer_with_received_grant_can_grant(self):
        """Fabricante con grant recibido: can_grant=True, not yet granted."""
        _override_user(MANUF_USER)
        vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)
        mock_db = self._db_for_status(
            vehicle, count_val=1, has_own_grant=False, received_grant=True
        )

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with TestClient(app) as client:
            resp = client.get(f"/api/v1/vehicles/{VEHICLE_ID}/location-grant/status")

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["current_level"] == 1
        assert data["can_grant"] is True
        assert data["has_granted"] is False

    def test_manufacturer_without_received_grant_cannot_grant(self):
        """Fabricante sin grant recibido: can_grant=False."""
        _override_user(MANUF_USER)
        vehicle = _make_vehicle(tenant_id=CLIENT_TENANT_ID)
        mock_db = self._db_for_status(
            vehicle, count_val=0, has_own_grant=False, received_grant=False
        )

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with TestClient(app) as client:
            resp = client.get(f"/api/v1/vehicles/{VEHICLE_ID}/location-grant/status")

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["current_level"] == 0
        assert data["can_grant"] is False
        assert data["has_granted"] is False


class TestCascadeGrantIds:
    """Tests unitarios de _cascade_grant_ids — sin endpoints, sin DB real."""

    @pytest.mark.asyncio
    async def test_client_cascade_includes_manufacturer_and_cmg(self):
        from app.api.v1.location_grant import _cascade_grant_ids

        client_tenant = MagicMock()
        client_tenant.tier = "client"
        client_tenant.parent_manufacturer_id = MANUF_TENANT_ID
        client_tenant.parent_id = None

        manuf_tenant = MagicMock()
        manuf_tenant.tier = "manufacturer"
        manuf_tenant.parent_manufacturer_id = None
        manuf_tenant.parent_id = CMG_TENANT_ID

        cmg_tenant = MagicMock()
        cmg_tenant.tier = "cmg"
        cmg_tenant.parent_manufacturer_id = None
        cmg_tenant.parent_id = None

        mock_db = AsyncMock()
        mock_db.get.side_effect = [client_tenant, manuf_tenant, cmg_tenant]

        result = await _cascade_grant_ids(mock_db, CLIENT_TENANT_ID)

        assert result == [CLIENT_TENANT_ID, MANUF_TENANT_ID, CMG_TENANT_ID]

    @pytest.mark.asyncio
    async def test_manufacturer_cascade_includes_only_cmg(self):
        from app.api.v1.location_grant import _cascade_grant_ids

        manuf_tenant = MagicMock()
        manuf_tenant.tier = "manufacturer"
        manuf_tenant.parent_manufacturer_id = None
        manuf_tenant.parent_id = CMG_TENANT_ID

        cmg_tenant = MagicMock()
        cmg_tenant.tier = "cmg"
        cmg_tenant.parent_manufacturer_id = None
        cmg_tenant.parent_id = None

        mock_db = AsyncMock()
        mock_db.get.side_effect = [manuf_tenant, cmg_tenant]

        result = await _cascade_grant_ids(mock_db, MANUF_TENANT_ID)

        assert result == [MANUF_TENANT_ID, CMG_TENANT_ID]

    @pytest.mark.asyncio
    async def test_cascade_stops_at_missing_tenant(self):
        from app.api.v1.location_grant import _cascade_grant_ids

        tenant = MagicMock()
        tenant.tier = "client"
        tenant.parent_manufacturer_id = MANUF_TENANT_ID
        tenant.parent_id = None

        mock_db = AsyncMock()
        mock_db.get.side_effect = [tenant, None]  # el parent no existe

        result = await _cascade_grant_ids(mock_db, CLIENT_TENANT_ID)

        assert result == [CLIENT_TENANT_ID, MANUF_TENANT_ID]
