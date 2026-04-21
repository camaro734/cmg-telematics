import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleTypeOut, SensorDef } from '../../lib/types'
import { AVL_CATALOG, GROUP_LABELS, avlParamToSensorDef } from '../../lib/avlCatalog'

const GAUGE_OPTIONS: SensorDef['gauge_type'][] = ['circular', 'linear', 'battery', 'numeric', 'led']

const sectionStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--bg-border)',
  borderRadius: 8,
  padding: 20,
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  color: 'var(--text-base, #E7E5E4)',
  border: '1px solid var(--bg-border)',
  borderRadius: 5,
  padding: '6px 10px',
  fontSize: 13,
  width: '100%',
}

interface AddSensorForm {
  avl_id: number
  label: string
  gauge_type: SensorDef['gauge_type']
  min: number
  max: number
}

export default function VehicleTypeSensorsSection() {
  const queryClient = useQueryClient()
  const [selectedTypeId, setSelectedTypeId] = useState<string>('')
  const [showModal, setShowModal] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<AddSensorForm>>({})

  const { data: vehicleTypes = [], isLoading } = useQuery({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: 60_000,
  })

  const selectedType = vehicleTypes.find(vt => vt.id === selectedTypeId)

  const patchSchemaMutation = useMutation({
    mutationFn: ({ id, schema }: { id: string; schema: SensorDef[] }) =>
      apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${id}/sensor-schema`, { sensor_schema: schema }),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.vehicleTypes(), (old: VehicleTypeOut[] | undefined) =>
        old?.map(vt => vt.id === updated.id ? updated : vt) ?? [updated]
      )
    },
    onError: (err: Error) => setModalError(err.message),
  })

  function handleCatalogChange(avlId: number) {
    const param = AVL_CATALOG.find(p => p.avl_id === avlId)
    if (!param) return
    setForm({
      avl_id: param.avl_id,
      label: param.defaultLabel,
      gauge_type: param.defaultGaugeType,
      min: param.defaultMin,
      max: param.defaultMax,
    })
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedType || form.avl_id == null || !form.label || !form.gauge_type) {
      setModalError('Completa todos los campos')
      return
    }
    const param = AVL_CATALOG.find(p => p.avl_id === form.avl_id)
    if (!param) { setModalError('Parámetro no encontrado'); return }
    const alreadyAdded = selectedType.sensor_schema.some(s => s.avl_id === form.avl_id)
    if (alreadyAdded) { setModalError('Este sensor ya está configurado para este tipo de vehículo'); return }

    const newSensor: SensorDef = {
      ...avlParamToSensorDef(param),
      label: form.label,
      gauge_type: form.gauge_type,
      min: form.min ?? param.defaultMin,
      max: form.max ?? param.defaultMax,
    }
    const updatedSchema = [...selectedType.sensor_schema, newSensor]
    patchSchemaMutation.mutate(
      { id: selectedType.id, schema: updatedSchema },
      {
        onSuccess: () => {
          setShowModal(false)
          setForm({})
          setModalError(null)
        },
      },
    )
  }

  function handleRemove(avlId: number | undefined) {
    if (!selectedType || avlId == null) return
    setRemoveError(null)
    const updatedSchema = selectedType.sensor_schema.filter(s => s.avl_id !== avlId)
    patchSchemaMutation.mutate(
      { id: selectedType.id, schema: updatedSchema },
      { onError: (err: Error) => setRemoveError(`Error al eliminar: ${err.message}`) },
    )
  }

  const activeAvlIds = new Set(selectedType?.sensor_schema.map(s => s.avl_id) ?? [])

  return (
    <div style={sectionStyle}>
      <h3 style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-base, #E7E5E4)' }}>
        Sensores por tipo de vehículo
      </h3>

      {isLoading ? (
        <div style={{ color: 'var(--accent-off)', fontSize: 13 }}>Cargando…</div>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>
              Tipo de vehículo
            </label>
            <select
              style={{ ...inputStyle, maxWidth: 300 }}
              value={selectedTypeId}
              onChange={e => { setSelectedTypeId(e.target.value); setModalError(null); setRemoveError(null) }}
            >
              <option value="">Seleccionar tipo…</option>
              {vehicleTypes.map(vt => (
                <option key={vt.id} value={vt.id}>{vt.name}</option>
              ))}
            </select>
          </div>

          {selectedType && (
            <>
              {selectedType.sensor_schema.length === 0 ? (
                <div style={{ color: 'var(--accent-off)', fontSize: 13, marginBottom: 12 }}>
                  No hay sensores configurados. Añade uno del catálogo CAN.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
                      <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--accent-off)' }}>Label</th>
                      <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--accent-off)' }}>AVL ID</th>
                      <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--accent-off)' }}>Gauge</th>
                      <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--accent-off)' }}>Min / Max</th>
                      <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--accent-off)' }}>Unidad</th>
                      <th style={{ width: 32 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {selectedType.sensor_schema.map(s => (
                      <tr key={s.key} style={{ borderBottom: '1px solid var(--bg-elevated)' }}>
                        <td style={{ padding: '5px 8px', color: 'var(--text-base, #E7E5E4)' }}>{s.label}</td>
                        <td style={{ padding: '5px 8px', color: 'var(--accent-energy)', fontFamily: 'var(--font-data)', fontSize: 11 }}>
                          {s.avl_id != null ? `avl_${s.avl_id}` : '—'}
                        </td>
                        <td style={{ padding: '5px 8px', color: 'var(--accent-off)' }}>{s.gauge_type}</td>
                        <td style={{ padding: '5px 8px', color: 'var(--accent-off)', fontFamily: 'var(--font-data)', fontSize: 11 }}>
                          {s.min ?? 0} / {s.max ?? 100}
                        </td>
                        <td style={{ padding: '5px 8px', color: 'var(--accent-off)' }}>{s.unit ?? '—'}</td>
                        <td style={{ padding: '5px 8px' }}>
                          <button
                            onClick={() => handleRemove(s.avl_id)}
                            disabled={patchSchemaMutation.isPending}
                            title="Eliminar sensor"
                            style={{ background: 'none', border: 'none', color: 'var(--accent-crit)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 2 }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {removeError && (
                <div style={{ color: 'var(--accent-crit)', fontSize: 12, marginBottom: 8 }}>{removeError}</div>
              )}

              <button
                onClick={() => { setShowModal(true); setForm({}); setModalError(null) }}
                style={{ padding: '5px 12px', background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 5, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
              >
                + Añadir sensor
              </button>
            </>
          )}
        </>
      )}

      {showModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) { setShowModal(false); setModalError(null) } }}
        >
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 10, padding: 24, width: 480, maxWidth: '92vw', maxHeight: '80vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 14 }}>Añadir sensor CAN</h3>
            <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              <div>
                <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>
                  Parámetro del catálogo *
                </label>
                <select
                  style={inputStyle}
                  value={form.avl_id ?? ''}
                  onChange={e => handleCatalogChange(Number(e.target.value))}
                  required
                >
                  <option value="">Seleccionar parámetro…</option>
                  {Object.entries(GROUP_LABELS).map(([groupKey, groupLabel]) => {
                    const params = AVL_CATALOG.filter(p => p.group === groupKey && !activeAvlIds.has(p.avl_id))
                    if (params.length === 0) return null
                    return (
                      <optgroup key={groupKey} label={groupLabel}>
                        {params.map(p => (
                          <option key={p.avl_id} value={p.avl_id}>
                            AVL {p.avl_id} — {p.defaultLabel} ({p.unit ?? 'sin unidad'})
                          </option>
                        ))}
                      </optgroup>
                    )
                  })}
                </select>
              </div>

              {form.avl_id != null && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>
                      Label mostrado *
                    </label>
                    <input
                      style={inputStyle}
                      value={form.label ?? ''}
                      onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>
                      Tipo de gauge *
                    </label>
                    <select
                      style={inputStyle}
                      value={form.gauge_type ?? 'numeric'}
                      onChange={e => setForm(f => ({ ...f, gauge_type: e.target.value as SensorDef['gauge_type'] }))}
                    >
                      {GAUGE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>Mín</label>
                      <input
                        type="number"
                        style={inputStyle}
                        value={form.min ?? 0}
                        onChange={e => setForm(f => ({ ...f, min: Number(e.target.value) }))}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>Máx</label>
                      <input
                        type="number"
                        style={inputStyle}
                        value={form.max ?? 100}
                        onChange={e => setForm(f => ({ ...f, max: Number(e.target.value) }))}
                      />
                    </div>
                  </div>

                  <div style={{ padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 5, fontSize: 11, color: 'var(--accent-off)' }}>
                    {AVL_CATALOG.find(p => p.avl_id === form.avl_id)?.description}
                  </div>
                </>
              )}

              {modalError && (
                <div style={{ color: 'var(--accent-crit)', fontSize: 12 }}>{modalError}</div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setModalError(null) }}
                  style={{ padding: '6px 14px', background: 'var(--bg-elevated)', color: 'var(--text-base, #E7E5E4)', border: '1px solid var(--bg-border)', borderRadius: 5, fontSize: 13, cursor: 'pointer' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={patchSchemaMutation.isPending || form.avl_id == null}
                  style={{ padding: '6px 14px', background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 5, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
                >
                  {patchSchemaMutation.isPending ? 'Guardando…' : 'Añadir'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
