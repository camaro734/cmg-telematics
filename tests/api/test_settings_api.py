# tests/api/test_settings_api.py
import uuid


async def test_get_settings_requires_auth(client):
    resp = await client.get("/api/v1/settings")
    assert resp.status_code == 403


async def test_get_settings_returns_tenant(client, admin_token):
    resp = await client.get(
        "/api/v1/settings",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "tenant_id" in data
    assert "notification_email" in data
    assert data["notification_email"] is None


async def test_patch_settings_updates_email(client, admin_token):
    resp = await client.patch(
        "/api/v1/settings",
        json={"notification_email": "ops@test.com"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["notification_email"] == "ops@test.com"


async def test_patch_settings_clears_email(client, admin_token):
    await client.patch(
        "/api/v1/settings",
        json={"notification_email": "ops@test.com"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    resp = await client.patch(
        "/api/v1/settings",
        json={"notification_email": None},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["notification_email"] is None


async def test_patch_settings_rejects_invalid_email(client, admin_token):
    resp = await client.patch(
        "/api/v1/settings",
        json={"notification_email": "not-an-email"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 422


async def test_patch_settings_requires_admin(client, admin_token, db):
    import base64, json as _json
    payload = admin_token.split(".")[1]
    payload += "=" * (4 - len(payload) % 4)
    claims = _json.loads(base64.b64decode(payload))
    tenant_id = claims["tenant_id"]

    from app.models.user import User
    from app.core.security import hash_password
    op_email = f"operator_{uuid.uuid4().hex[:8]}@test.com"
    operator = User(
        tenant_id=uuid.UUID(tenant_id),
        email=op_email,
        hashed_password=hash_password("Test1234!"),
        full_name="Test Operator",
        role="operator",
    )
    db.add(operator)
    await db.commit()

    login = await client.post("/api/v1/auth/login", json={"email": op_email, "password": "Test1234!"})
    assert login.status_code == 200
    op_token = login.json()["access_token"]

    resp = await client.patch(
        "/api/v1/settings",
        json={"notification_email": "ops@test.com"},
        headers={"Authorization": f"Bearer {op_token}"},
    )
    assert resp.status_code == 403


async def test_non_cmg_tenant_id_param_ignored_on_get(client, db):
    """Un admin de cliente que pasa ?tenant_id= ajeno siempre recibe su propio tenant."""
    from app.models.tenant import Tenant
    from app.models.user import User
    from app.core.security import hash_password

    suffix = uuid.uuid4().hex[:8]
    client_tenant = Tenant(id=uuid.uuid4(), tier="client", name="TestClient GET", slug=f"testclient-get-{suffix}")
    db.add(client_tenant)
    await db.flush()

    user = User(
        tenant_id=client_tenant.id,
        email=f"client_admin_{suffix}@test.com",
        hashed_password=hash_password("Test1234!"),
        full_name="Client Admin",
        role="admin",
    )
    db.add(user)
    await db.commit()

    login = await client.post("/api/v1/auth/login", json={"email": user.email, "password": "Test1234!"})
    assert login.status_code == 200
    token = login.json()["access_token"]

    foreign_uuid = str(uuid.uuid4())
    resp = await client.get(
        f"/api/v1/settings?tenant_id={foreign_uuid}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["tenant_id"] == str(client_tenant.id)


async def test_non_cmg_tenant_id_param_ignored_on_patch(client, db):
    """Un admin de cliente que pasa ?tenant_id= ajeno modifica su propio tenant."""
    from app.models.tenant import Tenant
    from app.models.user import User
    from app.core.security import hash_password

    suffix = uuid.uuid4().hex[:8]
    client_tenant = Tenant(id=uuid.uuid4(), tier="client", name="TestClient PATCH", slug=f"testclient-patch-{suffix}")
    db.add(client_tenant)
    await db.flush()

    user = User(
        tenant_id=client_tenant.id,
        email=f"client_admin_{suffix}@test.com",
        hashed_password=hash_password("Test1234!"),
        full_name="Client Admin",
        role="admin",
    )
    db.add(user)
    await db.commit()

    login = await client.post("/api/v1/auth/login", json={"email": user.email, "password": "Test1234!"})
    assert login.status_code == 200
    token = login.json()["access_token"]

    foreign_uuid = str(uuid.uuid4())
    resp = await client.patch(
        f"/api/v1/settings?tenant_id={foreign_uuid}",
        json={"notification_email": "isolated@test.com"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["tenant_id"] == str(client_tenant.id)


async def test_cmg_admin_can_set_tenant_id_param(client, admin_token):
    resp = await client.get(
        "/api/v1/settings",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    own_tenant_id = resp.json()["tenant_id"]

    resp2 = await client.get(
        f"/api/v1/settings?tenant_id={own_tenant_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp2.status_code == 200
    assert resp2.json()["tenant_id"] == own_tenant_id
