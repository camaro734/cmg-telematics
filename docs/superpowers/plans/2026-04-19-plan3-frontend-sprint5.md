# Frontend Sprint 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the CMG Telematics 2 React frontend for Sprint 5: login, shell, fleet overview (split list+map), and basic vehicle detail page.

**Architecture:** Feature-based folder structure (`features/auth`, `features/fleet`, `features/vehicle`). Shared UI primitives in `shared/ui/`. API/WS clients in `lib/`. All API calls are relative URLs (`/api/v1/...`) — Vite proxies to core-api in dev, Caddy routes in production. No tests in Sprint 5 (E2E tests planned for Sprint 6+).

**Tech Stack:** React 18, Vite 5, TypeScript 5 (strict), React Query v5 (TanStack), Zustand 5, Leaflet 1.9 + react-leaflet 4, react-router-dom 6. No CSS modules — CSS custom properties via inline styles. No axios — native fetch wrapper.

---

## Environment Prerequisites

Node.js 20+ required. Verify with:
```bash
node --version   # must be >= 20
npm --version
```

If not installed:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

---

## File Map

```
frontend/
├── index.html
├── package.json
├── package-lock.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── nginx.conf                            ← production serving
├── Dockerfile
├── .env.example
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── styles/
    │   └── tokens.css
    ├── lib/
    │   ├── types.ts
    │   ├── apiClient.ts
    │   ├── queryKeys.ts
    │   └── wsClient.ts
    ├── features/
    │   ├── auth/
    │   │   ├── useAuthStore.ts
    │   │   ├── LoginPage.tsx
    │   │   └── RequireAuth.tsx
    │   ├── fleet/
    │   │   ├── useFleetStore.ts
    │   │   ├── useVehicleStatuses.ts
    │   │   ├── VehicleRow.tsx
    │   │   ├── VehicleList.tsx
    │   │   ├── FleetMap.tsx
    │   │   └── FleetPage.tsx
    │   └── vehicle/
    │       ├── VehicleHeader.tsx
    │       ├── TrackMap.tsx
    │       ├── StatusPanel.tsx
    │       └── VehicleDetailPage.tsx
    └── shared/
        └── ui/
            ├── StatusBadge.tsx
            ├── Sidebar.tsx
            ├── Topbar.tsx
            └── Shell.tsx
```

---

### Task 1: Project scaffold

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/index.html`
- Create: `frontend/.env.example`
- Create: `frontend/src/styles/tokens.css`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "cmg-telematic-frontend",
  "private": true,
  "version": "2.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.59.0",
    "leaflet": "^1.9.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-leaflet": "^4.2.1",
    "react-router-dom": "^6.26.2",
    "zustand": "^5.0.1"
  },
  "devDependencies": {
    "@types/leaflet": "^1.9.14",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.2",
    "typescript": "^5.6.3",
    "vite": "^5.4.8"
  }
}
```

- [ ] **Step 2: Create `frontend/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8010',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 3: Create `frontend/tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.app.json" }
  ]
}
```

Create also `frontend/tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

Create also `frontend/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create `frontend/index.html`**

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CMG Telematics</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `frontend/.env.example`**

```
VITE_API_BASE_URL=
VITE_WS_URL=ws://localhost:8010
```

Note: `VITE_API_BASE_URL` is empty — all API calls use relative paths (`/api/v1/...`). Vite proxies them to core-api in dev. Caddy routes them in production.

- [ ] **Step 6: Create `frontend/src/styles/tokens.css`**

```css
:root {
  --bg-base:       #1C1917;
  --bg-surface:    #292524;
  --bg-elevated:   #3C3330;
  --bg-border:     #57534E;

  --accent-energy: #F97316;
  --accent-ok:     #22C55E;
  --accent-warn:   #EAB308;
  --accent-crit:   #EF4444;
  --accent-info:   #38BDF8;
  --accent-off:    #78716C;

  --text-primary:  #E7E5E4;
  --text-dim:      #A8A29E;
  --text-muted:    #78716C;

  --font-data: 'JetBrains Mono', 'IBM Plex Mono', monospace;
  --font-ui:   'Inter', 'DM Sans', sans-serif;

  --gauge-track: #3C3330;
  --gauge-fill:  #F97316;
  --gauge-warn:  #EAB308;
  --gauge-crit:  #EF4444;

  --sidebar-w: 56px;
  --topbar-h:  48px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body, #root {
  height: 100%;
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.5;
}

a { color: inherit; text-decoration: none; }
button { cursor: pointer; border: none; background: none; font: inherit; color: inherit; }
input { font: inherit; }
```

- [ ] **Step 7: Create `frontend/src/vite-env.d.ts`**

```typescript
/// <reference types="vite/client" />
```

This enables Vite's TypeScript type declarations, including PNG image imports used by Leaflet.

- [ ] **Step 8: Create `frontend/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import 'leaflet/dist/leaflet.css'
import './styles/tokens.css'
import App from './App.tsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
```

- [ ] **Step 9: Create `frontend/src/App.tsx` (placeholder — expanded in later tasks)**

```tsx
export default function App() {
  return <div style={{ padding: 24, color: 'var(--text-primary)' }}>CMG Telematics — loading…</div>
}
```

- [ ] **Step 10: Install dependencies**

```bash
cd /opt/cmg-telematic1/frontend
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 11: Verify build**

```bash
cd /opt/cmg-telematic1/frontend
npm run build
```

Expected: `dist/` created, 0 TypeScript errors.

- [ ] **Step 12: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/
git commit -m "feat: frontend scaffold — Vite + React 18 + TypeScript + design tokens"
```

---

### Task 2: TypeScript types

**Files:**
- Create: `frontend/src/lib/types.ts`

- [ ] **Step 1: Create `frontend/src/lib/types.ts`**

```typescript
// Matches backend app/schemas/auth.py + app/schemas/vehicle.py + app/schemas/alert.py

export interface CurrentUser {
  user_id: string
  tenant_id: string
  tenant_tier: 'cmg' | 'client' | 'subclient'
  role: 'admin' | 'operator' | 'viewer' | 'driver'
  email: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
}

export interface VehicleOut {
  id: string
  tenant_id: string
  vehicle_type_id: string
  name: string
  license_plate: string | null
  vin: string | null
  year: number | null
  active: boolean
  created_at: string
}

export interface VehicleStatus {
  vehicle_id: string
  online: boolean
  last_seen: string | null
  lat: number | null
  lon: number | null
  speed_kmh: number | null
  ignition: boolean | null
  pto_active: boolean | null
  can_data: Record<string, unknown> | null
}

export interface TrackPoint {
  time: string
  lat: number | null
  lon: number | null
}

export interface KpiHour {
  bucket: string
  avg_pressure_1: number | null
  max_pressure_1: number | null
  avg_oil_temp: number | null
  max_oil_temp: number | null
  pto_active_minutes: number | null
  engine_on_minutes: number | null
  record_count: number | null
}

export interface BrandTokens {
  brand_name?: string
  brand_color?: string
  logo_url?: string
  [key: string]: string | undefined
}

export interface TenantOut {
  id: string
  parent_id: string | null
  tier: string
  name: string
  slug: string
  active: boolean
  brand_name: string | null
  brand_color: string | null
  logo_url: string | null
  custom_domain: string | null
  brand_tokens: BrandTokens | null
  created_at: string
}
```

- [ ] **Step 2: Verify build**

```bash
cd /opt/cmg-telematic1/frontend
npm run build
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/lib/types.ts
git commit -m "feat: frontend shared TypeScript types"
```

---

### Task 3: API client + query keys + WS stub

**Files:**
- Create: `frontend/src/lib/apiClient.ts`
- Create: `frontend/src/lib/queryKeys.ts`
- Create: `frontend/src/lib/wsClient.ts`

- [ ] **Step 1: Create `frontend/src/lib/apiClient.ts`**

```typescript
// All paths are relative (/api/v1/...) — Vite proxies to core-api in dev, Caddy in production.
// On 401: auto-refresh once, then logout.

import { useAuthStore } from '../features/auth/useAuthStore'

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retry = true,
): Promise<T> {
  const token = useAuthStore.getState().accessToken
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401 && retry) {
    const ok = await useAuthStore.getState().refresh()
    if (ok) return request<T>(method, path, body, false)
    useAuthStore.getState().logout()
    throw new Error('Sesión expirada')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status}: ${text}`)
  }

  return res.json() as Promise<T>
}

export const apiClient = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
```

- [ ] **Step 2: Create `frontend/src/lib/queryKeys.ts`**

```typescript
export const keys = {
  vehicles: () => ['vehicles'] as const,
  vehicle: (id: string) => ['vehicles', id] as const,
  vehicleStatus: (id: string) => ['vehicles', id, 'status'] as const,
  vehicleTrack: (id: string) => ['vehicles', id, 'track'] as const,
  vehicleKpis: (id: string) => ['vehicles', id, 'kpis'] as const,
  alerts: () => ['alerts'] as const,
  rules: () => ['rules'] as const,
  tenantBrandTokens: (tenantId: string) => ['tenants', tenantId, 'brand-tokens'] as const,
}
```

- [ ] **Step 3: Create `frontend/src/lib/wsClient.ts`**

```typescript
// Stub for Sprint 6. Interface defined here so Sprint 6 activates it without touching Sprint 5 files.

export interface WsClient {
  connect: (token: string, tenantId: string) => void
  disconnect: () => void
  onTelemetry: (cb: (data: unknown) => void) => () => void
}

export const wsClient: WsClient = {
  connect: () => {},
  disconnect: () => {},
  onTelemetry: () => () => {},
}
```

- [ ] **Step 4: Verify build**

```bash
cd /opt/cmg-telematic1/frontend
npm run build
```

Expected: 0 errors. (useAuthStore import will warn as circular-candidate — ignore, it resolves at runtime correctly.)

- [ ] **Step 5: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/lib/
git commit -m "feat: apiClient, queryKeys, wsClient stub"
```

---

### Task 4: Auth store + login page + route guard

**Files:**
- Create: `frontend/src/features/auth/useAuthStore.ts`
- Create: `frontend/src/features/auth/LoginPage.tsx`
- Create: `frontend/src/features/auth/RequireAuth.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create `frontend/src/features/auth/useAuthStore.ts`**

```typescript
import { create } from 'zustand'
import type { CurrentUser, BrandTokens } from '../../lib/types'

const REFRESH_KEY = 'cmg_refresh'

function parseJwt(token: string): CurrentUser | null {
  try {
    const raw = atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    const p = JSON.parse(raw) as Record<string, string>
    return {
      user_id: p['sub'],
      tenant_id: p['tenant_id'],
      tenant_tier: p['tenant_tier'] as CurrentUser['tenant_tier'],
      role: p['role'] as CurrentUser['role'],
      email: p['email'],
    }
  } catch {
    return null
  }
}

interface AuthStore {
  accessToken: string | null
  user: CurrentUser | null
  brandName: string | null
  logoUrl: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  refresh: () => Promise<boolean>
  applyBrandTokens: (tokens: BrandTokens) => void
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  accessToken: null,
  user: null,
  brandName: null,
  logoUrl: null,

  login: async (email, password) => {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) throw new Error('Credenciales incorrectas')
    const data = await res.json() as { access_token: string; refresh_token: string }
    localStorage.setItem(REFRESH_KEY, data.refresh_token)
    set({ accessToken: data.access_token, user: parseJwt(data.access_token) })
  },

  logout: () => {
    localStorage.removeItem(REFRESH_KEY)
    set({ accessToken: null, user: null, brandName: null, logoUrl: null })
    window.location.href = '/login'
  },

  refresh: async () => {
    const refreshToken = localStorage.getItem(REFRESH_KEY)
    if (!refreshToken) return false
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (!res.ok) { localStorage.removeItem(REFRESH_KEY); return false }
      const data = await res.json() as { access_token: string; refresh_token: string }
      localStorage.setItem(REFRESH_KEY, data.refresh_token)
      set({ accessToken: data.access_token, user: parseJwt(data.access_token) })
      return true
    } catch {
      return false
    }
  },

  applyBrandTokens: (tokens) => {
    const root = document.documentElement
    Object.entries(tokens).forEach(([k, v]) => {
      if (v && k.startsWith('--')) root.style.setProperty(k, v)
    })
    set({
      brandName: tokens['brand_name'] ?? get().brandName,
      logoUrl: tokens['logo_url'] ?? get().logoUrl,
    })
  },
}))
```

- [ ] **Step 2: Create `frontend/src/features/auth/LoginPage.tsx`**

```tsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from './useAuthStore'
import { apiClient } from '../../lib/apiClient'
import type { BrandTokens } from '../../lib/types'

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, applyBrandTokens, user } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user) navigate('/fleet', { replace: true })
  }, [user, navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email, password)
      // fetch brand tokens after login
      const store = useAuthStore.getState()
      if (store.user) {
        try {
          const tokens = await apiClient.get<BrandTokens>(
            `/api/v1/tenants/${store.user.tenant_id}/brand-tokens`
          )
          applyBrandTokens(tokens)
        } catch {
          // brand tokens are optional — ignore failures
        }
      }
      navigate('/fleet', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-base)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        borderRadius: 12,
        padding: '40px 36px',
        width: 360,
        border: '1px solid var(--bg-border)',
      }}>
        {/* Logo mark */}
        <div style={{
          width: 48, height: 48,
          background: 'var(--accent-energy)',
          borderRadius: 8,
          marginBottom: 24,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-data)',
          fontWeight: 700, fontSize: 20,
          color: '#fff',
        }}>C</div>

        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>CMG Telematics</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 32, fontSize: 13 }}>
          Inicia sesión para continuar
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 500 }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--bg-border)',
                borderRadius: 6,
                padding: '8px 12px',
                color: 'var(--text-primary)',
                outline: 'none',
                fontSize: 14,
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 500 }}>
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--bg-border)',
                borderRadius: 6,
                padding: '8px 12px',
                color: 'var(--text-primary)',
                outline: 'none',
                fontSize: 14,
              }}
            />
          </div>

          {error && (
            <p style={{ color: 'var(--accent-crit)', fontSize: 13, marginTop: -4 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              background: loading ? 'var(--accent-off)' : 'var(--accent-energy)',
              color: '#fff',
              borderRadius: 6,
              padding: '10px 0',
              fontWeight: 600,
              fontSize: 14,
              marginTop: 8,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {loading ? 'Accediendo…' : 'Iniciar sesión'}
          </button>
        </form>

        <p style={{ marginTop: 24, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          ¿Olvidaste tu contraseña? Contacta con tu administrador.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `frontend/src/features/auth/RequireAuth.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from './useAuthStore'

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { accessToken, refresh } = useAuthStore()
  const [checking, setChecking] = useState(!accessToken)

  useEffect(() => {
    if (!accessToken) {
      refresh().finally(() => setChecking(false))
    }
  }, [accessToken, refresh])

  if (checking) {
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

  if (!accessToken) return <Navigate to="/login" replace />
  return <>{children}</>
}
```

- [ ] **Step 4: Replace `frontend/src/App.tsx` with routing**

```tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './features/auth/LoginPage'
import RequireAuth from './features/auth/RequireAuth'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Routes>
              <Route path="fleet" element={<div style={{ padding: 24, color: 'var(--text-primary)' }}>Fleet (próximamente)</div>} />
              <Route path="vehicles/:id" element={<div style={{ padding: 24, color: 'var(--text-primary)' }}>Vehicle detail (próximamente)</div>} />
              <Route path="*" element={<Navigate to="/fleet" replace />} />
            </Routes>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
```

- [ ] **Step 5: Verify build**

```bash
cd /opt/cmg-telematic1/frontend
npm run build
```

Expected: 0 TypeScript errors.

- [ ] **Step 6: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/auth/ frontend/src/App.tsx
git commit -m "feat: auth — store, login page, route guard"
```

---

### Task 5: Shell (sidebar + topbar + layout)

**Files:**
- Create: `frontend/src/shared/ui/StatusBadge.tsx`
- Create: `frontend/src/shared/ui/Sidebar.tsx`
- Create: `frontend/src/shared/ui/Topbar.tsx`
- Create: `frontend/src/shared/ui/Shell.tsx`

- [ ] **Step 1: Create `frontend/src/shared/ui/StatusBadge.tsx`**

```tsx
type BadgeVariant = 'online' | 'offline' | 'pto' | 'warn' | 'crit'

const VARIANT_STYLES: Record<BadgeVariant, { bg: string; color: string; label: string }> = {
  online:  { bg: 'rgba(34,197,94,0.15)',  color: 'var(--accent-ok)',     label: 'EN LÍNEA' },
  offline: { bg: 'rgba(120,113,108,0.2)', color: 'var(--accent-off)',    label: 'OFFLINE' },
  pto:     { bg: 'rgba(249,115,22,0.15)', color: 'var(--accent-energy)', label: 'PTO' },
  warn:    { bg: 'rgba(234,179,8,0.15)',  color: 'var(--accent-warn)',   label: 'ADVERTENCIA' },
  crit:    { bg: 'rgba(239,68,68,0.15)',  color: 'var(--accent-crit)',   label: 'CRÍTICO' },
}

interface StatusBadgeProps {
  variant: BadgeVariant
  label?: string
  size?: 'sm' | 'md'
}

export default function StatusBadge({ variant, label, size = 'sm' }: StatusBadgeProps) {
  const s = VARIANT_STYLES[variant]
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      background: s.bg,
      color: s.color,
      borderRadius: 100,
      padding: size === 'md' ? '4px 10px' : '2px 8px',
      fontSize: size === 'md' ? 12 : 10,
      fontWeight: 600,
      letterSpacing: '0.04em',
      fontFamily: 'var(--font-ui)',
    }}>
      <span style={{
        width: size === 'md' ? 7 : 5,
        height: size === 'md' ? 7 : 5,
        borderRadius: '50%',
        background: s.color,
        flexShrink: 0,
      }} />
      {label ?? s.label}
    </span>
  )
}
```

- [ ] **Step 2: Create `frontend/src/shared/ui/Sidebar.tsx`**

```tsx
import { NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/fleet', icon: '🚛', label: 'Flota', active: true },
  { to: '/alerts', icon: '🔔', label: 'Alertas', active: false },
  { to: '/rules', icon: '⚙️', label: 'Reglas', active: false },
]

export default function Sidebar() {
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
      {/* Logo */}
      <div style={{
        width: 32, height: 32,
        background: 'var(--accent-energy)',
        borderRadius: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 700, color: '#fff',
        fontFamily: 'var(--font-data)',
        marginBottom: 16,
      }}>C</div>

      {NAV_ITEMS.map(({ to, icon, label, active }) =>
        active ? (
          <NavLink
            key={to}
            to={to}
            title={label}
            style={({ isActive }) => ({
              width: 36, height: 36,
              borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18,
              background: isActive ? 'rgba(249,115,22,0.15)' : 'transparent',
              color: isActive ? 'var(--accent-energy)' : 'var(--text-muted)',
              transition: 'background 0.15s',
            })}
          >
            {icon}
          </NavLink>
        ) : (
          <div
            key={to}
            title={`${label} — disponible en próxima versión`}
            style={{
              width: 36, height: 36,
              borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18,
              color: 'var(--bg-border)',
              cursor: 'not-allowed',
            }}
          >
            {icon}
          </div>
        )
      )}

      {/* Settings stub at bottom */}
      <div style={{ marginTop: 'auto' }}>
        <div
          title="Ajustes — disponible en próxima versión"
          style={{
            width: 36, height: 36,
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
            color: 'var(--bg-border)',
            cursor: 'not-allowed',
          }}
        >⚙</div>
      </div>
    </nav>
  )
}
```

- [ ] **Step 3: Create `frontend/src/shared/ui/Topbar.tsx`**

```tsx
import { useAuthStore } from '../../features/auth/useAuthStore'

interface TopbarProps {
  title: string
}

export default function Topbar({ title }: TopbarProps) {
  const { user, brandName, logout } = useAuthStore()

  return (
    <header style={{
      position: 'fixed',
      top: 0,
      left: 'var(--sidebar-w)',
      right: 0,
      height: 'var(--topbar-h)',
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--bg-border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 20px',
      gap: 12,
      zIndex: 99,
    }}>
      <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>{title}</span>

      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {brandName ?? 'CMG Telematics'}
      </span>

      <span style={{
        fontSize: 12,
        color: 'var(--text-dim)',
        fontFamily: 'var(--font-data)',
      }}>
        {user?.email}
      </span>

      <button
        onClick={logout}
        style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          padding: '4px 10px',
          border: '1px solid var(--bg-border)',
          borderRadius: 6,
          background: 'transparent',
        }}
      >
        Salir
      </button>
    </header>
  )
}
```

- [ ] **Step 4: Create `frontend/src/shared/ui/Shell.tsx`**

```tsx
import Sidebar from './Sidebar'
import Topbar from './Topbar'

interface ShellProps {
  title: string
  children: React.ReactNode
}

export default function Shell({ title, children }: ShellProps) {
  return (
    <>
      <Sidebar />
      <Topbar title={title} />
      <main style={{
        marginLeft: 'var(--sidebar-w)',
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

- [ ] **Step 5: Verify build**

```bash
cd /opt/cmg-telematic1/frontend
npm run build
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/shared/
git commit -m "feat: shell — sidebar, topbar, status badge"
```

---

### Task 6: Fleet data layer

**Files:**
- Create: `frontend/src/features/fleet/useFleetStore.ts`
- Create: `frontend/src/features/fleet/useVehicleStatuses.ts`

- [ ] **Step 1: Create `frontend/src/features/fleet/useFleetStore.ts`**

```typescript
import { create } from 'zustand'

interface FleetStore {
  selectedId: string | null
  setSelected: (id: string | null) => void
}

export const useFleetStore = create<FleetStore>(set => ({
  selectedId: null,
  setSelected: id => set({ selectedId: id }),
}))
```

- [ ] **Step 2: Create `frontend/src/features/fleet/useVehicleStatuses.ts`**

```typescript
import { useQueries } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleOut, VehicleStatus } from '../../lib/types'

export function useVehicleStatuses(vehicles: VehicleOut[]) {
  const results = useQueries({
    queries: vehicles.map(v => ({
      queryKey: keys.vehicleStatus(v.id),
      queryFn: () => apiClient.get<VehicleStatus>(`/api/v1/vehicles/${v.id}/status`),
      refetchInterval: 30_000,
      staleTime: 20_000,
    })),
  })

  const statuses = new Map<string, VehicleStatus>()
  results.forEach((r, i) => {
    if (r.data) statuses.set(vehicles[i].id, r.data)
  })

  return statuses
}
```

- [ ] **Step 3: Verify build**

```bash
cd /opt/cmg-telematic1/frontend
npm run build
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/fleet/useFleetStore.ts frontend/src/features/fleet/useVehicleStatuses.ts
git commit -m "feat: fleet store + vehicle statuses polling hook"
```

---

### Task 7: Fleet list components

**Files:**
- Create: `frontend/src/features/fleet/VehicleRow.tsx`
- Create: `frontend/src/features/fleet/VehicleList.tsx`

- [ ] **Step 1: Create `frontend/src/features/fleet/VehicleRow.tsx`**

```tsx
import { useNavigate } from 'react-router-dom'
import StatusBadge from '../../shared/ui/StatusBadge'
import type { VehicleOut, VehicleStatus } from '../../lib/types'

function relativeTime(isoString: string): string {
  const diff = (Date.now() - new Date(isoString).getTime()) / 1000
  if (diff < 60) return 'hace un momento'
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`
  return `hace ${Math.floor(diff / 86400)} días`
}

interface VehicleRowProps {
  vehicle: VehicleOut
  status: VehicleStatus | undefined
  selected: boolean
  onSelect: () => void
}

export default function VehicleRow({ vehicle, status, selected, onSelect }: VehicleRowProps) {
  const navigate = useNavigate()
  const online = status?.online ?? false
  const pto = status?.pto_active === true

  function handleClick() {
    onSelect()
    navigate(`/vehicles/${vehicle.id}`)
  }

  return (
    <div
      onClick={handleClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderLeft: `3px solid ${pto ? 'var(--accent-energy)' : online ? 'var(--accent-ok)' : 'var(--bg-border)'}`,
        background: selected ? 'var(--bg-elevated)' : 'transparent',
        cursor: 'pointer',
        borderBottom: '1px solid var(--bg-border)',
        transition: 'background 0.1s',
      }}
    >
      {/* Status dot */}
      <span style={{
        width: 8, height: 8,
        borderRadius: '50%',
        background: pto ? 'var(--accent-energy)' : online ? 'var(--accent-ok)' : 'var(--accent-off)',
        flexShrink: 0,
      }} />

      {/* Name + plate */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 500,
          fontSize: 13,
          color: online ? 'var(--text-primary)' : 'var(--text-muted)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {vehicle.name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>
          {vehicle.license_plate ?? '—'}
        </div>
      </div>

      {/* Right side */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {online && status?.speed_kmh != null ? (
          <>
            <div style={{ fontSize: 13, fontFamily: 'var(--font-data)', color: 'var(--text-primary)' }}>
              {Math.round(status.speed_kmh)} km/h
            </div>
            {pto && <StatusBadge variant="pto" />}
          </>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {status?.last_seen ? relativeTime(status.last_seen) : 'Sin señal'}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `frontend/src/features/fleet/VehicleList.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useFleetStore } from './useFleetStore'
import { useVehicleStatuses } from './useVehicleStatuses'
import VehicleRow from './VehicleRow'
import type { VehicleOut } from '../../lib/types'

export default function VehicleList() {
  const { selectedId, setSelected } = useFleetStore()

  const { data: vehicles = [], isLoading, error } = useQuery({
    queryKey: keys.vehicles(),
    queryFn: () => apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    staleTime: 5 * 60_000,
  })

  const statuses = useVehicleStatuses(vehicles)

  // Sort: online first, then offline
  const sorted = [...vehicles].sort((a, b) => {
    const aOnline = statuses.get(a.id)?.online ?? false
    const bOnline = statuses.get(b.id)?.online ?? false
    return Number(bOnline) - Number(aOnline)
  })

  if (isLoading) {
    return (
      <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
        Cargando vehículos…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 20, color: 'var(--accent-crit)', fontSize: 13 }}>
        Error al cargar vehículos
      </div>
    )
  }

  if (sorted.length === 0) {
    return (
      <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
        No hay vehículos en la flota
      </div>
    )
  }

  const onlineCount = sorted.filter(v => statuses.get(v.id)?.online).length

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px',
        borderBottom: '1px solid var(--bg-border)',
        fontSize: 11,
        color: 'var(--text-muted)',
        fontWeight: 600,
        letterSpacing: '0.06em',
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>VEHÍCULOS ({sorted.length})</span>
        <span style={{ color: 'var(--accent-ok)' }}>{onlineCount} EN LÍNEA</span>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sorted.map(v => (
          <VehicleRow
            key={v.id}
            vehicle={v}
            status={statuses.get(v.id)}
            selected={selectedId === v.id}
            onSelect={() => setSelected(v.id)}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

```bash
cd /opt/cmg-telematic1/frontend
npm run build
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/fleet/VehicleRow.tsx frontend/src/features/fleet/VehicleList.tsx
git commit -m "feat: fleet vehicle list with real-time status polling"
```

---

### Task 8: Fleet map + Fleet page

**Files:**
- Create: `frontend/src/features/fleet/FleetMap.tsx`
- Create: `frontend/src/features/fleet/FleetPage.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create `frontend/src/features/fleet/FleetMap.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useNavigate } from 'react-router-dom'
import { useFleetStore } from './useFleetStore'
import type { VehicleOut, VehicleStatus } from '../../lib/types'

// Fix Leaflet default marker icons with Vite
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)['_getIconUrl']
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })

function makeIcon(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}"/>
    <circle cx="12" cy="12" r="5" fill="white"/>
  </svg>`
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [24, 36],
    iconAnchor: [12, 36],
    popupAnchor: [0, -36],
  })
}

const ICON_ONLINE = makeIcon('#22C55E')
const ICON_OFFLINE = makeIcon('#78716C')
const ICON_PTO = makeIcon('#F97316')

interface FleetMapProps {
  vehicles: VehicleOut[]
  statuses: Map<string, VehicleStatus>
}

export default function FleetMap({ vehicles, statuses }: FleetMapProps) {
  const navigate = useNavigate()
  const { selectedId } = useFleetStore()
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  const containerRef = useRef<HTMLDivElement>(null)

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapRef.current = L.map(containerRef.current, {
      center: [40.416775, -3.70379], // Madrid default
      zoom: 6,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(mapRef.current)

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // Update markers when statuses change
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const validVehicles = vehicles.filter(v => {
      const s = statuses.get(v.id)
      return s?.lat != null && s?.lon != null
    })

    // Remove old markers not in current list
    for (const [id, marker] of markersRef.current) {
      if (!validVehicles.find(v => v.id === id)) {
        marker.remove()
        markersRef.current.delete(id)
      }
    }

    // Add/update markers
    for (const vehicle of validVehicles) {
      const status = statuses.get(vehicle.id)!
      const lat = status.lat!
      const lon = status.lon!
      const icon = status.pto_active ? ICON_PTO : status.online ? ICON_ONLINE : ICON_OFFLINE

      if (markersRef.current.has(vehicle.id)) {
        const marker = markersRef.current.get(vehicle.id)!
        marker.setLatLng([lat, lon])
        marker.setIcon(icon)
      } else {
        const marker = L.marker([lat, lon], { icon })
          .addTo(map)
          .bindPopup(`
            <div style="font-family:sans-serif;min-width:140px">
              <strong>${vehicle.name}</strong><br/>
              ${vehicle.license_plate ?? ''}<br/>
              ${status.speed_kmh != null ? `${Math.round(status.speed_kmh)} km/h<br/>` : ''}
              <a href="/vehicles/${vehicle.id}" style="color:#F97316;font-size:12px">Ver detalle →</a>
            </div>
          `)
        markersRef.current.set(vehicle.id, marker)
      }
    }

    // Fit bounds on first load
    if (validVehicles.length > 0 && markersRef.current.size > 0) {
      const group = L.featureGroup(Array.from(markersRef.current.values()))
      try { map.fitBounds(group.getBounds().pad(0.2)) } catch { /* ignore */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses, vehicles])

  // Fly to selected vehicle
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedId) return
    const status = statuses.get(selectedId)
    if (status?.lat != null && status?.lon != null) {
      map.flyTo([status.lat, status.lon], 14, { duration: 0.8 })
    }
  }, [selectedId, statuses])

  // Handle popup link clicks (SPA navigation)
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'A' && target.getAttribute('href')?.startsWith('/vehicles/')) {
        e.preventDefault()
        navigate(target.getAttribute('href')!)
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [navigate])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', background: 'var(--bg-base)' }}
    />
  )
}
```

- [ ] **Step 2: Create `frontend/src/features/fleet/FleetPage.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import VehicleList from './VehicleList'
import FleetMap from './FleetMap'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useVehicleStatuses } from './useVehicleStatuses'
import type { VehicleOut } from '../../lib/types'

export default function FleetPage() {
  const { data: vehicles = [] } = useQuery({
    queryKey: keys.vehicles(),
    queryFn: () => apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    staleTime: 5 * 60_000,
  })

  const statuses = useVehicleStatuses(vehicles)

  return (
    <Shell title="Flota">
      <div style={{ display: 'flex', height: '100%' }}>
        {/* Left panel — 35% */}
        <div style={{
          width: '35%',
          minWidth: 260,
          maxWidth: 400,
          borderRight: '1px solid var(--bg-border)',
          background: 'var(--bg-surface)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <VehicleList />
        </div>

        {/* Right panel — 65% */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <FleetMap vehicles={vehicles} statuses={statuses} />
        </div>
      </div>
    </Shell>
  )
}
```

- [ ] **Step 3: Update `frontend/src/App.tsx` with FleetPage route**

```tsx
import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './features/auth/LoginPage'
import RequireAuth from './features/auth/RequireAuth'

const FleetPage = lazy(() => import('./features/fleet/FleetPage'))
const VehicleDetailPage = lazy(() => import('./features/vehicle/VehicleDetailPage'))

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
                <Route path="fleet" element={<FleetPage />} />
                <Route path="vehicles/:id" element={<VehicleDetailPage />} />
                <Route path="*" element={<Navigate to="/fleet" replace />} />
              </Routes>
            </Suspense>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
```

Note: `VehicleDetailPage` doesn't exist yet — TypeScript will error. Add a temporary stub file to unblock the build:

Create `frontend/src/features/vehicle/VehicleDetailPage.tsx` (temporary stub, replaced in Task 9):

```tsx
export default function VehicleDetailPage() {
  return <div style={{ padding: 24, color: 'var(--text-primary)' }}>Vehicle detail — próximamente</div>
}
```

- [ ] **Step 4: Verify build**

```bash
cd /opt/cmg-telematic1/frontend
npm run build
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/fleet/ frontend/src/features/vehicle/VehicleDetailPage.tsx frontend/src/App.tsx
git commit -m "feat: fleet page — split view with Leaflet map + vehicle list"
```

---

### Task 9: Vehicle detail page

**Files:**
- Create: `frontend/src/features/vehicle/VehicleHeader.tsx`
- Create: `frontend/src/features/vehicle/TrackMap.tsx`
- Create: `frontend/src/features/vehicle/StatusPanel.tsx`
- Replace: `frontend/src/features/vehicle/VehicleDetailPage.tsx`

- [ ] **Step 1: Create `frontend/src/features/vehicle/VehicleHeader.tsx`**

```tsx
import { useNavigate } from 'react-router-dom'
import StatusBadge from '../../shared/ui/StatusBadge'
import type { VehicleOut, VehicleStatus } from '../../lib/types'

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'hace un momento'
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`
  return `hace ${Math.floor(diff / 86400)} días`
}

interface VehicleHeaderProps {
  vehicle: VehicleOut
  status: VehicleStatus | undefined
}

export default function VehicleHeader({ vehicle, status }: VehicleHeaderProps) {
  const navigate = useNavigate()
  const online = status?.online ?? false

  return (
    <div style={{
      padding: '16px 24px',
      borderBottom: '1px solid var(--bg-border)',
      background: 'var(--bg-surface)',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
    }}>
      <button
        onClick={() => navigate('/fleet')}
        style={{
          color: 'var(--text-muted)',
          fontSize: 13,
          padding: '4px 10px',
          border: '1px solid var(--bg-border)',
          borderRadius: 6,
          flexShrink: 0,
        }}
      >
        ← Flota
      </button>

      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>{vehicle.name}</h1>
          <StatusBadge variant={online ? 'online' : 'offline'} size="md" />
          {status?.pto_active && <StatusBadge variant="pto" size="md" />}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-data)' }}>
          {vehicle.license_plate ?? '—'}
          {status?.last_seen && (
            <span style={{ marginLeft: 12 }}>
              Última señal: {relativeTime(status.last_seen)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `frontend/src/features/vehicle/TrackMap.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { TrackPoint, VehicleStatus } from '../../lib/types'

interface TrackMapProps {
  track: TrackPoint[]
  status: VehicleStatus | undefined
}

export default function TrackMap({ track, status }: TrackMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapRef.current = L.map(containerRef.current, {
      center: [40.416775, -3.70379],
      zoom: 12,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(mapRef.current)
    return () => { mapRef.current?.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clear existing layers except tile layer
    map.eachLayer(layer => {
      if (!(layer instanceof L.TileLayer)) map.removeLayer(layer)
    })

    const validPoints = track.filter(p => p.lat != null && p.lon != null)

    if (validPoints.length > 0) {
      const latlngs = validPoints.map(p => [p.lat!, p.lon!] as [number, number])

      // Track polyline in orange
      L.polyline(latlngs, {
        color: '#F97316',
        weight: 3,
        opacity: 0.8,
      }).addTo(map)

      // Start marker (green)
      L.circleMarker(latlngs[0], {
        radius: 5, fillColor: '#22C55E', color: '#fff',
        weight: 2, fillOpacity: 1,
      }).bindTooltip('Inicio').addTo(map)
    }

    // Current position marker
    if (status?.lat != null && status?.lon != null) {
      L.circleMarker([status.lat, status.lon], {
        radius: 8,
        fillColor: status.online ? '#F97316' : '#78716C',
        color: '#fff',
        weight: 2,
        fillOpacity: 1,
      }).bindTooltip('Posición actual').addTo(map)
    }

    // Fit bounds
    const allPoints: [number, number][] = validPoints.map(p => [p.lat!, p.lon!])
    if (status?.lat != null && status?.lon != null) {
      allPoints.push([status.lat, status.lon])
    }
    if (allPoints.length > 0) {
      try {
        map.fitBounds(L.latLngBounds(allPoints).pad(0.2))
      } catch { /* ignore */ }
    }
  }, [track, status])

  if (track.length === 0 && (status?.lat == null)) {
    return (
      <div style={{
        height: 340,
        background: 'var(--bg-elevated)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: 13,
        borderRadius: 8,
      }}>
        Sin actividad registrada hoy
      </div>
    )
  }

  return <div ref={containerRef} style={{ width: '100%', height: 340, borderRadius: 8, overflow: 'hidden' }} />
}
```

- [ ] **Step 3: Create `frontend/src/features/vehicle/StatusPanel.tsx`**

```tsx
import type { VehicleStatus } from '../../lib/types'

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      borderRadius: 8,
      padding: '12px 16px',
      border: '1px solid var(--bg-border)',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function Value({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{
      fontSize: 22,
      fontFamily: 'var(--font-data)',
      fontWeight: 500,
      color: color ?? 'var(--text-primary)',
    }}>
      {children}
    </div>
  )
}

interface StatusPanelProps {
  status: VehicleStatus | undefined
}

export default function StatusPanel({ status }: StatusPanelProps) {
  if (!status) {
    return (
      <div style={{ padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>
        Sin datos de estado disponibles
      </div>
    )
  }

  return (
    <div>
      {/* Status cards grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 12,
        marginBottom: 24,
      }}>
        <Card label="VELOCIDAD">
          <Value color="var(--accent-info)">
            {status.speed_kmh != null ? `${Math.round(status.speed_kmh)} km/h` : '—'}
          </Value>
        </Card>

        <Card label="IGNICIÓN">
          <Value color={status.ignition ? 'var(--accent-ok)' : 'var(--accent-off)'}>
            {status.ignition == null ? '—' : status.ignition ? 'ON' : 'OFF'}
          </Value>
        </Card>

        <Card label="PTO">
          <Value color={status.pto_active ? 'var(--accent-energy)' : 'var(--accent-off)'}>
            {status.pto_active == null ? '—' : status.pto_active ? 'ACTIVO' : 'INACTIVO'}
          </Value>
        </Card>
      </div>

      {/* CAN data */}
      {status.can_data && Object.keys(status.can_data).length > 0 && (
        <div>
          <div style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            fontWeight: 600,
            letterSpacing: '0.06em',
            marginBottom: 10,
          }}>
            DATOS CAN BUS
          </div>
          <div style={{
            background: 'var(--bg-elevated)',
            borderRadius: 8,
            border: '1px solid var(--bg-border)',
            overflow: 'hidden',
          }}>
            {Object.entries(status.can_data).map(([key, val], i) => (
              <div key={key} style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 16px',
                borderBottom: i < Object.keys(status.can_data!).length - 1
                  ? '1px solid var(--bg-border)' : 'none',
              }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>
                  {key}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-data)' }}>
                  {String(val)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Replace `frontend/src/features/vehicle/VehicleDetailPage.tsx`**

```tsx
import { useParams, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import VehicleHeader from './VehicleHeader'
import TrackMap from './TrackMap'
import StatusPanel from './StatusPanel'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleOut, VehicleStatus, TrackPoint } from '../../lib/types'

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>()
  if (!id) return <Navigate to="/fleet" replace />

  const { data: vehicle, isLoading: loadingVehicle, error: vehicleError } = useQuery({
    queryKey: keys.vehicle(id),
    queryFn: () => apiClient.get<VehicleOut>(`/api/v1/vehicles/${id}`),
  })

  const { data: status } = useQuery({
    queryKey: keys.vehicleStatus(id),
    queryFn: () => apiClient.get<VehicleStatus>(`/api/v1/vehicles/${id}/status`),
    refetchInterval: 15_000,
    enabled: !!vehicle,
  })

  const { data: track = [] } = useQuery({
    queryKey: keys.vehicleTrack(id),
    queryFn: () => apiClient.get<TrackPoint[]>(`/api/v1/vehicles/${id}/track/today`),
    staleTime: 60_000,
    enabled: !!vehicle,
  })

  if (loadingVehicle) {
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

  if (vehicleError || !vehicle) {
    return <Navigate to="/fleet" replace />
  }

  return (
    <Shell title={vehicle.name}>
      <div style={{ height: '100%', overflowY: 'auto' }}>
        <VehicleHeader vehicle={vehicle} status={status} />

        <div style={{
          padding: 24,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 24,
          maxWidth: 1200,
        }}>
          {/* Left: map */}
          <div>
            <div style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              fontWeight: 600,
              letterSpacing: '0.06em',
              marginBottom: 10,
            }}>
              RECORRIDO DE HOY
            </div>
            <TrackMap track={track} status={status} />
          </div>

          {/* Right: status */}
          <div>
            <div style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              fontWeight: 600,
              letterSpacing: '0.06em',
              marginBottom: 10,
            }}>
              ESTADO EN TIEMPO REAL
            </div>
            <StatusPanel status={status} />
          </div>
        </div>
      </div>
    </Shell>
  )
}
```

- [ ] **Step 5: Verify build**

```bash
cd /opt/cmg-telematic1/frontend
npm run build
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/vehicle/
git commit -m "feat: vehicle detail page — track map, status panel, CAN data"
```

---

### Task 10: Dockerfile + docker-compose

**Files:**
- Create: `frontend/nginx.conf`
- Create: `frontend/Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Create `frontend/nginx.conf`**

```nginx
server {
    listen 3000;
    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|svg|ico|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

- [ ] **Step 2: Create `frontend/Dockerfile`**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
```

- [ ] **Step 3: Read current `docker-compose.yml` then add frontend service**

Read `/opt/cmg-telematic1/docker-compose.yml` and add the following service after `caddy`:

```yaml
  frontend:
    build:
      context: ./frontend
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      core-api:
        condition: service_healthy
```

- [ ] **Step 4: Validate docker-compose syntax**

```bash
cd /opt/cmg-telematic1
docker compose config --quiet && echo "docker-compose OK"
```

Expected: `docker-compose OK`

- [ ] **Step 5: Build frontend Docker image**

```bash
cd /opt/cmg-telematic1
docker compose build frontend 2>&1 | tail -10
```

Expected: image builds successfully.

- [ ] **Step 6: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/nginx.conf frontend/Dockerfile docker-compose.yml
git commit -m "feat: frontend Docker image (nginx) + docker-compose service"
```

---

## Summary

Plan 3 delivers:

| Component | What it builds |
|-----------|---------------|
| Project scaffold | Vite 5 + React 18 + TypeScript strict + design tokens |
| Auth | JWT login, auto-refresh, route guards, brand token injection |
| Fleet page | Split view 35/65 — vehicle list with 30s polling + Leaflet map |
| Vehicle detail | Today's track polyline + 15s status polling + CAN data table |
| Shell | 56px icon sidebar + 48px topbar with tenant branding |
| Docker | nginx multi-stage build + docker-compose frontend service |

**Next plan:** Plan 4 — Frontend Sprint 6 (SVG gauges + WebSocket live telemetry + KPI Recharts charts + alerts page).
