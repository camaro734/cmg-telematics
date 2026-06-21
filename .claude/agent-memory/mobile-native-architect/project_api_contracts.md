---
name: API Contracts — Mobile ↔ Backend
description: Verified endpoint shapes and status for mobile app consumption
type: project
---

Backend FastAPI at `http://213.210.20.183/api/v1` (external) / `http://localhost:8010/api/v1` (internal)

**Why:** Mobile must consume same API as web — no separate backend.
**How to apply:** These are the confirmed shapes. Match types in `mobile/types/index.ts`.

## Implemented and consumed by mobile

### POST /auth/login
Request: `{ email, password }`
Response: `{ access_token, token_type, user: { id, email, role, full_name, tenant_id } }`

### GET /dashboard/fleet
Response: `{ fleet: [{ vehicle_id, vehicle_name, license_plate, device: { imei, online, last_seen, last_lat, last_lng, last_speed }, last_position: { lat, lng, speed, ignition, timestamp }, active_alerts }] }`

### GET /vehicles/{id}/last
Response: `{ data: { lat, lng, speed, ignition, ext_voltage_mv, ain1_mv, dout1, dout2, ...dynamic }, vehicle_name, imei, license_plate }`
Note: `ignition` field is `boolean | null` (NOT number) — checked in types.

### GET /vehicles/{id}/live-signals
Response: `{ signals: [{ io_key, display_name, converted_value, unit, data_type }] }`

### GET /alerts
Response: `Alert[]` where Alert = `{ id, vehicle_id, vehicle_name, display_name, level, converted_value, threshold, unit, fired_at, resolved_at, acknowledged_at }`
Alert levels: 'critical' | 'high' | 'warning' | 'info'

## TODO — endpoints not yet confirmed / may need backend work
- POST /alerts/{id}/acknowledge — exists per spec, not yet called from mobile
- GET /api/v1/tasks (with assigned_to, date params) — may not exist
- POST /api/v1/tasks/{id}/start, /finish, /photos — may not exist
- POST /api/v1/devices/register (push token) — may not exist
- WS /ws/vehicles/{vehicle_id} (per-vehicle) — /ws/fleet exists, per-vehicle uncertain

## WebSocket
`ws://213.210.20.183/ws/fleet?token=JWT` — fleet-wide stream, confirmed working
Message format: `{ type: "telemetry", vehicle_id, data: {...}, ts }`
