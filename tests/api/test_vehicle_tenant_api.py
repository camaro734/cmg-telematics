import uuid
import pytest
from sqlalchemy import select


async def _cmg_tenant_id(db) -> str:
    from app.models.tenant import Tenant
    result = await db.execute(select(Tenant).where(Tenant.tier == "cmg"))
    return str(result.scalar_one().id)


async def _first_vtype_id(client, token: str) -> str:
    resp = await client.get("/api/v1/vehicle-types", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    return resp.json()[0]["id"]


async def _create_client_tenant(db, cmg_id: str):
    from app.models.tenant import Tenant
    t = Tenant(
        parent_id=uuid.UUID(cmg_id),
        tier="client",
        name="Wasterent Vehicles",
        slug=f"wasterent-v-{uuid.uuid4().hex[:8]}",
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


async def _create_client_admin_token(db, tenant_id: uuid.UUID, client) -> str:
    from app.models.user import User
    from app.core.security import hash_password
    email = f"admin-v-{uuid.uuid4().hex[:8]}@wasterent.com"
    u = User(
        tenant_id=tenant_id,
        email=email,
        hashed_password=hash_password("Test1234!"),
        full_name="Admin",
        role="admin",
    )
    db.add(u)
    await db.commit()
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": "Test1234!"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


async def test_create_vehicle_cmg_for_client(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    vtype_id = await _first_vtype_id(client, admin_token)
    resp = await client.post(
        "/api/v1/vehicles",
        json={"vehicle_type_id": vtype_id, "name": "Cisterna 01", "tenant_id": str(tenant.id)},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201
    assert resp.json()["tenant_id"] == str(tenant.id)


async def test_create_vehicle_client_admin_own_tenant(client, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    token = await _create_client_admin_token(db, tenant.id, client)
    vtype_id = await _first_vtype_id(client, token)
    resp = await client.post(
        "/api/v1/vehicles",
        json={"vehicle_type_id": vtype_id, "name": "Barredora 01"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    assert resp.json()["tenant_id"] == str(tenant.id)


async def test_create_vehicle_client_cannot_override_tenant(client, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant_a = await _create_client_tenant(db, cmg_id)
    tenant_b = await _create_client_tenant(db, cmg_id)
    token_a = await _create_client_admin_token(db, tenant_a.id, client)
    vtype_id = await _first_vtype_id(client, token_a)
    resp = await client.post(
        "/api/v1/vehicles",
        json={"vehicle_type_id": vtype_id, "name": "Intento", "tenant_id": str(tenant_b.id)},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert resp.status_code == 201
    assert resp.json()["tenant_id"] == str(tenant_a.id)


async def test_list_vehicles_tenant_filter(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    vtype_id = await _first_vtype_id(client, admin_token)
    create_resp = await client.post(
        "/api/v1/vehicles",
        json={"vehicle_type_id": vtype_id, "name": "Filtro Test", "tenant_id": str(tenant.id)},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert create_resp.status_code == 201
    resp = await client.get(
        f"/api/v1/vehicles?tenant_id={tenant.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    vehicles = resp.json()
    assert len(vehicles) >= 1
    assert all(v["tenant_id"] == str(tenant.id) for v in vehicles)
