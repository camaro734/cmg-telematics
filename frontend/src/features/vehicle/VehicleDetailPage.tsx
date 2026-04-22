import { useState, useMemo } from 'react'
import { useParams, Navigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import Tabs from '../../shared/ui/Tabs'
import VehicleHeader from './VehicleHeader'
import TrackMap from './TrackMap'
import SensorGrid from './SensorGrid'
import KpiChart from './KpiChart'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleOut, VehicleStatus, TrackPoint, VehicleTypeOut, KpiHour, MaintenancePlanOut } from '../../lib/types'
import WorkCyclesTab from './WorkCyclesTab'
import { useAuthStore } from '../auth/useAuthStore'

const PAGE_TABS = [
  { id: 'live', label: 'EN VIVO' },
  { id: 'historic', label: 'HISTÓRICO' },
  { id: 'cycles', label: 'CICLOS' },
  { id: 'maintenance', label: 'MANTENIMIENTO' },
]

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<'live' | 'historic' | 'cycles' | 'maintenance'>('live')
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const isCmg = user?.tenant_tier === 'cmg'

  const [editingPlan, setEditingPlan] = useState<MaintenancePlanOut | null>(null)
  const [editPlanForm, setEditPlanForm] = useState({ name: '', value: '', warnPct: '10' })
  const [editPlanError, setEditPlanError] = useState('')

  function openEditPlan(plan: MaintenancePlanOut) {
    const firstThreshold = plan.trigger_condition.thresholds[0]
    setEditingPlan(plan)
    setEditPlanForm({
      name: plan.name,
      value: firstThreshold?.value?.toString() ?? '',
      warnPct: plan.warn_before_pct.toString(),
    })
    setEditPlanError('')
  }

  const editPlanMutation = useMutation({
    mutationFn: ({ planId, body }: { planId: string; body: object }) =>
      apiClient.put<MaintenancePlanOut>(`/api/v1/maintenance/plans/${planId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.vehicleMaintenance(id!) })
      setEditingPlan(null)
      setEditPlanError('')
    },
    onError: () => setEditPlanError('Error al guardar los cambios'),
  })

  function handleEditPlan() {
    if (!editingPlan || !editPlanForm.value) return
    const firstThreshold = editingPlan.trigger_condition.thresholds[0]
    if (!firstThreshold) return
    editPlanMutation.mutate({
      planId: editingPlan.id,
      body: {
        name: editPlanForm.name,
        trigger_condition: {
          thresholds: [{ type: firstThreshold.type, value: parseFloat(editPlanForm.value) }],
          op: 'OR',
        },
        warn_before_pct: parseInt(editPlanForm.warnPct) || 10,
      },
    })
  }

  const { data: vehicle, isLoading: loadingVehicle, error: vehicleError } = useQuery({
    queryKey: keys.vehicle(id ?? ''),
    queryFn: () => apiClient.get<VehicleOut>(`/api/v1/vehicles/${id}`),
    enabled: !!id,
  })

  const { data: vehicleTypes = [] } = useQuery({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: Infinity,
    enabled: !!id,
  })

  const { data: status } = useQuery({
    queryKey: keys.vehicleStatus(id ?? ''),
    queryFn: () => apiClient.get<VehicleStatus>(`/api/v1/vehicles/${id}/status`),
    refetchInterval: 30_000,
    enabled: !!vehicle,
  })

  const { data: track = [] } = useQuery({
    queryKey: keys.vehicleTrack(id ?? ''),
    queryFn: () => apiClient.get<TrackPoint[]>(`/api/v1/vehicles/${id}/track/today`),
    staleTime: 60_000,
    enabled: !!vehicle,
  })

  const { data: kpis = [] } = useQuery({
    queryKey: [...keys.vehicleKpis(id ?? ''), 24],
    queryFn: () => apiClient.get<KpiHour[]>(`/api/v1/vehicles/${id}/kpis?hours=24`),
    enabled: !!vehicle,
  })

  const { data: maintenancePlans = [] } = useQuery({
    queryKey: keys.vehicleMaintenance(id ?? ''),
    queryFn: () => apiClient.get<MaintenancePlanOut[]>(`/api/v1/vehicles/${id}/maintenance`),
    enabled: !!vehicle,
  })
  const urgentCount = maintenancePlans.filter(
    p => p.progress.status === 'vencido' || p.progress.status === 'próximo'
  ).length

  const vehicleType = vehicleTypes.find(vt => vt.id === vehicle?.vehicle_type_id)
  const sensorSchema = vehicleType?.sensor_schema ?? []

  const derivedValues = useMemo(() => ({
    pto_hours_today: kpis.length > 0
      ? Math.round(kpis.reduce((s, h) => s + (h.pto_active_minutes ?? 0), 0) / 60 * 10) / 10
      : null,
  }), [kpis])

  if (!id) return <Navigate to="/fleet" replace />

  if (loadingVehicle) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-base)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
      }}>
        Cargando…
      </div>
    )
  }

  if (vehicleError || !vehicle) return <Navigate to="/fleet" replace />

  return (
    <Shell title={vehicle.name}>
      {urgentCount > 0 && (
        <div style={{ padding: '6px 24px 0' }}>
          <Link
            to={`/maintenance?vehicle=${id}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid var(--accent-crit)',
              borderRadius: 6, padding: '4px 10px',
              fontSize: 11, color: 'var(--accent-crit)',
              textDecoration: 'none', fontWeight: 600,
            }}
          >
            ⚠ {urgentCount} plan{urgentCount > 1 ? 'es' : ''} de mantenimiento pendiente{urgentCount > 1 ? 's' : ''}
          </Link>
        </div>
      )}
      <div style={{ height: '100%', overflowY: 'auto' }}>
        <VehicleHeader vehicle={vehicle} status={status} />

        <div style={{ padding: '0 24px' }}>
          <Tabs
            tabs={PAGE_TABS}
            activeTab={tab}
            onTabChange={(newTab) => setTab(newTab as 'live' | 'historic' | 'cycles' | 'maintenance')}
          />
        </div>

        {tab === 'live' && (
          <div style={{
            padding: 24,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 24,
            maxWidth: 1400,
          }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 10 }}>
                RECORRIDO DE HOY
              </div>
              <TrackMap track={track} status={status} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 10 }}>
                SENSORES EN VIVO
              </div>
              {sensorSchema.length > 0 ? (
                <SensorGrid
                  sensorSchema={sensorSchema}
                  canData={status?.can_data ?? {}}
                  derivedValues={derivedValues}
                />
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  Sin schema de sensores configurado para este tipo de vehículo.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'historic' && (
          <div style={{ padding: 24, maxWidth: 1400 }}>
            <KpiChart vehicleId={id} />
          </div>
        )}

        {tab === 'cycles' && vehicle.vehicle_type_id && (
          <div style={{ padding: 24, maxWidth: 1400 }}>
            <WorkCyclesTab
              vehicleId={vehicle.id}
              vehicleTypeId={vehicle.vehicle_type_id}
              tenantId={vehicle.tenant_id}
            />
          </div>
        )}

        {tab === 'maintenance' && (
          <div style={{ padding: 24 }}>
            {maintenancePlans.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Sin planes de mantenimiento para este vehículo</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {maintenancePlans.map(plan => (
                  <div key={plan.id} style={{ background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--bg-border)', padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{plan.name}</div>
                        {plan.progress.thresholds.map(t => (
                          <div key={t.type} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {t.current.toFixed(1)} / {t.limit} {{ pto_hours: 'h PTO', engine_hours: 'h motor', calendar_days: 'días' }[t.type] ?? t.type}
                            {' '}({t.pct.toFixed(0)}%)
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                          background: plan.progress.status === 'vencido' ? 'var(--accent-crit)' : plan.progress.status === 'próximo' ? 'var(--accent-warn)' : 'var(--accent-ok)',
                          color: '#fff'
                        }}>
                          {plan.progress.status.toUpperCase()}
                        </span>
                        {isCmg && (
                          <button
                            onClick={() => openEditPlan(plan)}
                            style={{ fontSize: 11, padding: '3px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', borderRadius: 5, cursor: 'pointer', color: 'var(--text-primary, #E7E5E4)' }}
                          >
                            Editar umbrales
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {editingPlan && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
                <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 24, width: 360, border: '1px solid var(--bg-border)' }}>
                  <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600 }}>Editar umbrales</h3>
                  <label style={{ fontSize: 11, color: 'var(--accent-off)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Nombre</label>
                  <input style={{ background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', color: 'var(--text-primary, #E7E5E4)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box' as const, marginBottom: 12 }}
                    value={editPlanForm.name}
                    onChange={e => setEditPlanForm(f => ({ ...f, name: e.target.value }))} />
                  <label style={{ fontSize: 11, color: 'var(--accent-off)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Valor umbral</label>
                  <input style={{ background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', color: 'var(--text-primary, #E7E5E4)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box' as const, marginBottom: 12 }}
                    type="number" min="1" value={editPlanForm.value}
                    onChange={e => setEditPlanForm(f => ({ ...f, value: e.target.value }))} />
                  <label style={{ fontSize: 11, color: 'var(--accent-off)', fontWeight: 600, display: 'block', marginBottom: 4 }}>% aviso previo</label>
                  <input style={{ background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', color: 'var(--text-primary, #E7E5E4)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box' as const, marginBottom: 20 }}
                    type="number" min="1" max="50" value={editPlanForm.warnPct}
                    onChange={e => setEditPlanForm(f => ({ ...f, warnPct: e.target.value }))} />
                  {editPlanError && <p style={{ color: 'var(--accent-crit)', fontSize: 12, marginBottom: 12 }}>{editPlanError}</p>}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button onClick={() => setEditingPlan(null)} style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary, #E7E5E4)', border: '1px solid var(--bg-border)', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
                    <button onClick={handleEditPlan} disabled={editPlanMutation.isPending} style={{ background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                      {editPlanMutation.isPending ? 'Guardando…' : 'Guardar'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  )
}
