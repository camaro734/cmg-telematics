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
import type { VehicleOut, VehicleStatus, TrackPoint, VehicleTypeOut, KpiHour, MaintenancePlanOut, AlertInstanceOut, TenantOut } from '../../lib/types'
import WorkCyclesTab from './WorkCyclesTab'
import { useAuthStore } from '../auth/useAuthStore'

const BASE_TABS = [
  { id: 'live', label: 'EN VIVO' },
  { id: 'historic', label: 'HISTÓRICO' },
  { id: 'cycles', label: 'CICLOS' },
]

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<'live' | 'historic' | 'cycles' | 'maintenance'>('live')
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const isCmg = user?.tenant_tier === 'cmg'
  const isCmgAdmin = isCmg && user?.role === 'admin'
  const PAGE_TABS = isCmgAdmin
    ? [...BASE_TABS, { id: 'maintenance', label: 'MANTENIMIENTO' }]
    : BASE_TABS

  const [doutOverride, setDoutOverride] = useState<Record<number, boolean>>({})
  const [doutLoading, setDoutLoading] = useState<Record<number, boolean>>({})

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

  async function sendDout(slot: number) {
    if (!id || doutLoading[slot]) return
    const newState = !doutState[slot]
    setDoutLoading(prev => ({ ...prev, [slot]: true }))
    setDoutOverride(prev => ({ ...prev, [slot]: newState }))
    try {
      await apiClient.post(`/api/v1/vehicles/${id}/dout`, { slot, state: newState })
      // Keep override so button shows correct state until status refetch confirms
      qc.invalidateQueries({ queryKey: keys.vehicleStatus(id) })
    } catch {
      // Revert optimistic update on error
      setDoutOverride(prev => { const n = { ...prev }; delete n[slot]; return n })
    } finally {
      setDoutLoading(prev => ({ ...prev, [slot]: false }))
    }
  }

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
    staleTime: 30_000,
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

  const { data: kpis30 = [] } = useQuery<KpiHour[]>({
    queryKey: [...keys.vehicleKpis(id ?? ''), 720],
    queryFn: () => apiClient.get<KpiHour[]>(`/api/v1/vehicles/${id}/kpis?hours=720`),
    enabled: !!vehicle,
    staleTime: 300_000,
  })

  const { data: firingAlerts = [] } = useQuery<AlertInstanceOut[]>({
    queryKey: [...keys.alerts(), 'firing', id],
    queryFn: () => apiClient.get<AlertInstanceOut[]>('/api/v1/alerts?status=firing'),
    refetchInterval: 30_000,
    enabled: !!vehicle,
  })

  const { data: tenants = [] } = useQuery<TenantOut[]>({
    queryKey: keys.tenants(),
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants'),
    staleTime: 300_000,
    enabled: !!vehicle,
  })
  const vehicleTenant = tenants.find(t => t.id === vehicle?.tenant_id)

  const vehicleType = vehicleTypes.find(vt => vt.id === vehicle?.vehicle_type_id)
  const sensorSchema = vehicleType?.sensor_schema ?? []

  // Merge server-persisted DOUT state with optimistic overrides
  const doutState: Record<number, boolean> = { ...(status?.dout_state ?? {}), ...doutOverride }

  const derivedValues = useMemo(() => ({
    pto_hours_today: kpis.length > 0
      ? Math.round(kpis.reduce((s, h) => s + (h.pto_active_minutes ?? 0), 0) / 60 * 10) / 10
      : null,
    ext_voltage_v: status?.ext_voltage_mv != null
      ? Math.round(status.ext_voltage_mv / 10) / 100
      : null,
  }), [kpis, status?.ext_voltage_mv])

  const operativeDays = useMemo(() => {
    const days = new Set(kpis30.filter(h => (h.engine_on_minutes ?? 0) > 0).map(h => h.bucket.slice(0, 10)))
    return days.size
  }, [kpis30])

  const activeAlertsCount = firingAlerts.filter(a => a.vehicle_id === id).length

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
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <VehicleHeader vehicle={vehicle} status={status} />
        <div style={{ padding: '0 24px', flexShrink: 0 }}>
          <Tabs tabs={PAGE_TABS} activeTab={tab} onTabChange={(newTab) => setTab(newTab as 'live' | 'historic' | 'cycles' | 'maintenance')} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: tab === 'live' ? 'hidden' : 'auto', ...(tab !== 'live' && { padding: 24 }) }}>

          {tab === 'live' && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* Main area */}
              <div style={{ display: 'grid', gridTemplateColumns: '35% 65%', flex: 1, minHeight: 0, overflow: 'hidden' }}>

                {/* Left: map + vehicle info */}
                <div style={{ borderRight: '1px solid var(--bg-border)', overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <TrackMap track={track} status={status} />
                  <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-info)', fontFamily: 'var(--font-data)', marginBottom: 10 }}>
                      {vehicle.name}
                    </div>
                    <VDRow label="Cliente" value={vehicleTenant?.name ?? '—'} />
                    <VDRow label="Modelo" value={vehicleType?.name ?? '—'} />
                    <VDRow label="Conductor" value={vehicle.driver_name ?? '—'} />
                    <VDRow label="Matrícula" value={vehicle.license_plate ?? '—'} />
                    <VDRow label="VIN" value={vehicle.vin ?? '—'} />
                  </div>
                </div>

                {/* Right: KPIs + telemetry + controls */}
                <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    <VDKpiCard title="Días operativos" value={operativeDays} color="var(--accent-ok)" />
                    <VDKpiCard title="Fuera de servicio" value={Math.max(0, 30 - operativeDays)} color="var(--text-muted)" />
                    <VDKpiCard title="En mantenimiento" value={maintenancePlans.filter(p => p.progress.status !== 'ok').length} color="var(--accent-warn)" />
                    <VDKpiCard title="Alertas activas" value={activeAlertsCount} color={activeAlertsCount > 0 ? 'var(--accent-crit)' : 'var(--accent-ok)'} />
                  </div>

                  <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: 10 }}>CONTROLES DE MANDO</div>
                    {(vehicleType?.dout_config ?? []).filter(d => d.enabled).length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin salidas configuradas</div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                        {(vehicleType?.dout_config ?? []).filter(d => d.enabled).map(d => {
                          const active = !!doutState[d.slot]
                          const loading = !!doutLoading[d.slot]
                          return (
                          <button
                            key={d.slot}
                            title={`DOUT${d.slot}`}
                            onClick={() => sendDout(d.slot)}
                            disabled={loading}
                            style={{
                              background: active ? 'rgba(34,197,94,0.15)' : 'var(--bg-elevated)',
                              border: `1px solid ${active ? 'var(--accent-ok)' : 'var(--bg-border)'}`,
                              borderRadius: 6,
                              padding: '8px 12px',
                              cursor: loading ? 'wait' : 'pointer',
                              textAlign: 'left',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 2,
                              opacity: loading ? 0.7 : 1,
                              transition: 'background 0.2s, border-color 0.2s',
                            }}
                          >
                            <span style={{ fontSize: 10, color: active ? 'var(--accent-ok)' : 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>DOUT{d.slot}{active ? ' ●' : ' ○'}</span>
                            <span style={{ fontSize: 12, color: active ? 'var(--accent-ok)' : 'var(--text-primary, #E7E5E4)', fontWeight: 600 }}>{d.label}</span>
                          </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                      TELEMETRÍA EN TIEMPO REAL
                      {status?.online && <span style={{ color: 'var(--accent-ok)', fontSize: 10 }}>● En directo</span>}
                    </div>
                    {status ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 6 }}>
                          <StatusCard label="Ignición" value={status.ignition ? 'ON' : 'OFF'} color={status.ignition ? 'var(--accent-ok)' : 'var(--text-muted)'} />
                          <StatusCard label="PTO" value={(status.pto_active ?? false) ? 'ON' : 'OFF'} color={(status.pto_active ?? false) ? 'var(--accent-energy)' : 'var(--text-muted)'} />
                          <StatusCard label="Velocidad" value={status.speed_kmh != null ? `${status.speed_kmh.toFixed(0)} km/h` : '—'} />
                          {status.ext_voltage_mv != null && (
                            <StatusCard label="Voltaje" value={`${(status.ext_voltage_mv / 1000).toFixed(2)} V`} color={status.ext_voltage_mv < 11500 ? 'var(--accent-crit)' : status.ext_voltage_mv < 12000 ? 'var(--accent-warn)' : 'var(--accent-ok)'} />
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11 }}>
                          <span><span style={{ color: 'var(--text-muted)' }}>Lat </span><span style={{ fontFamily: 'var(--font-data)' }}>{status.lat != null ? status.lat.toFixed(6) : '—'}</span></span>
                          <span><span style={{ color: 'var(--text-muted)' }}>Lon </span><span style={{ fontFamily: 'var(--font-data)' }}>{status.lon != null ? status.lon.toFixed(6) : '—'}</span></span>
                          <span><span style={{ color: 'var(--text-muted)' }}>Señal </span><span>{status.last_seen ? new Date(status.last_seen).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</span></span>
                        </div>
                        {sensorSchema.filter(s => s.gauge_type === 'led' && s.avl_id != null).length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {sensorSchema.filter(s => s.gauge_type === 'led' && s.avl_id != null).map(s => {
                              const raw = status.can_data?.[`avl_${s.avl_id}`]
                              const num = raw != null ? Number(raw) : 0
                              const active = raw != null && (s.bit_index != null ? ((num >> s.bit_index) & 1) === 1 : num === 1)
                              return <VDControlBadge key={s.avl_id} label={s.label} active={active} />
                            })}
                          </div>
                        )}
                        {sensorSchema.some(s => s.gauge_type !== 'battery' && s.gauge_type !== 'led') && (
                          <SensorGrid
                            sensorSchema={sensorSchema.filter(s => s.gauge_type !== 'battery' && s.gauge_type !== 'led')}
                            canData={{ ...(status.can_data ?? {}), ...(status.ext_voltage_mv != null ? { avl_66: status.ext_voltage_mv } : {}) }}
                            derivedValues={derivedValues}
                          />
                        )}
                      </div>
                    ) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Sin datos en vivo</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom section */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', borderTop: '1px solid var(--bg-border)', height: 180, overflow: 'hidden', flexShrink: 0 }}>
                <div style={{ borderRight: '1px solid var(--bg-border)', padding: '10px 14px', overflowY: 'auto' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>ESTADO CHASIS</div>
                  {/* AVL 16: Total Odometer (m → km) */}
                  <VDFluidRow
                    label="Odómetro"
                    value={status?.can_data?.avl_16 != null ? `${(Number(status.can_data.avl_16) / 1000).toFixed(0)} km` : '—'}
                  />
                  {/* AVL 12: Fuel Level % (J1939) */}
                  <VDFluidRow
                    label="Combustible"
                    value={status?.can_data?.avl_12 != null ? `${Number(status.can_data.avl_12)} %` : '—'}
                    color={status?.can_data?.avl_12 != null && Number(status.can_data.avl_12) < 15 ? 'var(--accent-warn)' : undefined}
                  />
                  {/* AVL 32: Engine Coolant Temperature °C (J1939) */}
                  <VDFluidRow
                    label="Temp. motor"
                    value={status?.can_data?.avl_32 != null ? `${Number(status.can_data.avl_32)} °C` : '—'}
                    color={status?.can_data?.avl_32 != null && Number(status.can_data.avl_32) > 100 ? 'var(--accent-warn)' : undefined}
                  />
                  {/* AVL 67: FMC650 internal backup battery (mV → V) */}
                  <VDFluidRow
                    label="Batería GPS"
                    value={status?.can_data?.avl_67 != null ? `${(Number(status.can_data.avl_67) / 1000).toFixed(2)} V` : '—'}
                    color={status?.can_data?.avl_67 != null && Number(status.can_data.avl_67) < 3500 ? 'var(--accent-warn)' : undefined}
                  />
                </div>
                <div style={{ borderRight: '1px solid var(--bg-border)', padding: '10px 14px', overflowY: 'auto' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>HISTORIAL DE COMANDOS</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin historial disponible</div>
                </div>
                <div style={{ padding: '10px 14px', overflowY: 'auto' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>INCIDENCIAS</div>
                  {firingAlerts.filter(a => a.vehicle_id === id).length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--accent-ok)' }}>✓ Sin incidencias</div>
                  ) : (
                    firingAlerts.filter(a => a.vehicle_id === id).slice(0, 5).map(a => (
                      <div key={a.id} style={{ fontSize: 11, color: 'var(--accent-warn)', borderBottom: '1px solid var(--bg-border)', paddingBottom: 4, marginBottom: 4 }}>
                        {a.rule_id.slice(0, 8)}… {new Date(a.triggered_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'historic' && <KpiChart vehicleId={id} />}

          {tab === 'cycles' && vehicle.vehicle_type_id && (
            <WorkCyclesTab vehicleId={vehicle.id} vehicleTypeId={vehicle.vehicle_type_id} tenantId={vehicle.tenant_id} />
          )}

          {tab === 'maintenance' && (
            <div>
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
      </div>
    </Shell>
  )
}

function StatusCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', borderRadius: 6, padding: '8px 12px' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-data)', color: color ?? 'var(--text-primary, #E7E5E4)' }}>{value}</div>
    </div>
  )
}

function VDRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--text-default)', fontFamily: mono ? 'var(--font-data)' : undefined, textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </span>
    </div>
  )
}

function VDKpiCard({ title, value, color }: { title: string; value: number; color: string }) {
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, lineHeight: 1.3 }}>{title}</div>
      <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-data)', color }}>{value}</div>
    </div>
  )
}

function VDControlBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)', borderRadius: 6, padding: '6px 10px' }}>
      <span style={{ fontSize: 11, color: 'var(--text-default)' }}>{label}</span>
      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
        background: active ? 'color-mix(in srgb, var(--accent-ok) 15%, transparent)' : 'transparent',
        color: active ? 'var(--accent-ok)' : 'var(--text-muted)',
        border: `1px solid ${active ? 'var(--accent-ok)' : 'var(--bg-border)'}`,
      }}>
        {active ? 'On' : 'Off'}
      </span>
    </div>
  )
}

function VDFluidRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 12, fontFamily: 'var(--font-data)', color: color ?? 'var(--text-muted)' }}>{value}</span>
    </div>
  )
}
