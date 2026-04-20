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
        name="Wasterent Users",
        slug=f"wasterent-u-{uuid.uuid4().hex[:8]}",
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


async def _create_client_admin(db, tenant_id: uuid.UUID, client):
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
    return str(u.id), resp.json()["access_token"]


async def test_create_user_cmg_admin(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    resp = await client.post(
        f"/api/v1/tenants/{tenant.id}/users",
        json={
            "email": f"new-{uuid.uuid4().hex[:8]}@wasterent.com",
            "full_name": "Nuevo Usuario",
            "role": "operator",
            "password": "Pass1234!",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["role"] == "operator"
    assert data["active"] is True
    assert "password" not in data
    assert "hashed_password" not in data


async def test_create_user_own_admin(client, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    _, token = await _create_client_admin(db, tenant.id, client)
    resp = await client.post(
        f"/api/v1/tenants/{tenant.id}/users",
        json={
            "email": f"op-{uuid.uuid4().hex[:8]}@wasterent.com",
            "full_name": "Operador",
            "role": "operator",
            "password": "Pass1234!",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201


async def test_create_user_foreign_admin_forbidden(client, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant_a = await _create_client_tenant(db, cmg_id)
    tenant_b = await _create_client_tenant(db, cmg_id)
    _, token_b = await _create_client_admin(db, tenant_b.id, client)
    resp = await client.post(
        f"/api/v1/tenants/{tenant_a.id}/users",
        json={
            "email": f"x-{uuid.uuid4().hex[:8]}@test.com",
            "full_name": "Intruso",
            "role": "viewer",
            "password": "Pass1234!",
        },
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert resp.status_code == 403


async def test_list_users_in_tenant(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    await _create_client_admin(db, tenant.id, client)
    resp = await client.get(
        f"/api/v1/tenants/{tenant.id}/users",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


async def test_update_user_role(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    user_id, _ = await _create_client_admin(db, tenant.id, client)
    resp = await client.put(
        f"/api/v1/users/{user_id}",
        json={"role": "viewer"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "viewer"


async def test_deactivate_user_soft_delete(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    user_id, _ = await _create_client_admin(db, tenant.id, client)
    resp = await client.delete(
        f"/api/v1/users/{user_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 204
    from app.models.user import User
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    u = result.scalar_one()
    assert u.active is False
