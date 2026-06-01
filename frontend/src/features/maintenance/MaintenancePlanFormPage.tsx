import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import ThresholdBuilder from './ThresholdBuilder'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleOut, MaintenancePlanOut, MaintenancePlanCreate, MaintenancePlanUpdate, MaintenanceThreshold } from '../../lib/types'
import { Input } from '../../shared/ui/Input'

const DEFAULT_THRESHOLDS: MaintenanceThreshold[] = [{ type: 'pto_hours', value: 500 }]

export default function MaintenancePlanFormPage() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEdit = !!id

  const [name, setName] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [thresholds, setThresholds] = useState<MaintenanceThreshold[]>(DEFAULT_THRESHOLDS)
  const [warnPct, setWarnPct] = useState(10)
  const [active, setActive] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { data: vehicles = [] } = useQuery({
    queryKey: keys.vehicles(),
    queryFn: () => apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    staleTime: 60_000,
  })

  const { data: existing } = useQuery({
    queryKey: keys.maintenancePlan(id ?? ''),
    queryFn: () => apiClient.get<MaintenancePlanOut>(`/api/v1/maintenance/plans/${id}`),
    enabled: isEdit,
  })

  useEffect(() => {
    if (existing) {
      setName(existing.name)
      setVehicleId(existing.vehicle_id)
      setThresholds(existing.trigger_condition.thresholds ?? DEFAULT_THRESHOLDS)
      setWarnPct(existing.warn_before_pct)
      setActive(existing.active)
    } else if (vehicles.length > 0 && !vehicleId) {
      setVehicleId(vehicles[0].id)
    }
  }, [existing, vehicles, vehicleId])

  const mutation = useMutation({
    mutationFn: (payload: MaintenancePlanCreate | MaintenancePlanUpdate) =>
      isEdit
        ? apiClient.put<MaintenancePlanOut>(`/api/v1/maintenance/plans/${id}`, payload)
        : apiClient.post<MaintenancePlanOut>('/api/v1/maintenance/plans', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.maintenancePlans() })
      navigate('/maintenance')
    },
    onError: () => setError('Error al guardar el plan'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    if (isEdit) {
      mutation.mutate({
        name: name.trim(),
        trigger_condition: { thresholds, op: 'OR' },
        warn_before_pct: warnPct,
        active,
      } satisfies MaintenancePlanUpdate)
    } else {
      mutation.mutate({
        vehicle_id: vehicleId,
        name: name.trim(),
        trigger_condition: { thresholds, op: 'OR' },
        warn_before_pct: warnPct,
        active,
      } satisfies MaintenancePlanCreate)
    }
  }

  const labelStyle = { fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }
  const inputStyle = { background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--fg-primary)', borderRadius: 6, padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box' as const }

  return (
    <Shell title={isEdit ? 'Editar plan' : 'Nuevo plan de mantenimiento'}>
      <div style={{ padding: 24, maxWidth: 600 }}>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            <Input
              label="Nombre del plan"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Nombre del plan"
              required
            />

            {!isEdit && (
              <div>
                <div style={labelStyle}>VEHÍCULO</div>
                <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} style={inputStyle}>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            )}

            <div>
              <div style={{ ...labelStyle, marginBottom: 10 }}>UMBRALES (se dispara al llegar al primero)</div>
              <ThresholdBuilder thresholds={thresholds} onChange={setThresholds} />
            </div>

            <div>
              <div style={labelStyle}>AVISAR CUANDO QUEDE (%)</div>
              <Input
                type="number"
                value={warnPct}
                min={1}
                max={50}
                onChange={e => setWarnPct(Number(e.target.value))}
                style={{ width: 100 }}
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
              <span style={{ fontSize: 13, color: 'var(--fg-primary)' }}>Plan activo</span>
            </label>

            {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                type="submit"
                disabled={mutation.isPending}
                style={{
                  background: 'var(--cmg-teal)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '10px 24px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: mutation.isPending ? 'not-allowed' : 'pointer',
                }}
              >
                {mutation.isPending ? 'Guardando…' : 'Guardar'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/maintenance')}
                style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--fg-muted)', borderRadius: 6, padding: '10px 24px', fontSize: 13, cursor: 'pointer' }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </form>
      </div>
    </Shell>
  )
}
