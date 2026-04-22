import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleTypeOut, SensorDef } from '../../lib/types'
import { useAuthStore } from '../auth/useAuthStore'

// ── Form state types ───────────────────────────────────────────────────────

type TypeFormState = { name: string; slug: string }
const emptyTypeForm: TypeFormState = { name: '', slug: '' }

type SensorFormState = {
  avl_id: string; key: string; label: string; unit: string
  gauge_type: SensorDef['gauge_type']
  bit_index: string; scale: string; min: string; max: string
  warn_above: string; alert_above: string; warn_below: string; alert_below: string
}
const emptySensorForm: SensorFormState = {
  avl_id: '', key: '', label: '', unit: '', gauge_type: 'numeric',
  bit_index: '', scale: '', min: '', max: '',
  warn_above: '', alert_above: '', warn_below: '', alert_below: '',
}

function sensorDefToForm(def: SensorDef): SensorFormState {
  return {
    avl_id: def.avl_id?.toString() ?? '',
    key: def.key,
    label: def.label,
    unit: def.unit ?? '',
    gauge_type: def.gauge_type,
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
  const def: SensorDef = {
    avl_id: f.avl_id ? parseInt(f.avl_id) : undefined,
    key: f.key || f.label.toLowerCase().replace(/\s+/g, '_'),
    label: f.label,
    unit: f.unit || null,
    gauge_type: f.gauge_type,
  }
  if (f.gauge_type === 'led' && f.bit_index !== '') def.bit_index = parseInt(f.bit_index)
  if (f.gauge_type !== 'led' && f.scale !== '') def.scale = parseFloat(f.scale)
  if (['circular', 'linear'].includes(f.gauge_type)) {
    if (f.min !== '') def.min = parseFloat(f.min)
    if (f.max !== '') def.max = parseFloat(f.max)
  }
  if (f.gauge_type !== 'led') {
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

// ── Component ──────────────────────────────────────────────────────────────

export default function VehicleTypesPage() {
  const qc = useQueryClient()

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
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 10, padding: 24, width: 480, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary, #E7E5E4)' }}>
              {editingSensorIdx === null ? 'Nuevo sensor CAN' : 'Editar sensor CAN'}
            </div>

            {/* Row: AVL ID + Gauge type */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>AVL ID</label>
                <input type="number" min="1" max="65535" style={inputStyle} value={sensorForm.avl_id}
                  onChange={e => setSensorForm(f => ({ ...f, avl_id: e.target.value }))} placeholder="200" />
              </div>
              <div>
                <label style={labelStyle}>TIPO DE GAUGE</label>
                <select style={inputStyle} value={sensorForm.gauge_type}
                  onChange={e => setSensorForm(f => ({ ...f, gauge_type: e.target.value as SensorDef['gauge_type'], bit_index: '' }))}>
                  {GAUGE_TYPES.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>

            {/* Row: Nombre + Unidad */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>NOMBRE (label)</label>
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

            {/* Bit index (solo LED) */}
            {sensorForm.gauge_type === 'led' && (
              <div>
                <label style={labelStyle}>BIT INDEX (0–7) — bit del byte AVL a extraer</label>
                <input type="number" min="0" max="7" style={inputStyle} value={sensorForm.bit_index}
                  onChange={e => setSensorForm(f => ({ ...f, bit_index: e.target.value }))} placeholder="0" />
              </div>
            )}

            {/* Scale (no LED) */}
            {sensorForm.gauge_type !== 'led' && (
              <div>
                <label style={labelStyle}>MULTIPLICADOR (scale) — ej: 0.1 si el FMC650 envía ×10</label>
                <input type="number" step="any" style={inputStyle} value={sensorForm.scale}
                  onChange={e => setSensorForm(f => ({ ...f, scale: e.target.value }))} placeholder="1" />
              </div>
            )}

            {/* Min/Max (circular y linear) */}
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

            {/* Warn/Alert (no LED) */}
            {sensorForm.gauge_type !== 'led' && (
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
            )}

            {sensorError && <div style={{ fontSize: 12, color: 'var(--accent-crit, #EF4444)' }}>{sensorError}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => setShowSensorModal(false)}>Cancelar</button>
              <button style={btnPrimary} onClick={saveSensor} disabled={!sensorForm.label.trim() || !sensorForm.avl_id}>
                {editingSensorIdx === null ? 'Añadir' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}
