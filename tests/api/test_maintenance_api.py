import pytest
from datetime import datetime, timezone

PLAN_PAYLOAD = lambda vid: {
    "vehicle_id": vid,
    "name": "Cambio aceite hidráulico",
    "trigger_condition": {
        "thresholds": [
            {"type": "pto_hours", "value": 500},
            {"type": "calendar_days", "value": 365},
        ],
        "op": "OR",
    },
    "warn_before_pct": 10,
    "active": True,
}


async def _first_vehicle_id(client, token: str) -> str:
    resp = await client.get("/api/v1/vehicles", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    vehicles = resp.json()
    assert len(vehicles) > 0, "Seed data must have at least one vehicle"
    return vehicles[0]["id"]


async def test_create_plan_admin(client, admin_token):
    vid = await _first_vehicle_id(client, admin_token)
    resp = await client.post(
        "/api/v1/maintenance/plans",
        json=PLAN_PAYLOAD(vid),
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Cambio aceite hidráulico"
    assert data["vehicle_id"] == vid
    assert data["progress"]["status"] in ("ok", "próximo", "vencido")
    assert isinstance(data["progress"]["thresholds"], list)


async def test_list_plans(client, admin_token):
    vid = await _first_vehicle_id(client, admin_token)
    await client.post(
        "/api/v1/maintenance/plans",
        json=PLAN_PAYLOAD(vid),
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    resp = await client.get(
        "/api/v1/maintenance/plans",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


async def test_plan_pto_hours_zero_without_telemetry(client, admin_token):
    vid = await _first_vehicle_id(client, admin_token)
    resp = await client.post(
        "/api/v1/maintenance/plans",
        json=PLAN_PAYLOAD(vid),
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    data = resp.json()
    pto = next(t for t in data["progress"]["thresholds"] if t["type"] == "pto_hours")
    assert pto["current"] == 0.0
    assert pto["pct"] == 0.0


async def test_update_plan(client, admin_token):
    vid = await _first_vehicle_id(client, admin_token)
    create_resp = await client.post(
        "/api/v1/maintenance/plans",
        json=PLAN_PAYLOAD(vid),
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    plan_id = create_resp.json()["id"]
    resp = await client.put(
        f"/api/v1/maintenance/plans/{plan_id}",
        json={"name": "Aceite — actualizado"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Aceite — actualizado"


async def test_delete_plan(client, admin_token):
    vid = await _first_vehicle_id(client, admin_token)
    create_resp = await client.post(
        "/api/v1/maintenance/plans",
        json=PLAN_PAYLOAD(vid),
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    plan_id = create_resp.json()["id"]
    resp = await client.delete(
        f"/api/v1/maintenance/plans/{plan_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 204
    get_resp = await client.get(
        f"/api/v1/maintenance/plans/{plan_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert get_resp.status_code == 404


async def test_log_intervention(client, admin_token):
    vid = await _first_vehicle_id(client, admin_token)
    create_resp = await client.post(
        "/api/v1/maintenance/plans",
        json=PLAN_PAYLOAD(vid),
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    plan_id = create_resp.json()["id"]
    log_payload = {
        "performed_at": datetime.now(timezone.utc).isoformat(),
        "description": "Cambio aceite SAE 46",
        "reset_counters": ["pto_hours"],
        "cost_eur": 85.50,
    }
    resp = await client.post(
        f"/api/v1/maintenance/plans/{plan_id}/logs",
        json=log_payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["description"] == "Cambio aceite SAE 46"
    assert data["cost_eur"] == 85.50
    assert "pto_hours" in data["reset_counters"]


async def test_get_plan_logs(client, admin_token):
    vid = await _first_vehicle_id(client, admin_token)
    create_resp = await client.post(
        "/api/v1/maintenance/plans",
        json=PLAN_PAYLOAD(vid),
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    plan_id = create_resp.json()["id"]
    await client.post(
        f"/api/v1/maintenance/plans/{plan_id}/logs",
        json={"performed_at": datetime.now(timezone.utc).isoformat(), "reset_counters": ["pto_hours"]},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    resp = await client.get(
        f"/api/v1/maintenance/plans/{plan_id}/logs",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


async def test_vehicle_maintenance_endpoint(client, admin_token):
    vid = await _first_vehicle_id(client, admin_token)
    await client.post(
        "/api/v1/maintenance/plans",
        json=PLAN_PAYLOAD(vid),
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    resp = await client.get(
        f"/api/v1/vehicles/{vid}/maintenance",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
    assert len(resp.json()) >= 1
