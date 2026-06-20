"""Tests TDD para el modelo escalonado de privacidad de ubicación.

RED primero: la función user_can_see_vehicle_location actual es síncrona
y no acepta redis → todos estos tests fallan hasta implementar la nueva versión.
"""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.api.v1.access_v2 import user_can_see_vehicle_location
from app.schemas.auth import CurrentUser

pytestmark = pytest.mark.asyncio

# ── Fixtures ─────────────────────────────────────────────────────────────────

OWNER_ID = uuid.uuid4()
CLIENT_ID = uuid.uuid4()
MANUFACTURER_ID = uuid.uuid4()
VEHICLE_ID = uuid.uuid4()


def _user(tenant_id: uuid.UUID, tier: str = "client", role: str = "admin") -> CurrentUser:
    return CurrentUser(
        user_id=uuid.uuid4(),
        tenant_id=tenant_id,
        tenant_tier=tier,
        role=role,
        email="test@example.com",
    )


def _vehicle(tenant_id: uuid.UUID = OWNER_ID) -> MagicMock:
    v = MagicMock()
    v.id = VEHICLE_ID
    v.tenant_id = tenant_id
    return v


def _redis(sentinel: str | None = "1", viewers: set | None = None) -> MagicMock:
    """Mock de Redis con pipeline síncrono (como aioredis) que devuelve sentinel y viewers."""
    viewers = viewers if viewers is not None else set()
    pipe = MagicMock()
    pipe.get = MagicMock()
    pipe.smembers = MagicMock()
    pipe.execute = AsyncMock(return_value=[sentinel, viewers])
    redis = MagicMock()
    redis.pipeline = MagicMock(return_value=pipe)
    return redis


# ── Tests: user_can_see_vehicle_location ─────────────────────────────────────

class TestUserCanSeeVehicleLocationScaled:

    async def test_owner_always_sees_regardless_of_redis(self):
        """El dueño ve su vehículo aunque Redis esté caído o sin grants."""
        user = _user(OWNER_ID)
        vehicle = _vehicle(OWNER_ID)
        redis = MagicMock()
        redis.pipeline = MagicMock(side_effect=Exception("redis down"))

        result = await user_can_see_vehicle_location(user, vehicle, redis)

        assert result is True

    async def test_owner_always_sees_even_without_redis(self):
        """El dueño ve aunque redis=None."""
        user = _user(OWNER_ID)
        vehicle = _vehicle(OWNER_ID)

        result = await user_can_see_vehicle_location(user, vehicle, None)

        assert result is True

    async def test_no_grants_upstream_cant_see(self):
        """Sin ningún grant (viewers vacío), nadie por encima del dueño puede ver."""
        user = _user(CLIENT_ID, tier="client")
        vehicle = _vehicle(OWNER_ID)
        redis = _redis(sentinel="1", viewers=set())

        result = await user_can_see_vehicle_location(user, vehicle, redis)

        assert result is False

    async def test_grantee_sees_when_in_viewers(self):
        """El parent que recibió el grant (está en el SET) puede ver la ubicación."""
        user = _user(CLIENT_ID, tier="client")
        vehicle = _vehicle(OWNER_ID)
        redis = _redis(sentinel="1", viewers={str(CLIENT_ID)})

        result = await user_can_see_vehicle_location(user, vehicle, redis)

        assert result is True

    async def test_chain_broken_upper_cant_see(self):
        """Si el client está en viewers pero el manufacturer no, el manufacturer no ve.

        Caso crítico: dueño → client (grant OK) → manufacturer (sin grant).
        El SET solo contiene client_id; manufacturer_id NO está.
        """
        user = _user(MANUFACTURER_ID, tier="manufacturer")
        vehicle = _vehicle(OWNER_ID)
        # Solo el client fue añadido al SET (el manufacturer no propagó)
        redis = _redis(sentinel="1", viewers={str(CLIENT_ID)})

        result = await user_can_see_vehicle_location(user, vehicle, redis)

        assert result is False

    async def test_full_chain_manufacturer_sees(self):
        """Con cadena completa de grants, el manufacturer puede ver."""
        user = _user(MANUFACTURER_ID, tier="manufacturer")
        vehicle = _vehicle(OWNER_ID)
        redis = _redis(sentinel="1", viewers={str(CLIENT_ID), str(MANUFACTURER_ID)})

        result = await user_can_see_vehicle_location(user, vehicle, redis)

        assert result is True

    async def test_cmg_uses_special_key_not_tenant_id(self):
        """CMG usa la clave especial '__cmg__' en el SET, no su tenant_id."""
        cmg_tenant_id = uuid.uuid4()
        user = _user(cmg_tenant_id, tier="cmg")
        vehicle = _vehicle(OWNER_ID)
        # El SET contiene "__cmg__" pero NO el tenant_id real de CMG
        redis = _redis(sentinel="1", viewers={str(CLIENT_ID), str(MANUFACTURER_ID), "__cmg__"})

        result = await user_can_see_vehicle_location(user, vehicle, redis)

        assert result is True

    async def test_cmg_not_in_viewers_cant_see(self):
        """CMG no puede ver si '__cmg__' no está en el SET aunque haya otros grants."""
        cmg_tenant_id = uuid.uuid4()
        user = _user(cmg_tenant_id, tier="cmg")
        vehicle = _vehicle(OWNER_ID)
        # Cadena llegó al manufacturer pero no a CMG
        redis = _redis(sentinel="1", viewers={str(CLIENT_ID), str(MANUFACTURER_ID)})

        result = await user_can_see_vehicle_location(user, vehicle, redis)

        assert result is False

    async def test_failsafe_no_sentinel(self):
        """Sin sentinel (Redis no inicializado / cold-start), upstream no puede ver."""
        user = _user(CLIENT_ID, tier="client")
        vehicle = _vehicle(OWNER_ID)
        # sentinel=None simula caché no inicializada
        redis = _redis(sentinel=None, viewers={str(CLIENT_ID)})

        result = await user_can_see_vehicle_location(user, vehicle, redis)

        assert result is False

    async def test_failsafe_redis_exception(self):
        """Si Redis lanza excepción en el pipeline, upstream no puede ver."""
        user = _user(CLIENT_ID, tier="client")
        vehicle = _vehicle(OWNER_ID)
        pipe = MagicMock()
        pipe.get = MagicMock()
        pipe.smembers = MagicMock()
        pipe.execute = AsyncMock(side_effect=Exception("conexión perdida"))
        redis = MagicMock()
        redis.pipeline = MagicMock(return_value=pipe)

        result = await user_can_see_vehicle_location(user, vehicle, redis)

        assert result is False

    async def test_failsafe_redis_none(self):
        """Si redis=None (app sin Redis), upstream no puede ver."""
        user = _user(CLIENT_ID, tier="client")
        vehicle = _vehicle(OWNER_ID)

        result = await user_can_see_vehicle_location(user, vehicle, None)

        assert result is False
