# Alertas — Rediseño, wizard y permisos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar AlertsPage con tabs mejorados, convertir RuleFormPage en un wizard de 5 pasos con textos de ayuda, corregir el bug de email, y restringir el acceso a reglas solo a admins de tier cmg/client.

**Architecture:** Frontend-only. `canManageRules` se calcula en el hook de auth. Las rutas `/rules*` se envuelven en un guard inline en App.tsx. RuleFormPage mantiene el estado del formulario completo pero renderiza solo el paso activo.

**Tech Stack:** React 18 + Vite + TypeScript, React Router 6, React Query.

---

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `frontend/src/features/rules/ActionsList.tsx` | Fix bug checkbox email |
| `frontend/src/App.tsx` | Guard RequireRules en rutas /rules* |
| `frontend/src/features/alerts/AlertsPage.tsx` | Rediseño con 3 tabs + header mejorado |
| `frontend/src/features/rules/RulesPage.tsx` | `canManageRules` en lugar de `isAdmin` |
| `frontend/src/features/rules/RuleFormPage.tsx` | Wizard 5 pasos con textos de ayuda |

---

## Tarea 1: Fix bug email en ActionsList

**Files:**
- Modify: `frontend/src/features/rules/ActionsList.tsx`

- [ ] **Paso 1: Leer el archivo**

```bash
cat /opt/cmg-telematic1/frontend/src/features/rules/ActionsList.tsx
```

Confirmar que la línea ~66 tiene `onChange={e => { if (!e.target.checked) ... }}` — sin el caso `if (e.target.checked)`.

- [ ] **Paso 2: Aplicar el fix**

Buscar:
```tsx
          <input type="checkbox" checked={!!emailAction} onChange={e => { if (!e.target.checked) onChange(value.filter(a => a.type !== 'email')) }} style={{ accentColor: 'var(--cmg-teal)' }} />
```

Reemplazar por:
```tsx
          <input
            type="checkbox"
            checked={!!emailAction}
            onChange={e => {
              if (e.target.checked) {
                onChange([...value.filter(a => a.type !== 'email'), { type: 'email', recipients: [] }])
              } else {
                onChange(value.filter(a => a.type !== 'email'))
              }
            }}
            style={{ accentColor: 'var(--cmg-teal)' }}
          />
```

- [ ] **Paso 3: Build**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -5
```
Resultado esperado: `✓ built in` sin errores.

- [ ] **Paso 4: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/rules/ActionsList.tsx
git commit -m "fix(rules): email action checkbox now adds action on check

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 2: Guard de permisos en App.tsx y RulesPage

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/features/rules/RulesPage.tsx`

- [ ] **Paso 1: Leer las rutas en App.tsx**

```bash
grep -n "rules\|RequireModule\|RequireAuth" /opt/cmg-telematic1/frontend/src/App.tsx | head -20
```

- [ ] **Paso 2: Añadir el guard RequireRules en App.tsx**

En `frontend/src/App.tsx`, añadir el import de Navigate y useAuthStore si no están:
```tsx
import { Navigate } from 'react-router-dom'
import { useAuthStore } from './features/auth/useAuthStore'
```

Añadir el componente inline ANTES de `export default function App()`:
```tsx
function RequireRules({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user)
  const can = user?.role === 'admin' && user?.tenant_tier !== 'subclient'
  if (!can) return <Navigate to="/alerts" replace />
  return <>{children}</>
}
```

Luego buscar las 3 rutas de rules y envolverlas:
```tsx
// Antes:
<Route path="rules"     element={<SectionErrorBoundary label="Rules"><RulesPage /></SectionErrorBoundary>} />
<Route path="rules/new" element={<SectionErrorBoundary label="RuleForm"><RuleFormPage /></SectionErrorBoundary>} />
<Route path="rules/:id" element={<SectionErrorBoundary label="RuleForm"><RuleFormPage /></SectionErrorBoundary>} />

// Después:
<Route path="rules"     element={<RequireRules><SectionErrorBoundary label="Rules"><RulesPage /></SectionErrorBoundary></RequireRules>} />
<Route path="rules/new" element={<RequireRules><SectionErrorBoundary label="RuleForm"><RuleFormPage /></SectionErrorBoundary></RequireRules>} />
<Route path="rules/:id" element={<RequireRules><SectionErrorBoundary label="RuleForm"><RuleFormPage /></SectionErrorBoundary></RequireRules>} />
```

- [ ] **Paso 3: Actualizar RulesPage.tsx**

En `frontend/src/features/rules/RulesPage.tsx`, reemplazar:
```tsx
const isAdmin = useAuthStore(s => s.user?.role === 'admin')
```
Por:
```tsx
const user = useAuthStore(s => s.user)
const canManageRules = user?.role === 'admin' && user?.tenant_tier !== 'subclient'
```

Luego reemplazar todos los usos de `isAdmin` por `canManageRules` en ese archivo:
```bash
grep -n "isAdmin" /opt/cmg-telematic1/frontend/src/features/rules/RulesPage.tsx
```

- [ ] **Paso 4: Build y tests**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -5
npm run test -- --run 2>&1 | tail -8
```
Resultado esperado: build ✓, tests pasan.

- [ ] **Paso 5: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/App.tsx frontend/src/features/rules/RulesPage.tsx
git commit -m "feat(auth): restrict /rules to admin tier=cmg|client only

RequireRules guard redirects subclient and non-admins to /alerts.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 3: AlertsPage rediseño

**Files:**
- Modify: `frontend/src/features/alerts/AlertsPage.tsx`

- [ ] **Paso 1: Reemplazar AlertsPage.tsx completo**

```tsx
// frontend/src/features/alerts/AlertsPage.tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { Chip } from '../../shared/ui/Chip'
import ActiveAlertsList from './ActiveAlertsList'
import AlertHistory from './AlertHistory'
import type { AlertInstanceOut, VehicleOut, RuleOut } from '../../lib/types'
import { useAuthStore } from '../auth/useAuthStore'
import { useTenantContext } from '../../lib/useTenantContext'
import { useConfirm } from '../../shared/ui/ConfirmDialog'

const SEVERITY: Record<string, { label: string; color: string }> = {
  info:     { label: 'INFO',    color: 'var(--info)' },
  warning:  { label: 'AVISO',   color: 'var(--warn)' },
  critical: { label: 'CRÍTICA', color: 'var(--danger)' },
}

export default function AlertsPage() {
  const user = useAuthStore(s => s.user)
  const canManageRules = user?.role === 'admin' && user?.tenant_tier !== 'subclient'
  const { activeTenantId } = useTenantContext()
  const tenantQ = activeTenantId ? `&tenant_id=${activeTenantId}` : ''
  const qc = useQueryClient()
  const confirm = useConfirm()

  const tabs = ['activas', 'historial', ...(canManageRules ? ['reglas'] : [])] as const
  type Tab = typeof tabs[number]
  const [tab, setTab] = useState<Tab>('activas')

  async function handleExportCsv() {
    const blob = await apiClient.getBlob(`/api/v1/alerts/export.csv${activeTenantId ? `?tenant_id=${activeTenantId}` : ''}`)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'alertas.csv'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const { data: vehicles = [] } = useQuery({
    queryKey: [...keys.vehicles(), activeTenantId],
    queryFn: () => apiClient.get<VehicleOut[]>(`/api/v1/vehicles${activeTenantId ? `?tenant_id=${activeTenantId}` : ''}`),
    staleTime: 60_000,
  })

  const { data: rules = [] } = useQuery({
    queryKey: keys.rules(),
    queryFn: () => apiClient.get<RuleOut[]>('/api/v1/rules'),
    staleTime: 60_000,
  })

  const { data: firing = [] } = useQuery({
    queryKey: [...keys.alerts(), 'firing', activeTenantId],
    queryFn: () => apiClient.get<AlertInstanceOut[]>(`/api/v1/alerts?status=firing${tenantQ}`),
    refetchInterval: 30_000,
  })

  const { data: escalated = [] } = useQuery({
    queryKey: [...keys.alerts(), 'escalated', activeTenantId],
    queryFn: () => apiClient.get<AlertInstanceOut[]>(`/api/v1/alerts?status=escalated${tenantQ}`),
    refetchInterval: 30_000,
  })

  const activeAlerts = [...firing, ...escalated].sort(
    (a, b) => (b.triggered_at > a.triggered_at ? 1 : b.triggered_at < a.triggered_at ? -1 : 0)
  )

  const toggleRule = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiClient.put<RuleOut>(`/api/v1/rules/${id}`, { active }),
    onSuccess: (updated) =>
      qc.setQueryData(keys.rules(), (prev: RuleOut[] = []) =>
        prev.map(r => r.id === updated.id ? updated : r)
      ),
  })

  const deleteRule = useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/rules/${id}`),
    onSuccess: (_, id) =>
      qc.setQueryData(keys.rules(), (prev: RuleOut[] = []) => prev.filter(r => r.id !== id)),
  })

  const tabLabel: Record<Tab, string> = { activas: 'Activas', historial: 'Historial', reglas: 'Reglas' }

  return (
    <Shell title="Alertas">
      <div style={{ padding: 24, maxWidth: 1200, overflowY: 'auto', height: '100%' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)' }}>
              Alertas
            </span>
            {activeAlerts.length > 0 && (
              <Chip color="var(--danger)" soft dot size="sm">
                {activeAlerts.length} activa{activeAlerts.length !== 1 ? 's' : ''}
              </Chip>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {tab === 'activas' && (
              <button
                onClick={handleExportCsv}
                style={{
                  padding: '6px 12px', background: 'var(--bg-card)', color: 'var(--fg-secondary)',
                  border: '1px solid var(--border)', borderRadius: 6, fontSize: 12,
                  cursor: 'pointer', fontFamily: 'var(--font-sans)',
                }}
              >
                Exportar CSV
              </button>
            )}
            {canManageRules && (
              <Link
                to="/rules/new"
                style={{
                  padding: '6px 16px', background: 'var(--cmg-teal)', color: '#fff',
                  borderRadius: 6, fontSize: 13, fontWeight: 600,
                  textDecoration: 'none', fontFamily: 'var(--font-sans)',
                }}
              >
                + Nueva regla
              </Link>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
          {tabs.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '8px 20px', background: 'transparent', border: 'none',
                borderBottom: tab === t ? '2px solid var(--cmg-teal)' : '2px solid transparent',
                color: tab === t ? 'var(--cmg-teal)' : 'var(--fg-muted)',
                fontSize: 13, fontWeight: tab === t ? 600 : 400,
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
            >
              {tabLabel[t]}
              {t === 'activas' && activeAlerts.length > 0 && (
                <span style={{
                  marginLeft: 6, background: 'var(--danger)', color: '#fff',
                  borderRadius: 9999, fontSize: 10, fontWeight: 700,
                  padding: '1px 6px',
                }}>
                  {activeAlerts.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab: Activas */}
        {tab === 'activas' && (
          <ActiveAlertsList alerts={activeAlerts} vehicles={vehicles} rules={rules} />
        )}

        {/* Tab: Historial */}
        {tab === 'historial' && (
          <AlertHistory vehicles={vehicles} rules={rules} />
        )}

        {/* Tab: Reglas */}
        {tab === 'reglas' && canManageRules && (
          <div>
            {rules.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 0' }}>
                <p style={{ color: 'var(--fg-muted)', fontSize: 14, marginBottom: 16 }}>
                  No hay reglas de alerta configuradas.
                </p>
                <Link
                  to="/rules/new"
                  style={{
                    color: 'var(--cmg-teal)', fontSize: 14,
                    textDecoration: 'none', borderBottom: '1px solid var(--cmg-teal)', paddingBottom: 2,
                  }}
                >
                  Crear la primera regla →
                </Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rules.map(rule => {
                  const sev = SEVERITY[rule.severity] ?? SEVERITY.info
                  return (
                    <div
                      key={rule.id}
                      style={{
                        background: 'var(--bg-card)', border: '1px solid var(--border)',
                        borderRadius: 10, padding: '12px 16px',
                        display: 'flex', alignItems: 'center', gap: 12,
                      }}
                    >
                      <Chip color={sev.color} soft size="sm">{sev.label}</Chip>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          margin: 0, fontSize: 14, fontWeight: 600,
                          color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)',
                        }}>
                          {rule.name}
                        </p>
                        {rule.description && (
                          <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
                            {rule.description}
                          </p>
                        )}
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--fg-muted)' }}>
                        <input
                          type="checkbox"
                          checked={rule.active}
                          onChange={() => toggleRule.mutate({ id: rule.id, active: !rule.active })}
                          style={{ accentColor: 'var(--cmg-teal)', cursor: 'pointer' }}
                        />
                        Activa
                      </label>
                      <Link
                        to={`/rules/${rule.id}`}
                        style={{
                          padding: '4px 12px', fontSize: 12, color: 'var(--fg-tertiary)',
                          border: '1px solid var(--border)', borderRadius: 6,
                          textDecoration: 'none', fontFamily: 'var(--font-sans)',
                        }}
                      >
                        Editar
                      </Link>
                      <button
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Eliminar regla',
                            message: `¿Eliminar "${rule.name}"? Las alertas activas de esta regla se cerrarán.`,
                            confirmLabel: 'Eliminar',
                            kind: 'danger',
                          })
                          if (ok) deleteRule.mutate(rule.id)
                        }}
                        style={{
                          padding: '4px 12px', fontSize: 12, color: 'var(--danger)',
                          border: '1px solid var(--danger)', borderRadius: 6,
                          background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                        }}
                      >
                        Eliminar
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  )
}
```

- [ ] **Paso 2: Build y tests**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -5
npm run test -- --run 2>&1 | tail -8
```

- [ ] **Paso 3: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/alerts/AlertsPage.tsx
git commit -m "feat(alerts): redesign AlertsPage with 3 tabs, header chips, inline rules list

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 4: RuleFormPage — wizard 5 pasos

**Files:**
- Modify: `frontend/src/features/rules/RuleFormPage.tsx`

- [ ] **Paso 1: Leer el archivo actual para verificar imports y estructura**

```bash
head -45 /opt/cmg-telematic1/frontend/src/features/rules/RuleFormPage.tsx
```

- [ ] **Paso 2: Reemplazar RuleFormPage.tsx completo**

```tsx
// frontend/src/features/rules/RuleFormPage.tsx
import type { CSSProperties } from 'react'
import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import ConditionBuilder from './ConditionBuilder'
import VehicleFilterPicker from './VehicleFilterPicker'
import ActionsList from './ActionsList'
import EscalationBuilder from './EscalationBuilder'
import { Chip } from '../../shared/ui/Chip'
import { useAuthStore } from '../auth/useAuthStore'
import type { RuleOut, RuleCreate, ConditionDef, VehicleTypeOut, VehicleOut, SensorDef } from '../../lib/types'

// ── Estilos ──────────────────────────────────────────────────────────────────

const LABEL: CSSProperties = {
  fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600,
  color: 'var(--fg-muted)', letterSpacing: '0.05em', display: 'block', marginBottom: 6,
}
const INPUT: CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)',
  fontSize: 13, padding: '8px 10px', width: '100%', boxSizing: 'border-box' as const,
}
const HELP: CSSProperties = {
  fontSize: 11, color: 'var(--fg-dim)', fontFamily: 'var(--font-sans)', marginTop: 5, lineHeight: 1.5,
}
const SEV_BTN = (active: boolean, color: string): CSSProperties => ({
  padding: '6px 16px', fontSize: 12, fontFamily: 'var(--font-sans)', fontWeight: 600,
  border: `1px solid ${active ? color : 'var(--border)'}`,
  borderRadius: 6, cursor: 'pointer',
  background: active ? color : 'var(--bg-elevated)',
  color: active ? '#fff' : 'var(--fg-muted)',
  transition: 'all 0.15s',
})

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CONDITION: ConditionDef = { type: 'threshold', field: '', op: '>', value: 0 }
const DEFAULT_FORM: RuleCreate = {
  name: '', description: null, severity: 'warning',
  vehicle_filter: { scope: 'all' },
  condition: DEFAULT_CONDITION,
  actions: [{ type: 'in_app' }],
  escalation: [],
  cooldown_minutes: 30,
  active: true,
}

// ── Condición en lenguaje natural (resumen) ───────────────────────────────────

function conditionSummary(c: ConditionDef): string {
  if (!c) return '—'
  switch (c.type) {
    case 'threshold':
      return c.field ? `${c.field} ${c.op ?? '>'} ${c.value}` : 'Sin configurar'
    case 'threshold_sustained':
      return c.field ? `${c.field} ${c.op ?? '>'} ${c.value} durante ${(c as any).duration_minutes ?? '?'} min` : 'Sin configurar'
    case 'accumulation':
      return c.field ? `Acumulado ${c.field} >= ${c.value}` : 'Sin configurar'
    case 'geofence':
      return `Geocerca — ${(c as any).action === 'enter' ? 'al entrar' : 'al salir'}`
    case 'schedule':
      return 'Fuera de horario programado'
    default:
      return c.type
  }
}

function filterSummary(f: RuleCreate['vehicle_filter']): string {
  if (f.scope === 'all') return 'Todos los vehículos'
  if (f.scope === 'type') return `Tipo de vehículo${f.vehicle_type_id ? '' : ' (sin seleccionar)'}`
  if (f.scope === 'vehicle') return `Vehículo concreto${f.vehicle_id ? '' : ' (sin seleccionar)'}`
  return '—'
}

// ── Sensor help por tipo de condición ────────────────────────────────────────

const CONDITION_HELP: Record<string, string> = {
  threshold: 'El campo debe ser el nombre exacto del sensor CAN del vehículo. Ej: presion_bomba, temp_aceite, rpm_motor.',
  threshold_sustained: 'La condición debe mantenerse durante X minutos consecutivos antes de disparar la alerta.',
  accumulation: 'Suma el valor del sensor desde el último reset. Útil para horas de PTO, ciclos de trabajo o km recorridos.',
  geofence: 'La alerta se dispara cuando el vehículo cruza el límite del polígono definido.',
  schedule: 'Se dispara si el vehículo está activo fuera del horario configurado — ideal para detectar uso no autorizado.',
  composite: 'Combina varias condiciones con AND/OR. Útil para alertas que requieren múltiples señales simultáneas.',
  trend_rising: 'Detecta una tendencia de subida en el sensor. Útil para alertas tempranas antes de alcanzar el umbral crítico.',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mergedSensors(vehicleTypes: VehicleTypeOut[]): SensorDef[] {
  const seen = new Set<string>()
  const result: SensorDef[] = []
  for (const vt of vehicleTypes) {
    for (const s of vt.sensor_schema) {
      if (!seen.has(s.key)) { seen.add(s.key); result.push(s) }
    }
  }
  return result
}

// ── Componente principal ──────────────────────────────────────────────────────

const STEP_LABELS = ['Identidad', 'Vehículos', 'Condición', 'Acciones', 'Revisar']

export default function RuleFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id && id !== 'new'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()

  // Redirect if no permission
  const user = useAuthStore(s => s.user)
  const canManageRules = user?.role === 'admin' && user?.tenant_tier !== 'subclient'
  useEffect(() => { if (user && !canManageRules) navigate('/alerts', { replace: true }) }, [user])

  const prefilledTypeId = searchParams.get('type_id')
  const prefilledVehicleId = searchParams.get('vehicle_id')
  const prefilledConditionType = searchParams.get('condition_type')

  const [form, setForm] = useState<RuleCreate>({
    ...DEFAULT_FORM,
    vehicle_filter: {
      scope: prefilledTypeId ? 'type' : prefilledVehicleId ? 'vehicle' : 'all',
      vehicle_id: prefilledVehicleId ?? '',
      vehicle_type_id: prefilledTypeId ?? '',
    },
    condition: prefilledConditionType === 'geofence'
      ? { type: 'geofence', polygon: [], action: 'enter' } as unknown as ConditionDef
      : DEFAULT_CONDITION,
  })
  const [step, setStep] = useState(1)
  const [visitedSteps, setVisitedSteps] = useState(new Set([1]))
  const [nameError, setNameError] = useState('')
  const [apiError, setApiError] = useState('')

  const { data: existingRule } = useQuery({
    queryKey: keys.rule(id!),
    queryFn: () => apiClient.get<RuleOut>(`/api/v1/rules/${id}`),
    enabled: isEdit,
    staleTime: 60_000,
  })

  const { data: vehicleTypes = [] } = useQuery({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: 60_000,
  })

  const { data: selectedVehicle } = useQuery({
    queryKey: keys.vehicle(form.vehicle_filter.vehicle_id ?? ''),
    queryFn: () => apiClient.get<VehicleOut>(`/api/v1/vehicles/${form.vehicle_filter.vehicle_id}`),
    enabled: form.vehicle_filter.scope === 'vehicle' && !!form.vehicle_filter.vehicle_id,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (existingRule) {
      setForm({
        name: existingRule.name, description: existingRule.description,
        severity: existingRule.severity, vehicle_filter: existingRule.vehicle_filter,
        condition: existingRule.condition, actions: existingRule.actions,
        escalation: existingRule.escalation, cooldown_minutes: existingRule.cooldown_minutes,
        active: existingRule.active,
      })
    }
  }, [existingRule?.id])

  const sensors: SensorDef[] = useMemo(() => {
    const { scope, vehicle_type_id, vehicle_id } = form.vehicle_filter
    if (scope === 'type' && vehicle_type_id)
      return vehicleTypes.find(vt => vt.id === vehicle_type_id)?.sensor_schema ?? []
    if (scope === 'vehicle' && vehicle_id && selectedVehicle)
      return vehicleTypes.find(vt => vt.id === selectedVehicle.vehicle_type_id)?.sensor_schema ?? mergedSensors(vehicleTypes)
    return mergedSensors(vehicleTypes)
  }, [vehicleTypes, form.vehicle_filter, selectedVehicle])

  const { mutate, isPending } = useMutation({
    mutationFn: () => isEdit
      ? apiClient.put<RuleOut>(`/api/v1/rules/${id}`, form)
      : apiClient.post<RuleOut>('/api/v1/rules', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.rules() }); navigate('/rules') },
    onError: (err) => setApiError((err as Error).message),
  })

  const update = <K extends keyof RuleCreate>(key: K, val: RuleCreate[K]) =>
    setForm(prev => ({ ...prev, [key]: val }))

  const goTo = (s: number) => {
    if (s < 1 || s > 5) return
    if (s > step) {
      if (step === 1 && !form.name.trim()) { setNameError('El nombre es obligatorio'); return }
      setNameError('')
    }
    setStep(s)
    setVisitedSteps(prev => new Set([...prev, s]))
  }

  const sevColor: Record<string, string> = {
    info: 'var(--info)', warning: 'var(--warn)', critical: 'var(--danger)',
  }

  return (
    <Shell title={isEdit ? 'Editar regla' : 'Nueva regla'}>
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 24,
      }}>
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14,
          width: '100%', maxWidth: 660, maxHeight: '92vh', overflowY: 'auto',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex', flexDirection: 'column',
        }}>

          {/* Header fijo */}
          <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)' }}>
                {isEdit ? 'Editar regla' : 'Nueva regla de alerta'}
              </span>
              <button
                onClick={() => navigate('/rules')}
                style={{ background: 'transparent', border: 'none', color: 'var(--fg-dim)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4 }}
              >
                ✕
              </button>
            </div>

            {/* Stepper */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              {STEP_LABELS.map((label, i) => {
                const s = i + 1
                const active = s === step
                const done = visitedSteps.has(s) && s !== step
                const clickable = visitedSteps.has(s)
                return (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', flex: s < 5 ? 1 : 0 }}>
                    <button
                      onClick={() => clickable && goTo(s)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                        background: 'transparent', border: 'none', cursor: clickable ? 'pointer' : 'default',
                        padding: '0 4px',
                      }}
                    >
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%', fontSize: 12, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: active ? 'var(--cmg-teal)' : done ? 'var(--cmg-teal-soft)' : 'var(--bg-elevated)',
                        color: active ? '#fff' : done ? 'var(--cmg-teal)' : 'var(--fg-dim)',
                        border: active ? 'none' : done ? '1px solid var(--cmg-teal-line)' : '1px solid var(--border)',
                        transition: 'all 0.15s',
                      }}>
                        {done ? '✓' : s}
                      </div>
                      <span style={{ fontSize: 10, color: active ? 'var(--cmg-teal)' : 'var(--fg-dim)', whiteSpace: 'nowrap', fontFamily: 'var(--font-sans)', fontWeight: active ? 600 : 400 }}>
                        {label}
                      </span>
                    </button>
                    {s < 5 && (
                      <div style={{ flex: 1, height: 1, background: visitedSteps.has(s + 1) ? 'var(--cmg-teal-line)' : 'var(--border)', marginBottom: 16 }} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Cuerpo del paso */}
          <div style={{ padding: '24px', flex: 1 }}>

            {/* ── Paso 1: Identidad ── */}
            {step === 1 && (
              <div>
                <p style={{ fontSize: 13, color: 'var(--fg-tertiary)', marginBottom: 20, lineHeight: 1.5 }}>
                  Ponle un nombre descriptivo y elige la urgencia. El nombre aparece en las notificaciones al operario.
                </p>
                <div style={{ marginBottom: 16 }}>
                  <label style={LABEL}>NOMBRE *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => { update('name', e.target.value); setNameError('') }}
                    placeholder="Ej: Presión bomba alta, Temperatura aceite, Parada fuera de zona"
                    style={{ ...INPUT, borderColor: nameError ? 'var(--danger)' : 'var(--border)' }}
                    autoFocus
                  />
                  {nameError && <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}>{nameError}</div>}
                  <p style={HELP}>Ej: "Presión bomba vacuum alta", "Motor en marcha fuera de horario", "Batería baja"</p>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={LABEL}>DESCRIPCIÓN (opcional)</label>
                  <input
                    type="text"
                    value={form.description ?? ''}
                    onChange={e => update('description', e.target.value || null)}
                    placeholder="Nota interna sobre esta regla"
                    style={INPUT}
                  />
                  <p style={HELP}>Nota interna. No se muestra en las notificaciones al operario.</p>
                </div>
                <div>
                  <label style={LABEL}>SEVERIDAD</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['info', 'warning', 'critical'] as const).map(s => (
                      <button key={s} type="button" onClick={() => update('severity', s)}
                        style={SEV_BTN(form.severity === s, sevColor[s])}>
                        {s === 'info' ? 'Info' : s === 'warning' ? 'Aviso' : 'Crítica'}
                      </button>
                    ))}
                  </div>
                  <p style={HELP}>
                    <strong style={{ color: 'var(--danger)' }}>Crítica</strong> activa sonido en la app. &nbsp;
                    <strong style={{ color: 'var(--warn)' }}>Aviso</strong> notifica silenciosamente. &nbsp;
                    <strong style={{ color: 'var(--info)' }}>Info</strong> solo registra, sin notificación activa.
                  </p>
                </div>
              </div>
            )}

            {/* ── Paso 2: Vehículos ── */}
            {step === 2 && (
              <div>
                <p style={{ fontSize: 13, color: 'var(--fg-tertiary)', marginBottom: 20, lineHeight: 1.5 }}>
                  ¿A qué vehículos aplica esta regla? Puedes aplicarla a toda la flota, a un tipo de vehículo o a uno concreto.
                </p>
                <VehicleFilterPicker
                  value={form.vehicle_filter}
                  onChange={f => update('vehicle_filter', f)}
                />
                <p style={{ ...HELP, marginTop: 14 }}>
                  Si seleccionas "Todos los vehículos", la regla se evalúa para cada vehículo de tu flota cada vez que se recibe un paquete de telemetría.
                </p>
              </div>
            )}

            {/* ── Paso 3: Condición ── */}
            {step === 3 && (
              <div>
                <p style={{ fontSize: 13, color: 'var(--fg-tertiary)', marginBottom: 20, lineHeight: 1.5 }}>
                  Define cuándo debe dispararse la alerta. Se evalúa en cada paquete de telemetría recibido del vehículo.
                </p>
                <ConditionBuilder
                  condition={form.condition}
                  sensors={sensors}
                  onChange={c => update('condition', c)}
                />
                {form.condition?.type && CONDITION_HELP[form.condition.type] && (
                  <div style={{
                    marginTop: 16, padding: '10px 14px',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    borderRadius: 8, display: 'flex', gap: 10, alignItems: 'flex-start',
                  }}>
                    <span style={{ color: 'var(--info)', fontSize: 14, flexShrink: 0, lineHeight: 1.6 }}>ⓘ</span>
                    <p style={{ ...HELP, margin: 0 }}>{CONDITION_HELP[form.condition.type]}</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Paso 4: Acciones ── */}
            {step === 4 && (
              <div>
                <p style={{ fontSize: 13, color: 'var(--fg-tertiary)', marginBottom: 20, lineHeight: 1.5 }}>
                  ¿Qué ocurre cuando se dispara? Puedes combinar varias notificaciones.
                </p>

                <ActionsList value={form.actions} onChange={a => update('actions', a)} />

                <div style={{ marginTop: 6, marginBottom: 20 }}>
                  <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, marginTop: 8 }}>
                    <p style={{ ...HELP, margin: 0 }}>
                      <strong style={{ color: 'var(--fg-tertiary)' }}>In-app:</strong> aparece en la bandeja de alertas del panel web y la app móvil.<br/>
                      <strong style={{ color: 'var(--fg-tertiary)' }}>Email:</strong> envía correo a los destinatarios configurados. Requiere configurar el servidor SMTP en Ajustes → Correo.<br/>
                      <strong style={{ color: 'var(--fg-tertiary)' }}>Webhook:</strong> llama a una URL externa con los datos de la alerta en JSON. Útil para integraciones con ERP o Slack.
                    </p>
                  </div>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label style={{ ...LABEL, textTransform: 'uppercase' as const }}>ESCALACIÓN (opcional)</label>
                  <p style={{ ...HELP, marginBottom: 10 }}>
                    Envía una segunda notificación si la alerta no se reconoce pasado X minutos. Útil para alertas críticas.
                  </p>
                  <EscalationBuilder value={form.escalation} onChange={e => update('escalation', e)} />
                </div>

                <div>
                  <label style={LABEL}>COOLDOWN — NO REPETIR ANTES DE</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="number" value={form.cooldown_minutes}
                      onChange={e => update('cooldown_minutes', parseInt(e.target.value) || 1)}
                      style={{ ...INPUT, width: 80 }} min={1}
                    />
                    <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>minutos</span>
                  </div>
                  <p style={HELP}>Tiempo mínimo entre dos disparos de la misma regla para el mismo vehículo. Evita el spam de notificaciones. Recomendado: 30 min para avisos, 5–10 min para críticos.</p>
                </div>
              </div>
            )}

            {/* ── Paso 5: Revisar ── */}
            {step === 5 && (
              <div>
                <p style={{ fontSize: 13, color: 'var(--fg-tertiary)', marginBottom: 20, lineHeight: 1.5 }}>
                  Revisa la configuración antes de guardar.
                </p>

                {[
                  { label: 'Nombre', value: form.name || '—' },
                  { label: 'Descripción', value: form.description || 'Sin descripción' },
                  { label: 'Severidad', value: (
                    <Chip
                      color={sevColor[form.severity] ?? 'var(--info)'}
                      soft size="sm"
                    >
                      {form.severity === 'info' ? 'Info' : form.severity === 'warning' ? 'Aviso' : 'Crítica'}
                    </Chip>
                  )},
                  { label: 'Vehículos', value: filterSummary(form.vehicle_filter) },
                  { label: 'Condición', value: conditionSummary(form.condition) },
                  { label: 'Acciones', value: form.actions.map(a => a.type).join(', ') || '—' },
                  { label: 'Cooldown', value: `${form.cooldown_minutes} minutos` },
                ].map(({ label, value }) => (
                  <div key={label} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 0', borderBottom: '1px solid var(--border-soft)',
                  }}>
                    <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)', fontWeight: 600, minWidth: 120 }}>{label}</span>
                    <span style={{ fontSize: 13, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)', textAlign: 'right' }}>{value}</span>
                  </div>
                ))}

                <div style={{ marginTop: 20 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)' }}>
                    <input
                      type="checkbox" checked={form.active}
                      onChange={e => update('active', e.target.checked)}
                      style={{ accentColor: 'var(--cmg-teal)', width: 16, height: 16 }}
                    />
                    Activar regla inmediatamente al guardar
                  </label>
                  <p style={{ ...HELP, paddingLeft: 24 }}>Si la desmarcas, la regla se guarda pero no evaluará condiciones hasta que la actives.</p>
                </div>

                {apiError && (
                  <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 12 }}>{apiError}</div>
                )}
              </div>
            )}
          </div>

          {/* Footer fijo */}
          <div style={{
            padding: '16px 24px', borderTop: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', flexShrink: 0,
            background: 'var(--bg-surface)',
          }}>
            <button
              type="button"
              onClick={() => step > 1 ? goTo(step - 1) : navigate('/rules')}
              style={{
                padding: '8px 16px', fontSize: 13, background: 'var(--bg-elevated)',
                border: '1px solid var(--border)', borderRadius: 6,
                color: 'var(--fg-muted)', cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
            >
              {step > 1 ? '← Anterior' : 'Cancelar'}
            </button>

            {step < 5 ? (
              <button
                type="button"
                onClick={() => goTo(step + 1)}
                style={{
                  padding: '8px 20px', fontSize: 13, fontWeight: 600,
                  background: 'var(--cmg-teal)', border: 'none', borderRadius: 6,
                  color: '#fff', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                }}
              >
                Siguiente →
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { setApiError(''); if (!form.name.trim()) { setNameError('El nombre es obligatorio'); goTo(1); return } mutate() }}
                disabled={isPending}
                style={{
                  padding: '8px 24px', fontSize: 13, fontWeight: 600,
                  background: 'var(--cmg-teal)', border: 'none', borderRadius: 6,
                  color: '#fff', cursor: isPending ? 'wait' : 'pointer', fontFamily: 'var(--font-sans)',
                }}
              >
                {isPending ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear regla'}
              </button>
            )}
          </div>

        </div>
      </div>
    </Shell>
  )
}
```

- [ ] **Paso 3: Build y tests**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -8
npm run test -- --run 2>&1 | tail -8
```
Resultado esperado: build ✓, tests pasan.

- [ ] **Paso 4: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/rules/RuleFormPage.tsx
git commit -m "feat(rules): convert rule form to 5-step wizard with help texts

Steps: Identidad → Vehículos → Condición → Acciones → Revisar.
Contextual help text per condition type. Stepper with visited state.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Verificación final

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -5
npm run test -- --run 2>&1 | tail -5
cd .. && git log --oneline -5
```

Comprobar manualmente:
- Usuario `operator` → no ve tab "Reglas" en /alerts, redirect en /rules
- Usuario `admin tier=subclient` → redirect en /rules a /alerts
- Usuario `admin tier=client` → accede a /rules, ve tab "Reglas"
- Email checkbox → al marcar aparece el campo de destinatario
- Wizard → stepper muestra pasos visitados en teal, permite saltar hacia atrás
