# Work Cycle Definitions UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir una sección "Ciclos de trabajo" al panel derecho de VehicleTypesPage para crear, editar, borrar y activar/desactivar definiciones de ciclos de trabajo por tipo de vehículo.

**Architecture:** Nuevo componente `WorkCycleDefsSection.tsx` con props `typeId` y `sensorSchema`. Gestiona su propio estado y modales. VehicleTypesPage lo renderiza como una sección más dentro del bloque `cmg admin`. El backend ya tiene todos los endpoints necesarios (GET/POST/PATCH/DELETE en `/api/v1/work-cycles/definitions`).

**Tech Stack:** React 18, TanStack Query, TypeScript, Vitest + @testing-library/react

---

## Archivos

| Acción | Ruta |
|---|---|
| Crear | `frontend/src/features/vehicles/WorkCycleDefsSection.tsx` |
| Crear | `frontend/src/features/vehicles/__tests__/WorkCycleDefsSection.test.tsx` |
| Modificar | `frontend/src/features/vehicles/VehicleTypesPage.tsx` |

---

## Task 1: Tests para WorkCycleDefsSection

**Files:**
- Create: `frontend/src/features/vehicles/__tests__/WorkCycleDefsSection.test.tsx`

- [ ] **Step 1: Crear el fichero de tests**

```tsx
// frontend/src/features/vehicles/__tests__/WorkCycleDefsSection.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import WorkCycleDefsSection from '../WorkCycleDefsSection'
import type { WorkCycleDefinition, SensorDef } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

import { apiClient } from '../../../lib/apiClient'

const mockDef: WorkCycleDefinition = {
  id: 'def-1',
  vehicle_type_id: 'type-1',
  tenant_id: null,
  name: 'Ciclo bomba',
  trigger_type: 'pto_change',
  trigger_config: {},
  snapshot_fields: ['hydraulic_pressure'],
  aggregate_fields: [],
  active: true,
  created_at: '2026-04-25T00:00:00Z',
}

const mockSchema: SensorDef[] = [
  { key: 'hydraulic_pressure', label: 'Presión Hidráulica', unit: 'bar', gauge_type: 'circular', avl_id: 305, min: 0, max: 600 },
  { key: 'oil_temp', label: 'Temp Aceite', unit: '°C', gauge_type: 'numeric', avl_id: 306 },
]

function wrap(definitions: WorkCycleDefinition[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(['work-cycle-definitions', 'type-1'], definitions)
  return render(
    <QueryClientProvider client={qc}>
      <WorkCycleDefsSection typeId="type-1" sensorSchema={mockSchema} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.mocked(apiClient.get).mockResolvedValue([])
  vi.mocked(apiClient.post).mockResolvedValue({ ...mockDef, id: 'def-new' })
  vi.mocked(apiClient.patch).mockResolvedValue({ ...mockDef, active: false })
  vi.mocked(apiClient.delete).mockResolvedValue(undefined)
})

describe('WorkCycleDefsSection', () => {
  it('muestra mensaje vacío cuando no hay definiciones', () => {
    wrap([])
    expect(screen.getByText(/Sin definiciones/)).toBeInTheDocument()
  })

  it('muestra el nombre y trigger en la tabla', () => {
    wrap([mockDef])
    expect(screen.getByText('Ciclo bomba')).toBeInTheDocument()
    expect(screen.getByText('pto_change')).toBeInTheDocument()
  })

  it('muestra el número de snapshot fields', () => {
    wrap([mockDef])
    expect(screen.getByText('1 campos')).toBeInTheDocument()
  })

  it('abre el modal al pulsar el botón de nueva definición', () => {
    wrap([])
    fireEvent.click(screen.getByText('+ Añadir definición'))
    expect(screen.getByText('Nueva definición de ciclo')).toBeInTheDocument()
  })

  it('cierra el modal al pulsar Cancelar', () => {
    wrap([])
    fireEvent.click(screen.getByText('+ Añadir definición'))
    fireEvent.click(screen.getByText('Cancelar'))
    expect(screen.queryByText('Nueva definición de ciclo')).not.toBeInTheDocument()
  })

  it('abre el modal de edición con el nombre pre-rellenado', () => {
    wrap([mockDef])
    const editBtn = screen.getByText('✎')
    fireEvent.click(editBtn)
    expect(screen.getByText('Editar definición de ciclo')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Ciclo bomba')).toBeInTheDocument()
  })

  it('llama a DELETE al pulsar ✕', async () => {
    wrap([mockDef])
    fireEvent.click(screen.getByText('✕'))
    await waitFor(() => {
      expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/work-cycles/definitions/def-1')
    })
  })

  it('llama a PATCH al pulsar el toggle de activo', async () => {
    wrap([mockDef])
    fireEvent.click(screen.getByText('Activo'))
    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalledWith(
        '/api/v1/work-cycles/definitions/def-1',
        { active: false }
      )
    })
  })

  it('llama a POST con los datos del formulario al crear', async () => {
    wrap([])
    fireEvent.click(screen.getByText('+ Añadir definición'))
    fireEvent.change(screen.getByPlaceholderText('ej. Ciclo bomba agua'), { target: { value: 'Mi ciclo' } })
    fireEvent.click(screen.getByText('Crear'))
    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/v1/work-cycles/definitions',
        expect.objectContaining({ name: 'Mi ciclo', trigger_type: 'pto_change', vehicle_type_id: 'type-1' })
      )
    })
  })

  it('muestra campos de sensor cuando el trigger es threshold_exceeded', () => {
    wrap([])
    fireEvent.click(screen.getByText('+ Añadir definición'))
    fireEvent.change(screen.getByRole('combobox', { name: /tipo de trigger/i }), {
      target: { value: 'threshold_exceeded' },
    })
    expect(screen.getByText('SENSOR (CLAVE EN can_data)')).toBeInTheDocument()
    expect(screen.getByText('UMBRAL')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Ejecutar los tests para confirmar que fallan (el componente no existe aún)**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run src/features/vehicles/__tests__/WorkCycleDefsSection.test.tsx 2>&1 | tail -20
```

Resultado esperado: error de importación (`Cannot find module '../WorkCycleDefsSection'`)

---

## Task 2: Implementar WorkCycleDefsSection.tsx

**Files:**
- Create: `frontend/src/features/vehicles/WorkCycleDefsSection.tsx`

- [ ] **Step 1: Crear el componente completo**

```tsx
// frontend/src/features/vehicles/WorkCycleDefsSection.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { WorkCycleDefinition, WorkCycleDefinitionCreate, SensorDef } from '../../lib/types'

const TRIGGER_OPTIONS = [
  { value: 'pto_change', label: 'PTO activo' },
  { value: 'ignition_period', label: 'Período de ignición' },
  { value: 'threshold_exceeded', label: 'Umbral superado' },
  { value: 'sensor_pulse', label: 'Pulso de sensor' },
]

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--bg-border)',
  color: 'var(--text-primary, #E7E5E4)',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--accent-off)',
  fontWeight: 600,
  letterSpacing: '0.04em',
  marginBottom: 4,
  display: 'block',
}

const btnPrimary: React.CSSProperties = {
  background: 'var(--accent-energy)',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '7px 16px',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 600,
}

const btnSecondary: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary, #E7E5E4)',
  border: '1px solid var(--bg-border)',
  borderRadius: 6,
  padding: '7px 16px',
  fontSize: 13,
  cursor: 'pointer',
}

type CycleDefForm = {
  name: string
  trigger_type: string
  sensor: string
  sensorCustom: string
  op: string
  threshold: string
  min_gap: string
  snapshotChecked: Set<string>
  snapshotCustom: string
  aggregateChecked: Set<string>
  aggregateCustom: string
}

const emptyForm: CycleDefForm = {
  name: '',
  trigger_type: 'pto_change',
  sensor: '',
  sensorCustom: '',
  op: '>',
  threshold: '',
  min_gap: '30',
  snapshotChecked: new Set(),
  snapshotCustom: '',
  aggregateChecked: new Set(),
  aggregateCustom: '',
}

function defToForm(d: WorkCycleDefinition, schemaKeys: string[]): CycleDefForm {
  const cfg = (d.trigger_config ?? {}) as Record<string, unknown>
  const sensor = (cfg.sensor as string) ?? ''
  const inSchema = schemaKeys.includes(sensor)
  return {
    name: d.name,
    trigger_type: d.trigger_type,
    sensor: sensor ? (inSchema ? sensor : '__custom__') : '',
    sensorCustom: inSchema ? '' : sensor,
    op: (cfg.op as string) ?? '>',
    threshold: cfg.threshold != null ? String(cfg.threshold) : '',
    min_gap: cfg.min_gap_seconds != null ? String(cfg.min_gap_seconds) : '30',
    snapshotChecked: new Set((d.snapshot_fields ?? []).filter(k => schemaKeys.includes(k))),
    snapshotCustom: (d.snapshot_fields ?? []).filter(k => !schemaKeys.includes(k)).join(', '),
    aggregateChecked: new Set((d.aggregate_fields ?? []).filter(k => schemaKeys.includes(k))),
    aggregateCustom: (d.aggregate_fields ?? []).filter(k => !schemaKeys.includes(k)).join(', '),
  }
}

function formToPayload(form: CycleDefForm, typeId: string): WorkCycleDefinitionCreate {
  const sensorKey = form.sensor === '__custom__' ? form.sensorCustom.trim() : form.sensor
  let trigger_config: Record<string, unknown> = {}
  if (form.trigger_type === 'threshold_exceeded') {
    trigger_config = { sensor: sensorKey, op: form.op, threshold: parseFloat(form.threshold) }
  } else if (form.trigger_type === 'sensor_pulse') {
    trigger_config = { sensor: sensorKey, min_gap_seconds: parseInt(form.min_gap) || 30 }
  }
  const customSnapshot = form.snapshotCustom.split(',').map(s => s.trim()).filter(Boolean)
  const customAggregate = form.aggregateCustom.split(',').map(s => s.trim()).filter(Boolean)
  return {
    vehicle_type_id: typeId,
    name: form.name.trim(),
    trigger_type: form.trigger_type,
    trigger_config,
    snapshot_fields: [...form.snapshotChecked, ...customSnapshot],
    aggregate_fields: [...form.aggregateChecked, ...customAggregate],
  }
}

function triggerConfigSummary(d: WorkCycleDefinition): string {
  const cfg = (d.trigger_config ?? {}) as Record<string, unknown>
  if (d.trigger_type === 'threshold_exceeded') {
    return `${cfg.sensor ?? '?'} ${cfg.op ?? '>'} ${cfg.threshold ?? '?'}`
  }
  if (d.trigger_type === 'sensor_pulse') {
    return `${cfg.sensor ?? '?'} · gap ≥${cfg.min_gap_seconds ?? 30}s`
  }
  return '—'
}

interface FieldPickerProps {
  label: string
  schemaKeys: string[]
  checked: Set<string>
  custom: string
  onCheckedChange: (s: Set<string>) => void
  onCustomChange: (s: string) => void
}

function FieldPicker({ label, schemaKeys, checked, custom, onCheckedChange, onCustomChange }: FieldPickerProps) {
  function toggle(key: string) {
    const next = new Set(checked)
    if (next.has(key)) next.delete(key); else next.add(key)
    onCheckedChange(next)
  }
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {schemaKeys.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {schemaKeys.map(k => (
            <label key={k} style={{
              display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer',
              padding: '3px 8px', borderRadius: 4, border: '1px solid var(--bg-border)',
              background: checked.has(k) ? 'rgba(249,115,22,0.12)' : 'var(--bg-elevated)',
              color: checked.has(k) ? 'var(--accent-energy)' : 'var(--text-primary, #E7E5E4)',
            }}>
              <input type="checkbox" style={{ display: 'none' }} checked={checked.has(k)} onChange={() => toggle(k)} />
              {k}
            </label>
          ))}
        </div>
      )}
      <input
        style={inputStyle}
        value={custom}
        onChange={e => onCustomChange(e.target.value)}
        placeholder="Otras claves separadas por coma: temp_aceite, presion_entrada"
      />
    </div>
  )
}

interface Props {
  typeId: string
  sensorSchema: SensorDef[]
}

export default function WorkCycleDefsSection({ typeId, sensorSchema }: Props) {
  const qc = useQueryClient()
  const schemaKeys = sensorSchema.map(s => s.key)

  const [editingDef, setEditingDef] = useState<WorkCycleDefinition | 'new' | null>(null)
  const [form, setForm] = useState<CycleDefForm>(emptyForm)
  const [modalError, setModalError] = useState<string | null>(null)

  const { data: definitions = [], isLoading } = useQuery({
    queryKey: keys.workCycleDefinitions(typeId),
    queryFn: () => apiClient.get<WorkCycleDefinition[]>(`/api/v1/work-cycles/definitions?vehicle_type_id=${typeId}`),
  })

  function invalidate() {
    qc.invalidateQueries({ queryKey: keys.workCycleDefinitions(typeId) })
  }

  const createMutation = useMutation({
    mutationFn: (payload: WorkCycleDefinitionCreate) =>
      apiClient.post<WorkCycleDefinition>('/api/v1/work-cycles/definitions', payload),
    onSuccess: () => { invalidate(); setEditingDef(null); setModalError(null) },
    onError: (err: Error) => setModalError(err.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<WorkCycleDefinitionCreate> }) =>
      apiClient.patch<WorkCycleDefinition>(`/api/v1/work-cycles/definitions/${id}`, payload),
    onSuccess: () => { invalidate(); setEditingDef(null); setModalError(null) },
    onError: (err: Error) => setModalError(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/work-cycles/definitions/${id}`),
    onSuccess: invalidate,
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiClient.patch<WorkCycleDefinition>(`/api/v1/work-cycles/definitions/${id}`, { active }),
    onSuccess: invalidate,
  })

  function openNew() {
    setForm(emptyForm)
    setModalError(null)
    setEditingDef('new')
  }

  function openEdit(d: WorkCycleDefinition) {
    setForm(defToForm(d, schemaKeys))
    setModalError(null)
    setEditingDef(d)
  }

  function closeModal() {
    setEditingDef(null)
    setModalError(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setModalError('El nombre es obligatorio'); return }
    const payload = formToPayload(form, typeId)
    if (editingDef === 'new') {
      createMutation.mutate(payload)
    } else if (editingDef) {
      updateMutation.mutate({ id: editingDef.id, payload })
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending
  const needsSensor = form.trigger_type === 'threshold_exceeded' || form.trigger_type === 'sensor_pulse'

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Ciclos de trabajo
        </span>
        <button style={btnPrimary} onClick={openNew}>+ Añadir definición</button>
      </div>

      {isLoading ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Cargando…</p>
      ) : definitions.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sin definiciones de ciclos configuradas</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
              {['NOMBRE', 'TRIGGER', 'CONFIG', 'SNAPSHOT', 'AGGREGATE', 'ACTIVO', ''].map(h => (
                <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-muted)', fontSize: 10, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {definitions.map(d => (
              <tr key={d.id} style={{ borderBottom: '1px solid var(--bg-border)' }}>
                <td style={{ padding: '6px 8px', fontWeight: 600 }}>{d.name}</td>
                <td style={{ padding: '6px 8px', color: 'var(--accent-energy)', fontFamily: 'var(--font-data)', fontSize: 11 }}>{d.trigger_type}</td>
                <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontFamily: 'var(--font-data)', fontSize: 11 }}>{triggerConfigSummary(d)}</td>
                <td style={{ padding: '6px 8px', color: 'var(--accent-off)' }}>
                  {(d.snapshot_fields ?? []).length > 0 ? `${d.snapshot_fields!.length} campos` : '—'}
                </td>
                <td style={{ padding: '6px 8px', color: 'var(--accent-off)' }}>
                  {(d.aggregate_fields ?? []).length > 0 ? `${d.aggregate_fields!.length} campos` : '—'}
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <button
                    onClick={() => toggleMutation.mutate({ id: d.id, active: !d.active })}
                    style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 4, border: 'none', cursor: 'pointer',
                      background: d.active ? 'rgba(34,197,94,0.15)' : 'rgba(120,113,108,0.2)',
                      color: d.active ? 'var(--accent-ok)' : 'var(--accent-off)',
                    }}
                  >
                    {d.active ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
                <td style={{ padding: '6px 8px', display: 'flex', gap: 6 }}>
                  <button style={{ ...btnSecondary, padding: '3px 10px', fontSize: 11 }} onClick={() => openEdit(d)}>✎</button>
                  <button
                    style={{ ...btnSecondary, padding: '3px 10px', fontSize: 11, color: 'var(--accent-crit)', borderColor: 'var(--accent-crit)' }}
                    onClick={() => deleteMutation.mutate(d.id)}
                  >✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editingDef !== null && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, overflow: 'auto', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 10, padding: 24, width: 520, maxWidth: '90vw', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary, #E7E5E4)' }}>
              {editingDef === 'new' ? 'Nueva definición de ciclo' : 'Editar definición de ciclo'}
            </h3>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={labelStyle}>NOMBRE *</label>
                <input
                  style={inputStyle}
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="ej. Ciclo bomba agua"
                  required
                />
              </div>

              <div>
                <label style={labelStyle} id="trigger-label">TIPO DE TRIGGER *</label>
                <select
                  aria-labelledby="trigger-label"
                  style={inputStyle}
                  value={form.trigger_type}
                  onChange={e => setForm(f => ({ ...f, trigger_type: e.target.value, sensor: '', sensorCustom: '' }))}
                >
                  {TRIGGER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              {needsSensor && (
                <div>
                  <label style={labelStyle}>SENSOR (CLAVE EN can_data)</label>
                  <select
                    style={inputStyle}
                    value={form.sensor}
                    onChange={e => setForm(f => ({ ...f, sensor: e.target.value, sensorCustom: '' }))}
                  >
                    <option value="">— Selecciona —</option>
                    {schemaKeys.map(k => <option key={k} value={k}>{k}</option>)}
                    <option value="__custom__">Otro…</option>
                  </select>
                  {form.sensor === '__custom__' && (
                    <input
                      style={{ ...inputStyle, marginTop: 6 }}
                      value={form.sensorCustom}
                      onChange={e => setForm(f => ({ ...f, sensorCustom: e.target.value }))}
                      placeholder="clave_manual"
                    />
                  )}
                </div>
              )}

              {form.trigger_type === 'threshold_exceeded' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
                  <div>
                    <label style={labelStyle}>OPERADOR</label>
                    <select style={inputStyle} value={form.op} onChange={e => setForm(f => ({ ...f, op: e.target.value }))}>
                      {['>', '>=', '<', '<='].map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>UMBRAL</label>
                    <input
                      type="number" step="any" style={inputStyle} value={form.threshold}
                      onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))}
                      placeholder="ej. 280"
                    />
                  </div>
                </div>
              )}

              {form.trigger_type === 'sensor_pulse' && (
                <div>
                  <label style={labelStyle}>SEPARACIÓN MÍNIMA ENTRE PULSOS (segundos)</label>
                  <input
                    type="number" min="1" style={inputStyle} value={form.min_gap}
                    onChange={e => setForm(f => ({ ...f, min_gap: e.target.value }))}
                  />
                </div>
              )}

              <FieldPicker
                label="SNAPSHOT FIELDS (valor al inicio y fin del ciclo)"
                schemaKeys={schemaKeys}
                checked={form.snapshotChecked}
                custom={form.snapshotCustom}
                onCheckedChange={snapshotChecked => setForm(f => ({ ...f, snapshotChecked }))}
                onCustomChange={snapshotCustom => setForm(f => ({ ...f, snapshotCustom }))}
              />

              <FieldPicker
                label="AGGREGATE FIELDS (suma/media/máx durante el ciclo)"
                schemaKeys={schemaKeys}
                checked={form.aggregateChecked}
                custom={form.aggregateCustom}
                onCheckedChange={aggregateChecked => setForm(f => ({ ...f, aggregateChecked }))}
                onCustomChange={aggregateCustom => setForm(f => ({ ...f, aggregateCustom }))}
              />

              {modalError && (
                <div style={{ color: 'var(--accent-crit)', fontSize: 12 }}>{modalError}</div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" style={btnSecondary} onClick={closeModal}>Cancelar</button>
                <button type="submit" style={btnPrimary} disabled={isPending}>
                  {isPending ? 'Guardando…' : editingDef === 'new' ? 'Crear' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Ejecutar los tests**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run src/features/vehicles/__tests__/WorkCycleDefsSection.test.tsx 2>&1 | tail -30
```

Resultado esperado: todos los tests en verde.

- [ ] **Step 3: Verificar TypeScript**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -30
```

Resultado esperado: sin errores.

- [ ] **Step 4: Commit**

```bash
cd /opt/cmg-telematic1/frontend && git add src/features/vehicles/WorkCycleDefsSection.tsx src/features/vehicles/__tests__/WorkCycleDefsSection.test.tsx && git commit -m "feat(vehicles): WorkCycleDefsSection — CRUD de definiciones de ciclos por tipo"
```

---

## Task 3: Integrar en VehicleTypesPage

**Files:**
- Modify: `frontend/src/features/vehicles/VehicleTypesPage.tsx`

El fichero ya importa `SensorDef` de `../../lib/types`. Solo hay que añadir el import del nuevo componente y renderizar la sección en el lugar correcto.

- [ ] **Step 1: Añadir el import al principio de VehicleTypesPage.tsx**

Localizar la línea del import de `Shell` (línea ~4) y añadir el import del nuevo componente justo después de los imports existentes:

```tsx
import WorkCycleDefsSection from './WorkCycleDefsSection'
```

- [ ] **Step 2: Añadir la sección en el panel derecho**

Localizar el bloque de la sección DOUT (empieza con `{/* ── DOUT (salidas digitales) section`). Inmediatamente **después** de ese bloque (que termina con `</div>` + `)}`) y **antes** del bloque de reglas de alerta (`{/* ── Alert rules for this type`), insertar:

```tsx
{/* ── Ciclos de trabajo ─────────────────────────────────────────── */}
{user?.tenant_tier === 'cmg' && user?.role === 'admin' && selectedType && (
  <WorkCycleDefsSection
    typeId={selectedType.id}
    sensorSchema={selectedType.sensor_schema as SensorDef[]}
  />
)}
```

- [ ] **Step 3: Verificar TypeScript**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -20
```

Resultado esperado: sin errores.

- [ ] **Step 4: Ejecutar todos los tests del proyecto**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run 2>&1 | tail -20
```

Resultado esperado: todos los tests en verde.

- [ ] **Step 5: Commit**

```bash
cd /opt/cmg-telematic1/frontend && git add src/features/vehicles/VehicleTypesPage.tsx && git commit -m "feat(vehicles): integrar WorkCycleDefsSection en VehicleTypesPage"
```

---

## Task 4: Build y despliegue

- [ ] **Step 1: Build de producción**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -20
```

Resultado esperado: `built in X.XXs` sin errores.

- [ ] **Step 2: Reconstruir y redeployar el contenedor frontend**

```bash
cd /opt/cmg-telematic1 && docker build -t cmg-frontend ./frontend && docker stop cmg-frontend-1 && docker run -d --name cmg-frontend-1 --network cmg-telematic1_default -p 3000:80 cmg-frontend
```

> Nota: ajustar el nombre del contenedor si difiere (`docker ps | grep frontend` para verificar).

- [ ] **Step 3: Verificar en producción**

Ir a `https://cmgtrack.com/tipos-vehiculo`, seleccionar un tipo de vehículo, y confirmar que aparece la sección "CICLOS DE TRABAJO" con el botón "+ Añadir definición". Crear una definición, editarla, y borrarla para validar el flujo completo.
