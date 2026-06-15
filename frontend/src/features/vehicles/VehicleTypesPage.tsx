import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useConfirm } from '../../shared/ui/ConfirmDialog'
import { toast } from '../../shared/ui/Toast'
import type { VehicleTypeOut, SensorDef } from '../../lib/types'
import { useAuthStore } from '../auth/useAuthStore'
import { Input } from '../../shared/ui/Input'
import { Select } from '../../shared/ui/Select'
import { AVL_NAMES, AVL_OPTIONS } from '../../lib/avlNames'
import { applyTransform, formatSensorValue } from '../../lib/sensorValue'
import WorkCycleDefsSection from './WorkCycleDefsSection'
import MaintenanceTemplatesSection from './MaintenanceTemplatesSection'
import HistoricMetricsSection from './HistoricMetricsSection'
import PdfMetricsSection from './PdfMetricsSection'
import DoutConfigSection from './DoutConfigSection'
import AlertRulesSection from './AlertRulesSection'
import SystemBlocksSection from './SystemBlocksSection'

// ── Form state types ───────────────────────────────────────────────────────

type TypeFormState = { name: string; slug: string }
const emptyTypeForm: TypeFormState = { name: '', slug: '' }

type SensorFormState = {
  avl_id: string; key: string; label: string; unit: string
  mode: 'byte' | 'bit'
  gauge_type: SensorDef['gauge_type']
  bit_index: string; scale: string; offset: string; min: string; max: string
  warn_above: string; alert_above: string; warn_below: string; alert_below: string
  // Transformación de la señal cruda al valor físico
  transform_mode: 'scale_offset' | 'linear_range' | 'minutes_to_hours'
  in_min: string; in_max: string; out_min: string; out_max: string
  visible_in_detail: boolean
  show_in_popup: boolean
}
const emptySensorForm: SensorFormState = {
  avl_id: '', key: '', label: '', unit: '', mode: 'byte', gauge_type: 'numeric',
  bit_index: '', scale: '', offset: '', min: '', max: '',
  warn_above: '', alert_above: '', warn_below: '', alert_below: '',
  transform_mode: 'scale_offset',
  in_min: '', in_max: '', out_min: '', out_max: '',
  visible_in_detail: true,
  show_in_popup: false,
}

function sensorDefToForm(def: SensorDef): SensorFormState {
  const isBit = def.gauge_type === 'led' && def.bit_index !== undefined
  const lin = def.transform?.type === 'linear_range' ? def.transform : null
  const transform_mode: SensorFormState['transform_mode'] =
    def.transform?.type === 'minutes_to_hours' ? 'minutes_to_hours'
    : lin ? 'linear_range'
    : 'scale_offset'
  return {
    avl_id: def.avl_id?.toString() ?? '',
    key: def.key,
    label: def.label,
    unit: def.unit ?? '',
    mode: isBit ? 'bit' : 'byte',
    gauge_type: isBit ? 'numeric' : def.gauge_type,
    bit_index: def.bit_index?.toString() ?? '',
    scale: def.scale?.toString() ?? '',
    offset: def.offset?.toString() ?? '',
    min: def.min?.toString() ?? '',
    max: def.max?.toString() ?? '',
    warn_above: def.warn_above?.toString() ?? '',
    alert_above: def.alert_above?.toString() ?? '',
    warn_below: def.warn_below?.toString() ?? '',
    alert_below: def.alert_below?.toString() ?? '',
    transform_mode,
    in_min: lin ? lin.in_min.toString() : '',
    in_max: lin ? lin.in_max.toString() : '',
    out_min: lin ? lin.out_min.toString() : '',
    out_max: lin ? lin.out_max.toString() : '',
    visible_in_detail: def.visible_in_detail !== false,
    show_in_popup: def.show_in_popup === true,
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
  const hasRange = [f.in_min, f.in_max, f.out_min, f.out_max].every(v => v !== '')
  if (f.mode === 'byte' && f.transform_mode === 'minutes_to_hours') {
    def.transform = { type: 'minutes_to_hours' }
    def.unit = 'h'
  } else if (f.mode === 'byte' && f.transform_mode === 'linear_range' && hasRange) {
    // Rango lineal de 2 puntos: entrada → salida (4-20 mA, 0-10 V, …)
    def.transform = {
      type: 'linear_range',
      in_min: parseFloat(f.in_min),
      in_max: parseFloat(f.in_max),
      out_min: parseFloat(f.out_min),
      out_max: parseFloat(f.out_max),
    }
  } else {
    if (f.mode === 'byte' && f.scale !== '') def.scale = parseFloat(f.scale)
    if (f.mode === 'byte' && f.offset !== '') def.offset = parseFloat(f.offset)
  }
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
  def.visible_in_detail = f.visible_in_detail
  def.show_in_popup = f.show_in_popup
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

const GAUGE_TYPES: SensorDef['gauge_type'][] = ['circular', 'linear', 'battery', 'numeric', 'led']

// ── Component ──────────────────────────────────────────────────────────────

export default function VehicleTypesPage() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const confirmAsk = useConfirm()

  const { data: vehicleTypes = [], isLoading } = useQuery<VehicleTypeOut[]>({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: 30_000,
  })

  const [selectedTypeId, setSelectedTypeId] = useState<string>('')
  const selectedType = vehicleTypes.find(vt => vt.id === selectedTypeId)
    ?? (selectedTypeId === '' ? vehicleTypes[0] : undefined)

  const [duplicateSuccess, setDuplicateSuccess] = useState<string | null>(null)

  function selectType(id: string) {
    setSelectedTypeId(id)
    setDuplicateSuccess(null)
  }

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

  const duplicateTypeMutation = useMutation({
    mutationFn: async (vt: VehicleTypeOut) => {
      const ts = Date.now()
      return apiClient.post<VehicleTypeOut>('/api/v1/vehicle-types', {
        name: `Copia de ${vt.name}`,
        slug: `${vt.slug}-copy-${ts}`,
        sensor_schema: vt.sensor_schema ?? [],
        dout_config: vt.dout_config ?? [],
        maintenance_templates: vt.maintenance_templates ?? [],
        enabled_counters: (vt as any).enabled_counters ?? [],
      })
    },
    onSuccess: (newType) => {
      qc.invalidateQueries({ queryKey: keys.vehicleTypes() })
      setSelectedTypeId(newType.id)
      setDuplicateSuccess(`Tipo "${newType.name}" creado correctamente`)
      setTimeout(() => setDuplicateSuccess(null), 4000)
    },
  })

  const deleteTypeMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/vehicle-types/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.vehicleTypes() })
      setSelectedTypeId('')
    },
    onError: (err: Error) => {
      // El backend devuelve 400 si hay vehículos que usan el tipo
      toast.error(err.message || 'No se pudo eliminar el tipo de vehículo')
    },
  })

  async function handleDeleteType(vt: VehicleTypeOut) {
    const ok = await confirmAsk({
      title: 'Borrar tipo de vehículo',
      message: `¿Eliminar el tipo "${vt.name}"? Se borrarán también su configuración de sensores y bloques. Esta acción no se puede deshacer.`,
      confirmLabel: 'Borrar', kind: 'danger',
    })
    if (!ok) return
    deleteTypeMutation.mutate(vt.id)
  }

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

  const typeError = createTypeMutation.error?.message ?? updateTypeMutation.error?.message ?? null
  const sensorError = updateSchemaMutation.error?.message ?? null

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Shell title="Plantillas de Vehículo">
      <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

        {/* Left panel — type list */}
        <div style={{
          width: 220, flexShrink: 0,
          borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-surface)',
        }}>
          <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--border)' }}>
            <button style={{ ...btnPrimary, width: '100%', fontSize: 12 }} onClick={openNewType}>
              + Nuevo tipo
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {isLoading && <div style={{ padding: '12px', fontSize: 12, color: 'var(--offline)' }}>Cargando…</div>}
            {vehicleTypes.map(vt => (
              <div
                key={vt.id}
                onClick={() => selectType(vt.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px 14px',
                  cursor: 'pointer',
                  fontSize: 13,
                  color: (selectedType?.id === vt.id) ? 'var(--cmg-teal)' : 'var(--fg-primary)',
                  background: (selectedType?.id === vt.id) ? 'color-mix(in srgb, var(--cmg-teal) 10%, transparent)' : 'transparent',
                  borderLeft: (selectedType?.id === vt.id) ? '2px solid var(--cmg-teal)' : '2px solid transparent',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{vt.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--offline)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>{vt.slug}</div>
                </div>
                {user?.tenant_tier === 'cmg' && user?.role === 'admin' && (
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteType(vt) }}
                    title="Eliminar tipo"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', opacity: 0.4, fontSize: 14, padding: '2px 4px', flexShrink: 0, lineHeight: 1 }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '0.4')}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right panel — sensors + sections */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!selectedType ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--offline)', fontSize: 13 }}>
              Selecciona un tipo de vehículo
            </div>
          ) : (
            <>
              {/* Type header */}
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  {/* Icon row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div style={{
                      width: 40, height: 40,
                      background: 'var(--bg-elevated)',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
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
                        : <span style={{ fontSize: 18, color: 'var(--fg-muted)' }}>🚛</span>
                      }
                    </div>
                    <div>
                      <label style={{
                        padding: '4px 10px',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        fontSize: 12,
                        color: 'var(--fg-primary)',
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
                        <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>
                          {(iconMutation.error as Error).message}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-primary)' }}>{selectedType.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--offline)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>slug: {selectedType.slug}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={btnSecondary} onClick={() => openEditType(selectedType)}>Editar tipo</button>
                  <button
                    style={{ ...btnSecondary, fontSize: 12 }}
                    onClick={() => selectedType && duplicateTypeMutation.mutate(selectedType)}
                    disabled={duplicateTypeMutation.isPending}
                    title="Duplicar este tipo con todos sus sensores y plantillas"
                  >
                    {duplicateTypeMutation.isPending ? 'Duplicando…' : '⎘ Duplicar'}
                  </button>
                  <button
                    style={{ ...btnSecondary, fontSize: 12, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                    onClick={() => handleDeleteType(selectedType)}
                    disabled={deleteTypeMutation.isPending}
                  >
                    {deleteTypeMutation.isPending ? 'Borrando…' : 'Borrar tipo'}
                  </button>
                  <button style={btnPrimary} onClick={openNewSensor}>+ Añadir sensor</button>
                </div>
              </div>

              {/* Sensor table + subsections */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
                {((selectedType.sensor_schema as SensorDef[]) ?? []).length === 0 ? (
                  <div style={{ color: 'var(--offline)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>
                    No hay sensores configurados. Pulsa "+ Añadir sensor" para mapear un AVL ID.
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-elevated)' }}>
                        {['AVL ID', 'Nombre', 'Unidad', 'Gauge', 'Bit / Scale', 'Key', 'Detalle', 'Popup', ''].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '7px 10px', color: 'var(--offline)', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {((selectedType.sensor_schema as SensorDef[]) ?? []).map((def, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--bg-elevated)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', color: 'var(--cmg-teal)' }}>
                            {def.avl_id !== undefined ? `avl_${def.avl_id}` : '—'}
                          </td>
                          <td style={{ padding: '6px 10px', color: 'var(--fg-primary)', fontWeight: 600 }}>{def.label}</td>
                          <td style={{ padding: '6px 10px', color: 'var(--offline)' }}>{def.unit ?? '—'}</td>
                          <td style={{ padding: '6px 10px', color: 'var(--offline)' }}>{def.gauge_type}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', color: 'var(--info)' }}>
                            {def.bit_index !== undefined
                              ? `bit ${def.bit_index}`
                              : def.transform?.type === 'minutes_to_hours'
                                ? 'min → h (÷60)'
                                : def.transform?.type === 'linear_range'
                                ? `${def.transform.in_min}–${def.transform.in_max} → ${def.transform.out_min}–${def.transform.out_max}`
                                : (def.scale !== undefined || def.offset !== undefined)
                                  ? `${def.scale != null ? `×${def.scale}` : '×1'}${def.offset != null ? (def.offset >= 0 ? `+${def.offset}` : `${def.offset}`) : ''}`
                                  : '—'}
                          </td>
                          <td style={{ padding: '6px 10px', color: 'var(--offline)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{def.key}</td>
                          <td style={{ padding: '6px 10px' }}>
                            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600,
                              background: (def.visible_in_detail !== false) ? 'color-mix(in srgb, var(--ok) 15%, transparent)' : 'transparent',
                              color: (def.visible_in_detail !== false) ? 'var(--ok)' : 'var(--fg-muted)',
                              border: `1px solid ${(def.visible_in_detail !== false) ? 'var(--ok)' : 'var(--border)'}`,
                            }}>
                              {(def.visible_in_detail !== false) ? 'Sí' : 'No'}
                            </span>
                          </td>
                          <td style={{ padding: '6px 10px' }}>
                            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600,
                              background: def.show_in_popup ? 'color-mix(in srgb, var(--info) 15%, transparent)' : 'transparent',
                              color: def.show_in_popup ? 'var(--info)' : 'var(--fg-muted)',
                              border: `1px solid ${def.show_in_popup ? 'var(--info)' : 'var(--border)'}`,
                            }}>
                              {def.show_in_popup ? 'Sí' : 'No'}
                            </span>
                          </td>
                          <td style={{ padding: '6px 10px', display: 'flex', gap: 6 }}>
                            <button
                              onClick={() => openEditSensor(def, idx)}
                              style={{ ...btnSecondary, padding: '3px 10px', fontSize: 11 }}
                            >✎</button>
                            <button
                              onClick={() => deleteSensor(idx)}
                              style={{ ...btnSecondary, padding: '3px 10px', fontSize: 11, color: 'var(--danger)' }}
                            >✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* ── Extracted subsections (CMG admin only) ── */}
                {user?.tenant_tier === 'cmg' && user?.role === 'admin' && selectedType && (
                  <MaintenanceTemplatesSection typeId={selectedType.id} selectedType={selectedType} />
                )}
                {user?.tenant_tier === 'cmg' && user?.role === 'admin' && selectedType && (
                  <HistoricMetricsSection typeId={selectedType.id} selectedType={selectedType} />
                )}
                {user?.tenant_tier === 'cmg' && user?.role === 'admin' && selectedType && (
                  <div style={{ borderTop: '1px solid var(--border)', marginTop: 24, paddingTop: 24 }}>
                    <PdfMetricsSection typeId={selectedType.id} selectedType={selectedType} />
                  </div>
                )}
                {user?.tenant_tier === 'cmg' && user?.role === 'admin' && selectedType && (
                  <DoutConfigSection typeId={selectedType.id} selectedType={selectedType} />
                )}
                {user?.tenant_tier === 'cmg' && user?.role === 'admin' && selectedType && (
                  <WorkCycleDefsSection
                    typeId={selectedType.id}
                    sensorSchema={selectedType.sensor_schema as SensorDef[]}
                  />
                )}
                {user?.tenant_tier === 'cmg' && user?.role === 'admin' && selectedType && (
                  <AlertRulesSection typeId={selectedType.id} selectedType={selectedType} />
                )}
                {user?.tenant_tier === 'cmg' && user?.role === 'admin' && selectedType && (
                  <SystemBlocksSection typeId={selectedType.id} selectedType={selectedType} />
                )}
                {user?.tenant_tier === 'cmg' && user?.role === 'admin' && (
                  <div style={{ borderTop: '1px solid var(--border)', marginTop: 24, paddingTop: 20 }}>
                    <a
                      href="/plantillas-bloques"
                      style={{ ...btnSecondary, display: 'inline-block', textDecoration: 'none', fontSize: 13 }}
                    >
                      Gestionar plantillas de bloques →
                    </a>
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
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, width: 360, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg-primary)' }}>
              {editingType ? 'Editar tipo de vehículo' : 'Nuevo tipo de vehículo'}
            </div>
            <div>
              <label style={labelStyle}>NOMBRE</label>
              <Input value={typeForm.name} onChange={e => setTypeForm(f => ({ ...f, name: e.target.value }))} placeholder="Barredora Municipal" />
            </div>
            <div>
              <label style={labelStyle}>SLUG (identificador interno)</label>
              <Input value={typeForm.slug} mono onChange={e => setTypeForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, '_') }))} placeholder="barredora_municipal" />
            </div>
            {typeError && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{typeError}</div>}
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
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, width: 500, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg-primary)' }}>
              {editingSensorIdx === null ? 'Nuevo sensor CAN' : 'Editar sensor CAN'}
            </div>

            {/* Canal CAN */}
            <div>
              <label style={labelStyle}>CANAL CAN</label>
              <Select value={AVL_OPTIONS.some(o => String(o.id) === sensorForm.avl_id) ? sensorForm.avl_id : '__custom__'}
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
                }}>
                <option value="">— Selecciona canal —</option>
                {AVL_OPTIONS.map(opt => (
                  <option key={opt.id} value={String(opt.id)}>
                    {opt.id} — {opt.name}{opt.unit ? ` (${opt.unit})` : ''}
                  </option>
                ))}
                <option value="__custom__">Otro AVL ID...</option>
              </Select>
              {/* Input manual si el ID no está en la lista */}
              {!AVL_OPTIONS.some(o => String(o.id) === sensorForm.avl_id) && (
                <Input type="number" min="1" max="65535" style={{ marginTop: 6 }}
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
                      border: sensorForm.mode === m ? '2px solid var(--cmg-teal)' : '1px solid var(--border)',
                      background: sensorForm.mode === m ? 'rgba(249,115,22,0.12)' : 'var(--bg-elevated)',
                      color: sensorForm.mode === m ? 'var(--cmg-teal)' : 'var(--offline)',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {m === 'byte' ? 'Byte completo' : 'Bit individual'}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--offline)', marginTop: 4 }}>
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
                          border: selected ? '2px solid var(--cmg-teal)' : '1px solid var(--border)',
                          background: selected ? 'rgba(249,115,22,0.15)' : 'var(--bg-elevated)',
                          color: selected ? 'var(--cmg-teal)' : 'var(--fg-primary)',
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: 'pointer',
                          fontFamily: 'var(--font-mono)',
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
                <Input value={sensorForm.label}
                  onChange={e => setSensorForm(f => ({ ...f, label: e.target.value }))} placeholder="Presión Hidráulica" />
              </div>
              <div>
                <label style={labelStyle}>UNIDAD</label>
                <Input value={sensorForm.unit}
                  onChange={e => setSensorForm(f => ({ ...f, unit: e.target.value }))} placeholder="bar" />
              </div>
            </div>

            {/* Key */}
            <div>
              <label style={labelStyle}>KEY (interno — se genera del nombre si se deja vacío)</label>
              <Input mono value={sensorForm.key}
                onChange={e => setSensorForm(f => ({ ...f, key: e.target.value }))} placeholder="hydraulic_pressure" />
            </div>

            {/* Opciones de byte: gauge type + scale + min/max + warn/alert */}
            {sensorForm.mode === 'byte' && (<>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>TIPO DE GAUGE</label>
                  <Select value={sensorForm.gauge_type}
                    onChange={e => setSensorForm(f => ({ ...f, gauge_type: e.target.value as SensorDef['gauge_type'] }))}>
                    {GAUGE_TYPES.filter(g => g !== 'led').map(g => <option key={g} value={g}>{g}</option>)}
                  </Select>
                </div>
                <div>
                  <label style={labelStyle}>TRANSFORMACIÓN</label>
                  <Select value={sensorForm.transform_mode}
                    onChange={e => {
                      const m = e.target.value as SensorFormState['transform_mode']
                      setSensorForm(f => ({ ...f, transform_mode: m, ...(m === 'minutes_to_hours' ? { unit: 'h' } : {}) }))
                    }}>
                    <option value="scale_offset">Escala / offset</option>
                    <option value="linear_range">Rango lineal (4-20 mA / 0-10 V)</option>
                    <option value="minutes_to_hours">Minutos → horas (÷60)</option>
                  </Select>
                </div>
              </div>

              {sensorForm.transform_mode === 'minutes_to_hours' ? (
                <div style={{ fontSize: 12, color: 'var(--fg-muted)', background: 'var(--bg-elevated)', borderRadius: 8, padding: '10px 12px' }}>
                  El valor (en minutos) se divide entre 60 y se muestra en <b>horas decimales</b> (unidad <b>h</b>).
                  <span style={{ color: 'var(--cmg-teal)', fontFamily: 'var(--font-mono)', marginLeft: 8 }}>ej.: 150 → 2.5 h</span>
                </div>
              ) : sensorForm.transform_mode === 'scale_offset' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={labelStyle}>MULTIPLICADOR (scale)</label>
                    <Input type="number" step="any" value={sensorForm.scale}
                      onChange={e => setSensorForm(f => ({ ...f, scale: e.target.value }))} placeholder="1" />
                  </div>
                  <div>
                    <label style={labelStyle}>OFFSET (suma/resta)</label>
                    <Input type="number" step="any" value={sensorForm.offset}
                      onChange={e => setSensorForm(f => ({ ...f, offset: e.target.value }))} placeholder="0" />
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg-elevated)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                    Convierte la <b>señal cruda</b> del sensor (lo que envía el CAN, p. ej. 4-20 mA = 4000–20000)
                    al <b>valor real</b> en su unidad{sensorForm.unit ? ` (${sensorForm.unit})` : ''}.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 24px 1fr', gap: 8, alignItems: 'end' }}>
                    <div>
                      <label style={{ ...labelStyle, fontSize: 10 }}>SEÑAL CRUDA — MÍNIMO</label>
                      <Input type="number" step="any" size="sm" value={sensorForm.in_min}
                        onChange={e => setSensorForm(f => ({ ...f, in_min: e.target.value }))} placeholder="4000" />
                    </div>
                    <div style={{ textAlign: 'center', color: 'var(--cmg-teal)', fontWeight: 700, paddingBottom: 6 }}>→</div>
                    <div>
                      <label style={{ ...labelStyle, fontSize: 10 }}>VALOR REAL — MÍNIMO{sensorForm.unit ? ` (${sensorForm.unit})` : ''}</label>
                      <Input type="number" step="any" size="sm" value={sensorForm.out_min}
                        onChange={e => setSensorForm(f => ({ ...f, out_min: e.target.value }))} placeholder="-1" />
                    </div>
                    <div>
                      <label style={{ ...labelStyle, fontSize: 10 }}>SEÑAL CRUDA — MÁXIMO</label>
                      <Input type="number" step="any" size="sm" value={sensorForm.in_max}
                        onChange={e => setSensorForm(f => ({ ...f, in_max: e.target.value }))} placeholder="20000" />
                    </div>
                    <div style={{ textAlign: 'center', color: 'var(--cmg-teal)', fontWeight: 700, paddingBottom: 6 }}>→</div>
                    <div>
                      <label style={{ ...labelStyle, fontSize: 10 }}>VALOR REAL — MÁXIMO{sensorForm.unit ? ` (${sensorForm.unit})` : ''}</label>
                      <Input type="number" step="any" size="sm" value={sensorForm.out_max}
                        onChange={e => setSensorForm(f => ({ ...f, out_max: e.target.value }))} placeholder="10" />
                    </div>
                  </div>
                  {(() => {
                    const a = parseFloat(sensorForm.in_min), b = parseFloat(sensorForm.in_max)
                    const c = parseFloat(sensorForm.out_min), d = parseFloat(sensorForm.out_max)
                    if ([a, b, c, d].some(n => Number.isNaN(n)) || a === b) {
                      return <div style={{ fontSize: 11, color: 'var(--fg-dim)' }}>Rellena los 4 valores para ver la conversión.</div>
                    }
                    const t = { transform: { type: 'linear_range' as const, in_min: a, in_max: b, out_min: c, out_max: d } }
                    const lo = applyTransform(a, t), hi = applyTransform(b, t)
                    const u = sensorForm.unit ? ` ${sensorForm.unit}` : ''
                    return (
                      <div style={{ fontSize: 12, color: 'var(--cmg-teal)', fontFamily: 'var(--font-mono)' }}>
                        Ejemplo: {a} → {formatSensorValue(lo)}{u} · {b} → {formatSensorValue(hi)}{u}
                        <span style={{ color: 'var(--fg-dim)', marginLeft: 8 }}>(señal 0 = sin lectura)</span>
                      </div>
                    )
                  })()}
                </div>
              )}

              {['circular', 'linear'].includes(sensorForm.gauge_type) && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={labelStyle}>MÍNIMO</label>
                    <Input type="number" step="any" value={sensorForm.min}
                      onChange={e => setSensorForm(f => ({ ...f, min: e.target.value }))} placeholder="0" />
                  </div>
                  <div>
                    <label style={labelStyle}>MÁXIMO</label>
                    <Input type="number" step="any" value={sensorForm.max}
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
                    <Input type="number" step="any" size="sm"
                      value={(sensorForm as unknown as Record<string, string>)[key]}
                      onChange={e => setSensorForm(f => ({ ...f, [key]: e.target.value }))}
                      placeholder="—" />
                  </div>
                ))}
              </div>
            </>)}

            <div style={{ display: 'flex', gap: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  id="sensor-visible"
                  checked={sensorForm.visible_in_detail}
                  onChange={e => setSensorForm(f => ({ ...f, visible_in_detail: e.target.checked }))}
                />
                <label htmlFor="sensor-visible" style={{ fontSize: 13, color: 'var(--fg-primary)', cursor: 'pointer' }}>
                  En detalle del vehículo
                </label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  id="sensor-popup"
                  checked={sensorForm.show_in_popup}
                  onChange={e => setSensorForm(f => ({ ...f, show_in_popup: e.target.checked }))}
                />
                <label htmlFor="sensor-popup" style={{ fontSize: 13, color: 'var(--fg-primary)', cursor: 'pointer' }}>
                  En popup de Flota
                </label>
              </div>
            </div>
            {sensorError && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{sensorError}</div>}
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

      {/* Toast duplicar */}
      {duplicateSuccess && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 500,
          background: 'rgba(34,197,94,0.15)', border: '1px solid var(--ok)',
          borderRadius: 8, padding: '10px 18px', fontSize: 13,
          color: 'var(--ok)', fontWeight: 600,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          ✓ {duplicateSuccess}
        </div>
      )}
    </Shell>
  )
}
