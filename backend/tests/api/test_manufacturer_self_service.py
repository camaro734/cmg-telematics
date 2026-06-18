import uuid
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser
from app.models.tenant import Tenant

CMG_ID = uuid.UUID("ee100000-0000-0000-0000-000000000001")
MFR_ID = uuid.UUID("aa100000-0000-0000-0000-000000000001")
CLIENT_ID = uuid.UUID("bb100000-0000-0000-0000-000000000001")

CMG_ADMIN = CurrentUser(user_id=uuid.uuid4(), tenant_id=CMG_ID, tenant_tier="cmg", role="admin", email="cmg@t.com")
MFR_ADMIN = CurrentUser(user_id=uuid.uuid4(), tenant_id=MFR_ID, tenant_tier="manufacturer", role="admin", email="m@t.com")


def _setup(user, db):
    app.dependency_overrides[get_current_user] = lambda: user
    async def _g():
        yield db
    app.dependency_overrides[get_db] = _g


@pytest.fixture(autouse=True)
def clear():
    yield
    app.dependency_overrides.clear()


class _MfrTenant:
    """Tenant fabricante mutable."""
    def __init__(self):
        self.id = MFR_ID
        self.tier = "manufacturer"
        self.parent_id = None
        self.parent_manufacturer_id = None
        self.name = "VPS"
        self.slug = "vps"
        self.active = True
        self.brand_name = None; self.brand_color = None; self.logo_url = None
        self.custom_domain = None; self.brand_tokens = None
        self.enabled_modules = []
        self.business_cif = None; self.business_address = None
        self.created_at = datetime.now(timezone.utc)
        self.manufacturer_can_view_operations = True
        self.manufacturer_can_view_can_data = True
        self.manufacturer_can_create_rules = True
        self.manufacturer_can_manage_clients = False
        self.manufacturer_can_transfer_vehicles = False


def test_cmg_can_set_manufacturer_flags():
    tenant = _MfrTenant()
    db = AsyncMock()
    db.get = AsyncMock(return_value=tenant)
    db.refresh = AsyncMock()
    _setup(CMG_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).patch(
        f"/api/v1/tenants/{MFR_ID}",
        json={"manufacturer_can_manage_clients": True, "manufacturer_can_transfer_vehicles": True},
    )
    assert resp.status_code == 200
    assert tenant.manufacturer_can_manage_clients is True
    assert tenant.manufacturer_can_transfer_vehicles is True
    body = resp.json()
    assert body["manufacturer_can_manage_clients"] is True
