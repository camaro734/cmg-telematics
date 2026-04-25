import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleTypeOut, SensorDef, MaintenanceTemplateItem, RuleOut, HistoricMetricItem, DoutSlot } from '../../lib/types'
import { useAuthStore } from '../auth/useAuthStore'
import { AVL_NAMES, AVL_OPTIONS } from '../../lib/avlNames'

// ── Form state types ───────────────────────────────────────────────────────

type TypeFormState = { name: string; slug: string }
const emptyTypeForm: TypeFormState = { name: '', slug: '' }

type SensorFormState = {
  avl_id: string; key: string; label: string; unit: string
  mode: 'byte' | 'bit'
  gauge_type: SensorDef['gauge_type']
  bit_index: string; scale: string; min: string; max: string
  warn_above: string; alert_above: string; warn_below: string; alert_below: string
}
const emptySensorForm: SensorFormState = {
  avl_id: '', key: '', label: '', unit: '', mode: 'byte', gauge_type: 'numeric',
  bit_index: '', scale: '', min: '', max: '',
  warn_above: '', alert_above: '', warn_below: '', alert_below: '',
}

type TemplateFormState = {
  name: string
  thresholdType: 'pto_hours' | 'engine_hours' | 'calendar_days'
  value: string
  warn_before_pct: string
}
const emptyTemplateForm: TemplateFormState = {
  name: '', thresholdType: 'pto_hours', value: '', warn_before_pct: '10',
}

function sensorDefToForm(def: SensorDef): SensorFormState {
  const isBit = def.gauge_type === 'led' && def.bit_index !== undefined
  return {
    avl_id: def.avl_id?.toString() ?? '',
    key: def.key,
    label: def.label,
    unit: def.unit ?? '',
    mode: isBit ? 'bit' : 'byte',
    gauge_type: isBit ? 'numeric' : def.gauge_type,
    bit_index: def.bit_index?.toString() ?? '',
    scale: def.scale?.toString() ?? '',
    min: def.min?.toString() ?? '',
    max: def.max?.toString() ?? '',
    warn_above: def.warn_above?.toString() ?? '',
    alert_above: def.alert_above?.toString() ?? '',
    warn_below: def.warn_below?.toString() ?? '',
    alert_below: def.alert_below?.toString() ?? '',
  }
}

function formToSensorDef(f: SensorFormState): SensorDef {
  const gauge_type: SensorDef['gauge_type'] = f.mode === 'bit' ? 'led' : f.gauge_type
  const def: SensorDef = {
    avl_id: f.avl_id ? parseInt(f.avl_id) : undefined,
    key: f.key || f.label.toLowerCase().replace(/\s+/g, '_'),
    label: f.label,
    unit: f.unit || null,
    gauge_type,
  }
  if (f.mode === 'bit' && f.bit_index !== '') def.bit_index = parseInt(f.bit_index)
  if (f.mode === 'byte' && f.scale !== '') def.scale = parseFloat(f.scale)
  if (f.mode === 'byte' && ['circular', 'linear'].includes(gauge_type)) {
    if (f.min !== '') def.min = parseFloat(f.min)
    if (f.max !== '') def.max = parseFloat(f.max)
  }
  if (f.mode === 'byte') {
    if (f.warn_above !== '') def.warn_above = parseFloat(f.warn_above)
    if (f.alert_above !== '') def.alert_above = parseFloat(f.alert_above)
    if (f.warn_below !== '') def.warn_below = parseFloat(f.warn_below)
    if (f.alert_below !== '') def.alert_below = parseFloat(f.alert_below)
  }
  return def
}

async function uploadIcon(typeId: string, file: File): Promise<VehicleTypeOut> {
  const token = useAuthStore.getState().accessToken
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`/api/v1/vehicle-types/${typeId}/icon`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status}: ${text}`)
  }
  return res.json()
}

// ── Shared styles ──────────────────────────────────────────────────────────

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

const GAUGE_TYPES: SensorDef['gauge_type'][] = ['circular', 'linear', 'battery', 'numeric', 'led']

const KPI_OPTIONS = [
  { key: 'engine_on_minutes', label: 'Horas motor',  unit: 'h',    transform: 0.01667, color: '#22C55E' },
  { key: 'pto_active_minutes', label: 'Horas PTO',   unit: 'h',    transform: 0.01667, color: '#F97316' },
  { key: 'distance_km',        label: 'Distancia',   unit: 'km',   transform: 1,       color: '#38BDF8' },
  { key: 'max_speed_kmh',      label: 'Vel. máxima', unit: 'km/h', transform: 1,       color: '#EAB308' },
  { key: 'pto_cycles',         label: 'Ciclos PTO',  unit: '',     transform: 1,       color: '#A78BFA' },
]

type MetricFormState = {
  key: string
  label: string
  color: string
  unit: string
  transform: string
}
const emptyMetricForm: MetricFormState = {
  key: '', label: '', color: '#22C55E', unit: '', transform: '1',
}

type DoutFormState = { slot: string; label: string; enabled: boolean }
const emptyDoutForm: DoutFormState = { slot: '1', label: '', enabled: true }

// ── Component ──────────────────────────────────────────────────────────────

export default function VehicleTypesPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)

  const { data: vehicleTypes = [], isLoading } = useQuery<VehicleTypeOut[]>({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: 30_000,
  })

  const [selectedTypeId, setSelectedTypeId] = useState<string>('')
  const selectedType = vehicleTypes.find(vt => vt.id === selectedTypeId) ?? vehicleTypes[0]

  // ── Type modal state ──────────────────────────────────────────────────────
  const [showTypeModal, setShowTypeModal] = useState(false)
  const [editingType, setEditingType] = useState<VehicleTypeOut | null>(null)
  const [typeForm, setTypeForm] = useState<TypeFormState>(emptyTypeForm)

  function openNewType() {
    setEditingType(null)
    setTypeForm(emptyTypeForm)
    setShowTypeModal(true)
  }

  function openEditType(vt: VehicleTypeOut) {
    setEditingType(vt)
    setTypeForm({ name: vt.name, slug: vt.slug })
    setShowTypeModal(true)
  }

  const createTypeMutation = useMutation({
    mutationFn: (body: { name: string; slug: string }) =>
      apiClient.post<VehicleTypeOut>('/api/v1/vehicle-types', body),
    onSuccess: (newType) => {
      qc.invalidateQueries({ queryKey: keys.vehicleTypes() })
      setSelectedTypeId(newType.id)
      setShowTypeModal(false)
    },
  })

  const updateTypeMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; slug?: string } }) =>
      apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.vehicleTypes() })
      setShowTypeModal(false)
    },
  })

  function saveType() {
    if (!typeForm.name.trim() || !typeForm.slug.trim()) return
    if (editingType) {
      updateTypeMutation.mutate({ id: editingType.id, body: typeForm })
    } else {
      createTypeMutation.mutate(typeForm)
    }
  }

  // ── Sensor modal state ────────────────────────────────────────────────────
  const [showSensorModal, setShowSensorModal] = useState(false)
  const [editingSensorIdx, setEditingSensorIdx] = useState<number | null>(null)
  const [sensorForm, setSensorForm] = useState<SensorFormState>(emptySensorForm)

  function openNewSensor() {
    setEditingSensorIdx(null)
    setSensorForm(emptySensorForm)
    setShowSensorModal(true)
  }

  function openEditSensor(def: SensorDef, idx: number) {
    setEditingSensorIdx(idx)
    setSensorForm(sensorDefToForm(def))
    setShowSensorModal(true)
  }

  const updateSchemaMutation = useMutation({
    mutationFn: ({ typeId, schema }: { typeId: string; schema: SensorDef[] }) =>
      apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${typeId}/sensor-schema`, { sensor_schema: schema }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.vehicleTypes() })
      setShowSensorModal(false)
    },
  })

  function saveSensor() {
    if (!selectedType || !sensorForm.label.trim()) return
    const def = formToSensorDef(sensorForm)
    const current = selectedType.sensor_schema as SensorDef[]
    let next: SensorDef[]
    if (editingSensorIdx === null) {
      next = [...current, def]
    } else {
      next = current.map((s, i) => i === editingSensorIdx ? def : s)
    }
    updateSchemaMutation.mutate({ typeId: selectedType.id, schema: next })
  }

  function deleteSensor(idx: number) {
    if (!selectedType) return
    const current = selectedType.sensor_schema as SensorDef[]
    updateSchemaMutation.mutate({
      typeId: selectedType.id,
      schema: current.filter((_, i) => i !== idx),
    })
  }

  const iconMutation = useMutation({
    mutationFn: ({ typeId, file }: { typeId: string; file: File }) =>
      uploadIcon(typeId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.vehicleTypes() }),
  })

  // ── Maintenance template modal state ──────────────────────────────────────
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [editingTemplateIdx, setEditingTemplateIdx] = useState<number | null>(null)
  const [templateForm, setTemplateForm] = useState<TemplateFormState>(emptyTemplateForm)

  function openNewTemplate() {
    setEditingTemplateIdx(null)
    setTemplateForm(emptyTemplateForm)
    setShowTemplateModal(true)
  }

  function openEditTemplate(tmpl: MaintenanceTemplateItem, idx: number) {
    setEditingTemplateIdx(idx)
    setTemplateForm({
      name: tmpl.name,
      thresholdType: tmpl.thresholds[0]?.type ?? 'pto_hours',
      value: tmpl.thresholds[0]?.value?.toString() ?? '',
      warn_before_pct: tmpl.warn_before_pct.toString(),
    })
    setShowTemplateModal(true)
  }

  const updateTemplatesMutation = useMutation({
    mutationFn: ({ typeId, templates }: { typeId: string; templates: MaintenanceTemplateItem[] }) =>
      apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${typeId}/maintenance-templates`, { templates }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.vehicleTypes() })
      setShowTemplateModal(false)
    },
  })

  function saveTemplate() {
    if (!selectedType || !templateForm.name.trim() || !templateForm.value) return
    const newTemplate: MaintenanceTemplateItem = {
      name: templateForm.name.trim(),
      thresholds: [{ type: templateForm.thresholdType, value: parseFloat(templateForm.value) }],
      warn_before_pct: parseInt(templateForm.warn_before_pct) || 10,
    }
    const current: MaintenanceTemplateItem[] = selectedType.maintenance_templates ?? []
    let next: MaintenanceTemplateItem[]
    if (editingTemplateIdx === null) {
      next = [...current, newTemplate]
    } else {
      next = current.map((t, i) => i === editingTemplateIdx ? newTemplate : t)
    }
    updateTemplatesMutation.mutate({ typeId: selectedType.id, templates: next })
  }

  function deleteTemplate(idx: number) {
    if (!selectedType) return
    const next = (selectedType.maintenance_templates ?? []).filter((_, i) => i !== idx)
    updateTemplatesMutation.mutate({ typeId: selectedType.id, templates: next })
  }

  // ── Historic metrics modal state ──────────────────────────────────────────
  const [showMetricModal, setShowMetricModal] = useState(false)
  const [editingMetricIdx, setEditingMetricIdx] = useState<number | null>(null)
  const [metricForm, setMetricForm] = useState<MetricFormState>(emptyMetricForm)

  function openNewMetric() {
    setEditingMetricIdx(null)
    setMetricForm(emptyMetricForm)
    setShowMetricModal(true)
  }

  function openEditMetric(m: HistoricMetricItem, idx: number) {
    setEditingMetricIdx(idx)
    setMetricForm({
      key: m.key,
      label: m.label,
      color: m.color,
      unit: m.unit,
      transform: m.transform.toString(),
    })
    setShowMetricModal(true)
  }

  const updateMetricsMutation = useMutation({
    mutationFn: ({ typeId, metrics }: { typeId: string; metrics: HistoricMetricItem[] }) =>
      apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${typeId}/historic-metrics`, { metrics }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.vehicleTypes() })
      setShowMetricModal(false)
    },
  })

  function saveMetric() {
    if (!selectedType || !metricForm.key) return
    const newMetric: HistoricMetricItem = {
      key: metricForm.key,
      label: metricForm.label.trim() || metricForm.key,
      color: metricForm.color,
      unit: metricForm.unit,
      transform: parseFloat(metricForm.transform) || 1,
    }
    const current: HistoricMetricItem[] = selectedType.historic_metrics ?? []
    let next: HistoricMetricItem[]
    if (editingMetricIdx === null) {
      next = [...current, newMetric]
    } else {
      next = current.map((m, i) => i === editingMetricIdx ? newMetric : m)
    }
    updateMetricsMutation.mutate({ typeId: selectedType.id, metrics: next })
  }

  function deleteMetric(idx: number) {
    if (!selectedType) return
    const next = (selectedType.historic_metrics ?? []).filter((_, i) => i !== idx)
    updateMetricsMutation.mutate({ typeId: selectedType.id, metrics: next })
  }

  // ── DOUT config state ─────────────────────────────────────────────────────
  const [showDoutModal, setShowDoutModal] = useState(false)
  const [editingDoutIdx, setEditingDoutIdx] = useState<number | null>(null)
  const [doutForm, setDoutForm] = useState<DoutFormState>(emptyDoutForm)

  function openNewDout() {
    setEditingDoutIdx(null)
    setDoutForm(emptyDoutForm)
    setShowDoutModal(true)
  }

  function openEditDout(d: DoutSlot, idx: number) {
    setEditingDoutIdx(idx)
    setDoutForm({ slot: d.slot.toString(), label: d.label, enabled: d.enabled })
    setShowDoutModal(true)
  }

  const updateDoutMutation = useMutation({
    mutationFn: ({ typeId, dout_config }: { typeId: string; dout_config: DoutSlot[] }) =>
      apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${typeId}/dout-config`, { dout_config }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.vehicleTypes() })
      setShowDoutModal(false)
    },
  })

  function saveDout() {
    if (!selectedType || !doutForm.label.trim()) return
    const newSlot: DoutSlot = {
      slot: parseInt(doutForm.slot) || 1,
      label: doutForm.label.trim(),
      enabled: doutForm.enabled,
    }
    const current: DoutSlot[] = selectedType.dout_config ?? []
    let next: DoutSlot[]
    if (editingDoutIdx === null) {
      next = [...current, newSlot]
    } else {
      next = current.map((d, i) => i === editingDoutIdx ? newSlot : d)
    }
    updateDoutMutation.mutate({ typeId: selectedType.id, dout_config: next })
  }

  function deleteDout(idx: number) {
    if (!selectedType) return
    const next = (selectedType.dout_config ?? []).filter((_, i) => i !== idx)
    updateDoutMutation.mutate({ typeId: selectedType.id, dout_config: next })
  }

  // ── Alert rules for this type ─────────────────────────────────────────────
  const { data: allRules = [] } = useQuery({
    queryKey: keys.rules(),
    queryFn: () => apiClient.get<RuleOut[]>('/api/v1/rules'),
    staleTime: 60_000,
  })

  const typeRules = allRules.filter(
    r => r.vehicle_filter?.scope === 'type' && r.vehicle_filter?.vehicle_type_id === selectedType?.id
  )

  const typeError = createTypeMutation.error?.message ?? updateTypeMutation.error?.message ?? null
  const sensorError = updateSchemaMutation.error?.message ?? null

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Shell title="Tipos de Vehículo">
      <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

        {/* Left panel — type list */}
        <div style={{
          width: 220, flexShrink: 0,
          borderRight: '1px solid var(--bg-border)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-surface)',
        }}>
          <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--bg-border)' }}>
            <button style={{ ...btnPrimary, width: '100%', fontSize: 12 }} onClick={openNewType}>
              + Nuevo tipo
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {isLoading && <div style={{ padding: '12px', fontSize: 12, color: 'var(--accent-off)' }}>Cargando…</div>}
            {vehicleTypes.map(vt => (
              <div
                key={vt.id}
                onClick={() => setSelectedTypeId(vt.id)}
                style={{
                  padding: '8px 14px',
                  cursor: 'pointer',
                  fontSize: 13,
                  color: (selectedType?.id === vt.id) ? 'var(--accent-energy)' : 'var(--text-primary, #E7E5E4)',
                  background: (selectedType?.id === vt.id) ? 'color-mix(in srgb, var(--accent-energy) 10%, transparent)' : 'transparent',
                  borderLeft: (selectedType?.id === vt.id) ? '2px solid var(--accent-energy)' : '2px solid transparent',
                }}
              >
                <div style={{ fontWeight: 600 }}>{vt.name}</div>
                <div style={{ fontSize: 10, color: 'var(--accent-off)', marginTop: 2, fontFamily: 'var(--font-data)' }}>{vt.slug}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel — sensors */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!selectedType ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-off)', fontSize: 13 }}>
              Selecciona un tipo de vehículo
            </div>
          ) : (
            <>
              {/* Type header */}
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--bg-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  {/* Icon row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div style={{
                      width: 40, height: 40,
                      background: 'var(--bg-elevated)',
                      borderRadius: 6,
                      border: '1px solid var(--bg-border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      overflow: 'hidden',
                      flexShrink: 0,
                    }}>
                      {selectedType.icon_url
                        ? <img
                            src={selectedType.icon_url}
                            alt="icon"
                            style={{ width: 40, height: 40, objectFit: 'contain' }}
                          />
                        : <span style={{ fontSize: 18, color: 'var(--text-muted)' }}>🚛</span>
                      }
                    </div>
                    <div>
                      <label style={{
                        padding: '4px 10px',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--bg-border)',
                        borderRadius: 6,
                        fontSize: 12,
                        color: 'var(--text-default)',
                        cursor: iconMutation.isPending ? 'not-allowed' : 'pointer',
                        opacity: iconMutation.isPending ? 0.6 : 1,
                        display: 'inline-block',
                      }}>
                        {iconMutation.isPending ? 'Subiendo…' : 'Subir icono PNG'}
                        <input
                          type="file"
                          accept="image/png"
                          style={{ display: 'none' }}
                          disabled={iconMutation.isPending}
                          onChange={e => {
                            const file = e.target.files?.[0]
                            if (file) iconMutation.mutate({ typeId: selectedType.id, file })
                            e.target.value = ''
                          }}
                        />
                      </label>
                      {iconMutation.isError && (
                        <div style={{ fontSize: 11, color: 'var(--accent-crit)', marginTop: 4 }}>
                          {(iconMutation.error as Error).message}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary, #E7E5E4)' }}>{selectedType.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--accent-off)', fontFamily: 'var(--font-data)', marginTop: 2 }}>slug: {selectedType.slug}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={btnSecondary} onClick={() => openEditType(selectedType)}>Editar tipo</button>
                  <button style={btnPrimary} onClick={openNewSensor}>+ Añadir sensor</button>
                </div>
              </div>

              {/* Sensor table */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
                {(selectedType.sensor_schema as SensorDef[]).length === 0 ? (
                  <div style={{ color: 'var(--accent-off)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>
                    No hay sensores configurados. Pulsa "+ Añadir sensor" para mapear un AVL ID.
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-elevated)' }}>
                        {['AVL ID', 'Nombre', 'Unidad', 'Gauge', 'Bit / Scale', 'Key', ''].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '7px 10px', color: 'var(--accent-off)', fontWeight: 600, borderBottom: '1px solid var(--bg-border)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedType.sensor_schema as SensorDef[]).map((def, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--bg-elevated)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-data)', color: 'var(--accent-energy)' }}>
                            {def.avl_id !== undefined ? `avl_${def.avl_id}` : '—'}
                          </td>
                          <td style={{ padding: '6px 10px', color: 'var(--text-primary, #E7E5E4)', fontWeight: 600 }}>{def.label}</td>
                          <td style={{ padding: '6px 10px', color: 'var(--accent-off)' }}>{def.unit ?? '—'}</td>
                          <td style={{ padding: '6px 10px', color: 'var(--accent-off)' }}>{def.gauge_type}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-data)', color: 'var(--accent-info, #38BDF8)' }}>
                            {def.bit_index !== undefined ? `bit ${def.bit_index}` : def.scale !== undefined ? `×${def.scale}` : '—'}
                          </td>
                          <td style={{ padding: '6px 10px', color: 'var(--accent-off)', fontFamily: 'var(--font-data)', fontSize: 11 }}>{def.key}</td>
                          <td style={{ padding: '6px 10px', display: 'flex', gap: 6 }}>
                            <button
                              onClick={() => openEditSensor(def, idx)}
                              style={{ ...btnSecondary, padding: '3px 10px', fontSize: 11 }}
                            >✎</button>
                            <button
                              onClick={() => deleteSensor(idx)}
                              style={{ ...btnSecondary, padding: '3px 10px', fontSize: 11, color: 'var(--accent-crit, #EF4444)' }}
                            >✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* ── Maintenance templates section ──────────────────────────────────────── */}
                {user?.tenant_tier === 'cmg' && user?.role === 'admin' && selectedType && (
                  <div style={{ marginTop: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        Planes de mantenimiento
                      </span>
                      <button style={btnPrimary} onClick={openNewTemplate}>+ Añadir</button>
                    </div>
                    {(selectedType.maintenance_templates ?? []).length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sin plantillas configuradas</p>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
                            {['NOMBRE', 'UMBRAL', 'VALOR', '% AVISO', ''].map(h => (
                              <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-muted)', fontSize: 10, fontWeight: 600 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(selectedType.maintenance_templates ?? []).map((tmpl, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--bg-border)' }}>
                              <td style={{ padding: '6px 8px' }}>{tmpl.name}</td>
                              <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>
                                {{ pto_hours: 'h PTO', engine_hours: 'h motor', calendar_days: 'días' }[tmpl.thresholds[0]?.type] ?? tmpl.thresholds[0]?.type}
                              </td>
                              <td style={{ padding: '6px 8px', fontFamily: 'var(--font-data)' }}>{tmpl.thresholds[0]?.value}</td>
                              <td style={{ padding: '6px 8px', fontFamily: 'var(--font-data)' }}>{tmpl.warn_before_pct}%</td>
                              <td style={{ padding: '6px 8px', display: 'flex', gap: 6 }}>
                                <button style={btnSecondary} onClick={() => openEditTemplate(tmpl, idx)}>Editar</button>
                                <button style={{ ...btnSecondary, color: 'var(--accent-crit)', borderColor: 'var(--accent-crit)' }} onClick={() => deleteTemplate(idx)}>✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* ── Historic metrics section ───────────────────────────────────────────── */}
                {user?.tenant_tier === 'cmg' && user?.role === 'admin' && selectedType && (
                  <div style={{ marginTop: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        Métricas del histórico
                      </span>
                      {(selectedType.historic_metrics ?? []).length < 5 && (
                        <button style={btnPrimary} onClick={openNewMetric}>+ Añadir métrica</button>
                      )}
                    </div>
                    {(selectedType.historic_metrics ?? []).length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sin métricas configuradas</p>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
                            {['MÉTRICA', 'ETIQUETA', 'COLOR', 'UNIDAD', ''].map(h => (
                              <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-muted)', fontSize: 10, fontWeight: 600 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(selectedType.historic_metrics ?? []).map((m, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--bg-border)' }}>
                              <td style={{ padding: '6px 8px', fontFamily: 'var(--font-data)', color: 'var(--accent-off)', fontSize: 11 }}>{m.key}</td>
                              <td style={{ padding: '6px 8px' }}>{m.label}</td>
                              <td style={{ padding: '6px 8px' }}>
                                <span style={{
                                  display: 'inline-block', width: 16, height: 16, borderRadius: 3,
                                  background: m.color, verticalAlign: 'middle',
                                  border: '1px solid rgba(255,255,255,0.15)',
                                }} />
                                <span style={{ marginLeft: 6, fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--accent-off)' }}>{m.color}</span>
                              </td>
                              <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{m.unit || '—'}</td>
                              <td style={{ padding: '6px 8px', display: 'flex', gap: 6 }}>
                                <button style={btnSecondary} onClick={() => openEditMetric(m, idx)}>✎</button>
                                <button style={{ ...btnSecondary, color: 'var(--accent-crit)', borderColor: 'var(--accent-crit)' }} onClick={() => deleteMetric(idx)}>✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* ── DOUT (salidas digitales) section ──────────────────────────────────── */}
                {user?.tenant_tier === 'cmg' && user?.role === 'admin' && selectedType && (
                  <div style={{ marginTop: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        Salidas digitales (controles de mando)
                      </span>
                      {(selectedType.dout_config ?? []).length < 4 && (
                        <button style={btnPrimary} onClick={openNewDout}>+ Añadir salida</button>
                      )}
                    </div>
                    {(selectedType.dout_config ?? []).length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sin salidas configuradas. Máximo 4 (DOUT1–DOUT4 del FMC650).</p>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
                            {['DOUT', 'ETIQUETA', 'HABILITADO', ''].map(h => (
                              <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-muted)', fontSize: 10, fontWeight: 600 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(selectedType.dout_config ?? []).map((d, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--bg-border)' }}>
                              <td style={{ padding: '6px 8px', fontFamily: 'var(--font-data)', color: 'var(--accent-energy)' }}>DOUT{d.slot}</td>
                              <td style={{ padding: '6px 8px', fontWeight: 600 }}>{d.label}</td>
                              <td style={{ padding: '6px 8px' }}>
                                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600,
                                  background: d.enabled ? 'color-mix(in srgb, var(--accent-ok) 15%, transparent)' : 'transparent',
                                  color: d.enabled ? 'var(--accent-ok)' : 'var(--text-muted)',
                                  border: `1px solid ${d.enabled ? 'var(--accent-ok)' : 'var(--bg-border)'}`,
                                }}>
                                  {d.enabled ? 'Sí' : 'No'}
                                </span>
                              </td>
                              <td style={{ padding: '6px 8px', display: 'flex', gap: 6 }}>
                                <button style={btnSecondary} onClick={() => openEditDout(d, idx)}>✎</button>
                                <button style={{ ...btnSecondary, color: 'var(--accent-crit)', borderColor: 'var(--accent-crit)' }} onClick={() => deleteDout(idx)}>✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* ── Alert rules for this type ──────────────────────────────────────────── */}
                {user?.tenant_tier === 'cmg' && user?.role === 'admin' && selectedType && (
                  <div style={{ marginTop: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        Reglas de alerta
                      </span>
                      <button style={btnPrimary} onClick={() => navigate(`/rules/new?type_id=${selectedType.id}`)}>+ Nueva regla</button>
                    </div>
                    {typeRules.length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sin reglas configuradas para este tipo</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {typeRules.map(r => (
                          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-base)', borderRadius: 6, padding: '6px 10px' }}>
                            <span style={{ fontSize: 12 }}>{r.name}</span>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: r.severity === 'critical' ? 'var(--accent-crit)' : r.severity === 'warning' ? 'var(--accent-warn)' : 'var(--accent-info)', color: '#fff', fontWeight: 600, textTransform: 'uppercase' }}>
                                {r.severity}
                              </span>
                              <span style={{ fontSize: 10, color: r.active ? 'var(--accent-ok)' : 'var(--text-muted)' }}>
                                {r.active ? 'Activa' : 'Inactiva'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Modal: Tipo ─────────────────────────────────────────────── */}
      {showTypeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setShowTypeModal(false) }}
        >
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 10, padding: 24, width: 360, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary, #E7E5E4)' }}>
              {editingType ? 'Editar tipo de vehículo' : 'Nuevo tipo de vehículo'}
            </div>
            <div>
              <label style={labelStyle}>NOMBRE</label>
              <input style={inputStyle} value={typeForm.name} onChange={e => setTypeForm(f => ({ ...f, name: e.target.value }))} placeholder="Barredora Municipal" />
            </div>
            <div>
              <label style={labelStyle}>SLUG (identificador interno)</label>
              <input style={inputStyle} value={typeForm.slug} onChange={e => setTypeForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, '_') }))} placeholder="barredora_municipal" />
            </div>
            {typeError && <div style={{ fontSize: 12, color: 'var(--accent-crit, #EF4444)' }}>{typeError}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => setShowTypeModal(false)}>Cancelar</button>
              <button style={btnPrimary} onClick={saveType} disabled={!typeForm.name.trim() || !typeForm.slug.trim()}>
                {editingType ? 'Guardar' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Sensor ───────────────────────────────────────────── */}
      {showSensorModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setShowSensorModal(false) }}
        >
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 10, padding: 24, width: 500, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary, #E7E5E4)' }}>
              {editingSensorIdx === null ? 'Nuevo sensor CAN' : 'Editar sensor CAN'}
            </div>

            {/* Canal CAN */}
            <div>
              <label style={labelStyle}>CANAL CAN</label>
              <select
                style={inputStyle}
                value={AVL_OPTIONS.some(o => String(o.id) === sensorForm.avl_id) ? sensorForm.avl_id : '__custom__'}
                onChange={e => {
                  const val = e.target.value
                  if (val === '__custom__') {
                    setSensorForm(f => ({ ...f, avl_id: '' }))
                  } else {
                    const info = AVL_NAMES[`avl_${val}`]
                    setSensorForm(f => ({
                      ...f,
                      avl_id: val,
                      label: f.label || (info?.name ?? ''),
                      unit: f.unit || (info?.unit ?? ''),
                    }))
                  }
                }}
              >
                <option value="">— Selecciona canal —</option>
                {AVL_OPTIONS.map(opt => (
                  <option key={opt.id} value={String(opt.id)}>
                    {opt.id} — {opt.name}{opt.unit ? ` (${opt.unit})` : ''}
                  </option>
                ))}
                <option value="__custom__">Otro AVL ID...</option>
              </select>
              {/* Input manual si el ID no está en la lista */}
              {!AVL_OPTIONS.some(o => String(o.id) === sensorForm.avl_id) && (
                <input
                  type="number" min="1" max="65535"
                  style={{ ...inputStyle, marginTop: 6 }}
                  value={sensorForm.avl_id}
                  onChange={e => setSensorForm(f => ({ ...f, avl_id: e.target.value }))}
                  placeholder="AVL ID personalizado (1–65535)"
                />
              )}
            </div>

            {/* Modo: Byte / Bit */}
            <div>
              <label style={labelStyle}>MODO DE LECTURA</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['byte', 'bit'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setSensorForm(f => ({
                      ...f,
                      mode: m,
                      bit_index: m === 'byte' ? '' : f.bit_index,
                      gauge_type: m === 'bit' ? 'numeric' : f.gauge_type,
                    }))}
                    style={{
                      flex: 1,
                      padding: '8px 0',
                      borderRadius: 6,
                      border: sensorForm.mode === m ? '2px solid var(--accent-energy)' : '1px solid var(--bg-border)',
                      background: sensorForm.mode === m ? 'rgba(249,115,22,0.12)' : 'var(--bg-elevated)',
                      color: sensorForm.mode === m ? 'var(--accent-energy)' : 'var(--accent-off)',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {m === 'byte' ? 'Byte completo' : 'Bit individual'}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--accent-off)', marginTop: 4 }}>
                {sensorForm.mode === 'byte'
                  ? 'Usa el valor entero del canal (con multiplicador opcional)'
                  : 'Extrae un bit concreto del byte (para señales de estado 0/1)'}
              </div>
            </div>

            {/* Selector visual de bit (solo modo bit) */}
            {sensorForm.mode === 'bit' && (
              <div>
                <label style={labelStyle}>BIT A EXTRAER (0 = LSB, 7 = MSB)</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[7, 6, 5, 4, 3, 2, 1, 0].map(bit => {
                    const selected = sensorForm.bit_index === String(bit)
                    return (
                      <button
                        key={bit}
                        onClick={() => setSensorForm(f => ({ ...f, bit_index: String(bit) }))}
                        style={{
                          flex: 1,
                          padding: '8px 0',
                          borderRadius: 6,
                          border: selected ? '2px solid var(--accent-energy)' : '1px solid var(--bg-border)',
                          background: selected ? 'rgba(249,115,22,0.15)' : 'var(--bg-elevated)',
                          color: selected ? 'var(--accent-energy)' : 'var(--text-primary, #E7E5E4)',
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: 'pointer',
                          fontFamily: 'var(--font-data)',
                        }}
                      >
                        {bit}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Row: Nombre + Unidad */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>NOMBRE</label>
                <input style={inputStyle} value={sensorForm.label}
                  onChange={e => setSensorForm(f => ({ ...f, label: e.target.value }))} placeholder="Presión Hidráulica" />
              </div>
              <div>
                <label style={labelStyle}>UNIDAD</label>
                <input style={inputStyle} value={sensorForm.unit}
                  onChange={e => setSensorForm(f => ({ ...f, unit: e.target.value }))} placeholder="bar" />
              </div>
            </div>

            {/* Key */}
            <div>
              <label style={labelStyle}>KEY (interno — se genera del nombre si se deja vacío)</label>
              <input style={inputStyle} value={sensorForm.key}
                onChange={e => setSensorForm(f => ({ ...f, key: e.target.value }))} placeholder="hydraulic_pressure" />
            </div>

            {/* Opciones de byte: gauge type + scale + min/max + warn/alert */}
            {sensorForm.mode === 'byte' && (<>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>TIPO DE GAUGE</label>
                  <select style={inputStyle} value={sensorForm.gauge_type}
                    onChange={e => setSensorForm(f => ({ ...f, gauge_type: e.target.value as SensorDef['gauge_type'] }))}>
                    {GAUGE_TYPES.filter(g => g !== 'led').map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>MULTIPLICADOR (scale)</label>
                  <input type="number" step="any" style={inputStyle} value={sensorForm.scale}
                    onChange={e => setSensorForm(f => ({ ...f, scale: e.target.value }))} placeholder="1" />
                </div>
              </div>

              {['circular', 'linear'].includes(sensorForm.gauge_type) && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={labelStyle}>MÍNIMO</label>
                    <input type="number" step="any" style={inputStyle} value={sensorForm.min}
                      onChange={e => setSensorForm(f => ({ ...f, min: e.target.value }))} placeholder="0" />
                  </div>
                  <div>
                    <label style={labelStyle}>MÁXIMO</label>
                    <input type="number" step="any" style={inputStyle} value={sensorForm.max}
                      onChange={e => setSensorForm(f => ({ ...f, max: e.target.value }))} placeholder="300" />
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                {[
                  { key: 'warn_above', label: 'WARN >' },
                  { key: 'alert_above', label: 'ALERT >' },
                  { key: 'warn_below', label: 'WARN <' },
                  { key: 'alert_below', label: 'ALERT <' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label style={{ ...labelStyle, fontSize: 10 }}>{label}</label>
                    <input type="number" step="any" style={{ ...inputStyle, fontSize: 12 }}
                      value={(sensorForm as Record<string, string>)[key]}
                      onChange={e => setSensorForm(f => ({ ...f, [key]: e.target.value }))}
                      placeholder="—" />
                  </div>
                ))}
              </div>
            </>)}

            {sensorError && <div style={{ fontSize: 12, color: 'var(--accent-crit, #EF4444)' }}>{sensorError}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => setShowSensorModal(false)}>Cancelar</button>
              <button
                style={btnPrimary}
                onClick={saveSensor}
                disabled={!sensorForm.label.trim() || !sensorForm.avl_id || (sensorForm.mode === 'bit' && sensorForm.bit_index === '')}
              >
                {editingSensorIdx === null ? 'Añadir' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Métrica del histórico ───────────────────────────────── */}
      {showMetricModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
          onClick={e => { if (e.target === e.currentTarget) setShowMetricModal(false) }}
        >
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 24, width: 400, border: '1px solid var(--bg-border)', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #E7E5E4)' }}>
              {editingMetricIdx === null ? 'Nueva métrica' : 'Editar métrica'}
            </h3>

            <div>
              <label style={labelStyle}>MÉTRICA</label>
              <select
                style={inputStyle}
                value={metricForm.key}
                onChange={e => {
                  const opt = KPI_OPTIONS.find(o => o.key === e.target.value)
                  setMetricForm(f => ({
                    ...f,
                    key: e.target.value,
                    label: opt ? opt.label : f.label,
                    unit: opt ? opt.unit : f.unit,
                    color: opt ? opt.color : f.color,
                    transform: opt ? opt.transform.toString() : f.transform,
                  }))
                }}
              >
                <option value="">— Selecciona —</option>
                {KPI_OPTIONS.map(o => (
                  <option key={o.key} value={o.key}>{o.label} ({o.key})</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>ETIQUETA</label>
              <input
                style={inputStyle}
                value={metricForm.label}
                onChange={e => setMetricForm(f => ({ ...f, label: e.target.value }))}
                placeholder="Nombre visible en el histórico"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>COLOR</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="color"
                    value={metricForm.color}
                    onChange={e => setMetricForm(f => ({ ...f, color: e.target.value }))}
                    style={{ width: 36, height: 32, padding: 2, border: '1px solid var(--bg-border)', borderRadius: 6, background: 'var(--bg-elevated)', cursor: 'pointer' }}
                  />
                  <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--accent-off)' }}>{metricForm.color}</span>
                </div>
              </div>
              <div>
                <label style={labelStyle}>UNIDAD</label>
                <input
                  style={inputStyle}
                  value={metricForm.unit}
                  onChange={e => setMetricForm(f => ({ ...f, unit: e.target.value }))}
                  placeholder="h, km, km/h, …"
                />
              </div>
            </div>

            <div>
              <label style={labelStyle}>MULTIPLICADOR (transform) — ej: 0.01667 para convertir minutos a horas</label>
              <input
                type="number"
                step="any"
                min="0"
                style={inputStyle}
                value={metricForm.transform}
                onChange={e => setMetricForm(f => ({ ...f, transform: e.target.value }))}
                placeholder="1"
              />
            </div>

            {updateMetricsMutation.isError && (
              <div style={{ fontSize: 12, color: 'var(--accent-crit)' }}>
                {(updateMetricsMutation.error as Error).message}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => setShowMetricModal(false)}>Cancelar</button>
              <button
                style={btnPrimary}
                onClick={saveMetric}
                disabled={!metricForm.key || updateMetricsMutation.isPending}
              >
                {updateMetricsMutation.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Salida digital (DOUT) ──────────────────────────────── */}
      {showDoutModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
          onClick={e => { if (e.target === e.currentTarget) setShowDoutModal(false) }}
        >
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 24, width: 360, border: '1px solid var(--bg-border)', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #E7E5E4)' }}>
              {editingDoutIdx === null ? 'Nueva salida digital' : 'Editar salida digital'}
            </h3>
            <div>
              <label style={labelStyle}>DOUT (1–4)</label>
              <select style={inputStyle} value={doutForm.slot}
                onChange={e => setDoutForm(f => ({ ...f, slot: e.target.value }))}>
                {[1, 2, 3, 4].map(n => <option key={n} value={n}>DOUT{n}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>ETIQUETA (acción)</label>
              <input style={inputStyle} value={doutForm.label} placeholder="Parar motor"
                onChange={e => setDoutForm(f => ({ ...f, label: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" id="dout-enabled" checked={doutForm.enabled}
                onChange={e => setDoutForm(f => ({ ...f, enabled: e.target.checked }))} />
              <label htmlFor="dout-enabled" style={{ fontSize: 13, color: 'var(--text-primary, #E7E5E4)', cursor: 'pointer' }}>
                Habilitado (visible en controles de mando)
              </label>
            </div>
            {updateDoutMutation.isError && (
              <div style={{ fontSize: 12, color: 'var(--accent-crit)' }}>
                {(updateDoutMutation.error as Error).message}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => setShowDoutModal(false)}>Cancelar</button>
              <button style={btnPrimary} onClick={saveDout}
                disabled={!doutForm.label.trim() || updateDoutMutation.isPending}>
                {updateDoutMutation.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Plantilla de mantenimiento ──────────────────────────── */}
      {showTemplateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 24, width: 360, border: '1px solid var(--bg-border)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600 }}>
              {editingTemplateIdx === null ? 'Nueva plantilla' : 'Editar plantilla'}
            </h3>
            <label style={labelStyle}>Nombre</label>
            <input style={{ ...inputStyle, marginBottom: 12 }} value={templateForm.name}
              onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))} />
            <label style={labelStyle}>Tipo de umbral</label>
            <select style={{ ...inputStyle, marginBottom: 12 }}
              value={templateForm.thresholdType}
              onChange={e => setTemplateForm(f => ({ ...f, thresholdType: e.target.value as TemplateFormState['thresholdType'] }))}>
              <option value="pto_hours">Horas PTO</option>
              <option value="engine_hours">Horas motor</option>
              <option value="calendar_days">Días naturales</option>
            </select>
            <label style={labelStyle}>Valor</label>
            <input style={{ ...inputStyle, marginBottom: 12 }} type="number" min="1" value={templateForm.value}
              onChange={e => setTemplateForm(f => ({ ...f, value: e.target.value }))} />
            <label style={labelStyle}>% aviso previo</label>
            <input style={{ ...inputStyle, marginBottom: 20 }} type="number" min="1" max="50" value={templateForm.warn_before_pct}
              onChange={e => setTemplateForm(f => ({ ...f, warn_before_pct: e.target.value }))} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => setShowTemplateModal(false)}>Cancelar</button>
              <button style={btnPrimary} onClick={saveTemplate}
                disabled={updateTemplatesMutation.isPending}>
                {updateTemplatesMutation.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}
