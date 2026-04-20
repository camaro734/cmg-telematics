import uuid
import pytest
from sqlalchemy import select


async def _cmg_tenant_id(db) -> str:
    from app.models.tenant import Tenant
    result = await db.execute(select(Tenant).where(Tenant.tier == "cmg"))
    return str(result.scalar_one().id)


async def _create_client_tenant(db, cmg_id: str):
    from app.models.tenant import Tenant
    t = Tenant(
        parent_id=uuid.UUID(cmg_id),
        tier="client",
        name="Wasterent Test",
        slug=f"wasterent-{uuid.uuid4().hex[:8]}",
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


async def _create_client_admin_token(db, tenant_id: uuid.UUID, client) -> str:
    from app.models.user import User
    from app.core.security import hash_password
    email = f"admin-{uuid.uuid4().hex[:8]}@wasterent.com"
    u = User(
        tenant_id=tenant_id,
        email=email,
        hashed_password=hash_password("Test1234!"),
        full_name="Admin Wasterent",
        role="admin",
    )
    db.add(u)
    await db.commit()
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": "Test1234!"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


async def test_get_tenant_detail_cmg_admin(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    resp = await client.get(
        f"/api/v1/tenants/{tenant.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == str(tenant.id)
    assert resp.json()["name"] == "Wasterent Test"


async def test_get_tenant_detail_own_admin(client, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    token = await _create_client_admin_token(db, tenant.id, client)
    resp = await client.get(
        f"/api/v1/tenants/{tenant.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200


async def test_get_tenant_detail_foreign_admin_404(client, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    other = await _create_client_tenant(db, cmg_id)
    token = await _create_client_admin_token(db, other.id, client)
    resp = await client.get(
        f"/api/v1/tenants/{tenant.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


async def test_update_tenant_cmg_admin(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    resp = await client.put(
        f"/api/v1/tenants/{tenant.id}",
        json={"name": "Wasterent Renombrado"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Wasterent Renombrado"


async def test_update_tenant_client_admin_forbidden(client, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    token = await _create_client_admin_token(db, tenant.id, client)
    resp = await client.put(
        f"/api/v1/tenants/{tenant.id}",
        json={"name": "Intento"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


async def test_update_tenant_slug_conflict(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant_a = await _create_client_tenant(db, cmg_id)
    tenant_b = await _create_client_tenant(db, cmg_id)
    resp = await client.put(
        f"/api/v1/tenants/{tenant_b.id}",
        json={"slug": tenant_a.slug},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 409


async def test_list_grants_grantee_filter(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    post_resp = await client.post(
        "/api/v1/grants",
        json={"grantee_id": str(tenant.id), "resource_type": "maintenance", "allowed_actions": ["log"]},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert post_resp.status_code == 201
    resp = await client.get(
        f"/api/v1/grants?grantee_id={tenant.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    grants = resp.json()
    assert len(grants) >= 1
    assert all(g["grantee_id"] == str(tenant.id) for g in grants)
