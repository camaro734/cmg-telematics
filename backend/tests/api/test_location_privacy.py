"""Tests de privacidad de ubicación — Feature 059.

Orden TDD:
  Bloque 1 (funciones puras): pasan desde el primer commit (A).
  Bloque 2 (endpoints): FALLAN hasta que se implementen los filtros en vehicles.py (B).
  Bloque 3 (endpoint PATCH): FALLAN hasta que se implemente el endpoint (F).

Los tests de endpoints fallan porque actualmente los endpoints devuelven lat/lon
a usuarios upstream aunque hide_location_from_upstream=True. La transición
ROJO → VERDE ocurre al implementar strip_location() en cada endpoint.
"""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.api.v1.access_v2 import (
    _LOCATION_FIELDS,
    strip_location,
    user_can_see_vehicle_location,
)
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.main import app
from app.models.vehicle import Vehicle
from app.schemas.auth import CurrentUser
from app.schemas.vehicle import TelemetryPoint, VehicleStatus

# ─── IDs fijos ────────────────────────────────────────────────────────────────
CLIENT_TENANT_ID = uuid.UUID("20000000-0000-0000-0000-000000000001")
MANUF_TENANT_ID  = uuid.UUID("30000000-0000-0000-0000-000000000001")
CMG_TENANT_ID    = uuid.UUID("10000000-0000-0000-0000-000000000001")
VEHICLE_ID       = uuid.UUID("a0000000-0000-0000-0000-000000000001")

# ─── Usuarios ─────────────────────────────────────────────────────────────────
MANUFACTURER_USER = CurrentUser(
    user_id=uuid.uuid4(),
    tenant_id=MANUF_TENANT_ID,
    tenant_tier="manufacturer",
    role="admin",
    email="manuf@test.com",
)
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


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _make_vehicle(hide: bool = False) -> MagicMock:
    v = MagicMock(spec=Vehicle)
    v.id = VEHICLE_ID
    v.tenant_id = CLIENT_TENANT_ID
    v.manufacturer_tenant_id = MANUF_TENANT_ID
    v.hide_location_from_upstream = hide
    v.active = True
    v.name = "Test Vehicle"
    v.vehicle_type_id = uuid.uuid4()
    v.license_plate = "TEST-001"
    v.vin = None
    v.driver_name = None
    v.year = 2020
    v.created_at = datetime.now(timezone.utc)
    return v


def _redis_with_location() -> AsyncMock:
    """Redis mock que devuelve telemetría con coordenadas reales."""
    redis = AsyncMock()
    hash_data = {
        b"online": b"true",
        b"lat": b"39.4702",
        b"lon": b"-0.3768",
        b"speed_kmh": b"55.0",
        b"heading": b"90",
        b"altitude_m": b"15.0",
        b"ignition": b"true",
        b"pto_active": b"false",
        b"ext_voltage_mv": b"12100",
        b"can_data": b"{}",
        b"dout_state": b"{}",
        b"last_seen": b"2026-06-20T08:00:00+00:00",
    }
    redis.hgetall.return_value = hash_data
    redis.mget.return_value = [b"1", None]  # sentinel presente, vehicle no privado en WS cache
    pipe_mock = AsyncMock()
    pipe_mock.hgetall = MagicMock()
    pipe_mock.execute = AsyncMock(return_value=[hash_data])
    pipe_mock.__aenter__ = AsyncMock(return_value=pipe_mock)
    pipe_mock.__aexit__ = AsyncMock(return_value=False)
    redis.pipeline.return_value = pipe_mock
    return redis


def _find_location_leak(obj) -> list[str]:
    """Devuelve los campos de ubicación con valor no-null encontrados recursivamente."""
    leaks: list[str] = []
    LOCATION_KEYS = {"lat", "lon", "lng", "speed_kmh", "heading", "altitude_m",
                     "location_lat", "location_lon"}
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in LOCATION_KEYS and v is not None:
                leaks.append(f"{k}={v!r}")
            leaks.extend(_find_location_leak(v))
    elif isinstance(obj, list):
        for item in obj:
            leaks.extend(_find_location_leak(item))
    return leaks


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _override_user(user: CurrentUser) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


# ═══════════════════════════════════════════════════════════════════════════════
# Bloque 1: Funciones puras — PASAN desde el primer commit (pieza A)
# ═══════════════════════════════════════════════════════════════════════════════

class TestUserCanSeeVehicleLocation:
    """user_can_see_vehicle_location() — 5 casos según Decisión 2."""

    def test_owner_always_sees_location(self):
        vehicle = _make_vehicle(hide=True)
        assert user_can_see_vehicle_location(CLIENT_USER, vehicle) is True

    def test_manufacturer_sees_when_flag_off(self):
        vehicle = _make_vehicle(hide=False)
        assert user_can_see_vehicle_location(MANUFACTURER_USER, vehicle) is True

    def test_manufacturer_hidden_when_flag_on(self):
        vehicle = _make_vehicle(hide=True)
        assert user_can_see_vehicle_location(MANUFACTURER_USER, vehicle) is False

    def test_cmg_hidden_when_flag_on(self):
        """CMG NO está exento — Decisión 2 corrige el diseño inicial."""
        vehicle = _make_vehicle(hide=True)
        assert user_can_see_vehicle_location(CMG_USER, vehicle) is False

    def test_cmg_sees_when_flag_off(self):
        vehicle = _make_vehicle(hide=False)
        assert user_can_see_vehicle_location(CMG_USER, vehicle) is True


class TestStripLocation:
    """strip_location() — elimina coordenadas, mantiene telemetría técnica."""

    def test_strips_fields_from_pydantic_model(self):
        point = TelemetryPoint(
            time=datetime.now(timezone.utc),
            lat=39.47, lon=-0.38,
            speed_kmh=55.0, heading=90, altitude_m=15.0,
            ignition=True, pto_active=False,
            ext_voltage_mv=12100, can_data={"avl_30": 1500},
        )
        strip_location(point)
        assert point.lat is None
        assert point.lon is None
        assert point.speed_kmh is None
        assert point.heading is None
        assert point.altitude_m is None
        # Telemetría técnica intacta
        assert point.ignition is True
        assert point.pto_active is False
        assert point.ext_voltage_mv == 12100
        assert point.can_data == {"avl_30": 1500}

    def test_strips_fields_from_dict(self):
        d = {"lat": 39.47, "lon": -0.38, "speed_kmh": 55.0, "ignition": True}
        strip_location(d)
        assert d["lat"] is None
        assert d["lon"] is None
        assert d["speed_kmh"] is None
        assert d["ignition"] is True

    def test_strips_lng_alias_from_vehicle_status(self):
        status = VehicleStatus(
            vehicle_id=VEHICLE_ID,
            online=True,
            lat=39.47, lon=-0.38, lng=-0.38,
            speed_kmh=55.0, heading=90,
            ignition=True, ext_voltage_mv=12100,
        )
        strip_location(status)
        assert status.lat is None
        assert status.lng is None
        assert status.speed_kmh is None
        assert status.heading is None
        assert status.ignition is True
        assert status.ext_voltage_mv == 12100

    def test_location_fields_constant_covers_all_schemas(self):
        """_LOCATION_FIELDS debe cubrir todos los campos de ubicación de todos los schemas.
        Si alguien añade un campo nuevo de ubicación en un schema y olvida registrarlo
        aquí, este test falla.
        """
        from app.schemas.vehicle import (
            TelemetryPoint, TrackPoint, VehicleOut, VehicleStatus,
        )
        from app.schemas.work_order import WorkOrderOut, WorkOrderStopOut
        from app.schemas.work_cycle import WorkCycleOut

        # Campos de ubicación esperados por schema (nombres exactos en el modelo Pydantic)
        expected: dict[type, set[str]] = {
            VehicleOut:       {"lat", "lng"},
            VehicleStatus:    {"lat", "lon", "lng", "speed_kmh", "heading"},
            TelemetryPoint:   {"lat", "lon", "speed_kmh", "heading", "altitude_m"},
            TrackPoint:       {"lat", "lon"},
            WorkOrderOut:     {"location_lat", "location_lon"},
            WorkOrderStopOut: {"lat", "lon"},
            WorkCycleOut:     {"lat", "lon"},
        }

        for schema_cls, location_fields in expected.items():
            schema_field_names = set(schema_cls.model_fields.keys())
            for f in location_fields:
                assert f in schema_field_names, (
                    f"{schema_cls.__name__} ya no tiene campo '{f}' — "
                    f"actualiza este test o el schema."
                )
            # Verifica que todos los campos están en _LOCATION_FIELDS
            for f in location_fields:
                assert f in _LOCATION_FIELDS, (
                    f"Campo '{f}' de {schema_cls.__name__} no está en _LOCATION_FIELDS — "
                    f"añádelo en access_v2.py para que strip_location() lo cubra."
                )


# ═══════════════════════════════════════════════════════════════════════════════
# Bloque 2: Endpoints REST — FALLAN hasta que se implemente pieza B
# ═══════════════════════════════════════════════════════════════════════════════

class TestLocationPrivacyEndpoints:
    """Anti-fuga: upstream no debe recibir coordenadas cuando el flag está activo.

    FASE ROJA: los tests de manufacturer/CMG fallan porque los endpoints aún
    devuelven lat/lon. Los tests de 'owner' pasan en ambas fases.
    """

    def _status_redis_hash(self) -> dict:
        return {
            b"online": b"true",
            b"lat": b"39.4702",
            b"lon": b"-0.3768",
            b"speed_kmh": b"55.0",
            b"heading": b"90",
            b"altitude_m": b"15.0",
            b"ignition": b"true",
            b"pto_active": b"false",
            b"ext_voltage_mv": b"12100",
            b"can_data": b"{}",
            b"last_seen": b"2026-06-20T08:00:00+00:00",
        }

    def _make_status_db_mock(self) -> AsyncMock:
        mock_db = AsyncMock()
        oos_result = MagicMock()
        oos_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = oos_result
        return mock_db

    def test_vehicle_status_hides_location_from_manufacturer(self):
        """GET /vehicles/{id}/status no devuelve lat/lon al fabricante con flag activo."""
        vehicle = _make_vehicle(hide=True)
        _override_user(MANUFACTURER_USER)

        mock_db = self._make_status_db_mock()

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with patch(
            "app.api.v1.vehicles.assert_can_access_vehicle",
            AsyncMock(return_value=vehicle),
        ):
            with TestClient(app) as client:
                app.state.redis = _redis_with_location()
                resp = client.get(f"/api/v1/vehicles/{VEHICLE_ID}/status")

        assert resp.status_code == 200, resp.text
        leaks = _find_location_leak(resp.json())
        assert not leaks, (
            f"FUGA en GET /vehicles/{{id}}/status (manufacturer): {leaks}"
        )

    def test_vehicle_status_hides_location_from_cmg(self):
        """CMG tampoco ve coordenadas cuando el flag está activo (Decisión 2)."""
        vehicle = _make_vehicle(hide=True)
        _override_user(CMG_USER)

        mock_db = self._make_status_db_mock()

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with patch(
            "app.api.v1.vehicles.assert_can_access_vehicle",
            AsyncMock(return_value=vehicle),
        ):
            with TestClient(app) as client:
                app.state.redis = _redis_with_location()
                resp = client.get(f"/api/v1/vehicles/{VEHICLE_ID}/status")

        assert resp.status_code == 200, resp.text
        leaks = _find_location_leak(resp.json())
        assert not leaks, (
            f"FUGA en GET /vehicles/{{id}}/status (CMG): {leaks}"
        )

    def test_vehicle_status_owner_sees_full_location(self):
        """El dueño SIEMPRE ve coordenadas aunque el flag esté activo."""
        vehicle = _make_vehicle(hide=True)
        _override_user(CLIENT_USER)

        mock_db = self._make_status_db_mock()

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with patch(
            "app.api.v1.vehicles.assert_can_access_vehicle",
            AsyncMock(return_value=vehicle),
        ):
            with TestClient(app) as client:
                app.state.redis = _redis_with_location()
                resp = client.get(f"/api/v1/vehicles/{VEHICLE_ID}/status")

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["lat"] is not None, "El dueño debe ver lat"
        assert data["lon"] is not None, "El dueño debe ver lon"

    def test_telemetry_latest_hides_location_from_manufacturer(self):
        """GET /vehicles/{id}/telemetry/latest no devuelve lat/lon al fabricante."""
        vehicle = _make_vehicle(hide=True)
        _override_user(MANUFACTURER_USER)

        mock_row = MagicMock()
        mock_row._mapping = {
            "time": datetime.now(timezone.utc),
            "lat": 39.4702, "lon": -0.3768,
            "speed_kmh": 55.0, "heading": 90, "altitude_m": 15.0,
            "ignition": True, "pto_active": False,
            "ext_voltage_mv": 12100, "can_data": None,
        }
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.fetchone.return_value = mock_row
        mock_db.execute.return_value = mock_result

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with patch(
            "app.api.v1.vehicles.assert_can_access_vehicle",
            AsyncMock(return_value=vehicle),
        ):
            with TestClient(app) as client:
                resp = client.get(f"/api/v1/vehicles/{VEHICLE_ID}/telemetry/latest")

        assert resp.status_code == 200, resp.text
        leaks = _find_location_leak(resp.json())
        assert not leaks, (
            f"FUGA en GET /vehicles/{{id}}/telemetry/latest: {leaks}"
        )

    def test_track_today_returns_empty_for_manufacturer_with_flag(self):
        """GET /vehicles/{id}/track/today devuelve [] para upstream con flag activo."""
        vehicle = _make_vehicle(hide=True)
        _override_user(MANUFACTURER_USER)

        mock_row = MagicMock()
        mock_row._mapping = {
            "time": datetime.now(timezone.utc),
            "lat": 39.4702, "lon": -0.3768,
        }
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.fetchall.return_value = [mock_row]
        mock_db.execute.return_value = mock_result

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with patch(
            "app.api.v1.vehicles.assert_can_access_vehicle",
            AsyncMock(return_value=vehicle),
        ):
            with TestClient(app) as client:
                resp = client.get(f"/api/v1/vehicles/{VEHICLE_ID}/track/today")

        assert resp.status_code == 200, resp.text
        assert resp.json() == [], (
            "track/today debe devolver [] cuando la ubicación está oculta para upstream"
        )

    def test_track_range_returns_empty_for_manufacturer_with_flag(self):
        """GET /vehicles/{id}/track devuelve [] para upstream con flag activo."""
        vehicle = _make_vehicle(hide=True)
        _override_user(MANUFACTURER_USER)

        mock_row = MagicMock()
        mock_row._mapping = {
            "time": datetime.now(timezone.utc),
            "lat": 39.4702, "lon": -0.3768,
        }
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.fetchall.return_value = [mock_row]
        mock_db.execute.return_value = mock_result

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with patch(
            "app.api.v1.vehicles.assert_can_access_vehicle",
            AsyncMock(return_value=vehicle),
        ):
            with TestClient(app) as client:
                resp = client.get(
                    f"/api/v1/vehicles/{VEHICLE_ID}/track",
                    params={"from": "2026-06-20T00:00:00Z", "to": "2026-06-20T23:59:59Z"},
                )

        assert resp.status_code == 200, resp.text
        assert resp.json() == [], (
            "track debe devolver [] cuando la ubicación está oculta para upstream"
        )

    def test_telemetry_history_hides_location_from_manufacturer(self):
        """GET /vehicles/{id}/telemetry/history no devuelve lat/lon al fabricante."""
        vehicle = _make_vehicle(hide=True)
        _override_user(MANUFACTURER_USER)

        mock_row = MagicMock()
        mock_row._mapping = {
            "time": datetime.now(timezone.utc),
            "lat": 39.4702, "lon": -0.3768,
            "speed_kmh": 55.0, "heading": 90, "altitude_m": 15.0,
            "ignition": True, "pto_active": False,
            "ext_voltage_mv": 12100, "can_data": None,
        }
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.fetchall.return_value = [mock_row]
        mock_db.execute.return_value = mock_result

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with patch(
            "app.api.v1.vehicles.assert_can_access_vehicle",
            AsyncMock(return_value=vehicle),
        ):
            with TestClient(app) as client:
                resp = client.get(f"/api/v1/vehicles/{VEHICLE_ID}/telemetry/history")

        assert resp.status_code == 200, resp.text
        for point in resp.json():
            leaks = _find_location_leak(point)
            assert not leaks, (
                f"FUGA en GET /vehicles/{{id}}/telemetry/history: {leaks}"
            )


# ═══════════════════════════════════════════════════════════════════════════════
# Bloque 3: Endpoint PATCH — FALLA hasta que se implemente pieza F
# ═══════════════════════════════════════════════════════════════════════════════

class TestLocationPrivacyPatch:
    """El fabricante y CMG NO pueden cambiar el flag (Decisión 3)."""

    def test_manufacturer_cannot_change_privacy_flag(self):
        """PATCH /vehicles/{id}/location-privacy devuelve 403 al fabricante."""
        vehicle = _make_vehicle(hide=False)
        _override_user(MANUFACTURER_USER)

        mock_db = AsyncMock()
        mock_db.get.return_value = vehicle

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with TestClient(app) as client:
            resp = client.patch(
                f"/api/v1/vehicles/{VEHICLE_ID}/location-privacy",
                json={"hide": True},
            )

        assert resp.status_code == 403, (
            f"El fabricante no debe poder cambiar el flag de privacidad. Got {resp.status_code}"
        )

    def test_cmg_cannot_change_privacy_flag(self):
        """PATCH /vehicles/{id}/location-privacy devuelve 403 a CMG."""
        vehicle = _make_vehicle(hide=False)
        _override_user(CMG_USER)

        mock_db = AsyncMock()
        mock_db.get.return_value = vehicle

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with TestClient(app) as client:
            resp = client.patch(
                f"/api/v1/vehicles/{VEHICLE_ID}/location-privacy",
                json={"hide": True},
            )

        assert resp.status_code == 403, (
            f"CMG no debe poder cambiar el flag de privacidad. Got {resp.status_code}"
        )

    def test_owner_can_activate_privacy_flag(self):
        """El dueño puede activar hide_location_from_upstream."""
        vehicle = _make_vehicle(hide=False)
        _override_user(CLIENT_USER)

        mock_db = AsyncMock()
        mock_db.get.return_value = vehicle
        mock_redis = AsyncMock()
        app.state.redis = mock_redis

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with TestClient(app) as client:
            resp = client.patch(
                f"/api/v1/vehicles/{VEHICLE_ID}/location-privacy",
                json={"hide": True},
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["hide_location_from_upstream"] is True


# ═══════════════════════════════════════════════════════════════════════════════
# Bloque 4: Endpoints restantes — FALLAN hasta que se filtren (pieza B, batch 2)
# ═══════════════════════════════════════════════════════════════════════════════

class TestLocationPrivacyNewEndpoints:
    """Anti-fuga para los 6 endpoints no cubiertos en el bloque 2.

    TDD: ROJO hasta implementar el filtro, VERDE tras la implementación.
    GET /vehicles/{id} se verifica como "seguro por diseño" (lat/lng nunca en ORM).
    """

    # ── helpers internos ─────────────────────────────────────────────────────

    @staticmethod
    def _make_redis_with_location_pipeline() -> tuple:
        """Devuelve (redis_mock, hash_data) con pipeline sincrónico."""
        hash_data = {
            "lat": "39.4702", "lon": "-0.3768",
            "speed_kmh": "55.0", "heading": "90",
            "ignition": "true",
            "last_seen": "2026-06-20T08:00:00+00:00",
        }
        pipe = MagicMock()
        pipe.hgetall = MagicMock()
        pipe.execute = AsyncMock(return_value=[hash_data])
        redis_mock = AsyncMock()
        redis_mock.pipeline = MagicMock(return_value=pipe)  # sync, no await
        return redis_mock, hash_data

    # ── 1. GET /vehicles (lista) ──────────────────────────────────────────────

    def test_list_vehicles_hides_location_from_manufacturer(self):
        """GET /vehicles no devuelve lat/lng al fabricante con flag activo."""
        vehicle = _make_vehicle(hide=True)
        vehicle.vehicle_type = MagicMock()
        vehicle.vehicle_type.slug = "cisterna"
        _override_user(MANUFACTURER_USER)

        mock_result = MagicMock()
        mock_result.unique.return_value.scalars.return_value.all.return_value = [vehicle]
        mock_db = AsyncMock()
        mock_db.execute.return_value = mock_result

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen
        redis_mock, _ = self._make_redis_with_location_pipeline()

        with TestClient(app) as client:
            app.state.redis = redis_mock
            resp = client.get("/api/v1/vehicles")

        assert resp.status_code == 200, resp.text
        leaks = _find_location_leak(resp.json())
        assert not leaks, f"FUGA en GET /vehicles (manufacturer): {leaks}"

    # ── 2. GET /vehicles/{id} — verificar seguro por diseño ──────────────────

    def test_get_vehicle_detail_no_location_leak_for_upstream(self):
        """GET /vehicles/{id} no filtra coordenadas: lat/lng no son columnas del ORM Vehicle.

        Verificación empírica: el endpoint devuelve el ORM object directamente.
        Como Vehicle no tiene columnas lat/lng, Pydantic usa el default None para
        VehicleOut.lat y VehicleOut.lng. El test usa _find_location_leak para
        demostrar que ningún campo de ubicación llega con valor no-null al fabricante.
        Si en el futuro alguien añadiera lat/lng al ORM o al endpoint, este test
        fallaría y quedaría expuesta la necesidad de añadir strip_location.
        """
        vehicle = _make_vehicle(hide=True)
        _override_user(MANUFACTURER_USER)

        with patch(
            "app.api.v1.vehicles.assert_can_access_vehicle",
            AsyncMock(return_value=vehicle),
        ):
            with TestClient(app) as client:
                resp = client.get(f"/api/v1/vehicles/{VEHICLE_ID}")

        assert resp.status_code == 200, resp.text
        data = resp.json()
        # Verificación mediante _find_location_leak (igual que el resto de endpoints)
        leaks = _find_location_leak(data)
        assert not leaks, (
            f"FUGA en GET /vehicles/{{id}} (upstream): {leaks}. "
            "Si falla, hay que añadir strip_location() en get_vehicle()."
        )
        # Confirmar explícitamente que los campos de VehicleOut están a None
        assert data.get("lat") is None, "lat debe ser None — Vehicle ORM no tiene esta columna"
        assert data.get("lng") is None, "lng debe ser None — Vehicle ORM no tiene esta columna"

    # ── 3. GET /vehicles/statuses (bulk) ─────────────────────────────────────

    def test_bulk_statuses_hides_location_from_cmg(self):
        """GET /vehicles/statuses no devuelve lat/lon a CMG con flag activo."""
        vehicle = _make_vehicle(hide=True)
        _override_user(CMG_USER)

        vehicles_result = MagicMock()
        vehicles_result.scalars.return_value.all.return_value = [vehicle]

        oos_result = MagicMock()
        oos_result.all.return_value = []

        mock_db = AsyncMock()
        mock_db.execute.side_effect = [vehicles_result, oos_result]

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        hash_data = {
            "lat": "39.4702", "lon": "-0.3768",
            "speed_kmh": "55.0", "heading": "90",
            "ignition": "true",
            "last_seen": "2026-06-20T08:00:00+00:00",
        }
        pipe1 = MagicMock()
        pipe1.hgetall = MagicMock()
        pipe1.execute = AsyncMock(return_value=[hash_data])

        pipe2 = MagicMock()
        pipe2.get = MagicMock()
        pipe2.execute = AsyncMock(return_value=[None])

        redis_mock = AsyncMock()
        redis_mock.pipeline = MagicMock(side_effect=[pipe1, pipe2])

        with TestClient(app) as client:
            app.state.redis = redis_mock
            resp = client.get(f"/api/v1/vehicles/statuses?ids={VEHICLE_ID}")

        assert resp.status_code == 200, resp.text
        leaks = _find_location_leak(resp.json())
        assert not leaks, f"FUGA en GET /vehicles/statuses (CMG): {leaks}"

    # ── 4. GET /vehicles/{id}/trips ───────────────────────────────────────────

    def test_trips_returns_empty_for_upstream_with_flag(self):
        """GET /vehicles/{id}/trips devuelve trips=[] al fabricante con flag activo."""
        vehicle = _make_vehicle(hide=True)
        _override_user(MANUFACTURER_USER)

        mock_row = MagicMock()
        mock_row._mapping = {
            "time": datetime.now(timezone.utc),
            "lat": 39.4702, "lon": -0.3768,
            "ignition": True, "speed_kmh": 55.0,
        }
        mock_result = MagicMock()
        mock_result.fetchall.return_value = [mock_row]
        mock_db = AsyncMock()
        mock_db.execute.return_value = mock_result

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with patch(
            "app.api.v1.vehicles.assert_can_access_vehicle",
            AsyncMock(return_value=vehicle),
        ):
            with TestClient(app) as client:
                resp = client.get(f"/api/v1/vehicles/{VEHICLE_ID}/trips?date=2026-06-20")

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["trips"] == [], (
            f"trips debe estar vacío para upstream con flag activo; got {data['trips']}"
        )
        leaks = _find_location_leak(data)
        assert not leaks, f"FUGA en GET /vehicles/{{id}}/trips: {leaks}"

    # ── 5. GET /work-orders ───────────────────────────────────────────────────

    def test_work_orders_list_hides_location_from_cmg(self):
        """GET /work-orders no devuelve location_lat/lon a CMG con flag activo."""
        from app.models.work_order import WorkOrder as WorkOrderModel

        vehicle = _make_vehicle(hide=True)
        _override_user(CMG_USER)

        mock_order = MagicMock()
        mock_order.id = uuid.uuid4()
        mock_order.tenant_id = CLIENT_TENANT_ID
        mock_order.vehicle_id = VEHICLE_ID
        mock_order.driver_id = None
        mock_order.title = "Test Order"
        mock_order.status = "pending"
        mock_order.priority = "normal"
        mock_order.description = None
        mock_order.scheduled_at = None
        mock_order.started_at = None
        mock_order.completed_at = None
        mock_order.location_address = "Calle Test, Valencia"
        mock_order.location_lat = 39.4702
        mock_order.location_lon = -0.3768
        mock_order.notes = None
        mock_order.final_client_name = None
        mock_order.final_client_address = None
        mock_order.doc_number = None
        mock_order.created_by = None
        mock_order.created_at = datetime.now(timezone.utc)
        mock_order.auto_close_config = None
        mock_order.vehicle_name = None
        mock_order.driver_name = None

        orders_result = MagicMock()
        orders_result.scalars.return_value.all.return_value = [mock_order]

        mock_db = AsyncMock()
        mock_db.execute.return_value = orders_result
        mock_db.get.return_value = vehicle  # db.get(Vehicle, vehicle_id)

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with TestClient(app) as client:
            resp = client.get("/api/v1/work-orders")

        assert resp.status_code == 200, resp.text
        leaks = _find_location_leak(resp.json())
        assert not leaks, f"FUGA en GET /work-orders (CMG): {leaks}"

    # ── 6. GET /work-orders/{id} ──────────────────────────────────────────────

    def test_work_order_detail_hides_location_from_cmg(self):
        """GET /work-orders/{id} no devuelve location_lat/lon a CMG con flag activo."""
        vehicle = _make_vehicle(hide=True)
        _override_user(CMG_USER)

        order_id = uuid.uuid4()
        mock_order = MagicMock()
        mock_order.id = order_id
        mock_order.tenant_id = CLIENT_TENANT_ID
        mock_order.vehicle_id = VEHICLE_ID
        mock_order.driver_id = None
        mock_order.title = "Test Order"
        mock_order.status = "pending"
        mock_order.priority = "normal"
        mock_order.description = None
        mock_order.scheduled_at = None
        mock_order.started_at = None
        mock_order.completed_at = None
        mock_order.location_address = "Calle Test, Valencia"
        mock_order.location_lat = 39.4702
        mock_order.location_lon = -0.3768
        mock_order.notes = None
        mock_order.final_client_name = None
        mock_order.final_client_address = None
        mock_order.doc_number = None
        mock_order.created_by = None
        mock_order.created_at = datetime.now(timezone.utc)
        mock_order.auto_close_config = None
        mock_order.vehicle_name = None
        mock_order.driver_name = None

        mock_db = AsyncMock()
        mock_db.get.return_value = vehicle  # primer get devuelve orden NO; necesita ser selectivo

        # Para work-orders/{id}: db.get(WorkOrder, order_id) primero,
        # luego db.get(Vehicle, vehicle_id) en _enrich
        from app.models.work_order import WorkOrder as WorkOrderModel

        async def _get_side_effect(model, oid):
            if model is WorkOrderModel:
                return mock_order
            return vehicle  # Vehicle

        mock_db.get = AsyncMock(side_effect=_get_side_effect)

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with TestClient(app) as client:
            resp = client.get(f"/api/v1/work-orders/{order_id}")

        assert resp.status_code == 200, resp.text
        leaks = _find_location_leak(resp.json())
        assert not leaks, f"FUGA en GET /work-orders/{{id}} (CMG): {leaks}"

    # ── 7. GET /work-orders/{id}/stops ────────────────────────────────────────

    def test_work_order_stops_hides_location_from_cmg(self):
        """GET /work-orders/{id}/stops no devuelve lat/lon a CMG con flag activo."""
        from app.models.work_order import WorkOrder as WorkOrderModel

        vehicle = _make_vehicle(hide=True)
        _override_user(CMG_USER)

        order_id = uuid.uuid4()
        mock_order = MagicMock()
        mock_order.id = order_id
        mock_order.tenant_id = CLIENT_TENANT_ID
        mock_order.vehicle_id = VEHICLE_ID

        mock_stop = MagicMock()
        mock_stop.id = uuid.uuid4()
        mock_stop.work_order_id = order_id
        mock_stop.order_index = 0
        mock_stop.title = "Parada Test"
        mock_stop.address = "Calle Test, Valencia"
        mock_stop.lat = 39.4702
        mock_stop.lon = -0.3768
        mock_stop.arrival_radius_m = 150
        mock_stop.notes = None
        mock_stop.client_name = None
        mock_stop.status = "pending"
        mock_stop.arrived_at = None
        mock_stop.started_at = None
        mock_stop.completed_at = None
        mock_stop.pto_minutes = None
        mock_stop.fuel_l = None
        mock_stop.rpm_avg = None
        mock_stop.pump_minutes = None
        mock_stop.pressure_min = None
        mock_stop.pressure_max = None
        mock_stop.created_at = datetime.now(timezone.utc)

        stops_result = MagicMock()
        stops_result.scalars.return_value.all.return_value = [mock_stop]

        async def _get_side_effect(model, oid):
            if model is WorkOrderModel:
                return mock_order
            return vehicle  # Vehicle

        mock_db = AsyncMock()
        mock_db.get = AsyncMock(side_effect=_get_side_effect)
        mock_db.execute.return_value = stops_result

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        with TestClient(app) as client:
            resp = client.get(f"/api/v1/work-orders/{order_id}/stops")

        assert resp.status_code == 200, resp.text
        leaks = _find_location_leak(resp.json())
        assert not leaks, f"FUGA en GET /work-orders/{{id}}/stops (CMG): {leaks}"

    # ── 8. GET /work-cycles ───────────────────────────────────────────────────

    def test_work_cycles_hides_location_from_cmg(self):
        """GET /work-cycles no devuelve lat/lon a CMG con flag activo en el vehículo."""
        vehicle = _make_vehicle(hide=True)
        _override_user(CMG_USER)

        mock_cycle = MagicMock()
        mock_cycle.id = uuid.uuid4()
        mock_cycle.vehicle_id = VEHICLE_ID
        mock_cycle.definition_id = uuid.uuid4()
        mock_cycle.tenant_id = CLIENT_TENANT_ID
        mock_cycle.started_at = datetime.now(timezone.utc)
        mock_cycle.ended_at = None
        mock_cycle.duration_seconds = None
        mock_cycle.cycle_data = {}
        mock_cycle.lat = 39.4702
        mock_cycle.lon = -0.3768

        cycles_result = MagicMock()
        cycles_result.scalars.return_value.all.return_value = [mock_cycle]

        mock_db = AsyncMock()
        mock_db.execute.return_value = cycles_result
        mock_db.get.return_value = vehicle  # db.get(Vehicle, vehicle_id)

        async def _db_gen():
            yield mock_db

        app.dependency_overrides[get_db] = _db_gen

        from_dt = "2026-06-20T00:00:00Z"
        to_dt = "2026-06-20T23:59:59Z"

        with TestClient(app) as client:
            resp = client.get(
                f"/api/v1/work-cycles?vehicle_id={VEHICLE_ID}"
                f"&from_dt={from_dt}&to_dt={to_dt}"
            )

        assert resp.status_code == 200, resp.text
        leaks = _find_location_leak(resp.json())
        assert not leaks, f"FUGA en GET /work-cycles (CMG): {leaks}"
