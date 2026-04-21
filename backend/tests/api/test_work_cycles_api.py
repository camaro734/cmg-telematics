import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db


def _make_user(tier="cmg", role="admin", tenant_id=None):
    u = MagicMock()
    u.tenant_tier = tier
    u.role = role
    u.tenant_id = tenant_id or uuid.uuid4()
    return u


def _make_db():
    db = AsyncMock()
    db.execute = AsyncMock()
    db.get = AsyncMock(return_value=None)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    return db


def _override(user, db):
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db


def test_wc_unauthenticated():
    app.dependency_overrides = {}
    client = TestClient(app, raise_server_exceptions=False)
    res = client.get("/api/v1/work-cycles/definitions")
    assert res.status_code in (401, 403)


def test_wc_cmg_admin_creates_definition():
    user = _make_user(tier="cmg", role="admin")
    db = _make_db()
    defn = MagicMock()
    defn.id = uuid.uuid4()
    defn.vehicle_type_id = uuid.uuid4()
    defn.tenant_id = None
    defn.name = "Ciclo PTO"
    defn.trigger_type = "pto_change"
    defn.trigger_config = {}
    defn.snapshot_fields = []
    defn.aggregate_fields = []
    defn.active = True
    from datetime import datetime, timezone
    defn.created_at = datetime.now(timezone.utc)
    db.refresh.side_effect = lambda obj: None

    async def fake_refresh(obj):
        obj.id = defn.id
        obj.vehicle_type_id = defn.vehicle_type_id
        obj.tenant_id = defn.tenant_id
        obj.name = defn.name
        obj.trigger_type = defn.trigger_type
        obj.trigger_config = defn.trigger_config
        obj.snapshot_fields = defn.snapshot_fields
        obj.aggregate_fields = defn.aggregate_fields
        obj.active = defn.active
        obj.created_at = defn.created_at

    db.refresh = fake_refresh
    _override(user, db)
    client = TestClient(app, raise_server_exceptions=False)
    res = client.post("/api/v1/work-cycles/definitions", json={
        "vehicle_type_id": str(uuid.uuid4()),
        "name": "Ciclo PTO",
        "trigger_type": "pto_change",
    })
    assert res.status_code == 201
    assert res.json()["trigger_type"] == "pto_change"
    assert res.json()["tenant_id"] is None


def test_wc_client_admin_creates_definition():
    tenant_id = uuid.uuid4()
    user = _make_user(tier="client", role="admin", tenant_id=tenant_id)
    db = _make_db()
    from datetime import datetime, timezone

    async def fake_refresh(obj):
        obj.id = uuid.uuid4()
        obj.vehicle_type_id = uuid.uuid4()
        obj.tenant_id = tenant_id
        obj.name = "Sensor inductivo"
        obj.trigger_type = "sensor_pulse"
        obj.trigger_config = {"sensor": "inductive", "min_gap_seconds": 30}
        obj.snapshot_fields = []
        obj.aggregate_fields = []
        obj.active = True
        obj.created_at = datetime.now(timezone.utc)

    db.refresh = fake_refresh
    _override(user, db)
    client = TestClient(app, raise_server_exceptions=False)
    res = client.post("/api/v1/work-cycles/definitions", json={
        "vehicle_type_id": str(uuid.uuid4()),
        "name": "Sensor inductivo",
        "trigger_type": "sensor_pulse",
        "trigger_config": {"sensor": "inductive", "min_gap_seconds": 30},
    })
    assert res.status_code == 201
    assert res.json()["tenant_id"] == str(tenant_id)


def test_wc_non_admin_cannot_create():
    user = _make_user(tier="client", role="operator")
    db = _make_db()
    _override(user, db)
    client = TestClient(app, raise_server_exceptions=False)
    res = client.post("/api/v1/work-cycles/definitions", json={
        "vehicle_type_id": str(uuid.uuid4()),
        "name": "X",
        "trigger_type": "pto_change",
    })
    assert res.status_code == 403


def test_wc_client_cannot_modify_global_definition():
    tenant_id = uuid.uuid4()
    user = _make_user(tier="client", role="admin", tenant_id=tenant_id)
    db = _make_db()
    defn = MagicMock()
    defn.tenant_id = None  # global CMG definition
    db.get.return_value = defn
    _override(user, db)
    client = TestClient(app, raise_server_exceptions=False)
    res = client.patch(f"/api/v1/work-cycles/definitions/{uuid.uuid4()}", json={"active": False})
    assert res.status_code == 404


def test_wc_list_cycles_scoped_to_tenant():
    tenant_id = uuid.uuid4()
    user = _make_user(tier="client", role="operator", tenant_id=tenant_id)
    db = _make_db()
    scalars_mock = MagicMock()
    scalars_mock.all.return_value = []
    execute_result = MagicMock()
    execute_result.scalars.return_value = scalars_mock
    db.execute.return_value = execute_result
    _override(user, db)
    client = TestClient(app, raise_server_exceptions=False)
    res = client.get(
        "/api/v1/work-cycles",
        params={
            "vehicle_id": str(uuid.uuid4()),
            "from_dt": "2026-04-01T00:00:00Z",
            "to_dt": "2026-04-30T23:59:59Z",
        },
    )
    assert res.status_code == 200
    assert res.json() == []


def test_wc_compute_returns_count():
    user = _make_user(tier="cmg", role="admin")
    db = _make_db()
    defn = MagicMock()
    defn.trigger_type = "pto_change"
    defn.trigger_config = {}
    defn.snapshot_fields = []
    defn.aggregate_fields = []
    vehicle = MagicMock()
    vehicle.active = True
    vehicle.tenant_id = uuid.uuid4()

    async def fake_get(model, pk):
        from app.models.work_cycle import WorkCycleDefinition
        from app.models.vehicle import Vehicle
        if model is WorkCycleDefinition:
            return defn
        if model is Vehicle:
            return vehicle
        return None

    db.get = fake_get
    db.execute = AsyncMock(return_value=MagicMock(fetchall=MagicMock(return_value=[])))

    with patch("app.api.v1.work_cycles.detect_and_store_cycles", new=AsyncMock(return_value=5)):
        _override(user, db)
        client = TestClient(app, raise_server_exceptions=False)
        res = client.post("/api/v1/work-cycles/compute", json={
            "vehicle_id": str(uuid.uuid4()),
            "definition_id": str(uuid.uuid4()),
            "from_dt": "2026-04-01T00:00:00Z",
            "to_dt": "2026-04-30T23:59:59Z",
        })
    assert res.status_code == 200
    assert res.json()["computed"] == 5
