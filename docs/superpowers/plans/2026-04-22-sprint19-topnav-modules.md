# Sprint 19 — Top Nav + Módulos por Tenant

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** Reemplazar sidebar icon-only por top nav horizontal con texto+icono; añadir `enabled_modules[]` por tenant para control dinámico de la navegación; fusionar Reglas dentro de Alertas.

**Architecture:** Backend añade `enabled_modules TEXT[]` a tenant + endpoint `/auth/me`. Frontend nuevo `TopNav.tsx` reemplaza `Sidebar` + `Topbar`; Shell simplificado; AlertsPage con tabs; TenantsPage con checkboxes de módulos.

**Tech Stack:** FastAPI + Alembic + SQLAlchemy (backend), React 18 + Zustand + TanStack Query (frontend).

---

## File Map

| File | Action |
|---|---|
| `backend/alembic/versions/008_tenant_enabled_modules.py` | Create |
| `backend/app/models/tenant.py` | Modify — add `enabled_modules` column |
| `backend/app/schemas/tenant.py` | Modify — add `enabled_modules` to TenantOut + TenantUpdate |
| `backend/app/api/v1/auth.py` | Modify — add `GET /auth/me` endpoint |
| `backend/app/api/v1/tenants.py` | Modify — validate `enabled_modules` subset on PATCH |
| `frontend/src/lib/types.ts` | Modify — add `enabled_modules` to TenantOut |
| `frontend/src/features/auth/useAuthStore.ts` | Modify — add `enabledModules`, fetch `/auth/me` on login/refresh |
| `frontend/src/styles/tokens.css` | Modify — `--sidebar-w: 0`, `--topbar-h: 52px` |
| `frontend/src/shared/ui/TopNav.tsx` | Create — full top navigation bar |
| `frontend/src/shared/ui/Shell.tsx` | Modify — use TopNav, remove Sidebar |
| `frontend/src/features/alerts/AlertsPage.tsx` | Modify — add Activas/Reglas tabs |
| `frontend/src/features/clientes/TenantsPage.tsx` | Modify — module checkboxes in tenant edit |

---

## Constants

Allowed modules (assignable to clients): `fleet`, `alerts`, `maintenance`, `reports`

CMG admin always sees ALL modules + Admin dropdown regardless of `enabled_modules`.

---

### Task 1: Migration 008 + backend tenant model + schemas

**Files:**
- Create: `backend/alembic/versions/008_tenant_enabled_modules.py`
- Modify: `backend/app/models/tenant.py`
- Modify: `backend/app/schemas/tenant.py`

- [ ] **Step 1: Create migration**

```python
"""add enabled_modules to tenant

Revision ID: 008
Revises: 007
Create Date: 2026-04-22
"""
from alembic import op
import sqlalchemy as sa

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tenant",
        sa.Column("enabled_modules", sa.ARRAY(sa.Text()), nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("tenant", "enabled_modules")
```

- [ ] **Step 2: Add column to SQLAlchemy model**

In `backend/app/models/tenant.py`, add import and column. Add after the existing `from sqlalchemy import ...` line:
```python
from sqlalchemy import ARRAY
```

Add column after `notification_email`:
```python
enabled_modules: Mapped[list[str]] = mapped_column(ARRAY(sa.String), nullable=False, server_default="{}")
```

Wait — SQLAlchemy `ARRAY` needs the import. Use `from sqlalchemy.dialects.postgresql import ARRAY` for PostgreSQL. Actually, the generic `ARRAY` from sqlalchemy works for PostgreSQL too. Use:
```python
from sqlalchemy import String, ForeignKey, DateTime, Boolean, CheckConstraint, Text, ARRAY
```

Column:
```python
enabled_modules: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, server_default="{}")
```

- [ ] **Step 3: Update schemas**

In `backend/app/schemas/tenant.py`:

Add to `TenantOut`:
```python
enabled_modules: list[str] = []
```

Add to `TenantUpdate`:
```python
enabled_modules: list[str] | None = None
```

- [ ] **Step 4: Verify**

```bash
cd /opt/cmg-telematic1 && python -c "from backend.app.models.tenant import Tenant; print('OK')" 2>&1 || true
```

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/008_tenant_enabled_modules.py \
        backend/app/models/tenant.py \
        backend/app/schemas/tenant.py
git commit -m "feat: enabled_modules TEXT[] on tenant — migration 008 + model + schema"
```

---

### Task 2: Backend — GET /auth/me + PATCH /tenants validation

**Files:**
- Modify: `backend/app/api/v1/auth.py`
- Modify: `backend/app/api/v1/tenants.py`

**ALLOWED_MODULES constant** (add near top of both files that need it):
```python
ALLOWED_MODULES = {"fleet", "alerts", "maintenance", "reports"}
```

- [ ] **Step 1: Add GET /auth/me to auth.py**

Read `backend/app/api/v1/auth.py` first. Add after the existing imports:
```python
from app.schemas.tenant import TenantOut
```

Add this endpoint at the end of the file:
```python
@router.get("/me")
async def get_me(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, current_user.tenant_id)
    return {
        "tenant_id": str(current_user.tenant_id),
        "tier": current_user.tenant_tier,
        "enabled_modules": tenant.enabled_modules if tenant else [],
    }
```

Also add missing import `get_current_user` from deps if not already present:
```python
from app.api.v1.deps import get_current_user
```

- [ ] **Step 2: Add module validation to PATCH /tenants/{id}**

Read `backend/app/api/v1/tenants.py` to find the existing PATCH endpoint. Add this logic inside the PATCH handler when `enabled_modules` is being updated:

```python
ALLOWED_MODULES = {"fleet", "alerts", "maintenance", "reports"}

# Inside the PATCH handler, before committing:
if body.enabled_modules is not None:
    invalid = set(body.enabled_modules) - ALLOWED_MODULES
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Módulos no válidos: {invalid}",
        )
    if tenant.tier == "subclient" and tenant.parent_id:
        parent = await db.get(Tenant, tenant.parent_id)
        if parent:
            not_allowed = set(body.enabled_modules) - set(parent.enabled_modules)
            if not_allowed:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"El fabricante padre no tiene estos módulos: {not_allowed}",
                )
    tenant.enabled_modules = body.enabled_modules
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/v1/auth.py backend/app/api/v1/tenants.py
git commit -m "feat: GET /auth/me endpoint + enabled_modules validation in PATCH /tenants"
```

---

### Task 3: Backend deploy + migration

- [ ] **Step 1: Build core-api image**

```bash
cd /opt/cmg-telematic1 && docker build -t cmg-core-api ./backend
```

- [ ] **Step 2: Replace container (with uploads volume)**

```bash
docker stop core-api && docker rm core-api
docker run -d \
  --name core-api \
  --network cmg-telematic1_default \
  -p 127.0.0.1:8010:8010 \
  --env-file /opt/cmg-telematic1/.env \
  -v uploads_data:/app/uploads \
  --restart unless-stopped \
  cmg-core-api
```

- [ ] **Step 3: Run migration**

```bash
sleep 15 && docker exec core-api alembic upgrade head
```
Expected: `Running upgrade 007 -> 008, add enabled_modules to tenant`

- [ ] **Step 4: Verify column**

```bash
docker exec postgres psql -U $(grep POSTGRES_USER /opt/cmg-telematic1/.env | cut -d= -f2) \
  -d $(grep POSTGRES_DB /opt/cmg-telematic1/.env | cut -d= -f2) \
  -c "\d tenant" 2>/dev/null | grep enabled_modules
```
Expected: `enabled_modules | text[] | not null | {}`

- [ ] **Step 5: Smoke test /auth/me**

```bash
curl -s -o /dev/null -w "%{http_code}" https://cmgtrack.com/api/v1/auth/me
```
Expected: `401` (route exists, auth required)

- [ ] **Step 6: Commit** (deploy step, no code changes)

Nothing to commit.

---

### Task 4: Frontend — types + auth store

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/features/auth/useAuthStore.ts`

- [ ] **Step 1: Add `enabled_modules` to TenantOut in types.ts**

```typescript
export interface TenantOut {
  // ... existing fields ...
  enabled_modules: string[]
}
```

- [ ] **Step 2: Update useAuthStore.ts**

Read the file first. Then:

a) Add `enabledModules: string[]` to the `AuthStore` interface and initial state.

b) Add helper function outside the store (after `parseJwt`):
```typescript
async function fetchEnabledModules(token: string): Promise<string[]> {
  try {
    const res = await fetch('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return []
    const data = await res.json() as { enabled_modules: string[] }
    return data.enabled_modules ?? []
  } catch {
    return []
  }
}
```

c) In `login`: after `set({ accessToken: data.access_token, user })`, add:
```typescript
const enabledModules = await fetchEnabledModules(data.access_token)
set({ enabledModules })
```

d) In `refresh`: after `set({ accessToken: data.access_token, user })`, add:
```typescript
const enabledModules = await fetchEnabledModules(data.access_token)
set({ enabledModules })
```

e) In `logout`: add `enabledModules: []` to the `set({...})` call.

f) Initial state: `enabledModules: []`

- [ ] **Step 3: TypeScript check**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/features/auth/useAuthStore.ts
git commit -m "feat: enabledModules in auth store — fetches /auth/me after login/refresh"
```

---

### Task 5: TopNav component

**Files:**
- Create: `frontend/src/shared/ui/TopNav.tsx`

The TopNav replaces Sidebar + Topbar as a single fixed full-width horizontal nav.

- [ ] **Step 1: Read existing icon imports**

Read `frontend/src/shared/ui/Sidebar.tsx` to copy the icon imports that are needed.

- [ ] **Step 2: Create TopNav.tsx**

```tsx
import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../features/auth/useAuthStore'
import { CmgMark } from './CmgLogo'
import {
  IconFlota, IconAlertas, IconMantenimiento, IconReportes,
  IconVehiculos, IconClientes, IconDispositivos, IconCanScanner, IconAjustes,
} from './icons'

const MODULES = [
  { key: 'fleet',        label: 'Flota',         Icon: IconFlota,         to: '/fleet' },
  { key: 'alerts',       label: 'Alertas',        Icon: IconAlertas,       to: '/alerts' },
  { key: 'maintenance',  label: 'Mantenimiento',  Icon: IconMantenimiento, to: '/maintenance' },
  { key: 'reports',      label: 'Reportes',       Icon: IconReportes,      to: '/reports' },
] as const

const CMG_ADMIN_ITEMS = [
  { label: 'Vehículos',        to: '/vehiculos' },
  { label: 'Tipos de vehículo', to: '/tipos-vehiculo' },
  { label: 'Clientes',         to: '/clientes' },
  { label: 'Dispositivos',     to: '/devices' },
  { label: 'CAN Scanner',      to: '/can-scanner' },
  { label: 'Ajustes',          to: '/settings' },
]

function navLinkStyle({ isActive }: { isActive: boolean }) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 14px',
    height: '100%',
    fontSize: 13,
    fontFamily: 'var(--font-ui)',
    fontWeight: 500,
    color: isActive ? 'var(--accent-energy)' : 'var(--text-muted)',
    borderBottom: isActive ? '2px solid var(--accent-energy)' : '2px solid transparent',
    textDecoration: 'none',
    transition: 'color 0.15s, border-color 0.15s',
    whiteSpace: 'nowrap' as const,
  }
}

export default function TopNav() {
  const { user, enabledModules, brandName, logoUrl, logout } = useAuthStore()
  const [adminOpen, setAdminOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const adminRef = useRef<HTMLDivElement>(null)
  const userRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const isCmg = user?.tenant_tier === 'cmg'
  const isAdmin = user?.role === 'admin'

  const visibleModules = MODULES.filter(m =>
    isCmg || enabledModules.includes(m.key)
  )

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (adminRef.current && !adminRef.current.contains(e.target as Node)) setAdminOpen(false)
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <nav style={{
      position: 'fixed',
      top: 0, left: 0, right: 0,
      height: 'var(--topbar-h)',
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--bg-border)',
      display: 'flex',
      alignItems: 'center',
      zIndex: 100,
      gap: 0,
    }}>
      {/* Logo */}
      <div
        onClick={() => navigate('/fleet')}
        style={{ padding: '0 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}
        title={brandName ?? 'CMG Telematic'}
      >
        {logoUrl
          ? <img src={logoUrl} alt="logo" style={{ width: 28, height: 28, objectFit: 'contain' }} />
          : <CmgMark size={28} />
        }
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 24, background: 'var(--bg-border)', flexShrink: 0 }} />

      {/* Module nav links */}
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', flex: 1, overflowX: 'auto' }}>
        {visibleModules.map(({ key, label, Icon, to }) => (
          <NavLink key={key} to={to} style={navLinkStyle}>
            <Icon width={16} height={16} />
            {label}
          </NavLink>
        ))}
      </div>

      {/* CMG Admin dropdown */}
      {isCmg && isAdmin && (
        <div ref={adminRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setAdminOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '6px 14px',
              background: adminOpen ? 'var(--bg-elevated)' : 'transparent',
              border: '1px solid var(--bg-border)',
              borderRadius: 6,
              color: 'var(--text-muted)',
              fontSize: 12,
              cursor: 'pointer',
              margin: '0 8px',
            }}
          >
            Admin {adminOpen ? '▲' : '▼'}
          </button>
          {adminOpen && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              right: 0,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--bg-border)',
              borderRadius: 8,
              padding: '4px 0',
              minWidth: 180,
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
              zIndex: 200,
            }}>
              {CMG_ADMIN_ITEMS.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setAdminOpen(false)}
                  style={({ isActive }) => ({
                    display: 'block',
                    padding: '8px 16px',
                    fontSize: 13,
                    color: isActive ? 'var(--accent-energy)' : 'var(--text-default)',
                    textDecoration: 'none',
                    background: isActive ? 'color-mix(in srgb, var(--accent-energy) 10%, transparent)' : 'transparent',
                  })}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          )}
        </div>
      )}

      {/* User menu */}
      <div ref={userRef} style={{ position: 'relative', flexShrink: 0, marginRight: 12 }}>
        <button
          onClick={() => setUserOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px',
            background: 'transparent',
            border: '1px solid var(--bg-border)',
            borderRadius: 6,
            color: 'var(--text-muted)',
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: 'var(--font-data)',
          }}
        >
          {user?.email}
        </button>
        {userOpen && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--bg-border)',
            borderRadius: 8,
            padding: '4px 0',
            minWidth: 160,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            zIndex: 200,
          }}>
            <button
              onClick={logout}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 16px',
                background: 'transparent',
                border: 'none',
                color: 'var(--accent-crit)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Cerrar sesión
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/shared/ui/TopNav.tsx
git commit -m "feat: TopNav component — horizontal nav with modules, admin dropdown, user menu"
```

---

### Task 6: Shell + tokens.css update

**Files:**
- Modify: `frontend/src/shared/ui/Shell.tsx`
- Modify: `frontend/src/styles/tokens.css`

- [ ] **Step 1: Update tokens.css**

Find `--sidebar-w` and `--topbar-h` in `frontend/src/styles/tokens.css`. Change:
- `--sidebar-w: 56px;` → `--sidebar-w: 0px;`
- `--topbar-h: 48px;` → `--topbar-h: 52px;`

- [ ] **Step 2: Rewrite Shell.tsx**

```tsx
import TopNav from './TopNav'

interface ShellProps {
  title?: string
  children: React.ReactNode
}

export default function Shell({ children }: ShellProps) {
  return (
    <>
      <TopNav />
      <main style={{
        marginTop: 'var(--topbar-h)',
        height: 'calc(100vh - var(--topbar-h))',
        overflow: 'hidden',
      }}>
        {children}
      </main>
    </>
  )
}
```

Note: `title` prop kept optional for backwards compatibility (existing calls pass it).

- [ ] **Step 3: TypeScript check**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/shared/ui/Shell.tsx frontend/src/styles/tokens.css
git commit -m "feat: Shell uses TopNav — remove sidebar, full-width content area"
```

---

### Task 7: AlertsPage — Activas / Reglas tabs

**Files:**
- Modify: `frontend/src/features/alerts/AlertsPage.tsx`

- [ ] **Step 1: Read AlertsPage.tsx** to understand its current structure.

- [ ] **Step 2: Add tab state + Reglas tab**

Add at the top of the component:
```typescript
const [tab, setTab] = useState<'activas' | 'reglas'>('activas')
const isAdmin = user?.role === 'admin'
const { user } = useAuthStore()
```

Add tab bar JSX before the existing content (wrap existing content in `tab === 'activas'` condition):

```tsx
{/* Tab bar */}
<div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--bg-border)', marginBottom: 20 }}>
  {(['activas', 'reglas'] as const).filter(t => t === 'activas' || isAdmin).map(t => (
    <button
      key={t}
      onClick={() => setTab(t)}
      style={{
        padding: '8px 20px',
        background: 'transparent',
        border: 'none',
        borderBottom: tab === t ? '2px solid var(--accent-energy)' : '2px solid transparent',
        color: tab === t ? 'var(--accent-energy)' : 'var(--text-muted)',
        fontSize: 13,
        fontWeight: tab === t ? 600 : 400,
        cursor: 'pointer',
        textTransform: 'capitalize',
      }}
    >
      {t === 'activas' ? 'Activas' : 'Reglas de alerta'}
    </button>
  ))}
</div>

{tab === 'activas' && (
  /* existing AlertsPage content here */
)}

{tab === 'reglas' && isAdmin && (
  /* Import and render RulesPageContent inline or link to /rules */
  <div style={{ padding: '0 0 24px' }}>
    <RulesContent />
  </div>
)}
```

For `RulesContent`: render the existing `RulesPage` content without the `Shell` wrapper. The simplest approach: extract the inner content of RulesPage into a `RulesContent` component that AlertsPage imports. If this is too large, simply add a link:

```tsx
{tab === 'reglas' && isAdmin && (
  <div style={{ padding: 24, textAlign: 'center' }}>
    <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
      Las reglas de alerta definen cuándo se dispara una notificación.
    </p>
    <a href="/rules" style={{ color: 'var(--accent-info)', fontSize: 14 }}>
      Ir al configurador de reglas →
    </a>
  </div>
)}
```

Use the link approach for simplicity — this keeps the scope bounded.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/alerts/AlertsPage.tsx
git commit -m "feat: AlertsPage with Activas/Reglas tabs — rules link for admins"
```

---

### Task 8: TenantsPage — module assignment checkboxes

**Files:**
- Modify: `frontend/src/features/clientes/TenantsPage.tsx` or `TenantDetailPage.tsx`

- [ ] **Step 1: Read TenantsPage and TenantDetailPage**

Read both files to understand where tenant editing happens (modal form or separate page).

- [ ] **Step 2: Add module checkboxes**

In the tenant edit form/modal, add a "Módulos habilitados" section with checkboxes. Only visible when editing a `tier=client` or `tier=subclient` tenant, and only by CMG admin or by the parent client admin:

```tsx
const AVAILABLE_MODULES = [
  { key: 'fleet',       label: 'Flota' },
  { key: 'alerts',      label: 'Alertas' },
  { key: 'maintenance', label: 'Mantenimiento' },
  { key: 'reports',     label: 'Reportes' },
]

{/* In edit form, add: */}
{(editingTenant?.tier === 'client' || editingTenant?.tier === 'subclient') && (
  <div style={{ marginTop: 16 }}>
    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      Módulos habilitados
    </div>
    {AVAILABLE_MODULES.map(m => (
      <label key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={formModules.includes(m.key)}
          onChange={e => {
            if (e.target.checked) {
              setFormModules(prev => [...prev, m.key])
            } else {
              setFormModules(prev => prev.filter(k => k !== m.key))
            }
          }}
        />
        <span style={{ fontSize: 13, color: 'var(--text-default)' }}>{m.label}</span>
      </label>
    ))}
  </div>
)}
```

Where `formModules: string[]` is a piece of form state initialized from `tenant.enabled_modules`.

The PATCH mutation should include `enabled_modules: formModules` in the body.

The `TenantUpdate` type needs `enabled_modules: string[]` — add this to the types if not already there.

- [ ] **Step 3: TypeScript check**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/clientes/TenantsPage.tsx frontend/src/features/clientes/TenantDetailPage.tsx 2>/dev/null || \
git add frontend/src/features/clientes/
git commit -m "feat: module checkboxes in TenantsPage — CMG assigns enabled_modules to clients"
```

---

### Task 9: Frontend deploy

- [ ] **Step 1: Build**
```bash
cd /opt/cmg-telematic1 && docker build -t cmg-frontend ./frontend
```

- [ ] **Step 2: Replace container**
```bash
docker stop frontend && docker rm frontend
docker run -d \
  --name frontend \
  --network cmg-telematic1_default \
  -p 127.0.0.1:3000:3000 \
  --restart unless-stopped \
  cmg-frontend
```

- [ ] **Step 3: Verify**
```bash
sleep 5 && curl -s -o /dev/null -w "%{http_code}" https://cmgtrack.com/
```
Expected: `200`

- [ ] **Step 4: Smoke test in browser**

Navigate to `https://cmgtrack.com/fleet` and verify:
1. No left sidebar — full width content
2. Top nav bar with: Logo | Flota | Alertas | Mantenimiento | Reportes | [Admin ▼] | [email]
3. CMG admin: Admin dropdown opens with Vehículos, Tipos, Clientes, Dispositivos, CAN Scanner, Ajustes
4. Active link has orange color + bottom border
5. Navigate to Clientes → edit a client → module checkboxes appear
6. Navigate to Alertas → tabs "Activas" / "Reglas de alerta" visible for admin
