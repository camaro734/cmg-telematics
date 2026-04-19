# tests/api/test_settings_api.py
import pytest
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


async def test_patch_settings_requires_admin(client, admin_token):
    import base64, json as _json
    payload = admin_token.split(".")[1]
    payload += "=" * (4 - len(payload) % 4)
    claims = _json.loads(base64.b64decode(payload))
    tenant_id = claims["tenant_id"]

    from app.core.config import settings as app_settings
    from app.core.security import hash_password
    import asyncpg
    dsn = app_settings.db_url.replace("+asyncpg", "")
    conn = await asyncpg.connect(dsn=dsn)
    op_id = str(uuid.uuid4())
    op_email = f"operator_{op_id[:8]}@test.com"
    pw_hash = hash_password("Test1234!")
    await conn.execute(
        """INSERT INTO "user" (id, tenant_id, email, hashed_password, full_name, role)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'operator')""",
        op_id, tenant_id, op_email, pw_hash, "Test Operator",
    )
    await conn.close()

    login = await client.post("/api/v1/auth/login", json={"email": op_email, "password": "Test1234!"})
    assert login.status_code == 200
    op_token = login.json()["access_token"]

    resp = await client.patch(
        "/api/v1/settings",
        json={"notification_email": "ops@test.com"},
        headers={"Authorization": f"Bearer {op_token}"},
    )
    assert resp.status_code == 403


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
