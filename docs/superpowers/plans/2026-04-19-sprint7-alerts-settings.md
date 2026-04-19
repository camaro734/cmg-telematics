# Sprint 7 — Alerts Page + Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/alerts` page (active alerts + history diary + acknowledge flow) and `/settings` page (tenant notification email, admin-only), wiring notify-svc to send real emails when alerts fire.

**Architecture:** 4 backend tasks (migration, schemas, endpoint, notify-svc) followed by 4 frontend tasks (infrastructure, modals, lists, pages). Frontend joins vehicle/rule names client-side using prefetched lookup maps. notify-svc adds tenant email fallback after rule-level email actions.

**Tech Stack:** FastAPI + SQLAlchemy 2 (backend), Alembic (migration), asyncpg (notify-svc), React 18 + React Query v5 + Zustand (frontend), Vitest + @testing-library/react (frontend tests), pytest-asyncio (backend tests).

---

## File Map

```
backend/
├── alembic/versions/002_add_notification_email.py   NEW — migration
├── app/models/tenant.py                              MOD — add notification_email column
├── app/schemas/settings.py                           NEW — SettingsOut, SettingsPatch
├── app/api/v1/settings.py                            NEW — GET + PATCH /api/v1/settings
└── app/api/v1/router.py                              MOD — register settings router

services/notify/src/
├── main.py                                           MOD — vehicle name lookup, tenant fallback
└── dispatcher.py                                     MOD — use vehicle_name, email body

tests/api/
└── test_settings_api.py                              NEW — settings endpoint tests

frontend/src/
├── lib/
│   ├── types.ts                                      MOD — AlertInstanceOut, RuleOut, SettingsOut
│   ├── queryKeys.ts                                  MOD — tenants(), settings()
│   └── apiClient.ts                                  MOD — add patch method
├── features/
│   ├── alerts/
│   │   ├── AckModal.tsx                              NEW — acknowledge modal
│   │   ├── ActiveAlertsList.tsx                      NEW — firing/escalated cards
│   │   ├── AlertHistory.tsx                          NEW — filtered history table
│   │   ├── AlertsPage.tsx                            NEW — page shell
│   │   └── __tests__/
│   │       ├── AckModal.test.tsx                     NEW
│   │       ├── ActiveAlertsList.test.tsx             NEW
│   │       ├── AlertHistory.test.tsx                 NEW
│   │       └── AlertsPage.test.tsx                   NEW
│   └── settings/
│       ├── NotificationSettings.tsx                  NEW — email form
│       ├── SettingsPage.tsx                          NEW — page shell
│       └── __tests__/
│           └── SettingsPage.test.tsx                 NEW
├── shared/ui/Sidebar.tsx                             MOD — activate /alerts, conditional /settings
└── App.tsx                                           MOD — add /alerts and /settings routes
```

---

## Task 1: Backend — Migration + Settings schemas + endpoint + tests

**Files:**
- Create: `backend/alembic/versions/002_add_notification_email.py`
- Modify: `backend/app/models/tenant.py`
- Create: `backend/app/schemas/settings.py`
- Create: `backend/app/api/v1/settings.py`
- Modify: `backend/app/api/v1/router.py`
- Create: `tests/api/test_settings_api.py`

- [ ] **Step 1: Write the failing test**

Create `tests/api/test_settings_api.py`:

```python
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
    # Create an operator user and get their token
    from app.core.database import get_db
    from app.models.user import User
    from app.core.security import hash_password
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../backend"))

    # Get CMG tenant_id from the admin token
    import base64, json as _json
    payload = admin_token.split(".")[1]
    payload += "=" * (4 - len(payload) % 4)
    claims = _json.loads(base64.b64decode(payload))
    tenant_id = claims["tenant_id"]

    # Create operator user via DB
    from app.core.config import settings as app_settings
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

    # Login as operator
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
    # CMG admin queries own settings without param — should work
    resp = await client.get(
        "/api/v1/settings",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    own_tenant_id = resp.json()["tenant_id"]

    # Query with own tenant_id as param — same result
    resp2 = await client.get(
        f"/api/v1/settings?tenant_id={own_tenant_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp2.status_code == 200
    assert resp2.json()["tenant_id"] == own_tenant_id
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /opt/cmg-telematic1
python3 -m pytest tests/api/test_settings_api.py -v 2>&1 | head -30
```
Expected: all tests FAIL (404 or import errors — endpoint doesn't exist yet).

- [ ] **Step 3: Create the Alembic migration**

Create `backend/alembic/versions/002_add_notification_email.py`:

```python
"""add notification_email to tenant

Revision ID: 002
Revises: 001
Create Date: 2026-04-19
"""
from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenant", sa.Column("notification_email", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("tenant", "notification_email")
```

- [ ] **Step 4: Add the column to the SQLAlchemy model**

Modify `backend/app/models/tenant.py`, add after `brand_tokens`:

```python
    notification_email: Mapped[str | None] = mapped_column(sa.Text(), nullable=True)
```

The full import block already has `String` and `Boolean` — `sa.Text()` works if you add `import sqlalchemy as sa` or use the already-imported primitives. Since the file uses `from sqlalchemy import String, ...`, add `Text` to that import:

```python
from sqlalchemy import String, ForeignKey, DateTime, Boolean, CheckConstraint, Text
```

Then the column:
```python
    notification_email: Mapped[str | None] = mapped_column(Text(), nullable=True)
```

- [ ] **Step 5: Run the migration**

```bash
cd /opt/cmg-telematic1/backend
python3 -m alembic upgrade head
```
Expected: `Running upgrade 001 -> 002, add notification_email to tenant`

- [ ] **Step 6: Create settings schemas**

Create `backend/app/schemas/settings.py`:

```python
# backend/app/schemas/settings.py
from __future__ import annotations
import uuid
from pydantic import BaseModel, ConfigDict, field_validator


class SettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    tenant_id: uuid.UUID
    notification_email: str | None


class SettingsPatch(BaseModel):
    notification_email: str | None = None

    @field_validator("notification_email")
    @classmethod
    def validate_email(cls, v: str | None) -> str | None:
        if v is not None and "@" not in v:
            raise ValueError("Email inválido")
        return v
```

- [ ] **Step 7: Create the settings endpoint**

Create `backend/app/api/v1/settings.py`:

```python
# backend/app/api/v1/settings.py
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.api.v1.deps import get_current_user, require_role
from app.schemas.auth import CurrentUser
from app.schemas.settings import SettingsOut, SettingsPatch
from app.models.tenant import Tenant

router = APIRouter(tags=["settings"])


def _effective_tenant_id(user: CurrentUser, tenant_id: uuid.UUID | None) -> uuid.UUID:
    if tenant_id is not None and user.tenant_tier == "cmg":
        return tenant_id
    return user.tenant_id


@router.get("/settings", response_model=SettingsOut)
async def get_settings(
    tenant_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tid = _effective_tenant_id(user, tenant_id)
    tenant = await db.get(Tenant, tid)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    return tenant


@router.patch("/settings", response_model=SettingsOut)
async def patch_settings(
    body: SettingsPatch,
    tenant_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    tid = _effective_tenant_id(user, tenant_id)
    tenant = await db.get(Tenant, tid)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    tenant.notification_email = body.notification_email
    await db.commit()
    await db.refresh(tenant)
    return tenant
```

- [ ] **Step 8: Register the settings router**

Modify `backend/app/api/v1/router.py`:

```python
# backend/app/api/v1/router.py
from fastapi import APIRouter
from app.api.v1.auth import router as auth_router
from app.api.v1.vehicles import router as vehicles_router
from app.api.v1.alerts import router as alerts_router
from app.api.v1.rules import router as rules_router
from app.api.v1.tenants import router as tenants_router
from app.api.v1.settings import router as settings_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(vehicles_router)
api_router.include_router(alerts_router)
api_router.include_router(rules_router)
api_router.include_router(tenants_router)
api_router.include_router(settings_router)
```

- [ ] **Step 9: Run tests to confirm they pass**

```bash
cd /opt/cmg-telematic1
python3 -m pytest tests/api/test_settings_api.py -v
```
Expected: all 6 tests PASS.

- [ ] **Step 10: Run full backend test suite to check no regressions**

```bash
python3 -m pytest tests/api/ -v
```
Expected: all tests PASS.

- [ ] **Step 11: Commit**

```bash
git add backend/alembic/versions/002_add_notification_email.py \
        backend/app/models/tenant.py \
        backend/app/schemas/settings.py \
        backend/app/api/v1/settings.py \
        backend/app/api/v1/router.py \
        tests/api/test_settings_api.py
git commit -m "feat: settings endpoint — notification_email por tenant, admin-only PATCH"
```

---

## Task 2: notify-svc — vehicle name lookup + tenant email fallback

**Files:**
- Modify: `services/notify/src/main.py`
- Modify: `services/notify/src/dispatcher.py`

- [ ] **Step 1: Update `_process_alert` in main.py**

Replace the entire `_process_alert` function in `services/notify/src/main.py`:

```python
async def _process_alert(db_pool: asyncpg.Pool, redis: Redis, fields: dict) -> None:
    alert_id = fields.get("alert_id", "")
    rule_id = fields.get("rule_id", "")
    vehicle_id = fields.get("vehicle_id", "")
    tenant_id = fields.get("tenant_id", "")
    severity = fields.get("severity", "info")
    trigger_value = json.loads(fields.get("trigger_value", "{}"))
    actions = json.loads(fields.get("actions", "[]"))
    escalation = json.loads(fields.get("escalation", "[]"))

    async with db_pool.acquire() as conn:
        rule_row = await conn.fetchrow(
            "SELECT name FROM alert_rule WHERE id = $1::uuid", rule_id
        )
        vehicle_row = await conn.fetchrow(
            "SELECT name FROM vehicle WHERE id = $1::uuid", vehicle_id
        )
        tenant_row = await conn.fetchrow(
            "SELECT notification_email FROM tenant WHERE id = $1::uuid", tenant_id
        )

    rule_name = rule_row["name"] if rule_row else "unknown"
    vehicle_name = vehicle_row["name"] if vehicle_row else vehicle_id
    tenant_email = tenant_row["notification_email"] if tenant_row else None

    context = {
        "alert_id": alert_id,
        "rule_id": rule_id,
        "rule_name": rule_name,
        "vehicle_id": vehicle_id,
        "vehicle_name": vehicle_name,
        "tenant_id": tenant_id,
        "severity": severity,
        "trigger_value": trigger_value,
    }

    email_dispatched = any(a.get("type") == "email" for a in actions)

    for action in actions:
        await dispatch_action(action, context)

    # Tenant email fallback: only if no email action was in the rule
    if not email_dispatched and tenant_email:
        await dispatch_action(
            {"type": "email", "recipients": [tenant_email]},
            context,
        )

    for step in escalation:
        await schedule_escalation(
            redis, alert_id, rule_id, vehicle_id,
            step, step.get("delay_minutes", 10),
        )
```

- [ ] **Step 2: Update email body in dispatcher.py to use vehicle_name**

In `services/notify/src/dispatcher.py`, replace the `_send_email` body content:

```python
async def _send_email(action: dict, context: dict) -> None:
    recipients = action.get("recipients", [])
    if not recipients:
        return
    if not settings.smtp_host:
        logger.info(
            "[stub] Email to %s — rule: %s vehicle: %s",
            recipients, context.get("rule_name"), context.get("vehicle_name", context.get("vehicle_id")),
        )
        return

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = action.get(
        "subject", "[ALERTA] %s — %s" % (
            context.get("rule_name", "CMG Telematics"),
            context.get("vehicle_name", ""),
        )
    )
    msg.set_content(
        "Vehículo: %s\nSeveridad: %s\nValor disparado: %s\nRegla: %s" % (
            context.get("vehicle_name", context.get("vehicle_id")),
            context.get("severity"),
            context.get("trigger_value"),
            context.get("rule_name"),
        )
    )
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _smtp_send, msg)
```

- [ ] **Step 3: Verify the service builds**

```bash
cd /opt/cmg-telematic1/services/notify
python3 -c "from src.main import _process_alert; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add services/notify/src/main.py services/notify/src/dispatcher.py
git commit -m "feat: notify-svc — vehicle name en email, fallback a notification_email del tenant"
```

---

## Task 3: Frontend infrastructure — types, queryKeys, apiClient

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/queryKeys.ts`
- Modify: `frontend/src/lib/apiClient.ts`

- [ ] **Step 1: Add new types to types.ts**

At the end of `frontend/src/lib/types.ts`, add:

```typescript
export interface AlertInstanceOut {
  id: string
  rule_id: string
  vehicle_id: string
  tenant_id: string
  triggered_at: string
  resolved_at: string | null
  status: 'firing' | 'acknowledged' | 'resolved' | 'escalated'
  trigger_value: Record<string, unknown> | null
  ack_by_user_id: string | null
  ack_at: string | null
  ack_note: string | null
}

export interface RuleOut {
  id: string
  name: string
  severity: 'info' | 'warning' | 'critical'
  active: boolean
}

export interface SettingsOut {
  tenant_id: string
  notification_email: string | null
}
```

- [ ] **Step 2: Add tenants() and settings() to queryKeys.ts**

Replace the entire content of `frontend/src/lib/queryKeys.ts`:

```typescript
export const keys = {
  vehicles: () => ['vehicles'] as const,
  vehicle: (id: string) => ['vehicles', id] as const,
  vehicleStatus: (id: string) => ['vehicles', id, 'status'] as const,
  vehicleTrack: (id: string) => ['vehicles', id, 'track'] as const,
  vehicleKpis: (id: string) => ['vehicles', id, 'kpis'] as const,
  vehicleTypes: () => ['vehicle-types'] as const,
  alerts: () => ['alerts'] as const,
  rules: () => ['rules'] as const,
  tenants: () => ['tenants'] as const,
  tenantBrandTokens: (tenantId: string) => ['tenants', tenantId, 'brand-tokens'] as const,
  settings: (tenantId?: string) => tenantId ? ['settings', tenantId] as const : ['settings'] as const,
}
```

- [ ] **Step 3: Add patch method to apiClient.ts**

In `frontend/src/lib/apiClient.ts`, add `patch` to the exported object:

```typescript
export const apiClient = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
```

- [ ] **Step 4: TypeScript check**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/queryKeys.ts frontend/src/lib/apiClient.ts
git commit -m "feat: frontend types AlertInstanceOut/RuleOut/SettingsOut, queryKeys, apiClient.patch"
```

---

## Task 4: AckModal component + tests

**Files:**
- Create: `frontend/src/features/alerts/AckModal.tsx`
- Create: `frontend/src/features/alerts/__tests__/AckModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/alerts/__tests__/AckModal.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AckModal from '../AckModal'
import type { AlertInstanceOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: {
    post: vi.fn(),
  },
}))

import { apiClient } from '../../../lib/apiClient'

const mockAlert: AlertInstanceOut = {
  id: 'alert-1',
  rule_id: 'rule-1',
  vehicle_id: 'v-1',
  tenant_id: 't-1',
  triggered_at: '2026-04-19T10:00:00Z',
  resolved_at: null,
  status: 'firing',
  trigger_value: { value: 450 },
  ack_by_user_id: null,
  ack_at: null,
  ack_note: null,
}

function renderModal(onClose = vi.fn(), onSuccess = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AckModal
        alert={mockAlert}
        ruleName="Presión alta"
        vehicleName="Camión 01"
        onClose={onClose}
        onSuccess={onSuccess}
      />
    </QueryClientProvider>
  )
}

describe('AckModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('muestra nombre de regla y vehículo', () => {
    renderModal()
    expect(screen.getByText('Presión alta')).toBeInTheDocument()
    expect(screen.getByText('Camión 01')).toBeInTheDocument()
  })

  it('llama onClose al cancelar', () => {
    const onClose = vi.fn()
    renderModal(onClose)
    fireEvent.click(screen.getByText('Cancelar'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('llama apiClient.post al confirmar', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ ...mockAlert, status: 'acknowledged' })
    const onSuccess = vi.fn()
    renderModal(vi.fn(), onSuccess)
    fireEvent.click(screen.getByText('Confirmar'))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/alerts/alert-1/acknowledge',
      { note: null },
    )
  })

  it('envía nota si se escribe', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ ...mockAlert, status: 'acknowledged' })
    renderModal()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Revisado en campo' } })
    fireEvent.click(screen.getByText('Confirmar'))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/alerts/alert-1/acknowledge',
      { note: 'Revisado en campo' },
    ))
  })

  it('muestra error si la petición falla', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('500: Error interno'))
    renderModal()
    fireEvent.click(screen.getByText('Confirmar'))
    await waitFor(() => expect(screen.getByText('500: Error interno')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run src/features/alerts/__tests__/AckModal.test.tsx
```
Expected: FAIL (AckModal not found).

- [ ] **Step 3: Create AckModal.tsx**

Create `frontend/src/features/alerts/AckModal.tsx`:

```typescript
import type { CSSProperties } from 'react'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { AlertInstanceOut } from '../../lib/types'

const OVERLAY: CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 200,
}

const MODAL: CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--bg-border)',
  borderRadius: 10,
  padding: 28,
  width: 420,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
}

const BTN_BASE: CSSProperties = {
  padding: '6px 16px', fontSize: 13,
  fontFamily: 'var(--font-ui)',
  borderRadius: 6, cursor: 'pointer',
}

interface AckModalProps {
  alert: AlertInstanceOut
  ruleName: string
  vehicleName: string
  onClose: () => void
  onSuccess: () => void
}

export default function AckModal({ alert, ruleName, vehicleName, onClose, onSuccess }: AckModalProps) {
  const [note, setNote] = useState('')
  const queryClient = useQueryClient()

  const { mutate, isPending, error } = useMutation({
    mutationFn: () =>
      apiClient.post<AlertInstanceOut>(
        `/api/v1/alerts/${alert.id}/acknowledge`,
        { note: note.trim() || null },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.alerts() })
      onSuccess()
    },
  })

  return (
    <div style={OVERLAY} onClick={onClose} role="dialog" aria-modal="true" aria-label="Reconocer alerta">
      <div style={MODAL} onClick={e => e.stopPropagation()}>
        <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
          Reconocer alerta
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          <span style={{ color: 'var(--accent-energy)' }}>{ruleName}</span>{' — '}{vehicleName}
        </div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Nota (opcional)"
          rows={3}
          style={{
            background: 'var(--bg-base)',
            border: '1px solid var(--bg-border)',
            borderRadius: 6,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-ui)',
            fontSize: 13,
            padding: '8px 10px',
            resize: 'vertical',
            width: '100%',
            boxSizing: 'border-box',
          }}
        />
        {error && (
          <div style={{ fontSize: 12, color: 'var(--accent-crit)' }}>
            {(error as Error).message}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={isPending}
            style={{ ...BTN_BASE, background: 'transparent', border: '1px solid var(--bg-border)', color: 'var(--text-muted)' }}
          >
            Cancelar
          </button>
          <button
            onClick={() => mutate()}
            disabled={isPending}
            style={{ ...BTN_BASE, background: 'var(--accent-energy)', border: 'none', color: 'var(--bg-base)', cursor: isPending ? 'wait' : 'pointer' }}
          >
            {isPending ? 'Enviando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/features/alerts/__tests__/AckModal.test.tsx
```
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/alerts/AckModal.tsx frontend/src/features/alerts/__tests__/AckModal.test.tsx
git commit -m "feat: AckModal — modal de reconocimiento con nota opcional"
```

---

## Task 5: ActiveAlertsList component + tests

**Files:**
- Create: `frontend/src/features/alerts/ActiveAlertsList.tsx`
- Create: `frontend/src/features/alerts/__tests__/ActiveAlertsList.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/alerts/__tests__/ActiveAlertsList.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ActiveAlertsList from '../ActiveAlertsList'
import type { AlertInstanceOut, VehicleOut, RuleOut } from '../../../lib/types'

vi.mock('../AckModal', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="ack-modal"><button onClick={onClose}>cerrar</button></div>
  ),
}))

const alert1: AlertInstanceOut = {
  id: 'a1', rule_id: 'r1', vehicle_id: 'v1', tenant_id: 't1',
  triggered_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  resolved_at: null, status: 'firing',
  trigger_value: { value: 450 },
  ack_by_user_id: null, ack_at: null, ack_note: null,
}

const vehicles: VehicleOut[] = [{
  id: 'v1', tenant_id: 't1', vehicle_type_id: 'vt1',
  name: 'Camión 01', license_plate: null, vin: null,
  year: 2020, active: true, created_at: '2026-01-01T00:00:00Z',
}]

const rules: RuleOut[] = [{ id: 'r1', name: 'Presión alta', severity: 'warning', active: true }]

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>)
}

describe('ActiveAlertsList', () => {
  it('muestra estado vacío si no hay alertas', () => {
    wrap(<ActiveAlertsList alerts={[]} vehicles={[]} rules={[]} />)
    expect(screen.getByText('Sin alertas activas')).toBeInTheDocument()
  })

  it('muestra nombre de regla y vehículo', () => {
    wrap(<ActiveAlertsList alerts={[alert1]} vehicles={vehicles} rules={rules} />)
    expect(screen.getByText('Presión alta')).toBeInTheDocument()
    expect(screen.getByText(/Camión 01/)).toBeInTheDocument()
  })

  it('muestra tiempo transcurrido', () => {
    wrap(<ActiveAlertsList alerts={[alert1]} vehicles={vehicles} rules={rules} />)
    expect(screen.getByText(/hace 5 min/)).toBeInTheDocument()
  })

  it('abre AckModal al hacer clic en Reconocer', () => {
    wrap(<ActiveAlertsList alerts={[alert1]} vehicles={vehicles} rules={rules} />)
    fireEvent.click(screen.getByText('Reconocer'))
    expect(screen.getByTestId('ack-modal')).toBeInTheDocument()
  })

  it('cierra AckModal al llamar onClose', () => {
    wrap(<ActiveAlertsList alerts={[alert1]} vehicles={vehicles} rules={rules} />)
    fireEvent.click(screen.getByText('Reconocer'))
    fireEvent.click(screen.getByText('cerrar'))
    expect(screen.queryByTestId('ack-modal')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run src/features/alerts/__tests__/ActiveAlertsList.test.tsx
```
Expected: FAIL (component not found).

- [ ] **Step 3: Create ActiveAlertsList.tsx**

Create `frontend/src/features/alerts/ActiveAlertsList.tsx`:

```typescript
import type { CSSProperties } from 'react'
import { useState } from 'react'
import type { AlertInstanceOut, VehicleOut, RuleOut } from '../../lib/types'
import AckModal from './AckModal'

function timeAgo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'ahora mismo'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h}h`
  return `hace ${Math.floor(h / 24)}d`
}

const CARD: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12,
  background: 'var(--bg-surface)',
  border: '1px solid var(--bg-border)',
  borderRadius: 8, padding: '12px 16px',
}

interface ActiveAlertsListProps {
  alerts: AlertInstanceOut[]
  vehicles: VehicleOut[]
  rules: RuleOut[]
}

export default function ActiveAlertsList({ alerts, vehicles, rules }: ActiveAlertsListProps) {
  const [ackAlert, setAckAlert] = useState<AlertInstanceOut | null>(null)

  const vehicleMap = Object.fromEntries(vehicles.map(v => [v.id, v.name]))
  const ruleMap = Object.fromEntries(rules.map(r => [r.id, r]))

  if (alerts.length === 0) {
    return (
      <div style={{ padding: '20px 0', color: 'var(--accent-ok)', fontFamily: 'var(--font-ui)', fontSize: 13 }}>
        Sin alertas activas
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {alerts.map(alert => {
        const rule = ruleMap[alert.rule_id]
        const color = alert.status === 'escalated' || rule?.severity === 'critical'
          ? 'var(--accent-crit)'
          : 'var(--accent-warn)'

        return (
          <div key={alert.id} style={{ ...CARD, borderLeft: `3px solid ${color}` }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                {rule?.name ?? 'Regla desconocida'}
              </div>
              <div style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-muted)' }}>
                {vehicleMap[alert.vehicle_id] ?? 'Vehículo desconocido'}{' · '}{timeAgo(alert.triggered_at)}
              </div>
            </div>
            {alert.trigger_value != null && (
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 13, color, flexShrink: 0 }}>
                {String(alert.trigger_value['value'] ?? JSON.stringify(alert.trigger_value))}
              </div>
            )}
            <button
              onClick={() => setAckAlert(alert)}
              style={{
                padding: '4px 12px', fontSize: 12, fontFamily: 'var(--font-ui)',
                background: 'transparent', border: `1px solid ${color}`,
                borderRadius: 6, color, cursor: 'pointer', flexShrink: 0,
              }}
            >
              Reconocer
            </button>
          </div>
        )
      })}
      {ackAlert && (
        <AckModal
          alert={ackAlert}
          ruleName={ruleMap[ackAlert.rule_id]?.name ?? 'Regla desconocida'}
          vehicleName={vehicleMap[ackAlert.vehicle_id] ?? 'Vehículo desconocido'}
          onClose={() => setAckAlert(null)}
          onSuccess={() => setAckAlert(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/features/alerts/__tests__/ActiveAlertsList.test.tsx
```
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/alerts/ActiveAlertsList.tsx frontend/src/features/alerts/__tests__/ActiveAlertsList.test.tsx
git commit -m "feat: ActiveAlertsList — tarjetas de alertas activas con botón Reconocer"
```

---

## Task 6: AlertHistory component + tests

**Files:**
- Create: `frontend/src/features/alerts/AlertHistory.tsx`
- Create: `frontend/src/features/alerts/__tests__/AlertHistory.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/alerts/__tests__/AlertHistory.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AlertHistory from '../AlertHistory'
import type { AlertInstanceOut, VehicleOut, RuleOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: { get: vi.fn().mockResolvedValue([]) },
}))

const vehicles: VehicleOut[] = [{
  id: 'v1', tenant_id: 't1', vehicle_type_id: 'vt1',
  name: 'Camión 01', license_plate: null, vin: null,
  year: 2020, active: true, created_at: '2026-01-01T00:00:00Z',
}]

const rules: RuleOut[] = [{ id: 'r1', name: 'Presión alta', severity: 'warning', active: true }]

const ackedAlert: AlertInstanceOut = {
  id: 'a2', rule_id: 'r1', vehicle_id: 'v1', tenant_id: 't1',
  triggered_at: '2026-04-19T08:00:00Z',
  resolved_at: null, status: 'acknowledged',
  trigger_value: { value: 380, lat: 39.4698, lon: -0.3774 },
  ack_by_user_id: 'u1', ack_at: '2026-04-19T08:05:00Z',
  ack_note: 'Revisado',
}

function wrap(node: React.ReactNode, prefill?: AlertInstanceOut[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  if (prefill) {
    qc.setQueryData(['alerts', 'acknowledged', ''], prefill)
    qc.setQueryData(['alerts', 'resolved', ''], [])
  }
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>)
}

describe('AlertHistory', () => {
  it('muestra mensaje vacío cuando no hay registros', () => {
    wrap(<AlertHistory vehicles={vehicles} rules={rules} />, [])
    expect(screen.getByText(/Sin registros/)).toBeInTheDocument()
  })

  it('muestra fila de alerta reconocida', () => {
    wrap(<AlertHistory vehicles={vehicles} rules={rules} />, [ackedAlert])
    expect(screen.getByText('Presión alta')).toBeInTheDocument()
    expect(screen.getByText('Camión 01')).toBeInTheDocument()
    expect(screen.getByText('RECONOCIDA')).toBeInTheDocument()
    expect(screen.getByText('Revisado')).toBeInTheDocument()
  })

  it('muestra ubicación cuando trigger_value tiene lat/lon', () => {
    wrap(<AlertHistory vehicles={vehicles} rules={rules} />, [ackedAlert])
    expect(screen.getByText('39.4698, -0.3774')).toBeInTheDocument()
  })

  it('muestra — en ubicación cuando no hay lat/lon', () => {
    const noLoc = { ...ackedAlert, trigger_value: { value: 380 } }
    wrap(<AlertHistory vehicles={rules} rules={rules} />, [noLoc])
    // at least one — should be present
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run src/features/alerts/__tests__/AlertHistory.test.tsx
```
Expected: FAIL (component not found).

- [ ] **Step 3: Create AlertHistory.tsx**

Create `frontend/src/features/alerts/AlertHistory.tsx`:

```typescript
import type { CSSProperties } from 'react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { AlertInstanceOut, VehicleOut, RuleOut } from '../../lib/types'

type HistoryStatus = 'all' | 'acknowledged' | 'resolved'

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  firing:       { label: 'ACTIVA',     color: 'var(--accent-crit)' },
  escalated:    { label: 'ESCALADA',   color: 'var(--accent-crit)' },
  acknowledged: { label: 'RECONOCIDA', color: 'var(--accent-warn)' },
  resolved:     { label: 'RESUELTA',   color: 'var(--accent-ok)'   },
}

const SELECT: CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--bg-border)',
  borderRadius: 6, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
  fontSize: 12, padding: '4px 8px',
}

const TH: CSSProperties = { padding: '6px 8px', textAlign: 'left', fontWeight: 600 }
const TD: CSSProperties = { padding: '6px 8px' }

interface AlertHistoryProps {
  vehicles: VehicleOut[]
  rules: RuleOut[]
}

export default function AlertHistory({ vehicles, rules }: AlertHistoryProps) {
  const [status, setStatus] = useState<HistoryStatus>('all')
  const [vehicleId, setVehicleId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const vehicleMap = Object.fromEntries(vehicles.map(v => [v.id, v.name]))
  const ruleMap = Object.fromEntries(rules.map(r => [r.id, r.name]))

  const buildUrl = (s: string) => {
    const p = new URLSearchParams({ status: s, limit: '50' })
    if (vehicleId) p.set('vehicle_id', vehicleId)
    return `/api/v1/alerts?${p}`
  }

  const { data: acked = [] } = useQuery({
    queryKey: [...keys.alerts(), 'acknowledged', vehicleId],
    queryFn: () => apiClient.get<AlertInstanceOut[]>(buildUrl('acknowledged')),
    enabled: status === 'all' || status === 'acknowledged',
  })

  const { data: resolved = [] } = useQuery({
    queryKey: [...keys.alerts(), 'resolved', vehicleId],
    queryFn: () => apiClient.get<AlertInstanceOut[]>(buildUrl('resolved')),
    enabled: status === 'all' || status === 'resolved',
  })

  let rows = status === 'all' ? [...acked, ...resolved]
    : status === 'acknowledged' ? acked
    : resolved

  if (dateFrom) rows = rows.filter(a => a.triggered_at >= dateFrom)
  if (dateTo)   rows = rows.filter(a => a.triggered_at <= dateTo + 'T23:59:59Z')
  rows = [...rows].sort((a, b) => b.triggered_at.localeCompare(a.triggered_at))

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={status} onChange={e => setStatus(e.target.value as HistoryStatus)} style={SELECT}>
          <option value="all">Todos los estados</option>
          <option value="acknowledged">Reconocidas</option>
          <option value="resolved">Resueltas</option>
        </select>
        <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} style={SELECT}>
          <option value="">Todos los vehículos</option>
          {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={SELECT} title="Desde" />
        <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   style={SELECT} title="Hasta" />
      </div>

      {rows.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>
          Sin registros para el período seleccionado
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-ui)', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--bg-border)' }}>
                {['Fecha', 'Vehículo', 'Regla', 'Valor', 'Ubicación', 'Estado', 'Nota'].map(h => (
                  <th key={h} style={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(a => {
                const badge = STATUS_BADGE[a.status] ?? { label: a.status, color: 'var(--text-muted)' }
                const tv = a.trigger_value
                const lat = tv?.['lat'] as number | undefined
                const lon = tv?.['lon'] as number | undefined
                const loc = lat != null && lon != null ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : '—'
                const val = tv?.['value'] != null ? String(tv['value']) : '—'
                return (
                  <tr key={a.id} style={{ borderBottom: '1px solid var(--bg-elevated)' }}>
                    <td style={{ ...TD, fontFamily: 'var(--font-data)', whiteSpace: 'nowrap' }}>
                      {new Date(a.triggered_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td style={TD}>{vehicleMap[a.vehicle_id] ?? '—'}</td>
                    <td style={TD}>{ruleMap[a.rule_id] ?? '—'}</td>
                    <td style={{ ...TD, fontFamily: 'var(--font-data)' }}>{val}</td>
                    <td style={{ ...TD, fontFamily: 'var(--font-data)' }}>{loc}</td>
                    <td style={TD}>
                      <span style={{ color: badge.color, fontWeight: 600 }}>{badge.label}</span>
                    </td>
                    <td style={{ ...TD, color: 'var(--text-muted)' }}>{a.ack_note ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/features/alerts/__tests__/AlertHistory.test.tsx
```
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/alerts/AlertHistory.tsx frontend/src/features/alerts/__tests__/AlertHistory.test.tsx
git commit -m "feat: AlertHistory — tabla de historial con filtros estado/vehículo/fecha"
```

---

## Task 7: AlertsPage + activate /alerts route + Sidebar

**Files:**
- Create: `frontend/src/features/alerts/AlertsPage.tsx`
- Create: `frontend/src/features/alerts/__tests__/AlertsPage.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/shared/ui/Sidebar.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/alerts/__tests__/AlertsPage.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AlertsPage from '../AlertsPage'

vi.mock('../ActiveAlertsList', () => ({
  default: () => <div data-testid="active-list" />,
}))
vi.mock('../AlertHistory', () => ({
  default: () => <div data-testid="alert-history" />,
}))
vi.mock('../../../lib/apiClient', () => ({
  apiClient: { get: vi.fn().mockResolvedValue([]) },
}))

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AlertsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('AlertsPage', () => {
  it('muestra sección ALERTAS ACTIVAS', () => {
    renderPage()
    expect(screen.getByText('ALERTAS ACTIVAS')).toBeInTheDocument()
  })

  it('muestra sección HISTORIAL', () => {
    renderPage()
    expect(screen.getByText('HISTORIAL')).toBeInTheDocument()
  })

  it('renderiza ActiveAlertsList y AlertHistory', () => {
    renderPage()
    expect(screen.getByTestId('active-list')).toBeInTheDocument()
    expect(screen.getByTestId('alert-history')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run src/features/alerts/__tests__/AlertsPage.test.tsx
```
Expected: FAIL (AlertsPage not found).

- [ ] **Step 3: Create AlertsPage.tsx**

Create `frontend/src/features/alerts/AlertsPage.tsx`:

```typescript
import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import ActiveAlertsList from './ActiveAlertsList'
import AlertHistory from './AlertHistory'
import type { AlertInstanceOut, VehicleOut, RuleOut } from '../../lib/types'

const SECTION_LABEL: CSSProperties = {
  fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-ui)',
  color: 'var(--text-muted)', letterSpacing: '0.06em',
  marginBottom: 12,
}

export default function AlertsPage() {
  const { data: vehicles = [] } = useQuery({
    queryKey: keys.vehicles(),
    queryFn: () => apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    staleTime: Infinity,
  })

  const { data: rules = [] } = useQuery({
    queryKey: keys.rules(),
    queryFn: () => apiClient.get<RuleOut[]>('/api/v1/rules'),
    staleTime: Infinity,
  })

  const { data: firing = [] } = useQuery({
    queryKey: [...keys.alerts(), 'firing'],
    queryFn: () => apiClient.get<AlertInstanceOut[]>('/api/v1/alerts?status=firing'),
    refetchInterval: 30_000,
  })

  const { data: escalated = [] } = useQuery({
    queryKey: [...keys.alerts(), 'escalated'],
    queryFn: () => apiClient.get<AlertInstanceOut[]>('/api/v1/alerts?status=escalated'),
    refetchInterval: 30_000,
  })

  const activeAlerts = [...firing, ...escalated].sort(
    (a, b) => b.triggered_at.localeCompare(a.triggered_at),
  )

  return (
    <Shell title="Alertas">
      <div style={{ padding: 24, maxWidth: 1200, overflowY: 'auto', height: '100%' }}>
        <div style={SECTION_LABEL}>ALERTAS ACTIVAS</div>
        <ActiveAlertsList alerts={activeAlerts} vehicles={vehicles} rules={rules} />

        <div style={{ ...SECTION_LABEL, marginTop: 32 }}>HISTORIAL</div>
        <AlertHistory vehicles={vehicles} rules={rules} />
      </div>
    </Shell>
  )
}
```

- [ ] **Step 4: Add /alerts route to App.tsx**

Modify `frontend/src/App.tsx`:

```typescript
import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './features/auth/LoginPage'
import RequireAuth from './features/auth/RequireAuth'

const FleetPage        = lazy(() => import('./features/fleet/FleetPage'))
const VehicleDetailPage = lazy(() => import('./features/vehicle/VehicleDetailPage'))
const AlertsPage       = lazy(() => import('./features/alerts/AlertsPage'))

function Loading() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-base)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-muted)',
    }}>
      Cargando…
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="fleet"          element={<FleetPage />} />
                <Route path="vehicles/:id"   element={<VehicleDetailPage />} />
                <Route path="alerts"         element={<AlertsPage />} />
                <Route path="*"             element={<Navigate to="/fleet" replace />} />
              </Routes>
            </Suspense>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
```

- [ ] **Step 5: Activate /alerts in Sidebar**

Modify `frontend/src/shared/ui/Sidebar.tsx` — change `active: false` to `active: true` for `/alerts`:

```typescript
const NAV_ITEMS = [
  { to: '/fleet',  Icon: IconFlota,   label: 'Flota',   active: true },
  { to: '/alerts', Icon: IconAlertas, label: 'Alertas', active: true },
  { to: '/rules',  Icon: IconReglas,  label: 'Reglas',  active: false },
]
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
npx vitest run src/features/alerts/__tests__/AlertsPage.test.tsx
```
Expected: 3 tests PASS.

- [ ] **Step 7: Run full frontend test suite**

```bash
npx vitest run
```
Expected: all tests PASS (previous 56 + 4 new AckModal + 5 ActiveAlertsList + 4 AlertHistory + 3 AlertsPage = 72).

- [ ] **Step 8: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/features/alerts/AlertsPage.tsx \
        frontend/src/features/alerts/__tests__/AlertsPage.test.tsx \
        frontend/src/App.tsx \
        frontend/src/shared/ui/Sidebar.tsx
git commit -m "feat: AlertsPage — panel activas + historial, ruta /alerts activada en sidebar"
```

---

## Task 8: NotificationSettings + SettingsPage + /settings route + Sidebar

**Files:**
- Create: `frontend/src/features/settings/NotificationSettings.tsx`
- Create: `frontend/src/features/settings/SettingsPage.tsx`
- Create: `frontend/src/features/settings/__tests__/SettingsPage.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/shared/ui/Sidebar.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/settings/__tests__/SettingsPage.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SettingsPage from '../SettingsPage'
import type { SettingsOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}))

vi.mock('../../../features/auth/useAuthStore', () => ({
  useAuthStore: vi.fn(),
}))

import { apiClient } from '../../../lib/apiClient'
import { useAuthStore } from '../../../features/auth/useAuthStore'

const clientAdminUser = {
  user_id: 'u1', tenant_id: 't1', tenant_tier: 'client' as const,
  role: 'admin' as const, email: 'admin@wasterent.com',
}

const cmgAdminUser = {
  user_id: 'u2', tenant_id: 'cmg-t', tenant_tier: 'cmg' as const,
  role: 'admin' as const, email: 'admin@cmg.es',
}

const mockSettings: SettingsOut = { tenant_id: 't1', notification_email: 'ops@wasterent.com' }

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('SettingsPage', () => {
  it('muestra formulario para admin de cliente', () => {
    vi.mocked(useAuthStore).mockReturnValue(clientAdminUser)
    vi.mocked(apiClient.get).mockResolvedValue(mockSettings)
    renderPage()
    expect(screen.getByText('Notificaciones por email')).toBeInTheDocument()
  })

  it('muestra selector de tenant para admin CMG', () => {
    vi.mocked(useAuthStore).mockReturnValue(cmgAdminUser)
    vi.mocked(apiClient.get).mockResolvedValue([])
    renderPage()
    expect(screen.getByText('TENANT')).toBeInTheDocument()
  })

  it('llama apiClient.patch al guardar', async () => {
    vi.mocked(useAuthStore).mockReturnValue(clientAdminUser)
    vi.mocked(apiClient.get).mockResolvedValue(mockSettings)
    vi.mocked(apiClient.patch).mockResolvedValue({ ...mockSettings, notification_email: 'new@test.com' })

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    qc.setQueryData(['settings', undefined], mockSettings)

    const { getByRole } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>
    )

    const input = getByRole('textbox')
    fireEvent.change(input, { target: { value: 'new@test.com' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run src/features/settings/__tests__/SettingsPage.test.tsx
```
Expected: FAIL (component not found).

- [ ] **Step 3: Create NotificationSettings.tsx**

Create `frontend/src/features/settings/NotificationSettings.tsx`:

```typescript
import type { CSSProperties } from 'react'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import type { SettingsOut, TenantOut } from '../../lib/types'

const INPUT: CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--bg-border)',
  borderRadius: 6, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
  fontSize: 13, padding: '8px 10px', width: '100%', boxSizing: 'border-box',
}

const LABEL: CSSProperties = {
  fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-muted)',
  display: 'block', marginBottom: 4, letterSpacing: '0.05em',
}

export default function NotificationSettings() {
  const user = useAuthStore(s => s)
  const isCmg = user?.tenant_tier === 'cmg'

  const [selectedTenantId, setSelectedTenantId] = useState('')
  const [email, setEmail] = useState('')
  const [saved, setSaved] = useState(false)

  const queryClient = useQueryClient()

  const { data: tenants = [] } = useQuery({
    queryKey: keys.tenants(),
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants'),
    enabled: isCmg,
    staleTime: Infinity,
  })

  const tenantParam = isCmg && selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''
  const settingsKey = keys.settings(isCmg ? (selectedTenantId || undefined) : undefined)

  const { data: settings } = useQuery({
    queryKey: settingsKey,
    queryFn: () => apiClient.get<SettingsOut>(`/api/v1/settings${tenantParam}`),
    enabled: !isCmg || !!selectedTenantId,
  })

  useEffect(() => {
    if (settings !== undefined) setEmail(settings.notification_email ?? '')
  }, [settings?.tenant_id])

  const { mutate, isPending, error } = useMutation({
    mutationFn: () =>
      apiClient.patch<SettingsOut>(
        `/api/v1/settings${tenantParam}`,
        { notification_email: email.trim() || null },
      ),
    onSuccess: data => {
      queryClient.setQueryData(settingsKey, data)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', marginBottom: 20 }}>
        Notificaciones por email
      </div>

      {isCmg && (
        <div style={{ marginBottom: 16 }}>
          <label style={LABEL}>TENANT</label>
          <select
            value={selectedTenantId}
            onChange={e => { setSelectedTenantId(e.target.value); setEmail(''); setSaved(false) }}
            style={INPUT}
          >
            <option value="">Selecciona un tenant…</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      {(!isCmg || selectedTenantId) && (
        <>
          <div style={{ marginBottom: 12 }}>
            <label style={LABEL}>EMAIL DE ALERTAS</label>
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setSaved(false) }}
              placeholder="operaciones@empresa.com"
              style={INPUT}
            />
            <div style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              Cuando se dispare una alerta, se enviará un aviso a esta dirección. Cada regla puede además tener su propio email específico.
            </div>
          </div>

          {error && (
            <div style={{ color: 'var(--accent-crit)', fontSize: 12, marginBottom: 8 }}>
              {(error as Error).message}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => mutate()}
              disabled={isPending}
              style={{
                padding: '7px 20px', fontSize: 13, fontFamily: 'var(--font-ui)',
                background: 'var(--accent-energy)', border: 'none',
                borderRadius: 6, color: 'var(--bg-base)',
                cursor: isPending ? 'wait' : 'pointer',
              }}
            >
              {isPending ? 'Guardando…' : 'Guardar'}
            </button>
            {saved && (
              <span style={{ color: 'var(--accent-ok)', fontSize: 12, fontFamily: 'var(--font-ui)' }}>
                Guardado
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create SettingsPage.tsx**

Create `frontend/src/features/settings/SettingsPage.tsx`:

```typescript
import Shell from '../../shared/ui/Shell'
import NotificationSettings from './NotificationSettings'

export default function SettingsPage() {
  return (
    <Shell title="Ajustes">
      <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
        <NotificationSettings />
      </div>
    </Shell>
  )
}
```

- [ ] **Step 5: Add /settings route to App.tsx**

Replace the entire content of `frontend/src/App.tsx`:

```typescript
import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './features/auth/LoginPage'
import RequireAuth from './features/auth/RequireAuth'

const FleetPage         = lazy(() => import('./features/fleet/FleetPage'))
const VehicleDetailPage = lazy(() => import('./features/vehicle/VehicleDetailPage'))
const AlertsPage        = lazy(() => import('./features/alerts/AlertsPage'))
const SettingsPage      = lazy(() => import('./features/settings/SettingsPage'))

function Loading() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-base)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-muted)',
    }}>
      Cargando…
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="fleet"        element={<FleetPage />} />
                <Route path="vehicles/:id" element={<VehicleDetailPage />} />
                <Route path="alerts"       element={<AlertsPage />} />
                <Route path="settings"     element={<SettingsPage />} />
                <Route path="*"            element={<Navigate to="/fleet" replace />} />
              </Routes>
            </Suspense>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
```

- [ ] **Step 6: Add conditional /settings NavLink to Sidebar**

Replace the entire content of `frontend/src/shared/ui/Sidebar.tsx`:

```typescript
import { NavLink } from 'react-router-dom'
import { useAuthStore } from '../../features/auth/useAuthStore'
import { CmgMark } from './CmgLogo'
import { IconFlota, IconAlertas, IconReglas, IconAjustes } from './icons'

const NAV_ITEMS = [
  { to: '/fleet',  Icon: IconFlota,   label: 'Flota',   active: true  },
  { to: '/alerts', Icon: IconAlertas, label: 'Alertas', active: true  },
  { to: '/rules',  Icon: IconReglas,  label: 'Reglas',  active: false },
]

const navLinkStyle = ({ isActive }: { isActive: boolean }) => ({
  width: 36, height: 36,
  borderRadius: 8,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: isActive ? 'var(--accent-energy)' : 'var(--text-muted)',
  background: isActive ? 'rgba(110,197,177,0.15)' : 'transparent',
  transition: 'background 0.15s, color 0.15s',
})

const disabledStyle = {
  width: 36, height: 36,
  borderRadius: 8,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--bg-border)',
  cursor: 'not-allowed' as const,
}

export default function Sidebar() {
  const { logoUrl, user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  return (
    <nav style={{
      position: 'fixed',
      top: 0, left: 0, bottom: 0,
      width: 'var(--sidebar-w)',
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--bg-border)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '12px 0',
      gap: 4,
      zIndex: 100,
    }}>
      <div style={{ marginBottom: 16 }}>
        {logoUrl
          ? <img src={logoUrl} alt="logo" style={{ width: 30, height: 30, objectFit: 'contain' }} />
          : <CmgMark size={30} />
        }
      </div>

      {NAV_ITEMS.map(({ to, Icon, label, active }) =>
        active ? (
          <NavLink key={to} to={to} title={label} style={navLinkStyle}>
            <Icon width={20} height={20} />
          </NavLink>
        ) : (
          <div key={to} title={`${label} — disponible en próxima versión`} style={disabledStyle}>
            <Icon width={20} height={20} />
          </div>
        )
      )}

      <div style={{ marginTop: 'auto' }}>
        {isAdmin ? (
          <NavLink to="/settings" title="Ajustes" style={navLinkStyle}>
            <IconAjustes width={20} height={20} />
          </NavLink>
        ) : null}
      </div>
    </nav>
  )
}
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run src/features/settings/__tests__/SettingsPage.test.tsx
```
Expected: 3 tests PASS.

- [ ] **Step 8: Run full frontend test suite**

```bash
npx vitest run
```
Expected: all 75+ tests PASS.

- [ ] **Step 9: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 10: Production build**

```bash
npm run build
```
Expected: build succeeds with no errors.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/features/settings/NotificationSettings.tsx \
        frontend/src/features/settings/SettingsPage.tsx \
        frontend/src/features/settings/__tests__/SettingsPage.test.tsx \
        frontend/src/App.tsx \
        frontend/src/shared/ui/Sidebar.tsx
git commit -m "feat: SettingsPage — email de notificaciones por tenant, admin-only, selector CMG"
```

---

## Verificación final post-sprint

```bash
# Backend tests
cd /opt/cmg-telematic1
python3 -m pytest tests/api/ -v

# Frontend tests
cd frontend
npx vitest run

# TypeScript
npx tsc --noEmit

# Build
npm run build
```

Todos los tests deben pasar. Build sin errores.
