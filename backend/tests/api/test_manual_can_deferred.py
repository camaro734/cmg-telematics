"""TDD — Manual CAN entrega diferida (encolado cuando el FMC está offline)."""
import json
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser

TENANT_A = uuid.UUID("ce200000-0000-0000-0000-000000000001")
VEHICLE_A = uuid.UUID("ce400000-0000-0000-0000-000000000001")
DEVICE_A = uuid.UUID("ce500000-0000-0000-0000-000000000001")
SLOT_A = uuid.UUID("ce600000-0000-0000-0000-000000000001")
BUTTON_A = uuid.UUID("ce700000-0000-0000-0000-000000000001")
IMEI = "862272089079729"
PARAM_ID = 31412

ADMIN_A = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=TENANT_A, tenant_tier="client",
    role="admin", email="admin@a.com",
)


class _MockVehicle:
    id = VEHICLE_A
    tenant_id = TENANT_A
    active = True


class _MockDevice:
    id = DEVICE_A
    vehicle_id = VEHICLE_A
    imei = IMEI
    active = True


SLOTS = [{"id": str(SLOT_A), "slot": 0, "param_id": PARAM_ID}]
BUTTONS = [{"id": str(BUTTON_A), "slot_id": str(SLOT_A), "label": "Bomba",
            "byte_index": 0, "bit_index": 0, "function": "toggle",
            "active": True, "allowed_roles": []}]

URL = f"/api/v1/vehicles/{VEHICLE_A}/can-slots/{SLOT_A}/buttons/{BUTTON_A}/toggle"


def _setup_db():
    db = AsyncMock()
    db.execute.return_value = MagicMock(
        scalar_one_or_none=MagicMock(return_value=_MockDevice()))
    db.commit = AsyncMock()
    return db


def _setup(user, db):
    app.dependency_overrides[get_current_user] = lambda: user

    async def _db_gen():
        yield db

    app.dependency_overrides[get_db] = _db_gen


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_offline_set_queues_and_returns_202():
    """Sin ingest:conn → 202 queued, escribe pending en Redis, status=queued."""
    db = _setup_db()
    _setup(ADMIN_A, db)
    redis = AsyncMock()
    redis.exists.return_value = 0          # ingest:conn ausente → offline
    redis.hget.return_value = None         # estado de slot vacío

    with patch("app.api.v1.vehicles.assert_can_access_vehicle",
               new_callable=AsyncMock, return_value=_MockVehicle()), \
         patch("app.api.v1.vehicles._vehicle_manual_can_cfg",
               new_callable=AsyncMock, return_value=(SLOTS, BUTTONS)):
        with TestClient(app) as c:
            app.state.redis = redis
            r = c.post(URL, json={"value": True})

    assert r.status_code == 202
    body = r.json()
    assert body["queued"] is True
    # Se escribió el pending: hset(vehicle:{id}:manual_can_pending, "31412", <json>)
    hset_calls = [call for call in redis.hset.await_args_list
                  if call.args and call.args[0] == f"vehicle:{VEHICLE_A}:manual_can_pending"]
    assert hset_calls, "debe escribir el hash de pendientes"
    payload = json.loads(hset_calls[0].args[2])
    assert payload["type"] == "set"
    assert payload["commands"] == [f"setparam {PARAM_ID}:0100000000000000"]


def test_online_set_still_confirms_200():
    """Con ingest:conn presente y ACK del FMC → 200, queued=False."""
    db = _setup_db()
    _setup(ADMIN_A, db)
    redis = AsyncMock()
    redis.exists.return_value = 1   # online
    redis.hget.return_value = None
    redis.set.return_value = True   # lock adquirido
    redis.blpop.return_value = (f"command:{IMEI}:response",
                                f"setparam {PARAM_ID}:0100000000000000")

    with patch("app.api.v1.vehicles.assert_can_access_vehicle",
               new_callable=AsyncMock, return_value=_MockVehicle()), \
         patch("app.api.v1.vehicles._vehicle_manual_can_cfg",
               new_callable=AsyncMock, return_value=(SLOTS, BUTTONS)):
        with TestClient(app) as c:
            app.state.redis = redis
            r = c.post(URL, json={"value": True})

    assert r.status_code == 200
    assert r.json()["queued"] is False
