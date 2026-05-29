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
  border: '1px solid var(--border)',
  color: 'var(--fg-primary)',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--offline)',
  fontWeight: 600,
  letterSpacing: '0.04em',
  marginBottom: 4,
  display: 'block',
}

const btnPrimary: React.CSSProperties = {
  background: 'var(--cmg-teal)',
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
  color: 'var(--fg-primary)',
  border: '1px solid var(--border)',
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
              padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)',
              background: checked.has(k) ? 'rgba(249,115,22,0.12)' : 'var(--bg-elevated)',
              color: checked.has(k) ? 'var(--cmg-teal)' : 'var(--fg-primary)',
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
    if (form.trigger_type === 'threshold_exceeded' && form.threshold.trim() === '') {
      setModalError('El umbral es obligatorio para este tipo de trigger')
      return
    }
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
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Ciclos de trabajo
        </span>
        <button style={btnPrimary} onClick={openNew}>+ Añadir definición</button>
      </div>

      {isLoading ? (
        <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Cargando…</p>
      ) : definitions.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Sin definiciones de ciclos configuradas</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['NOMBRE', 'TRIGGER', 'CONFIG', 'SNAPSHOT', 'AGGREGATE', 'ACTIVO', ''].map(h => (
                <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {definitions.map(d => (
              <tr key={d.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px', fontWeight: 600 }}>{d.name}</td>
                <td style={{ padding: '6px 8px', color: 'var(--cmg-teal)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{d.trigger_type}</td>
                <td style={{ padding: '6px 8px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{triggerConfigSummary(d)}</td>
                <td style={{ padding: '6px 8px', color: 'var(--offline)' }}>
                  {(d.snapshot_fields ?? []).length > 0 ? `${d.snapshot_fields!.length} campos` : '—'}
                </td>
                <td style={{ padding: '6px 8px', color: 'var(--offline)' }}>
                  {(d.aggregate_fields ?? []).length > 0 ? `${d.aggregate_fields!.length} campos` : '—'}
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <button
                    onClick={() => toggleMutation.mutate({ id: d.id, active: !d.active })}
                    style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 4, border: 'none', cursor: 'pointer',
                      background: d.active ? 'rgba(34,197,94,0.15)' : 'rgba(120,113,108,0.2)',
                      color: d.active ? 'var(--ok)' : 'var(--offline)',
                    }}
                  >
                    {d.active ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={{ ...btnSecondary, padding: '3px 10px', fontSize: 11 }} onClick={() => openEdit(d)}>✎</button>
                    <button
                      style={{ ...btnSecondary, padding: '3px 10px', fontSize: 11, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      onClick={() => deleteMutation.mutate(d.id)}
                    >✕</button>
                  </div>
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
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, width: 520, maxWidth: '90vw', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--fg-primary)' }}>
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
                <div style={{ color: 'var(--danger)', fontSize: 12 }}>{modalError}</div>
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
