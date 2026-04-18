# tests/api/test_alerts_api.py
import pytest
import uuid


async def test_list_alerts_requires_auth(client):
    resp = await client.get("/api/v1/alerts")
    assert resp.status_code == 403


async def test_list_alerts_empty(client, admin_token):
    resp = await client.get(
        "/api/v1/alerts",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


async def test_ack_nonexistent_alert_returns_404(client, admin_token):
    fake_id = str(uuid.uuid4())
    resp = await client.post(
        f"/api/v1/alerts/{fake_id}/acknowledge",
        json={"note": "test"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 404
