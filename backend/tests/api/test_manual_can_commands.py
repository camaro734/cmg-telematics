"""
Tests TDD — Manual CAN setparam commands (flujo síncrono con BLPOP).

Cubre:
1. Happy path: state=true, FMC responde → 200 confirmed, latency_ms poblado
2. Vehículo de otro tenant → 404
3. Sin vehicle_manual_can_slot → 404
4. FMC desconectado (ingestor envía DISCONNECTED) → 503
5. Timeout BLPOP (18s sin respuesta) → 504, CommandLog status=timeout
6. pending_response ya existe → 409
7. Usuario sin rol → 403
8. pending_response se libera (DEL) en el camino de timeout
"""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser

# IDs fijos
TENANT_A = uuid.UUID("ce200000-0000-0000-0000-000000000001")
TENANT_B = uuid.UUID("ce300000-0000-0000-0000-000000000002")
VEHICLE_A = uuid.UUID("ce400000-0000-0000-0000-000000000001")
DEVICE_A = uuid.UUID("ce500000-0000-0000-0000-000000000001")
IMEI = "862272089079729"

ADMIN_A = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=TENANT_A, tenant_tier="client",
    role="admin", email="admin@a.com",
)
OPERATOR_A = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=TENANT_A, tenant_tier="client",
    role="operator", email="op@a.com",
)
VIEWER_A = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=TENANT_A, tenant_tier="client",
    role="viewer", email="viewer@a.com",
)


# Mocks
class _MockVehicle:
    def __init__(self, tenant_id=TENANT_A, active=True):
        self.id = VEHICLE_A
        self.tenant_id = tenant_id
        self.active = active


class _MockDevice:
    def __init__(self, imei=IMEI):
        self.id = DEVICE_A
        self.vehicle_id = VEHICLE_A
        self.imei = imei
        self.active = True


class _MockSlot:
    def __init__(self, param_id=31412):
        self.vehicle_id = VEHICLE_A
        self.slot = 0
        self.param_id = param_id
        self.active = True


def _make_db(*execute_returns):
    """Crea un AsyncMock de DB con side_effects para execute()."""
    db = AsyncMock()
    db.execute.side_effect = [
        MagicMock(scalar_one_or_none=MagicMock(return_value=r))
        for r in execute_returns
    ]
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    return db


def _setup(user, db):
    app.dependency_overrides[get_current_user] = lambda: user
    async def _db_gen():
        yield db
    app.dependency_overrides[get_db] = _db_gen


def _mock_redis(**method_returns) -> AsyncMock:
    """Crea un AsyncMock de Redis con los valores de retorno especificados.
    Reemplaza app.state.redis DENTRO del contexto TestClient para que el
    endpoint vea el mock en lugar del Redis real del lifespan."""
    redis = AsyncMock()
    for method, return_value in method_returns.items():
        getattr(redis, method).return_value = return_value
    return redis


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


URL = f"/api/v1/vehicles/{VEHICLE_A}/commands/manual-can"
PAYLOAD_ON = {"slot": 0, "state": True}


# ─────────────────────────────────────────────────────────────────────────────
# 1. Happy path: state=true → 200 confirmed, latency_ms poblado
# ─────────────────────────────────────────────────────────────────────────────
def test_happy_path_state_true():
    """FMC responde correctamente → 200, status=confirmed, latency_ms presente."""
    db = _make_db(_MockDevice(), _MockSlot())
    _setup(ADMIN_A, db)

    with patch("app.api.v1.vehicles.assert_can_access_vehicle", new_callable=AsyncMock) as mock_access:
        mock_access.return_value = _MockVehicle()

        with TestClient(app) as c:
            # El lifespan ya corrió; reemplazamos redis con un AsyncMock controlado.
            redis = _mock_redis(
                hgetall={"last_seen": datetime.now(timezone.utc).isoformat()},
                exists=0,
                blpop=(f"command:{IMEI}:response", "setparam 31412:01FFFFFFFFFFFFFF"),
            )
            app.state.redis = redis

            r = c.post(URL, json=PAYLOAD_ON)

    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["status"] == "confirmed"
    assert body["imei"] == IMEI
    assert body["command_sent"] == "setparam 31412:01FFFFFFFFFFFFFF"
    assert body["fmc_response"] == "setparam 31412:01FFFFFFFFFFFFFF"
    assert body["latency_ms"] is not None and body["latency_ms"] >= 0


# ─────────────────────────────────────────────────────────────────────────────
# 2. Vehículo de otro tenant → 404
# ─────────────────────────────────────────────────────────────────────────────
def test_wrong_tenant_returns_404():
    """assert_can_access_vehicle lanza 404 cuando el tenant no coincide."""
    db = _make_db()
    _setup(ADMIN_A, db)

    async def _raise_404(*args, **kwargs):
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    with patch("app.api.v1.vehicles.assert_can_access_vehicle", side_effect=_raise_404):
        with TestClient(app) as c:
            r = c.post(URL, json=PAYLOAD_ON)

    assert r.status_code == 404


# ─────────────────────────────────────────────────────────────────────────────
# 3. Sin vehicle_manual_can_slot → 404
# ─────────────────────────────────────────────────────────────────────────────
def test_slot_not_configured_returns_404():
    """Slot no configurado en vehicle_manual_can_slot → 404."""
    db = _make_db(_MockDevice(), None)  # Device OK, slot None
    _setup(ADMIN_A, db)

    with patch("app.api.v1.vehicles.assert_can_access_vehicle", new_callable=AsyncMock) as mock_access:
        mock_access.return_value = _MockVehicle()

        with TestClient(app) as c:
            r = c.post(URL, json=PAYLOAD_ON)

    assert r.status_code == 404
    assert "no configurado" in r.json()["detail"].lower()


# ─────────────────────────────────────────────────────────────────────────────
# 4. FMC desconectado → 503
# ─────────────────────────────────────────────────────────────────────────────
def test_fmc_disconnected_returns_503():
    """Ingestor enqueue DISCONNECTED → 503, CommandLog status=disconnected."""
    db = _make_db(_MockDevice(), _MockSlot())
    _setup(ADMIN_A, db)

    with patch("app.api.v1.vehicles.assert_can_access_vehicle", new_callable=AsyncMock) as mock_access:
        mock_access.return_value = _MockVehicle()

        with TestClient(app) as c:
            app.state.redis = _mock_redis(
                hgetall={},
                exists=0,
                blpop=(f"command:{IMEI}:response", "DISCONNECTED"),
            )
            r = c.post(URL, json=PAYLOAD_ON)

    assert r.status_code == 503
    db.commit.assert_called()


# ─────────────────────────────────────────────────────────────────────────────
# 5. Timeout BLPOP → 504, CommandLog status=timeout
# ─────────────────────────────────────────────────────────────────────────────
def test_blpop_timeout_returns_504():
    """BLPOP devuelve None (sin respuesta en 18s) → 504, status=timeout."""
    db = _make_db(_MockDevice(), _MockSlot())
    _setup(ADMIN_A, db)

    with patch("app.api.v1.vehicles.assert_can_access_vehicle", new_callable=AsyncMock) as mock_access:
        mock_access.return_value = _MockVehicle()

        with TestClient(app) as c:
            app.state.redis = _mock_redis(hgetall={}, exists=0, blpop=None)
            r = c.post(URL, json=PAYLOAD_ON)

    assert r.status_code == 504
    db.commit.assert_called()


# ─────────────────────────────────────────────────────────────────────────────
# 6. pending_response ya existe → 409
# ─────────────────────────────────────────────────────────────────────────────
def test_concurrent_command_returns_409():
    """command:{imei}:pending_response existe → 409."""
    db = _make_db(_MockDevice(), _MockSlot())
    _setup(ADMIN_A, db)

    with patch("app.api.v1.vehicles.assert_can_access_vehicle", new_callable=AsyncMock) as mock_access:
        mock_access.return_value = _MockVehicle()

        with TestClient(app) as c:
            app.state.redis = _mock_redis(hgetall={}, exists=1)  # lock presente
            r = c.post(URL, json=PAYLOAD_ON)

    assert r.status_code == 409


# ─────────────────────────────────────────────────────────────────────────────
# 7. Usuario sin rol admin/operator → 403
# ─────────────────────────────────────────────────────────────────────────────
def test_viewer_role_returns_403():
    """Usuario con rol viewer → 403 antes de tocar DB o Redis."""
    db = _make_db()
    _setup(VIEWER_A, db)

    with TestClient(app) as c:
        r = c.post(URL, json=PAYLOAD_ON)

    assert r.status_code == 403
    # La DB no debe haberse consultado (el check de rol es lo primero)
    db.execute.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# 8. pending_response se libera (DEL) en el camino de timeout
# ─────────────────────────────────────────────────────────────────────────────
def test_pending_response_deleted_on_timeout():
    """redis.delete(pending_key) se llama incluso cuando BLPOP hace timeout."""
    db = _make_db(_MockDevice(), _MockSlot())
    _setup(ADMIN_A, db)

    with patch("app.api.v1.vehicles.assert_can_access_vehicle", new_callable=AsyncMock) as mock_access:
        mock_access.return_value = _MockVehicle()

        with TestClient(app) as c:
            redis = _mock_redis(hgetall={}, exists=0, blpop=None)
            app.state.redis = redis
            r = c.post(URL, json=PAYLOAD_ON)

    assert r.status_code == 504
    pending_key = f"command:{IMEI}:pending_response"
    redis.delete.assert_any_call(pending_key)
