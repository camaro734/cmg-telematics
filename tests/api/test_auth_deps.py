# tests/api/test_auth_deps.py
import pytest


async def test_protected_endpoint_rejects_missing_token(client):
    response = await client.get("/api/v1/vehicles")
    assert response.status_code == 403


async def test_protected_endpoint_rejects_invalid_token(client):
    response = await client.get(
        "/api/v1/vehicles", headers={"Authorization": "Bearer invalid.token.here"}
    )
    assert response.status_code == 401


async def test_protected_endpoint_accepts_valid_token(client, admin_token):
    response = await client.get(
        "/api/v1/vehicles", headers={"Authorization": f"Bearer {admin_token}"}
    )
    # 200 or 404 are both OK — just not 401/403
    assert response.status_code not in (401, 403)
