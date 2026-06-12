"""
Tests para create_log (POST /maintenance/plans/:id/logs) con soporte de archivo.

Cubre:
- Registro sin archivo → document_url null, 201
- Registro con PDF → document_url set, archivo guardado en volumen
- Tipo de archivo no permitido → 400
- Archivo demasiado grande → 400
- reset_counters JSON inválido → 422
- performed_at inválido → 422
"""
import io
import uuid
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.core.database import get_db

PLAN_ID = uuid.uuid4()
VEHICLE_ID = uuid.uuid4()
TENANT_ID = uuid.uuid4()

client = TestClient(app, raise_server_exceptions=False)


def _user(tier: str = "cmg", role: str = "admin") -> CurrentUser:
    return CurrentUser(
        user_id=uuid.uuid4(),
        tenant_id=TENANT_ID,
        tenant_tier=tier,
        role=role,
        email=f"{tier}.{role}@test.com",
    )


def _make_db(plan=None):
    from app.models.maintenance import MaintenancePlan
    from app.models.vehicle import Vehicle
    from app.models.vehicle_type import VehicleType
    from app.models.tenant import Tenant

    if plan is None:
        plan = _plan_mock()

    mock_db = AsyncMock()

    async def _get(model, pk):
        if model is MaintenancePlan:
            return plan
        if model is Vehicle:
            v = MagicMock()
            v.id = VEHICLE_ID
            v.tenant_id = TENANT_ID
            v.vehicle_type_id = uuid.uuid4()
            return v
        if model is VehicleType:
            vt = MagicMock()
            vt.maintenance_counters = []
            return vt
        if model is Tenant:
            t = MagicMock()
            t.enabled_modules = ["maintenance"]
            return t
        return None

    created_log = MagicMock()
    created_log.id = uuid.uuid4()
    created_log.plan_id = PLAN_ID
    created_log.vehicle_id = VEHICLE_ID
    created_log.performed_at = datetime(2026, 6, 1, tzinfo=timezone.utc)
    created_log.performed_by = uuid.uuid4()
    created_log.description = None
    created_log.reset_counters = []
    created_log.cost_eur = None
    created_log.document_url = None
    created_log.counter_readings = None

    async def _refresh(obj):
        pass

    mock_db.get = AsyncMock(side_effect=_get)
    mock_db.commit = AsyncMock()
    mock_db.refresh = AsyncMock(side_effect=_refresh)
    mock_db.add = AsyncMock()
    fetch = MagicMock()
    fetch.scalar_one_or_none = MagicMock(return_value=None)
    fetch.scalar_one = MagicMock(return_value=0.0)
    fetch.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))
    mock_db.execute = AsyncMock(return_value=fetch)
    return mock_db


def _plan_mock():
    p = MagicMock()
    p.id = PLAN_ID
    p.vehicle_id = VEHICLE_ID
    p.tenant_id = TENANT_ID
    p.owner_tenant_id = TENANT_ID
    p.name = "Plan test upload"
    p.trigger_condition = {"thresholds": [{"type": "calendar_days", "value": 90}]}
    p.warn_before_pct = 10
    p.active = True
    p.created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return p


def _override(user: CurrentUser, db=None):
    app.dependency_overrides[get_current_user] = lambda: user
    if db is not None:
        app.dependency_overrides[get_db] = lambda: db


def _clear():
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def cleanup():
    yield
    _clear()


def _log_url():
    return f"/api/v1/maintenance/plans/{PLAN_ID}/logs"


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_create_log_without_file_returns_201():
    db = _make_db()
    _override(_user(), db)
    resp = client.post(
        _log_url(),
        data={
            "performed_at": "2026-06-01T10:00:00",
            "reset_counters": "[]",
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["document_url"] is None


def test_create_log_with_pdf_sets_document_url():
    db = _make_db()
    _override(_user(), db)
    pdf_content = b"%PDF-1.4 fake pdf content"
    with (
        patch.object(Path, "mkdir"),
        patch.object(Path, "write_bytes") as mock_write,
    ):
        resp = client.post(
            _log_url(),
            data={
                "performed_at": "2026-06-01T10:00:00",
                "reset_counters": "[]",
                "description": "Cambio aceite",
            },
            files={"file": ("factura.pdf", io.BytesIO(pdf_content), "application/pdf")},
        )
    assert resp.status_code == 201, resp.text
    mock_write.assert_called_once()
    data = resp.json()
    assert data["document_url"] is not None
    assert data["document_url"].startswith("/uploads/maintenance_docs/")
    assert data["document_url"].endswith(".pdf")


def test_create_log_with_image_sets_document_url():
    db = _make_db()
    _override(_user(), db)
    with (
        patch.object(Path, "mkdir"),
        patch.object(Path, "write_bytes"),
    ):
        resp = client.post(
            _log_url(),
            data={"performed_at": "2026-06-01T10:00:00", "reset_counters": "[]"},
            files={"file": ("foto.jpg", io.BytesIO(b"fake jpeg"), "image/jpeg")},
        )
    assert resp.status_code == 201, resp.text
    assert resp.json()["document_url"].endswith(".jpg")


def test_create_log_invalid_file_type_returns_400():
    db = _make_db()
    _override(_user(), db)
    resp = client.post(
        _log_url(),
        data={"performed_at": "2026-06-01T10:00:00", "reset_counters": "[]"},
        files={"file": ("script.exe", io.BytesIO(b"MZ"), "application/octet-stream")},
    )
    assert resp.status_code == 400
    assert "Formato no válido" in resp.json()["detail"]


def test_create_log_file_too_large_returns_400():
    db = _make_db()
    _override(_user(), db)
    big_content = b"x" * (5 * 1024 * 1024 + 1)
    resp = client.post(
        _log_url(),
        data={"performed_at": "2026-06-01T10:00:00", "reset_counters": "[]"},
        files={"file": ("big.pdf", io.BytesIO(big_content), "application/pdf")},
    )
    assert resp.status_code == 400
    assert "5 MB" in resp.json()["detail"]


def test_create_log_invalid_reset_counters_returns_422():
    db = _make_db()
    _override(_user(), db)
    resp = client.post(
        _log_url(),
        data={
            "performed_at": "2026-06-01T10:00:00",
            "reset_counters": "not-json",
        },
    )
    assert resp.status_code == 422


def test_create_log_invalid_performed_at_returns_422():
    db = _make_db()
    _override(_user(), db)
    resp = client.post(
        _log_url(),
        data={
            "performed_at": "not-a-date",
            "reset_counters": "[]",
        },
    )
    assert resp.status_code == 422


def test_create_log_with_cost_sets_cost():
    db = _make_db()
    _override(_user(), db)
    resp = client.post(
        _log_url(),
        data={
            "performed_at": "2026-06-01T10:00:00",
            "reset_counters": '["calendar_days"]',
            "cost_eur": "150.50",
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["cost_eur"] == 150.5
