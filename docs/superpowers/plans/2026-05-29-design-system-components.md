# Design System Components A–D — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar los 4 bloques del design system: átomos base (Chip, Sparkline, Button variantes), Sidebar expandida, Topbar KPIs en vivo, y Fleet "sala de control" con paneles overlay.

**Architecture:** Bloque A crea componentes atómicos exportables usados por B, C y D. Bloque B convierte la Sidebar icon-only en expandible (labels + search + footer) activando `--sidebar-w: 64px`. Bloque C añade chips de KPI en tiempo real al TopNav. Bloque D añade paneles overlay sobre el mapa de flota con auto-colapso de sidebar.

**Tech Stack:** React 18 + Vite + TypeScript, CSS custom properties, React Query, Zustand, Leaflet. Producción activa — NO ejecutar docker, alembic ni git push sin confirmación.

**Contexto clave del codebase:**
- `frontend/src/shared/ui/Shell.tsx` renderiza `<TopNav />` (horizontal). La nav principal está en TopNav, no en Sidebar.
- `frontend/src/shared/ui/Sidebar.tsx` existe pero con `--sidebar-w: 0px` (invisible). Tiene los iconos de nav.
- `frontend/src/shared/ui/TopNav.tsx` es la nav horizontal con dropdowns, usada en Shell.
- `frontend/src/shared/ui/Topbar.tsx` es un header simple (título + email + logout), usado en algunas feature pages, NO en Shell.
- `frontend/src/features/auth/useAuthStore.ts` expone `user`, `brandName`, `logoUrl`, `logout`.
- `frontend/src/features/fleet/FleetDashboard.tsx` tiene el mapa Leaflet principal.

---

## Mapa de archivos

| Archivo | Acción |
|---|---|
| `frontend/src/shared/ui/Chip.tsx` | **Crear** |
| `frontend/src/shared/ui/Sparkline.tsx` | **Crear** |
| `frontend/src/shared/ui/Button.tsx` | **Modificar** — variantes secondary/teal, tamaño lg, hover |
| `frontend/src/shared/ui/Sidebar.tsx` | **Modificar** — expand/collapse, labels, search, footer |
| `frontend/src/shared/ui/Shell.tsx` | **Modificar** — renderizar Sidebar, marginLeft |
| `frontend/src/styles/tokens.css` | **Modificar** — `--sidebar-w: 64px` + mobile override |
| `frontend/src/shared/ui/TopNav.tsx` | **Modificar** — chips KPI + dot WS |
| `frontend/src/features/fleet/VehicleListPanel.tsx` | **Crear** |
| `frontend/src/features/fleet/VehicleDetailPanel.tsx` | **Crear** |
| `frontend/src/features/fleet/FleetDashboard.tsx` | **Modificar** — auto-collapse + wiring paneles |

---

## Tarea 1: Chip — componente atómico exportable

**Files:**
- Create: `frontend/src/shared/ui/Chip.tsx`
- Create: `frontend/src/shared/ui/__tests__/Chip.test.tsx`

- [ ] **Paso 1: Escribir el test**

```tsx
// frontend/src/shared/ui/__tests__/Chip.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Chip } from '../Chip'

describe('Chip', () => {
  it('renders children', () => {
    render(<Chip>12 en línea</Chip>)
    expect(screen.getByText('12 en línea')).toBeTruthy()
  })
  it('renders dot when dot=true', () => {
    const { container } = render(<Chip dot color="#22C55E">Online</Chip>)
    // el dot es un span sin texto dentro del chip
    const spans = container.querySelectorAll('span')
    expect(spans.length).toBeGreaterThan(1)
  })
  it('applies soft background when soft=true', () => {
    const { container } = render(<Chip soft color="#1D9E75">teal</Chip>)
    const chip = container.firstChild as HTMLElement
    // soft → background contiene el color con opacidad (22 en hex)
    expect(chip.style.background).toContain('1D9E75')
  })
})
```

- [ ] **Paso 2: Ejecutar el test y verificar que falla**

```bash
cd /opt/cmg-telematic1/frontend && npm run test -- --run src/shared/ui/__tests__/Chip.test.tsx 2>&1 | tail -15
```
Resultado esperado: FAIL con "Cannot find module '../Chip'"

- [ ] **Paso 3: Crear Chip.tsx**

```tsx
// frontend/src/shared/ui/Chip.tsx
import { useId } from 'react'

interface ChipProps {
  children: React.ReactNode
  color?: string
  soft?: boolean
  dot?: boolean
  size?: 'sm' | 'md'
  onClick?: () => void
}

export function Chip({
  children,
  color = 'var(--fg-tertiary)',
  soft,
  dot,
  size = 'md',
  onClick,
}: ChipProps) {
  const padding = size === 'sm' ? '2px 7px' : '3px 9px'
  const fontSize = size === 'sm' ? 10 : 11
  const bg = soft ? `${color}22` : 'rgba(255,255,255,0.04)'
  const border = soft ? `1px solid ${color}44` : '1px solid var(--border)'

  return (
    <span
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding, fontSize, fontWeight: 600, borderRadius: 9999,
        color, background: bg, border,
        cursor: onClick ? 'pointer' : 'default',
        whiteSpace: 'nowrap', userSelect: 'none',
        lineHeight: 1.4,
      }}
    >
      {dot && (
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: color, flexShrink: 0, display: 'inline-block',
        }} />
      )}
      {children}
    </span>
  )
}
```

- [ ] **Paso 4: Ejecutar el test y verificar que pasa**

```bash
cd /opt/cmg-telematic1/frontend && npm run test -- --run src/shared/ui/__tests__/Chip.test.tsx 2>&1 | tail -10
```
Resultado esperado: PASS (3 tests)

- [ ] **Paso 5: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/shared/ui/Chip.tsx frontend/src/shared/ui/__tests__/Chip.test.tsx
git commit -m "feat(ui): add Chip component

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 2: Sparkline — gráfico SVG de tendencia

**Files:**
- Create: `frontend/src/shared/ui/Sparkline.tsx`
- Create: `frontend/src/shared/ui/__tests__/Sparkline.test.tsx`

- [ ] **Paso 1: Escribir el test**

```tsx
// frontend/src/shared/ui/__tests__/Sparkline.test.tsx
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Sparkline } from '../Sparkline'

describe('Sparkline', () => {
  it('returns null when fewer than 2 values', () => {
    const { container } = render(<Sparkline values={[42]} />)
    expect(container.firstChild).toBeNull()
  })
  it('returns null for empty array', () => {
    const { container } = render(<Sparkline values={[]} />)
    expect(container.firstChild).toBeNull()
  })
  it('renders SVG with polyline when given 2+ values', () => {
    const { container } = render(<Sparkline values={[10, 20, 15, 30]} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    const polyline = svg!.querySelector('polyline')
    expect(polyline).toBeTruthy()
  })
  it('uses default dimensions w=72 h=24', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('72')
    expect(svg.getAttribute('height')).toBe('24')
  })
})
```

- [ ] **Paso 2: Ejecutar el test y verificar que falla**

```bash
cd /opt/cmg-telematic1/frontend && npm run test -- --run src/shared/ui/__tests__/Sparkline.test.tsx 2>&1 | tail -10
```
Resultado esperado: FAIL con "Cannot find module '../Sparkline'"

- [ ] **Paso 3: Crear Sparkline.tsx**

```tsx
// frontend/src/shared/ui/Sparkline.tsx
import { useId } from 'react'

interface SparklineProps {
  values: number[]
  w?: number
  h?: number
  color?: string
}

export function Sparkline({ values, w = 72, h = 24, color = 'var(--cmg-teal)' }: SparklineProps) {
  const uid = useId()
  const gradId = `sg-${uid.replace(/:/g, '')}`

  if (!values || values.length < 2) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pad = 2
  const iw = w - pad * 2
  const ih = h - pad * 2

  const pts = values.map((v, i) => [
    pad + (i / (values.length - 1)) * iw,
    pad + ih - ((v - min) / range) * ih,
  ] as [number, number])

  const polylineStr = pts.map(([x, y]) => `${x},${y}`).join(' ')
  const fillStr = `${pad},${pad + ih} ${polylineStr} ${pad + iw},${pad + ih}`

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ overflow: 'visible', display: 'block' }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon fill={`url(#${gradId})`} points={fillStr} />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={polylineStr}
      />
    </svg>
  )
}
```

- [ ] **Paso 4: Ejecutar el test y verificar que pasa**

```bash
cd /opt/cmg-telematic1/frontend && npm run test -- --run src/shared/ui/__tests__/Sparkline.test.tsx 2>&1 | tail -10
```
Resultado esperado: PASS (4 tests)

- [ ] **Paso 5: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/shared/ui/Sparkline.tsx frontend/src/shared/ui/__tests__/Sparkline.test.tsx
git commit -m "feat(ui): add Sparkline SVG component

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 3: Button — variantes secondary/teal, tamaño lg, efecto press/hover

**Files:**
- Modify: `frontend/src/shared/ui/Button.tsx`

- [ ] **Paso 1: Leer el archivo actual**

```bash
cat /opt/cmg-telematic1/frontend/src/shared/ui/Button.tsx
```

El archivo actual tiene: variantes `primary`, `danger`, `ghost`; tamaños `sm` y `md`. Necesitamos añadir `secondary`, `teal`, tamaño `lg` y efectos hover/press.

- [ ] **Paso 2: Reemplazar Button.tsx con la versión completa**

```tsx
// frontend/src/shared/ui/Button.tsx
import React from 'react'

interface ButtonProps {
  children: React.ReactNode
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'teal'
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
  leftIcon?: React.ReactNode
  full?: boolean
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
  size = 'md',
  leftIcon,
  full,
}: ButtonProps) {
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600, fontFamily: 'var(--font-sans)',
    transition: 'opacity 0.15s, background 0.15s',
    opacity: disabled ? 0.5 : 1,
    width: full ? '100%' : undefined,
    ...(size === 'sm'  ? { padding: '6px 14px',  fontSize: 12, borderRadius: 6,  gap: 6 } : {}),
    ...(size === 'md'  ? { padding: '9px 20px',   fontSize: 14, borderRadius: 8,  gap: 8 } : {}),
    ...(size === 'lg'  ? { padding: '12px 18px',  fontSize: 14, borderRadius: 10, gap: 8 } : {}),
  }

  const variants: Record<string, React.CSSProperties> = {
    primary:   { background: 'var(--cmg-teal)',      color: '#fff',                border: '1px solid transparent' },
    secondary: { background: 'rgba(255,255,255,0.05)', color: 'var(--fg-tertiary)', border: '1px solid var(--border)' },
    danger:    { background: 'var(--danger)',         color: '#fff',                border: '1px solid transparent' },
    ghost:     { background: 'transparent',           color: 'var(--fg-muted)',     border: '1px solid transparent' },
    teal:      { background: 'var(--cmg-teal-soft)',  color: 'var(--cmg-teal)',     border: '1px solid var(--cmg-teal-line)' },
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={e => {
        if (disabled) return
        if (variant === 'primary') e.currentTarget.style.background = 'var(--cmg-teal-hover)'
      }}
      onMouseLeave={e => {
        if (disabled) return
        if (variant === 'primary') e.currentTarget.style.background = 'var(--cmg-teal)'
      }}
      onMouseDown={e => { if (!disabled) e.currentTarget.style.filter = 'brightness(0.92)' }}
      onMouseUp={e => { e.currentTarget.style.filter = '' }}
      style={{ ...base, ...variants[variant] }}
    >
      {leftIcon}{children}
    </button>
  )
}
```

- [ ] **Paso 3: Build y tests**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -5
npm run test -- --run 2>&1 | tail -10
```
Resultado esperado: build ✓, todos los tests pasan.

- [ ] **Paso 4: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/shared/ui/Button.tsx
git commit -m "feat(ui): add Button variants secondary/teal, size lg, press/hover effects

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 4: tokens.css — activar sidebar-w y transición

**Files:**
- Modify: `frontend/src/styles/tokens.css`

- [ ] **Paso 1: Cambiar --sidebar-w de 0px a 64px y añadir mobile override**

En `frontend/src/styles/tokens.css`, en la sección `/* ---------- Layout ---------- */`, cambiar:
```css
  --sidebar-w: 0px;
```
Por:
```css
  --sidebar-w: 64px;
```

Al final del archivo, ANTES del cierre del último bloque o al final, añadir:
```css
/* ── Mobile: sidebar oculta ───────────────────────────────────────────── */
@media (max-width: 767px) {
  :root { --sidebar-w: 0px; }
}
```

- [ ] **Paso 2: Build para verificar que no rompe nada**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -5
```
Resultado esperado: ✓ built in sin errores.

- [ ] **Paso 3: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/styles/tokens.css
git commit -m "style(tokens): set --sidebar-w to 64px, hide on mobile

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 5: Sidebar — expandida con labels, search y footer de usuario

**Files:**
- Modify: `frontend/src/shared/ui/Sidebar.tsx`

- [ ] **Paso 1: Leer Sidebar.tsx completo**

```bash
cat /opt/cmg-telematic1/frontend/src/shared/ui/Sidebar.tsx
```

- [ ] **Paso 2: Reemplazar Sidebar.tsx con la versión expandible**

El nuevo Sidebar.tsx completo (reemplaza todo el contenido actual):

```tsx
// frontend/src/shared/ui/Sidebar.tsx
import { useState, useEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../features/auth/useAuthStore'
import { CmgMark } from './CmgLogo'
import { Chip } from './Chip'
import {
  IconFlota, IconAlertas, IconReglas, IconMantenimiento, IconAjustes,
  IconClientes, IconReportes, IconDispositivos, IconCanScanner,
  IconVehiculos, IconConductores, IconOrdenes,
} from './icons'
import { apiClient } from '../../lib/apiClient'

const STORAGE_KEY = 'cmg_sidebar_expanded'

function useActiveAlertCount() {
  const { data } = useQuery({
    queryKey: ['alerts', 'active-count'],
    queryFn: async () => {
      const [firing, escalated] = await Promise.all([
        apiClient.get<unknown[]>('/api/v1/alerts?status=firing&limit=200'),
        apiClient.get<unknown[]>('/api/v1/alerts?status=escalated&limit=200'),
      ])
      return (firing?.length ?? 0) + (escalated?.length ?? 0)
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  })
  return data ?? 0
}

const ROLE_COLORS: Record<string, string> = {
  admin:    'var(--role-admin)',
  operator: 'var(--role-operator)',
  viewer:   'var(--role-viewer)',
  driver:   'var(--role-driver)',
}

interface NavSection {
  label: string
  items: { to: string; Icon: React.FC<{ width: number; height: number }>; label: string; badge?: number; condition?: boolean }[]
}

export default function Sidebar() {
  const { logoUrl, brandName, user, logout } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const isCmg = user?.tenant_tier === 'cmg'
  const alertCount = useActiveAlertCount()
  const [search, setSearch] = useState('')

  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(STORAGE_KEY) === 'true'
  )

  // Sync --sidebar-w CSS variable when expanded changes
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', expanded ? '240px' : '64px')
  }, [expanded])

  // Listen for external changes (e.g. FleetDashboard auto-collapse)
  useEffect(() => {
    const handler = () => {
      setExpanded(localStorage.getItem(STORAGE_KEY) === 'true')
    }
    window.addEventListener('cmg_sidebar_change', handler)
    return () => window.removeEventListener('cmg_sidebar_change', handler)
  }, [])

  const toggle = () => {
    const next = !expanded
    localStorage.setItem(STORAGE_KEY, String(next))
    setExpanded(next)
    if (next) setSearch('')
  }

  const sections: NavSection[] = [
    {
      label: 'Monitorización',
      items: [
        { to: '/fleet',       Icon: IconFlota,        label: 'Flota',        condition: true },
        { to: '/alerts',      Icon: IconAlertas,       label: 'Alertas',      badge: alertCount || undefined, condition: true },
        { to: '/maintenance', Icon: IconMantenimiento, label: 'Mantenimiento', condition: true },
        { to: '/rules',       Icon: IconReglas,        label: 'Reglas',       condition: isAdmin },
        { to: '/reports',     Icon: IconReportes,      label: 'Reportes',     condition: isAdmin },
      ],
    },
    {
      label: 'Operaciones',
      items: [
        { to: '/work-orders', Icon: IconOrdenes,     label: 'Órdenes de trabajo', condition: isAdmin || user?.role === 'operator' },
        { to: '/drivers',     Icon: IconConductores, label: 'Conductores',        condition: isAdmin || user?.role === 'operator' },
      ],
    },
    ...(isCmg ? [{
      label: 'Administración',
      items: [
        { to: '/clientes',      Icon: IconClientes,    label: 'Clientes',    condition: true },
        { to: '/vehiculos',     Icon: IconVehiculos,   label: 'Vehículos',   condition: isAdmin },
        { to: '/tipos-vehiculo',Icon: IconVehiculos,   label: 'Plantillas',  condition: isAdmin },
        { to: '/devices',       Icon: IconDispositivos,label: 'Dispositivos',condition: true },
        { to: '/can-scanner',   Icon: IconCanScanner,  label: 'CAN Scanner', condition: true },
        { to: '/settings',      Icon: IconAjustes,     label: 'Ajustes',     condition: isAdmin },
      ],
    }] : [{
      label: 'Configuración',
      items: [
        { to: '/settings', Icon: IconAjustes, label: 'Ajustes', condition: isAdmin },
      ],
    }]),
  ]

  const allItems = sections.flatMap(s => s.items)
  const filtered = search.trim()
    ? allItems.filter(i => i.condition && i.label.toLowerCase().includes(search.toLowerCase()))
    : null

  const initials = (user?.name ?? user?.email ?? 'U')
    .split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)

  return (
    <nav style={{
      position: 'fixed',
      top: 0, left: 0, bottom: 0,
      width: 'var(--sidebar-w)',
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 100,
      overflow: 'hidden',
      transition: 'width 200ms cubic-bezier(0.4, 0, 0.2, 1)',
    }}>
      {/* Logo */}
      <div style={{
        height: 'var(--topbar-h)',
        display: 'flex', alignItems: 'center',
        padding: expanded ? '0 16px' : '0',
        justifyContent: expanded ? 'flex-start' : 'center',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0, gap: 10,
      }}>
        {logoUrl
          ? <img src={logoUrl} alt="logo" style={{ width: 30, height: 30, objectFit: 'contain' }} />
          : <CmgMark size={30} />
        }
        {expanded && (
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {brandName ?? 'CMG Track'}
          </span>
        )}
      </div>

      {/* Search — solo en expanded */}
      {expanded && (
        <div style={{ padding: '10px 12px 6px', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="var(--fg-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar..."
              style={{
                width: '100%', padding: '6px 10px 6px 30px',
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)', color: 'var(--fg-secondary)',
                fontSize: 12, fontFamily: 'var(--font-sans)', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>
      )}

      {/* Nav items */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 0' }}>
        {filtered ? (
          // Search results — flat list
          <div style={{ padding: '0 8px' }}>
            {filtered.map(item => (
              <SidebarItem key={item.to} item={item} expanded={expanded} />
            ))}
            {filtered.length === 0 && (
              <p style={{ fontSize: 11, color: 'var(--fg-dim)', padding: '8px 6px' }}>Sin resultados</p>
            )}
          </div>
        ) : (
          // Normal sections
          sections.map(section => {
            const visible = section.items.filter(i => i.condition)
            if (visible.length === 0) return null
            return (
              <div key={section.label} style={{ marginBottom: 8 }}>
                {expanded && (
                  <p style={{
                    fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.07em',
                    padding: '8px 20px 4px', margin: 0,
                  }}>
                    {section.label}
                  </p>
                )}
                <div style={{ padding: '0 8px' }}>
                  {visible.map(item => (
                    <SidebarItem key={item.to} item={item} expanded={expanded} />
                  ))}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Toggle expand/collapse */}
      <div style={{ borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <button
          onClick={toggle}
          title={expanded ? 'Colapsar menú' : 'Expandir menú'}
          style={{
            width: '100%', height: 40,
            display: 'flex', alignItems: 'center',
            justifyContent: expanded ? 'flex-end' : 'center',
            padding: expanded ? '0 16px' : '0',
            background: 'transparent', border: 'none',
            color: 'var(--fg-dim)', cursor: 'pointer',
            fontSize: 16, transition: 'color 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-tertiary)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-dim)' }}
        >
          {expanded ? '‹' : '›'}
        </button>

        {/* User footer */}
        <div style={{
          padding: expanded ? '10px 12px' : '10px 0',
          borderTop: '1px solid var(--border-soft)',
          display: 'flex', alignItems: 'center',
          gap: 10, justifyContent: expanded ? 'flex-start' : 'center',
        }}>
          {/* Avatar */}
          <div style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            background: 'var(--cmg-teal-soft)', color: 'var(--cmg-teal)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700,
          }}>
            {initials}
          </div>

          {expanded && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                fontSize: 12, fontWeight: 500, color: 'var(--fg-secondary)',
                margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {user?.name ?? user?.email}
              </p>
              <Chip color={ROLE_COLORS[user?.role ?? 'viewer'] ?? 'var(--fg-dim)'} soft size="sm">
                {user?.role ?? 'viewer'}
              </Chip>
            </div>
          )}

          {expanded && (
            <button
              onClick={logout}
              title="Cerrar sesión"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--fg-dim)', padding: 4, flexShrink: 0,
                display: 'flex', alignItems: 'center',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--danger)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-dim)' }}
            >
              {/* Lucide LogOut icon */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </nav>
  )
}

// ── SidebarItem helper ────────────────────────────────────────────────────────

interface NavItem {
  to: string
  Icon: React.FC<{ width: number; height: number }>
  label: string
  badge?: number
}

function SidebarItem({ item, expanded }: { item: NavItem; expanded: boolean }) {
  return (
    <NavLink
      to={item.to}
      title={!expanded ? item.label : undefined}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center',
        gap: 12, padding: '8px 12px',
        borderRadius: 8, fontSize: 13, fontWeight: 500,
        color: isActive ? 'var(--cmg-teal)' : 'var(--fg-tertiary)',
        background: isActive ? 'var(--cmg-teal-soft)' : 'transparent',
        textDecoration: 'none', marginBottom: 2,
        transition: 'background 0.15s, color 0.15s',
        whiteSpace: 'nowrap', overflow: 'hidden',
        justifyContent: expanded ? 'flex-start' : 'center',
      })}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLAnchorElement
        if (!el.getAttribute('aria-current')) {
          el.style.background = 'var(--bg-hover)'
          el.style.color = 'var(--fg-primary)'
        }
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLAnchorElement
        if (!el.getAttribute('aria-current')) {
          el.style.background = 'transparent'
          el.style.color = 'var(--fg-tertiary)'
        }
      }}
    >
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <item.Icon width={20} height={20} />
        {item.badge != null && item.badge > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -8,
            background: 'var(--danger)', color: '#fff',
            borderRadius: 99, fontSize: 9, fontWeight: 700,
            lineHeight: 1, padding: '2px 4px',
            minWidth: 14, textAlign: 'center',
          }}>
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        )}
      </div>
      {expanded && (
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.label}
        </span>
      )}
    </NavLink>
  )
}
```

- [ ] **Paso 3: Build y verificar**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -10
```
Resultado esperado: ✓ built in sin errores ni warnings de TypeScript.

- [ ] **Paso 4: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/shared/ui/Sidebar.tsx
git commit -m "feat(sidebar): expandable sidebar with labels, search and user footer

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 6: Shell — renderizar Sidebar y ajustar layout

**Files:**
- Modify: `frontend/src/shared/ui/Shell.tsx`

- [ ] **Paso 1: Leer Shell.tsx**

```bash
cat /opt/cmg-telematic1/frontend/src/shared/ui/Shell.tsx
```

- [ ] **Paso 2: Reemplazar Shell.tsx**

```tsx
// frontend/src/shared/ui/Shell.tsx
import { useEffect } from 'react'
import TopNav from './TopNav'
import Sidebar from './Sidebar'
import { useIsMobile } from '../../lib/useIsMobile'

interface ShellProps {
  title?: string
  children: React.ReactNode
}

const BRAND = 'CMG Track'

export default function Shell({ title, children }: ShellProps) {
  const isMobile = useIsMobile()

  useEffect(() => {
    document.title = title ? `${title} — ${BRAND}` : BRAND
    return () => { document.title = BRAND }
  }, [title])

  return (
    <>
      {!isMobile && <Sidebar />}
      <TopNav />
      <main style={{
        marginTop: 'var(--topbar-h)',
        marginLeft: isMobile ? 0 : 'var(--sidebar-w)',
        height: 'calc(100vh - var(--topbar-h))',
        overflow: isMobile ? 'auto' : 'hidden',
        overflowX: 'hidden',
        transition: 'margin-left 200ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        {children}
      </main>
    </>
  )
}
```

- [ ] **Paso 3: Build y tests**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -8
npm run test -- --run 2>&1 | tail -10
```
Resultado esperado: build ✓, tests pasan.

- [ ] **Paso 4: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/shared/ui/Shell.tsx
git commit -m "feat(shell): render Sidebar on desktop, marginLeft sync with sidebar-w

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 7: TopNav — chips de KPI en vivo e indicador WebSocket

**Files:**
- Modify: `frontend/src/shared/ui/TopNav.tsx`

- [ ] **Paso 1: Leer los imports y la parte relevante del TopNav**

```bash
head -100 /opt/cmg-telematic1/frontend/src/shared/ui/TopNav.tsx
grep -n "wsClient\|wsConnected\|VehicleStatus\|useVehicleStatus\|statuses\|online\|moving" /opt/cmg-telematic1/frontend/src/shared/ui/TopNav.tsx | head -20
grep -n "wsClient\|isConnected\|connected" /opt/cmg-telematic1/frontend/src/lib/wsClient.ts 2>/dev/null | head -10
grep -rn "useVehicleStatuses\|statuses" /opt/cmg-telematic1/frontend/src/features/fleet/FleetDashboard.tsx | head -10
```

- [ ] **Paso 2: Añadir imports de Chip y wsClient al TopNav**

Leer las primeras líneas del archivo para identificar la línea exacta de imports y añadir después de los imports existentes:

```tsx
import { Chip } from './Chip'
import { wsClient } from '../../lib/wsClient'
import { useVehicleStatuses } from '../../features/fleet/useVehicleStatuses'
```

Si `useVehicleStatuses` no existe como hook independiente, buscar el hook/query existente que devuelve los statuses de vehículos y usar ese. Buscar con:
```bash
grep -rn "export.*useVehicle\|statuses\b" /opt/cmg-telematic1/frontend/src/features/fleet/ | head -20
```

- [ ] **Paso 3: Añadir hook de KPIs dentro del componente TopNav**

Dentro del componente principal de TopNav (buscar `export default function TopNav` o `export function TopNav`), añadir antes del return:

```tsx
// KPIs en vivo — derivados de los statuses ya en caché
const { data: statuses } = useQuery({
  queryKey: ['vehicles', 'statuses-brief'],
  queryFn: () => apiClient.get<{ id: string; online: boolean; moving?: boolean }[]>(
    '/api/v1/vehicles/statuses'
  ),
  refetchInterval: 30_000,
  staleTime: 25_000,
})
const onlineCount  = statuses?.filter(s => s.online).length ?? 0
const movingCount  = statuses?.filter(s => s.online && s.moving).length ?? 0
const [wsConnected, setWsConnected] = useState(false)

useEffect(() => {
  const unsub = wsClient.onConnectionChange?.((connected: boolean) => setWsConnected(connected))
  setWsConnected(wsClient.isConnected?.() ?? false)
  return () => unsub?.()
}, [])
```

Nota: si `wsClient` no expone `isConnected` o `onConnectionChange`, simplificarlo así (sin WS status):
```tsx
const wsConnected = true // fallback — no rompe nada
```

- [ ] **Paso 4: Añadir chips de KPI en el JSX del TopNav**

En el JSX de TopNav, localizar el área entre el título/logo y los controles de usuario/logout. Añadir antes de los controles de usuario:

```tsx
{/* KPI chips — solo desktop */}
<div className="hide-mobile" style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 }}>
  {onlineCount > 0 && (
    <Chip color="var(--ok)" soft dot size="sm">{onlineCount} en línea</Chip>
  )}
  {movingCount > 0 && (
    <Chip color="var(--cmg-teal)" soft dot size="sm">{movingCount} en mov.</Chip>
  )}
  {alertCount > 0 && (
    <Chip color="var(--danger)" soft dot size="sm">{alertCount} alertas</Chip>
  )}
  {/* WS indicator */}
  <div
    title={wsConnected ? 'Tiempo real activo' : 'Reconectando...'}
    style={{ display: 'flex', alignItems: 'center' }}
  >
    <span
      className={wsConnected ? 'live-dot' : undefined}
      style={{
        width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
        background: wsConnected ? 'var(--ok)' : 'var(--offline)',
      }}
    />
  </div>
</div>
```

Para `alertCount`, añadir el mismo hook que ya existe en Sidebar.tsx. Dentro del componente TopNav, añadir:

```tsx
const { data: alertCountData } = useQuery({
  queryKey: ['alerts', 'active-count'],
  queryFn: async () => {
    const [firing, escalated] = await Promise.all([
      apiClient.get<unknown[]>('/api/v1/alerts?status=firing&limit=200'),
      apiClient.get<unknown[]>('/api/v1/alerts?status=escalated&limit=200'),
    ])
    return (firing?.length ?? 0) + (escalated?.length ?? 0)
  },
  refetchInterval: 30_000, staleTime: 25_000,
})
const alertCount = alertCountData ?? 0
```
Verificar que `apiClient` ya está importado en TopNav (sí lo está, según el código existente).

- [ ] **Paso 5: Build y tests**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -10
npm run test -- --run 2>&1 | tail -10
```
Resultado esperado: build ✓, todos los tests pasan.

- [ ] **Paso 6: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/shared/ui/TopNav.tsx
git commit -m "feat(topnav): add live KPI chips and WebSocket status indicator

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 8: VehicleListPanel — panel overlay con lista y filtros

**Files:**
- Create: `frontend/src/features/fleet/VehicleListPanel.tsx`

- [ ] **Paso 1: Entender los tipos disponibles**

```bash
grep -n "interface VehicleWithStatus\|VehicleOut\|VehicleStatus\|export type\|export interface" \
  /opt/cmg-telematic1/frontend/src/lib/types.ts | head -30
grep -rn "useVehicleStatuses\|useVehicles\b\|VehicleWithStatus" \
  /opt/cmg-telematic1/frontend/src/features/fleet/ | head -20
```

- [ ] **Paso 2: Crear VehicleListPanel.tsx**

```tsx
// frontend/src/features/fleet/VehicleListPanel.tsx
import { useState, useMemo } from 'react'
import { Sparkline } from '../../shared/ui/Sparkline'
import { Chip } from '../../shared/ui/Chip'

type Filter = 'all' | 'online' | 'moving'

interface VehicleEntry {
  id: string
  plate: string
  name?: string
  online: boolean
  moving?: boolean
  speed?: number
  speedHistory?: number[]
}

interface VehicleListPanelProps {
  vehicles: VehicleEntry[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function VehicleListPanel({ vehicles, selectedId, onSelect }: VehicleListPanelProps) {
  const [open, setOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = useMemo(() => {
    let list = vehicles
    if (filter === 'online')  list = list.filter(v => v.online)
    if (filter === 'moving')  list = list.filter(v => v.moving)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(v =>
        v.plate.toLowerCase().includes(q) || (v.name ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [vehicles, filter, search])

  const statusColor = (v: VehicleEntry) => {
    if (!v.online) return 'var(--offline)'
    if (v.moving)  return 'var(--cmg-teal)'
    return 'var(--ok)'
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Mostrar lista de vehículos"
        style={{
          position: 'absolute', top: 12, left: 12, zIndex: 400,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)', padding: '6px 10px',
          color: 'var(--fg-tertiary)', cursor: 'pointer',
          fontSize: 13, display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
          <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
          <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
        Flota ({vehicles.filter(v => v.online).length}/{vehicles.length})
      </button>
    )
  }

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, bottom: 0,
      width: 280, zIndex: 400,
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 12px 8px',
        borderBottom: '1px solid var(--border-soft)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)' }}>
            Vehículos
          </span>
          <button
            onClick={() => setOpen(false)}
            title="Colapsar panel"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg-dim)', padding: 2 }}
          >
            ‹
          </button>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <svg style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="var(--fg-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar matrícula..."
            style={{
              width: '100%', padding: '5px 8px 5px 26px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)', color: 'var(--fg-secondary)',
              fontSize: 12, fontFamily: 'var(--font-sans)', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'online', 'moving'] as Filter[]).map(f => (
            <Chip
              key={f}
              size="sm"
              color={filter === f ? 'var(--cmg-teal)' : 'var(--fg-dim)'}
              soft={filter === f}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'Todos' : f === 'online' ? 'En línea' : 'En mov.'}
            </Chip>
          ))}
        </div>
      </div>

      {/* Vehicle list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.map(v => (
          <button
            key={v.id}
            onClick={() => onSelect(v.id)}
            style={{
              width: '100%', padding: '9px 12px',
              display: 'flex', alignItems: 'center', gap: 10,
              background: v.id === selectedId ? 'var(--cmg-teal-soft)' : 'transparent',
              borderLeft: v.id === selectedId ? '2px solid var(--cmg-teal)' : '2px solid transparent',
              border: 'none', borderBottom: '1px solid var(--border-soft)',
              cursor: 'pointer', textAlign: 'left',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => {
              if (v.id !== selectedId)
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)'
            }}
            onMouseLeave={e => {
              if (v.id !== selectedId)
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            }}
          >
            {/* Status dot */}
            <span style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: statusColor(v),
            }} />

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                margin: 0, fontSize: 12, fontWeight: 600,
                color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {v.plate}
              </p>
              {v.name && (
                <p style={{
                  margin: 0, fontSize: 11, color: 'var(--fg-muted)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {v.name}
                </p>
              )}
            </div>

            {/* Sparkline + speed */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <Sparkline
                values={v.speedHistory ?? []}
                w={48} h={16}
                color={v.moving ? 'var(--cmg-teal)' : 'var(--offline)'}
              />
              {v.moving && v.speed != null && (
                <span style={{ fontSize: 10, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
                  {v.speed} km/h
                </span>
              )}
            </div>
          </button>
        ))}

        {filtered.length === 0 && (
          <p style={{ padding: 16, fontSize: 12, color: 'var(--fg-dim)', textAlign: 'center' }}>
            Sin vehículos
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Paso 3: Build**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -8
```
Resultado esperado: ✓ built in sin errores.

- [ ] **Paso 4: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/fleet/VehicleListPanel.tsx
git commit -m "feat(fleet): add VehicleListPanel overlay component

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 9: VehicleDetailPanel — panel overlay de detalle de vehículo

**Files:**
- Create: `frontend/src/features/fleet/VehicleDetailPanel.tsx`

- [ ] **Paso 1: Entender los hooks disponibles**

```bash
grep -rn "useVehicleStatus\b\|useVehicle\b\|vehicleId\|VehicleStatus" \
  /opt/cmg-telematic1/frontend/src/features/vehicle/ | head -20
grep -n "export function\|export const\|export default" \
  /opt/cmg-telematic1/frontend/src/features/vehicle/StatusPanel.tsx 2>/dev/null | head -10
```

- [ ] **Paso 2: Crear VehicleDetailPanel.tsx**

```tsx
// frontend/src/features/fleet/VehicleDetailPanel.tsx
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'

interface VehicleDetailPanelProps {
  vehicleId: string | null
  onClose: () => void
}

interface VehicleSummary {
  id: string
  plate: string
  name?: string
  online: boolean
  moving?: boolean
  speed?: number
  ignition?: boolean
  rpm?: number
  lastSeen?: string
}

function useVehicleSummary(id: string | null) {
  return useQuery({
    queryKey: ['vehicles', id, 'status'],
    queryFn: () => apiClient.get<VehicleSummary>(`/api/v1/vehicles/${id}/status`),
    enabled: !!id,
    refetchInterval: 5_000,
  })
}

function KpiRow({ label, value, unit }: { label: string; value: React.ReactNode; unit?: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 0', borderBottom: '1px solid var(--border-soft)',
    }}>
      <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)' }}>
        {value}{unit && <span style={{ fontSize: 11, color: 'var(--fg-muted)', marginLeft: 3 }}>{unit}</span>}
      </span>
    </div>
  )
}

export function VehicleDetailPanel({ vehicleId, onClose }: VehicleDetailPanelProps) {
  const navigate = useNavigate()
  const { data: status } = useVehicleSummary(vehicleId)

  const statusColor = !status?.online ? 'var(--offline)'
    : status.moving ? 'var(--cmg-teal)'
    : 'var(--ok)'

  const statusLabel = !status?.online ? 'Offline'
    : status.moving ? 'En movimiento'
    : 'En línea'

  const lastSeenText = status?.lastSeen
    ? (() => {
        const diff = Date.now() - new Date(status.lastSeen).getTime()
        const mins = Math.floor(diff / 60000)
        if (mins < 1) return 'ahora'
        if (mins < 60) return `hace ${mins} min`
        return `hace ${Math.floor(mins / 60)}h`
      })()
    : null

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0,
      width: 320, zIndex: 400,
      background: 'var(--bg-surface)',
      borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      transform: vehicleId ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 250ms cubic-bezier(0.32, 0.72, 0, 1)',
    }}>
      {vehicleId && (
        <>
          {/* Header */}
          <div style={{
            padding: '14px 16px 10px',
            borderBottom: '1px solid var(--border-soft)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)' }}>
                  {status?.plate ?? '—'}
                </p>
                {status?.name && (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-muted)' }}>{status.name}</p>
                )}
              </div>
              <button
                onClick={onClose}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--fg-dim)', fontSize: 18, padding: 2, lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            {/* Estado */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
              <span style={{ fontSize: 12, color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
              {lastSeenText && (
                <span style={{ fontSize: 11, color: 'var(--fg-dim)' }}>· señal {lastSeenText}</span>
              )}
            </div>
          </div>

          {/* KPIs */}
          <div style={{ padding: '12px 16px', flex: 1, overflowY: 'auto' }}>
            <KpiRow
              label="Ignición"
              value={
                <span style={{ color: status?.ignition ? 'var(--ok)' : 'var(--offline)' }}>
                  {status?.ignition ? 'ON' : 'OFF'}
                </span>
              }
            />
            {status?.speed != null && (
              <KpiRow label="Velocidad" value={status.speed} unit="km/h" />
            )}
            {status?.rpm != null && (
              <KpiRow label="RPM" value={status.rpm} />
            )}
          </div>

          {/* Actions */}
          <div style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--border-soft)',
            flexShrink: 0,
          }}>
            <button
              onClick={() => navigate(`/vehicles/${vehicleId}`)}
              style={{
                width: '100%', padding: '9px 14px',
                background: 'var(--cmg-teal-soft)', color: 'var(--cmg-teal)',
                border: '1px solid var(--cmg-teal-line)', borderRadius: 8,
                fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              Ver detalle completo →
            </button>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Paso 3: Build**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -8
```

- [ ] **Paso 4: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/fleet/VehicleDetailPanel.tsx
git commit -m "feat(fleet): add VehicleDetailPanel slide-in overlay

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 10: FleetDashboard — fleet mode con auto-colapso y paneles

**Files:**
- Modify: `frontend/src/features/fleet/FleetDashboard.tsx`

- [ ] **Paso 1: Leer FleetDashboard**

```bash
wc -l /opt/cmg-telematic1/frontend/src/features/fleet/FleetDashboard.tsx
head -80 /opt/cmg-telematic1/frontend/src/features/fleet/FleetDashboard.tsx
grep -n "selectedVehicle\|selectedId\|setSelected\|VehicleList\|VehicleDetail\|position.*absolute\|useEffect" \
  /opt/cmg-telematic1/frontend/src/features/fleet/FleetDashboard.tsx | head -20
```

- [ ] **Paso 2: Añadir imports de los paneles y auto-colapso**

En FleetDashboard.tsx, añadir imports:
```tsx
import { VehicleListPanel } from './VehicleListPanel'
import { VehicleDetailPanel } from './VehicleDetailPanel'
```

- [ ] **Paso 3: Añadir estado de vehículo seleccionado y auto-colapso**

Dentro del componente FleetDashboard, añadir:

```tsx
const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)

// Auto-colapso sidebar al entrar en fleet mode
useEffect(() => {
  const prev = localStorage.getItem('cmg_sidebar_expanded') ?? 'false'
  localStorage.setItem('cmg_sidebar_prev_state', prev)
  localStorage.setItem('cmg_sidebar_expanded', 'false')
  window.dispatchEvent(new Event('cmg_sidebar_change'))
  return () => {
    const prevState = localStorage.getItem('cmg_sidebar_prev_state') ?? 'false'
    localStorage.setItem('cmg_sidebar_expanded', prevState)
    window.dispatchEvent(new Event('cmg_sidebar_change'))
  }
}, [])
```

- [ ] **Paso 4: Adaptar los vehículos al formato de VehicleListPanel**

El FleetDashboard ya tiene los vehículos y sus statuses. Añadir una variable derivada:

```tsx
// Adaptar los vehículos al formato que espera VehicleListPanel
const vehicleEntries = useMemo(() =>
  (vehicles ?? []).map(v => {
    const status = statusMap?.[v.id]
    return {
      id: v.id,
      plate: v.plate ?? v.id,
      name: v.name,
      online: status?.online ?? false,
      moving: status?.moving ?? false,
      speed: status?.speed,
      speedHistory: undefined as number[] | undefined,
    }
  }),
  [vehicles, statusMap]
)
```

Si el FleetDashboard usa un hook diferente o variable diferente (puede ser `data`, `vehicleList`, etc.), adaptar según lo encontrado en el Paso 1.

- [ ] **Paso 5: Añadir paneles al JSX**

Dentro del JSX de FleetDashboard, en el contenedor del mapa (que debe tener `position: relative`), añadir los dos paneles:

```tsx
{/* Panel izquierdo — lista de vehículos */}
<VehicleListPanel
  vehicles={vehicleEntries}
  selectedId={selectedVehicleId}
  onSelect={id => {
    setSelectedVehicleId(id)
    // Centrar mapa en el vehículo seleccionado si ya hay esa lógica
  }}
/>

{/* Panel derecho — detalle del vehículo seleccionado */}
<VehicleDetailPanel
  vehicleId={selectedVehicleId}
  onClose={() => setSelectedVehicleId(null)}
/>
```

Asegurarse de que el contenedor padre del mapa tiene `position: 'relative'` y `overflow: 'hidden'`.

- [ ] **Paso 6: Build y tests**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -10
npm run test -- --run 2>&1 | tail -10
```
Resultado esperado: build ✓, tests pasan.

- [ ] **Paso 7: Commit final**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/fleet/FleetDashboard.tsx
git commit -m "feat(fleet): fleet mode with auto-collapse sidebar and overlay panels

VehicleListPanel + VehicleDetailPanel wired.
Sidebar auto-collapses on /fleet, restores on exit.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Verificación final

```bash
# Build limpio
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -5

# Todos los tests
npm run test -- --run 2>&1 | tail -10

# Log de commits
cd /opt/cmg-telematic1 && git log --oneline -12
```

Resultado esperado:
- Build ✓
- Tests todos pasan
- 10 commits nuevos desde el inicio del plan

## Comprobación visual post-deploy

Tras reconstruir el contenedor frontend:

| Pantalla | Qué verificar |
|---|---|
| Cualquier página | Sidebar 64px visible a la izquierda con iconos; toggle `›` en el footer |
| Sidebar expandida | Click en `›` → sidebar 240px con labels, search, footer con nombre+rol+logout |
| `/fleet` | Sidebar se colapsa automáticamente; VehicleListPanel aparece a la izquierda del mapa |
| `/fleet` — click vehículo | VehicleDetailPanel slide-in desde la derecha con matrícula, estado, KPIs y botón "Ver detalle" |
| TopNav | Chips "N en línea", "N en mov." visibles; dot WS pulsando en verde |
| Salir de `/fleet` | Sidebar vuelve al estado previo |
