import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { WorkCycleDefinition, WorkCycleDefinitionCreate, VehicleTypeOut } from '../../lib/types'

const TRIGGER_OPTIONS = [
  { value: 'pto_change', label: 'PTO activo (cisterna, hidráulica)' },
  { value: 'threshold_exceeded', label: 'Umbral superado (excavadora, presión)' },
  { value: 'sensor_pulse', label: 'Pulso de sensor (basura, contadores)' },
  { value: 'ignition_period', label: 'Período ignición (jornada completa)' },
]

const sectionStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--bg-border)',
  borderRadius: 8,
  padding: 20,
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  color: 'var(--text-base)',
  border: '1px solid var(--bg-border)',
  borderRadius: 5,
  padding: '6px 10px',
  fontSize: 13,
  width: '100%',
}

export default function WorkCycleDefinitionsSection() {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<Partial<WorkCycleDefinitionCreate>>({ trigger_type: 'pto_change', trigger_config: {}, snapshot_fields: [], aggregate_fields: [] })
  const [modalError, setModalError] = useState<string | null>(null)

  const { data: definitions = [], isLoading } = useQuery({
    queryKey: keys.workCycleDefinitions(),
    queryFn: () => apiClient.get<WorkCycleDefinition[]>('/api/v1/work-cycles/definitions'),
  })

  const { data: vehicleTypes = [] } = useQuery({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: 60_000,
  })

  const createMutation = useMutation({
    mutationFn: (payload: WorkCycleDefinitionCreate) =>
      apiClient.post<WorkCycleDefinition>('/api/v1/work-cycles/definitions', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-cycle-definitions'] })
      setShowModal(false)
      setForm({ trigger_type: 'pto_change', trigger_config: {}, snapshot_fields: [], aggregate_fields: [] })
      setModalError(null)
    },
    onError: (err: Error) => setModalError(err.message),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiClient.patch<WorkCycleDefinition>(`/api/v1/work-cycles/definitions/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['work-cycle-definitions'] }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.vehicle_type_id || !form.name || !form.trigger_type) {
      setModalError('Completa todos los campos obligatorios')
      return
    }
    createMutation.mutate(form as WorkCycleDefinitionCreate)
  }

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 14, color: 'var(--text-base)' }}>Ciclos de trabajo</h3>
        <button
          onClick={() => setShowModal(true)}
          style={{ padding: '5px 12px', background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 5, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
        >
          + Nueva definición
        </button>
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--accent-off)', fontSize: 13 }}>Cargando…</div>
      ) : definitions.length === 0 ? (
        <div style={{ color: 'var(--accent-off)', fontSize: 13 }}>No hay definiciones configuradas.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
              <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--accent-off)' }}>Nombre</th>
              <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--accent-off)' }}>Tipo vehículo</th>
              <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--accent-off)' }}>Trigger</th>
              <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--accent-off)' }}>Origen</th>
              <th style={{ textAlign: 'center', padding: '5px 8px', color: 'var(--accent-off)' }}>Activo</th>
            </tr>
          </thead>
          <tbody>
            {definitions.map(d => {
              const vt = vehicleTypes.find(v => v.id === d.vehicle_type_id)
              const isGlobal = d.tenant_id === null
              return (
                <tr key={d.id} style={{ borderBottom: '1px solid var(--bg-elevated)' }}>
                  <td style={{ padding: '5px 8px', color: 'var(--text-base)' }}>{d.name}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--accent-off)' }}>{vt?.name ?? d.vehicle_type_id.slice(0, 8)}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--accent-energy)', fontFamily: 'var(--font-data)', fontSize: 11 }}>{d.trigger_type}</td>
                  <td style={{ padding: '5px 8px' }}>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: isGlobal ? 'rgba(56,189,248,0.15)' : 'rgba(249,115,22,0.15)', color: isGlobal ? 'var(--accent-info)' : 'var(--accent-energy)' }}>
                      {isGlobal ? 'CMG global' : 'Cliente'}
                    </span>
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                    {!isGlobal ? (
                      <button
                        onClick={() => toggleMutation.mutate({ id: d.id, active: !d.active })}
                        style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', background: d.active ? 'rgba(34,197,94,0.15)' : 'rgba(120,113,108,0.2)', color: d.active ? 'var(--accent-ok)' : 'var(--accent-off)' }}
                      >
                        {d.active ? 'Activo' : 'Inactivo'}
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: d.active ? 'var(--accent-ok)' : 'var(--accent-off)' }}>
                        {d.active ? '✓' : '✗'}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {showModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) { setShowModal(false); setModalError(null) } }}
        >
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 10, padding: 24, width: 440, maxWidth: '90vw' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 14 }}>Nueva definición de ciclo</h3>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>Nombre *</label>
                <input style={inputStyle} value={form.name ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ej. Ciclo bomba agua" required />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>Tipo de vehículo *</label>
                <select style={inputStyle} value={form.vehicle_type_id ?? ''} onChange={e => setForm(f => ({ ...f, vehicle_type_id: e.target.value }))} required>
                  <option value="">Seleccionar...</option>
                  {vehicleTypes.map(vt => <option key={vt.id} value={vt.id}>{vt.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>Tipo de trigger *</label>
                <select style={inputStyle} value={form.trigger_type ?? 'pto_change'} onChange={e => setForm(f => ({ ...f, trigger_type: e.target.value }))}>
                  {TRIGGER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {(form.trigger_type === 'threshold_exceeded' || form.trigger_type === 'sensor_pulse') && (
                <div>
                  <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>
                    {form.trigger_type === 'threshold_exceeded' ? 'Sensor (clave en can_data)' : 'Sensor / pin (clave en can_data)'}
                  </label>
                  <input style={inputStyle} placeholder="ej. hydraulic_pressure"
                    onChange={e => setForm(f => ({ ...f, trigger_config: { ...f.trigger_config, sensor: e.target.value } }))} />
                </div>
              )}
              {form.trigger_type === 'threshold_exceeded' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>Operador</label>
                    <select style={inputStyle} onChange={e => setForm(f => ({ ...f, trigger_config: { ...f.trigger_config, op: e.target.value } }))}>
                      <option value=">">{'>'}</option>
                      <option value=">=">{'>='}</option>
                      <option value="<">{'<'}</option>
                      <option value="<=">{'<='}</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>Umbral</label>
                    <input type="number" style={inputStyle} placeholder="ej. 280"
                      onChange={e => setForm(f => ({ ...f, trigger_config: { ...f.trigger_config, threshold: Number(e.target.value) } }))} />
                  </div>
                </div>
              )}
              {modalError && <div style={{ color: 'var(--accent-crit)', fontSize: 12 }}>{modalError}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" onClick={() => { setShowModal(false); setModalError(null) }}
                  style={{ padding: '6px 14px', background: 'var(--bg-elevated)', color: 'var(--text-base)', border: '1px solid var(--bg-border)', borderRadius: 5, fontSize: 13, cursor: 'pointer' }}>
                  Cancelar
                </button>
                <button type="submit" disabled={createMutation.isPending}
                  style={{ padding: '6px 14px', background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 5, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                  {createMutation.isPending ? 'Guardando…' : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
