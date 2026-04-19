# Alerts Page + Settings — Design Spec

**Date:** 2026-04-19
**Sprint:** 7

---

## Goal

Build the `/alerts` page (active alert monitoring + searchable history diary with acknowledge flow) and the `/settings` page (tenant notification email configuration), with notify-svc wired to send real emails when alerts fire.

---

## Scope

### In scope
- `/alerts` page: active alerts panel + history diary with filters + acknowledge modal
- `/settings` page: notification email per tenant (admin-only)
- Backend: `notification_email` column on `tenant`, `GET/PATCH /api/v1/settings` endpoints
- notify-svc: real SMTP email sending on `alerts.fire` stream (per-rule email → tenant fallback)
- Sidebar: `/settings` route shown only to `role=admin`

### Out of scope
- Per-rule email configuration UI (deferred to rule builder sprint)
- SMS / webhook / push notification channels
- User profile settings
- Escalation configuration UI

---

## Architecture

### Frontend — new files

```
frontend/src/
├── features/
│   ├── alerts/
│   │   ├── AlertsPage.tsx          ← page shell + two panels
│   │   ├── ActiveAlertsList.tsx    ← firing/escalated cards + ack trigger
│   │   ├── AlertHistory.tsx        ← filtered table + pagination state
│   │   └── AckModal.tsx            ← modal with note field + confirm button
│   └── settings/
│       ├── SettingsPage.tsx        ← page shell with role guard
│       └── NotificationSettings.tsx ← email form + save mutation
```

### Frontend — modified files

```
frontend/src/
├── App.tsx                         ← add /alerts and /settings routes
├── shared/ui/Sidebar.tsx           ← activate /alerts NavLink; show /settings only if role=admin
├── lib/types.ts                    ← add AlertInstanceOut, SettingsOut types
└── lib/queryKeys.ts                ← add keys.alerts(), keys.settings()
```

### Backend — new/modified files

```
backend/app/
├── api/v1/
│   └── settings.py                 ← GET + PATCH /api/v1/settings
├── api/v1/router.py                ← register settings router
├── models/
│   └── tenant.py                   ← add notification_email column
├── schemas/
│   └── settings.py                 ← SettingsOut, SettingsPatch schemas
└── alembic/versions/
    └── xxxx_add_notification_email_to_tenant.py

services/notify/src/
└── main.py                         ← implement real SMTP sending, tenant email fallback
```

---

## Frontend Design

### AlertsPage (`/alerts`)

Two vertical panels inside the Shell. CMG admins (`tier=cmg`) see alerts across all tenants (the backend already returns all tenants for CMG tier). No tenant selector on this page — the alerts page is read-only cross-tenant for CMG.

**Active alerts panel** (top)
- Queries `GET /api/v1/alerts?status=firing` and `GET /api/v1/alerts?status=escalated`, merged client-side.
- `refetchInterval: 30_000`.
- On mount, `AlertsPage` prefetches `/api/v1/rules` and `/api/v1/vehicles` with `staleTime: Infinity` to build lookup maps by ID. All name resolution (rule name, vehicle name) is done client-side.
- Each alert renders as a horizontal card:
  - Left: severity icon dot (`--accent-crit` for critical, `--accent-warn` for warning)
  - Center: rule name + vehicle name (resolved from prefetched lookup maps)
  - Right: trigger value, time since triggered ("hace 14 min"), "Reconocer" button
- Empty state: "Sin alertas activas" text in `--accent-ok` color.
- "Reconocer" opens `AckModal`.

**AckModal**
- Modal overlay with: alert summary (rule name, vehicle, value), textarea for optional note, "Confirmar" button, "Cancelar" button.
- On confirm: `POST /api/v1/alerts/{id}/acknowledge` with `{ note }`.
- On success: optimistic remove from active list (React Query `invalidateQueries` on alerts).
- On error: show inline error message, keep modal open.

**History panel** (bottom, label "HISTORIAL")
- Queries `GET /api/v1/alerts` with filters applied as query params.
- Filters in header row:
  - Status selector: Todos / Reconocido / Resuelto (maps to `acknowledged` / `resolved`)
  - Vehicle selector: dropdown populated from cached vehicle list
  - Date from / Date to: `<input type="date">`
- Table columns: Fecha, Vehículo, Regla, Valor, Ubicación, Estado, Nota
- Ubicación: `${lat.toFixed(4)}, ${lon.toFixed(4)}` from `trigger_value.location` if present, otherwise `—`
- Status badge: colored pill using design tokens
- Default: shows last 50 alerts filtered to `status=acknowledged` and `status=resolved`, merged client-side from two parallel queries (same pattern as active alerts). When the user selects a specific status in the filter, only one query is made.

### SettingsPage (`/settings`)

Accessible only when `role=admin`. The sidebar `IconAjustes` NavLink renders only when `user?.role === 'admin'`.

**CMG admin view** (`tier=cmg`)
- Tenant selector dropdown at top of page. Populated from `GET /api/v1/tenants`.
- Selected tenant's settings load via `GET /api/v1/settings?tenant_id={id}`.
- Form saves via `PATCH /api/v1/settings?tenant_id={id}`.

**Client admin view** (`tier=client` or `subclient`, `role=admin`)
- No tenant selector — sees only their own tenant's settings.
- `GET /api/v1/settings` (no query param needed).

**NotificationSettings form**
- Single field: "Email de alertas" with `<input type="email">`.
- Helper text: "Cuando se dispare una alerta, se enviará un aviso a esta dirección. Cada regla puede además tener su propio email específico."
- "Guardar" button: calls `PATCH /api/v1/settings`. Shows success toast or inline error.

---

## Backend Design

### New column: `tenant.notification_email`

```sql
ALTER TABLE tenant ADD COLUMN notification_email TEXT;
```

Nullable. No default. Validated as email format at application layer.

### `GET /api/v1/settings`

- Auth: any authenticated user.
- Returns `SettingsOut` for the caller's tenant.
- CMG admin: accepts optional `?tenant_id=uuid` to read any tenant.
- Non-CMG users: `?tenant_id` param is ignored (always returns own tenant).

```python
class SettingsOut(BaseModel):
    tenant_id: uuid.UUID
    notification_email: str | None
```

### `PATCH /api/v1/settings`

- Auth: `role=admin` required. Returns 403 if not admin.
- CMG admin: accepts optional `?tenant_id=uuid` to update any tenant.
- Body: `SettingsPatch { notification_email: str | None }`.
- Validates email format if not None.
- Returns updated `SettingsOut`.

```python
class SettingsPatch(BaseModel):
    notification_email: str | None = None

    @field_validator('notification_email')
    @classmethod
    def validate_email(cls, v):
        if v is not None and '@' not in v:
            raise ValueError('Email inválido')
        return v
```

### notify-svc — SMTP integration

Environment variables (already in `.env.example` plan):
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=alertas@cmghidraulica.com
SMTP_PASSWORD=...
SMTP_FROM=alertas@cmghidraulica.com
```

**Email sending logic** (in `alerts.fire` stream consumer):

1. Parse alert from stream message.
2. Load alert rule from DB to get `actions` JSONB.
3. Collect recipient emails:
   a. If rule has `{"type": "email", "to": "..."}` in actions → use that email.
   b. Load tenant from DB, if `notification_email` is set → add as additional recipient.
   c. Deduplicate recipients.
4. If recipients list is empty → skip, log debug.
5. Send email via `aiosmtplib` with subject: `[ALERTA] {rule.name} — {vehicle_name}` and body including: severity, triggered_at, trigger_value, vehicle name.
6. On SMTP error: log error, do NOT re-raise (alert processing continues).

---

## Data Flow

```
WS / poll (30s)
    ↓
AlertsPage queries active alerts
    ↓
Operator clicks "Reconocer"
    ↓
AckModal (note input)
    ↓
POST /api/v1/alerts/{id}/acknowledge
    ↓
React Query invalidate → active list refreshes
```

```
rules-engine evaluates condition
    ↓
publishes to alerts.fire stream
    ↓
notify-svc consumes stream
    ↓
loads rule.actions + tenant.notification_email
    ↓
sends email via SMTP (aiosmtplib)
```

---

## New Frontend Types

```typescript
// lib/types.ts additions

interface AlertInstanceOut {
  id: string
  rule_id: string
  vehicle_id: string
  tenant_id: string
  triggered_at: string        // ISO datetime
  resolved_at: string | null
  status: 'firing' | 'acknowledged' | 'resolved' | 'escalated'
  trigger_value: Record<string, unknown> | null
  ack_by_user_id: string | null
  ack_at: string | null
  ack_note: string | null
}

interface SettingsOut {
  tenant_id: string
  notification_email: string | null
}
```

---

## Error Handling

- **Acknowledge fails (network/server):** Modal stays open, shows error below button. Does not close.
- **Settings save fails:** Inline error below form field. Does not reset field value.
- **SMTP send fails (notify-svc):** Logs error at ERROR level. Alert instance is already committed to DB — email failure does not roll back the alert.
- **No recipients:** notify-svc logs at DEBUG level, continues without sending.

---

## Testing

**Frontend (Vitest + @testing-library/react):**
- `AlertsPage`: renders active alerts, renders empty state, renders history table
- `AckModal`: shows/hides, submits with note, handles API error
- `AlertHistory`: filter changes update query params
- `NotificationSettings`: renders form, submits, shows success, handles error

**Backend (pytest):**
- `GET /api/v1/settings` returns own tenant for non-CMG users
- `GET /api/v1/settings?tenant_id=x` works for CMG admin, ignored for non-CMG
- `PATCH /api/v1/settings` updates email, rejects invalid email, rejects non-admin
- notify-svc email logic: correct recipient selection (rule email, tenant fallback, both, neither)
