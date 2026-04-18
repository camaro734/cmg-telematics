# tests/api/test_vehicles_api.py
import pytest


async def test_list_vehicle_types_requires_auth(client):
    resp = await client.get("/api/v1/vehicle-types")
    assert resp.status_code == 403


async def test_list_vehicle_types(client, admin_token):
    resp = await client.get(
        "/api/v1/vehicle-types",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 3  # vacuum, sweeper, cistern from seeds
    slugs = [v["slug"] for v in data]
    assert "vacuum" in slugs
    assert "sweeper" in slugs


async def test_list_vehicles(client, admin_token):
    resp = await client.get(
        "/api/v1/vehicles",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1  # TEST-001 from seed
    v = data[0]
    assert "id" in v
    assert "name" in v
    assert "tenant_id" in v
    assert "vehicle_type_id" in v


async def test_get_vehicle_by_id(client, admin_token):
    # Get first vehicle id from list
    list_resp = await client.get(
        "/api/v1/vehicles",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    vehicle_id = list_resp.json()[0]["id"]

    resp = await client.get(
        f"/api/v1/vehicles/{vehicle_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == vehicle_id


async def test_get_vehicle_wrong_tenant_returns_404(client, admin_token):
    import uuid
    resp = await client.get(
        f"/api/v1/vehicles/{uuid.uuid4()}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 404


async def test_client_tenant_cannot_see_other_tenant_vehicles(client):
    """Tenant-scoped user should only see their own vehicles, not others'."""
    import uuid as _uuid
    from app.core.security import create_access_token

    fake_tenant_id = _uuid.uuid4()
    token = create_access_token(data={
        "sub": str(_uuid.uuid4()),
        "tenant_id": str(fake_tenant_id),
        "tenant_tier": "client",
        "role": "admin",
        "email": "test@other.com",
    })
    # Should see zero vehicles (all seeded vehicles belong to CMG tenant)
    resp = await client.get(
        "/api/v1/vehicles",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json() == []
