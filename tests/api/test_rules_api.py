import pytest
import uuid

RULE_PAYLOAD = {
    "name": "Presión alta bomba",
    "condition": {
        "type": "threshold",
        "field": "hydraulic_pressure_1",
        "op": ">",
        "value": 220.0,
    },
    "severity": "warning",
    "vehicle_filter": {"scope": "all"},
    "actions": [{"type": "in_app"}],
    "cooldown_minutes": 30,
}


async def test_list_rules_empty(client, admin_token):
    resp = await client.get(
        "/api/v1/rules", headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


async def test_create_rule(client, admin_token):
    resp = await client.post(
        "/api/v1/rules",
        json=RULE_PAYLOAD,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == RULE_PAYLOAD["name"]
    assert data["severity"] == "warning"
    assert "id" in data
    return data["id"]


async def test_update_rule(client, admin_token):
    create_resp = await client.post(
        "/api/v1/rules",
        json=RULE_PAYLOAD,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    rule_id = create_resp.json()["id"]

    resp = await client.put(
        f"/api/v1/rules/{rule_id}",
        json={"name": "Presión alta — actualizado", "active": False},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Presión alta — actualizado"
    assert resp.json()["active"] is False


async def test_delete_rule(client, admin_token):
    create_resp = await client.post(
        "/api/v1/rules",
        json=RULE_PAYLOAD,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    rule_id = create_resp.json()["id"]

    resp = await client.delete(
        f"/api/v1/rules/{rule_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 204

    get_resp = await client.get(
        f"/api/v1/rules/{rule_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert get_resp.status_code == 404


async def test_test_rule_endpoint(client, admin_token):
    create_resp = await client.post(
        "/api/v1/rules",
        json=RULE_PAYLOAD,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    rule_id = create_resp.json()["id"]

    resp = await client.post(
        f"/api/v1/rules/{rule_id}/test",
        json={"field_values": {"hydraulic_pressure_1": 250.0}},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["would_fire"] is True

    resp2 = await client.post(
        f"/api/v1/rules/{rule_id}/test",
        json={"field_values": {"hydraulic_pressure_1": 100.0}},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp2.status_code == 200
    assert resp2.json()["would_fire"] is False
