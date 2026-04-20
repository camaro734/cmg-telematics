# Sprint 12 — White-label Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que `brand_color` del tenant se aplique como CSS variable `--accent-energy` en el DOM en tiempo real, con re-aplicación inmediata al guardar y reset al hacer logout.

**Architecture:** El bug está en `useAuthStore.applyBrandTokens` — itera buscando claves que empiecen por `--` pero las claves reales son `brand_color`, `logo_url`, `brand_name`, así que el color nunca se aplica. El fix añade mapeo explícito. `BrandTokensEditor` llama a `applyBrandTokens` en `onSuccess` si el tenant editado es el propio usuario. `Sidebar` reemplaza el naranja hardcodeado por `color-mix` derivado de `--accent-energy`.

**Tech Stack:** React 18 + Zustand + Vitest 2 + React Testing Library

---

## File Map

| Fichero | Acción |
|---------|--------|
| `frontend/src/features/auth/useAuthStore.ts` | Fix `applyBrandTokens` + reset CSS var en `logout` |
| `frontend/src/features/auth/useAuthStore.test.ts` | Crear — 5 tests para `applyBrandTokens` y logout |
| `frontend/src/features/clientes/BrandTokensEditor.tsx` | Importar `useAuthStore`; re-apply en `onSuccess` |
| `frontend/src/features/clientes/__tests__/BrandTokensEditor.test.tsx` | Añadir mock de `useAuthStore` y 2 tests de re-apply |
| `frontend/src/shared/ui/Sidebar.tsx` | Añadir `brandName` + tooltip + `color-mix` |

---

### Task 1: Fix `useAuthStore` — `applyBrandTokens` + logout CSS reset

**Files:**
- Modify: `frontend/src/features/auth/useAuthStore.ts`
- Create: `frontend/src/features/auth/useAuthStore.test.ts`

- [ ] **Step 1: Crear `useAuthStore.test.ts` con tests que fallan**

Crear `frontend/src/features/auth/useAuthStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAuthStore } from './useAuthStore'

beforeEach(() => {
  useAuthStore.setState({ accessToken: null, user: null, brandName: null, logoUrl: null })
  document.documentElement.style.removeProperty('--accent-energy')
})

describe('applyBrandTokens', () => {
  it('aplica brand_color válido como --accent-energy', () => {
    useAuthStore.getState().applyBrandTokens({ brand_color: '#3056D3' })
    expect(document.documentElement.style.getPropertyValue('--accent-energy')).toBe('#3056D3')
  })

  it('ignora brand_color con formato inválido', () => {
    const spy = vi.spyOn(document.documentElement.style, 'setProperty')
    useAuthStore.getState().applyBrandTokens({ brand_color: '#ZZZZZZ' })
    expect(spy).not.toHaveBeenCalledWith('--accent-energy', expect.anything())
  })

  it('guarda brand_name en el store', () => {
    useAuthStore.getState().applyBrandTokens({ brand_name: 'Wasterent' })
    expect(useAuthStore.getState().brandName).toBe('Wasterent')
  })

  it('guarda logo_url https en el store', () => {
    useAuthStore.getState().applyBrandTokens({ logo_url: 'https://cdn.example.com/logo.png' })
    expect(useAuthStore.getState().logoUrl).toBe('https://cdn.example.com/logo.png')
  })

  it('rechaza logo_url sin https', () => {
    useAuthStore.getState().applyBrandTokens({ logo_url: 'http://unsafe.com/logo.png' })
    expect(useAuthStore.getState().logoUrl).toBeNull()
  })
})

describe('logout', () => {
  it('elimina --accent-energy del DOM', () => {
    document.documentElement.style.setProperty('--accent-energy', '#3056D3')
    const spy = vi.spyOn(document.documentElement.style, 'removeProperty')
    vi.stubGlobal('location', { href: '' })
    useAuthStore.getState().logout()
    expect(spy).toHaveBeenCalledWith('--accent-energy')
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Ejecutar tests — verificar que fallan**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run src/features/auth/useAuthStore.test.ts 2>&1 | tail -20
```
Expected: FAIL en al menos los tests de `brand_color` y `logout` (la implementación actual nunca llama a `setProperty` para `--accent-energy` ni `removeProperty` en logout)

- [ ] **Step 3: Corregir `applyBrandTokens` en `useAuthStore.ts`**

Reemplazar el bloque `applyBrandTokens` (líneas 96–115):

```ts
  applyBrandTokens: (tokens) => {
    const root = document.documentElement
    if (tokens.brand_color && /^#[0-9a-fA-F]{6}$/.test(tokens.brand_color)) {
      root.style.setProperty('--accent-energy', tokens.brand_color)
    }
    const safeLogoUrl = tokens.logo_url?.startsWith('https://') ? tokens.logo_url : get().logoUrl
    set({
      brandName: tokens.brand_name ?? get().brandName,
      logoUrl: safeLogoUrl,
    })
  },
```

- [ ] **Step 4: Añadir reset CSS en `logout`**

Reemplazar el bloque `logout` (líneas 68–73):

```ts
  logout: () => {
    localStorage.removeItem(REFRESH_KEY)
    wsClient.disconnect()
    document.documentElement.style.removeProperty('--accent-energy')
    set({ accessToken: null, user: null, brandName: null, logoUrl: null })
    window.location.href = '/login'
  },
```

- [ ] **Step 5: Ejecutar tests — verificar que pasan**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run src/features/auth/useAuthStore.test.ts 2>&1 | tail -20
```
Expected: 6 PASS

- [ ] **Step 6: Commit**

```bash
cd /opt/cmg-telematic1 && git add frontend/src/features/auth/useAuthStore.ts frontend/src/features/auth/useAuthStore.test.ts && git commit -m "fix: applyBrandTokens mapea brand_color a --accent-energy + logout CSS reset"
```

---

### Task 2: BrandTokensEditor — re-apply al guardar

**Files:**
- Modify: `frontend/src/features/clientes/BrandTokensEditor.tsx`
- Modify: `frontend/src/features/clientes/__tests__/BrandTokensEditor.test.tsx`

- [ ] **Step 1: Reemplazar `BrandTokensEditor.test.tsx` con versión ampliada**

Reemplazar el contenido completo de `frontend/src/features/clientes/__tests__/BrandTokensEditor.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BrandTokensEditor from '../BrandTokensEditor'

vi.mock('../../../lib/apiClient', () => ({ apiClient: { get: vi.fn(), put: vi.fn() } }))

const mockApplyBrandTokens = vi.hoisted(() => vi.fn())

vi.mock('../../auth/useAuthStore', () => {
  const useAuthStore: any = vi.fn(() => ({ user: { tenant_id: 't1' } }))
  useAuthStore.getState = vi.fn(() => ({
    user: { tenant_id: 't1' },
    applyBrandTokens: mockApplyBrandTokens,
  }))
  return { useAuthStore }
})

import { apiClient } from '../../../lib/apiClient'

function wrap(tenantId = 't1') {
  vi.mocked(apiClient.get).mockResolvedValue({ brand_color: '#F97316', brand_name: 'Wasterent', logo_url: '' })
  vi.mocked(apiClient.put).mockResolvedValue({})
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BrandTokensEditor tenantId={tenantId} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => { mockApplyBrandTokens.mockClear() })

describe('BrandTokensEditor', () => {
  it('muestra nombre de marca en preview', async () => {
    wrap()
    expect(await screen.findByText('Wasterent')).toBeInTheDocument()
  })

  it('llama a PUT al guardar', async () => {
    wrap()
    fireEvent.click(await screen.findByText('Guardar'))
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      '/api/v1/tenants/t1/brand-tokens',
      expect.objectContaining({ brand_tokens: expect.objectContaining({ brand_color: expect.any(String) }) })
    ))
  })

  it('aplica brand tokens al guardar cuando tenantId es el propio tenant', async () => {
    wrap('t1')
    fireEvent.click(await screen.findByText('Guardar'))
    await waitFor(() => expect(mockApplyBrandTokens).toHaveBeenCalledWith(
      expect.objectContaining({ brand_color: expect.any(String) })
    ))
  })

  it('no aplica brand tokens al guardar cuando tenantId es de otro tenant', async () => {
    wrap('otro-tenant')
    fireEvent.click(await screen.findByText('Guardar'))
    await waitFor(() => expect(apiClient.put).toHaveBeenCalled())
    expect(mockApplyBrandTokens).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Ejecutar tests — verificar que los nuevos fallan**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run src/features/clientes/__tests__/BrandTokensEditor.test.tsx 2>&1 | tail -20
```
Expected: los 2 tests nuevos FAIL (BrandTokensEditor aún no importa `useAuthStore`)

- [ ] **Step 3: Actualizar `BrandTokensEditor.tsx`**

Reemplazar el contenido completo de `frontend/src/features/clientes/BrandTokensEditor.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import type { BrandTokens } from '../../lib/types'

interface Props { tenantId: string }

export default function BrandTokensEditor({ tenantId }: Props) {
  const qc = useQueryClient()

  const { data: tokens } = useQuery({
    queryKey: keys.tenantBrandTokens(tenantId),
    queryFn: () => apiClient.get<BrandTokens>(`/api/v1/tenants/${tenantId}/brand-tokens`),
  })

  const [brandColor, setBrandColor] = useState('#F97316')
  const [logoUrl, setLogoUrl] = useState('')
  const [brandName, setBrandName] = useState('')
  const [previewColor, setPreviewColor] = useState('#F97316')

  useEffect(() => {
    if (tokens) {
      setBrandColor(tokens.brand_color ?? '#F97316')
      setPreviewColor(tokens.brand_color ?? '#F97316')
      setLogoUrl(tokens.logo_url ?? '')
      setBrandName(tokens.brand_name ?? '')
    }
  }, [tokens])

  const mutation = useMutation({
    mutationFn: (payload: BrandTokens) =>
      apiClient.put(`/api/v1/tenants/${tenantId}/brand-tokens`, { brand_tokens: payload }),
    onSuccess: (_, payload) => {
      qc.invalidateQueries({ queryKey: keys.tenantBrandTokens(tenantId) })
      const { user, applyBrandTokens } = useAuthStore.getState()
      if (user?.tenant_id === tenantId) applyBrandTokens(payload)
    },
  })

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', background: 'var(--bg-elevated)',
    border: '1px solid var(--bg-border)', borderRadius: 6,
    color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box',
  }

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Nombre de marca</span>
          <input value={brandName} onChange={e => setBrandName(e.target.value)} style={inputStyle} />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Color de acento</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="color"
              value={brandColor}
              onChange={e => { setBrandColor(e.target.value); setPreviewColor(e.target.value) }}
              style={{ width: 36, height: 36, padding: 2, background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', borderRadius: 6, cursor: 'pointer' }}
            />
            <input
              value={brandColor}
              onChange={e => {
                setBrandColor(e.target.value)
                if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setPreviewColor(e.target.value)
              }}
              style={{ ...inputStyle, fontFamily: 'var(--font-data)', flex: 1 }}
            />
          </div>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>URL del logo</span>
          <input value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://..." style={inputStyle} />
        </label>

        <button
          onClick={() => mutation.mutate({ brand_color: brandColor, logo_url: logoUrl, brand_name: brandName })}
          disabled={mutation.isPending}
          style={{
            background: 'var(--accent-energy)', color: '#fff', border: 'none',
            borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 500,
            cursor: 'pointer', alignSelf: 'flex-start',
          }}
        >
          {mutation.isPending ? 'Guardando...' : 'Guardar'}
        </button>
        {mutation.isSuccess && <p style={{ color: 'var(--accent-ok)', fontSize: 12, margin: 0 }}>Guardado</p>}
      </div>

      <div style={{ width: 180 }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '0 0 8px' }}>Preview</p>
        <div style={{ background: 'var(--bg-surface)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bg-border)' }}>
          <div style={{ background: 'var(--bg-elevated)', padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--bg-border)' }}>
            {logoUrl
              ? <img src={logoUrl} alt="logo" style={{ width: 18, height: 18, objectFit: 'contain' }} />
              : <div style={{ width: 18, height: 18, borderRadius: 4, background: previewColor }} />
            }
            <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 600 }}>
              {brandName || 'Marca'}
            </span>
          </div>
          {['Flota', 'Alertas', 'Ajustes'].map(label => (
            <div key={label} style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
          ))}
          <div style={{ padding: '6px 10px', fontSize: 11, color: previewColor, background: `${previewColor}22` }}>
            Página activa
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Ejecutar tests — verificar que pasan todos**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run src/features/clientes/__tests__/BrandTokensEditor.test.tsx 2>&1 | tail -20
```
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
cd /opt/cmg-telematic1 && git add frontend/src/features/clientes/BrandTokensEditor.tsx frontend/src/features/clientes/__tests__/BrandTokensEditor.test.tsx && git commit -m "feat: re-apply brand tokens on save para el propio tenant"
```

---

### Task 3: Sidebar — tooltip + color activo con color-mix

**Files:**
- Modify: `frontend/src/shared/ui/Sidebar.tsx`

- [ ] **Step 1: Añadir `brandName` al destructuring (línea 14)**

Reemplazar:
```ts
const { logoUrl, user } = useAuthStore()
```
Por:
```ts
const { logoUrl, brandName, user } = useAuthStore()
```

- [ ] **Step 2: Añadir `title` al div del logo (líneas 32–36)**

Reemplazar:
```tsx
      <div style={{ marginBottom: 16 }}>
        {logoUrl
          ? <img src={logoUrl} alt="logo" style={{ width: 30, height: 30, objectFit: 'contain' }}/>
          : <CmgMark size={30}/>
        }
      </div>
```
Por:
```tsx
      <div style={{ marginBottom: 16 }} title={brandName ?? 'CMG Telematic'}>
        {logoUrl
          ? <img src={logoUrl} alt="logo" style={{ width: 30, height: 30, objectFit: 'contain' }}/>
          : <CmgMark size={30}/>
        }
      </div>
```

- [ ] **Step 3: Reemplazar `rgba(249,115,22,0.15)` por `color-mix` en los tres NavLink**

Hay exactamente 3 ocurrencias de `rgba(249,115,22,0.15)` en el fichero (en el `map` de NAV_ITEMS, en el NavLink de Clientes, y en el NavLink de Ajustes). Reemplazar las tres por `color-mix(in srgb, var(--accent-energy) 15%, transparent)`.

El patrón a reemplazar en cada `style` de NavLink activo es:
```ts
background: isActive ? 'rgba(249,115,22,0.15)' : 'transparent',
```
Sustituir por:
```ts
background: isActive ? 'color-mix(in srgb, var(--accent-energy) 15%, transparent)' : 'transparent',
```

- [ ] **Step 4: Ejecutar la suite completa de frontend**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run 2>&1 | tail -15
```
Expected: todos los tests pasan (122 existentes + 6 nuevos = 128 total)

- [ ] **Step 5: Commit**

```bash
cd /opt/cmg-telematic1 && git add frontend/src/shared/ui/Sidebar.tsx && git commit -m "feat: sidebar tooltip brand_name + color activo dinámico con color-mix"
```

---

### Task 4: Verificación final y handoff

**Files:**
- Modify: `docs/handoff.md`

- [ ] **Step 1: Ejecutar suite completa backend + frontend**

```bash
cd /opt/cmg-telematic1 && python -m pytest tests/ -q 2>&1 | tail -5
cd /opt/cmg-telematic1/frontend && npx vitest run 2>&1 | tail -5
```
Expected: 82 backend PASS, 128 frontend PASS, 0 failures

- [ ] **Step 2: Actualizar `docs/handoff.md`**

En la tabla "Lo que está construido", actualizar la fila de Gestión clientes:
```markdown
| **Gestión clientes (multi-tenant)** | ✅ | CRUD tenants, usuarios, vehículos, grants, white-label runtime (Sprints 11–12) |
```

Reemplazar la sección "Último sprint completado" por:

```markdown
## Último sprint completado: Sprint 12 — White-label Runtime

### Qué se hizo

- `useAuthStore.applyBrandTokens` — fix: mapeaba claves `--` inexistentes; ahora aplica `brand_color` → `--accent-energy` en `document.documentElement`
- `useAuthStore.logout` — añadido `removeProperty('--accent-energy')` para limpiar el CSS var al salir
- `BrandTokensEditor` — llama a `applyBrandTokens` en `onSuccess` si el tenant editado es el propio tenant del usuario
- `Sidebar` — tooltip con `brand_name` en el logo; color activo usa `color-mix(in srgb, var(--accent-energy) 15%, transparent)` en lugar de naranja hardcodeado
- Tests: `useAuthStore.test.ts` (nuevo, 6 tests); `BrandTokensEditor.test.tsx` (ampliado, +2 tests)

**Tests:** 82 backend + 128 frontend = 210 pasando
```

Actualizar también la línea de estado al inicio del handoff:
```markdown
**Tests:** 82 backend + 128 frontend = 210 pasando. Build de producción limpio.
```
Y los sprints sugeridos: marcar Sprint 12 como ✅ completado en la tabla superior, y eliminar Sprint 12 de la lista "Próximos sprints sugeridos".

- [ ] **Step 3: Commit handoff**

```bash
cd /opt/cmg-telematic1 && git add docs/handoff.md && git commit -m "docs: handoff actualizado — Sprint 12 completado, white-label runtime activo"
```
