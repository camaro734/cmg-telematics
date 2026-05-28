"""
Tests para GET /api/v1/reports/monthly.
generate_monthly_pdf siempre mockeado — WeasyPrint nunca se ejecuta.
"""
from unittest.mock import AsyncMock, MagicMock, patch
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser

CMG_TENANT_ID    = uuid.UUID("10000000-0000-0000-0000-000000000000")
CLIENT_TENANT_ID = uuid.UUID("20000000-0000-0000-0000-000000000000")
OTHER_TENANT_ID  = uuid.UUID("30000000-0000-0000-0000-000000000000")

CMG_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CMG_TENANT_ID,
    tenant_tier="cmg", role="admin", email="cmg@test.com",
)
CLIENT_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CLIENT_TENANT_ID,
    tenant_tier="client", role="admin", email="client@test.com",
)


def _override_user(user: CurrentUser):
    app.dependency_overrides[get_current_user] = lambda: user


def _override_db(session):
    async def _gen():
        yield session
    app.dependency_overrides[get_db] = _gen


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_reports_unauthenticated():
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/reports/monthly?year=2026&month=4")
    assert resp.status_code == 403


def _db_with_reports_module() -> AsyncMock:
    """AsyncSession mock con tenant que tiene enabled_modules=["reports"].
    require_module("reports") llama a db.get(Tenant, ...) — necesita este mock
    para que el check de módulos pase antes de llegar a la lógica de negocio.
    """
    tenant = MagicMock()
    tenant.enabled_modules = ["reports"]
    db = AsyncMock()
    db.get = AsyncMock(return_value=tenant)
    return db


def test_reports_invalid_month():
    _override_user(CLIENT_USER)
    _override_db(_db_with_reports_module())
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/reports/monthly?year=2026&month=13")
    assert resp.status_code == 400


def test_reports_too_many_vehicles():
    _override_user(CLIENT_USER)
    _override_db(_db_with_reports_module())
    vids = "&".join(f"vehicle_ids={uuid.uuid4()}" for _ in range(16))
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/reports/monthly?year=2026&month=4&{vids}")
    assert resp.status_code == 400


def test_reports_client_admin_cross_tenant_forbidden():
    _override_user(CLIENT_USER)
    _override_db(_db_with_reports_module())
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/reports/monthly?year=2026&month=4&tenant_id={OTHER_TENANT_ID}")
    assert resp.status_code == 403


def test_reports_client_admin_own_tenant():
    _override_user(CLIENT_USER)
    db = _db_with_reports_module()
    vehicle_result = MagicMock()
    vehicle_result.scalars.return_value.all.return_value = []
    db.execute = AsyncMock(side_effect=[vehicle_result])
    _override_db(db)
    with patch("app.api.v1.reports.generate_monthly_pdf", return_value=b"%PDF-fake") as mock_gen:
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/api/v1/reports/monthly?year=2026&month=4")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    mock_gen.assert_called_once()


def test_reports_cmg_admin_returns_pdf():
    _override_user(CMG_USER)
    db = AsyncMock()
    tenant_result = MagicMock()
    tenant_result.scalar_one_or_none.return_value = MagicMock(id=CLIENT_TENANT_ID)
    vehicle_result = MagicMock()
    vehicle_result.scalars.return_value.all.return_value = []
    db.execute = AsyncMock(side_effect=[tenant_result, vehicle_result])
    _override_db(db)
    with patch("app.api.v1.reports.generate_monthly_pdf", return_value=b"%PDF-fake") as mock_gen:
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get(f"/api/v1/reports/monthly?year=2026&month=4&tenant_id={CLIENT_TENANT_ID}")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    mock_gen.assert_called_once()
