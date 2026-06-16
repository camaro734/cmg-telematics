import { useState, useMemo, useRef, useEffect } from 'react'
import { useVehicleLive } from '../../lib/useVehicleLive'
import { isEffectivelyOnline, statusStamp } from '../../lib/staleStatus'
import { SkeletonCard } from '../../shared/ui/SkeletonCard'
import { useParams, Navigate, Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import Tabs from '../../shared/ui/Tabs'
import VehicleHeader from './VehicleHeader'
import TrackMap from './TrackMap'
import { DiagnosticPanel } from './diagnostic/DiagnosticPanel'
import { BlockDetailSection } from './diagnostic/BlockDetailSection'
import KpiChart from './KpiChart'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useIsMobile } from '../../lib/useIsMobile'
import { useUserPreferences, usePatchUserPreferences } from '../../lib/useUserPreferences'
import { sortByOrder } from '../../lib/sensorOrder'
import type { VehicleOut, TrackPoint, VehicleTypeOut, KpiHour, MaintenancePlanOut, AlertInstanceEnrichedOut, TenantOut, CommandLogEntry, SystemBlock } from '../../lib/types'
import ManualCanControl from './ManualCanControl'
import ManualCanSlotManager from './ManualCanSlotManager'
import ManualCanButtonManager from './ManualCanButtonManager'
import ActivityDrawer from './ActivityDrawer'
import WorkCyclesTab from './WorkCyclesTab'
import MaintenanceTab from './MaintenanceTab'
import { toast } from '../../shared/ui/Toast'
import { useAuthStore } from '../auth/useAuthStore'
import { useFleetStore } from '../fleet/useFleetStore'
import { Select } from '../../shared/ui/Select'

const BASE_TABS = [
  { id: 'live', label: 'EN VIVO' },
  { id: 'historic', label: 'HISTÓRICO' },
  { id: 'cycles', label: 'CICLOS' },
]

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'live' | 'historic' | 'cycles' | 'maintenance'>('live')
  const qc = useQueryClient()
  const { user, enabledModules } = useAuthStore()
  const isCmg = user?.tenant_tier === 'cmg'
  const isManufacturer = user?.tenant_tier === 'manufacturer'
  const isPrivileged = isCmg || isManufacturer
  const canMaintenance = isPrivileged || enabledModules.includes('maintenance')
  const canAlerts      = isPrivileged || enabledModules.includes('alerts')
  const canReports     = isPrivileged || enabledModules.includes('reports')
  const isMobile = useIsMobile()
  const setFleetSelected = useFleetStore(s => s.setSelected)
  const PAGE_TABS = canMaintenance
    ? [...BASE_TABS, { id: 'maintenance', label: 'MANTENIMIENTO' }]
    : BASE_TABS

  const [doutOverride, setDoutOverride] = useState<Record<number, boolean>>({})
  const [showFullTelemetry, setShowFullTelemetry] = useState(false)
  const [doutLoading, setDoutLoading] = useState<Record<number, boolean>>({})
  const [showBottomPanel, setShowBottomPanel] = useState(false)
  const [mapExpanded, setMapExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem('vd_map_expanded') === 'true' } catch { return false }
  })
  function toggleMap() {
    setMapExpanded(prev => {
      const next = !prev
      try { localStorage.setItem('vd_map_expanded', String(next)) } catch {}
      return next
    })
  }
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const liveScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (selectedBlockId !== null) liveScrollRef.current?.scrollTo({ top: 0 }) }, [selectedBlockId])

  const [trackDate, setTrackDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const isTrackToday = trackDate === new Date().toISOString().slice(0, 10)

  async function sendDout(slot: number) {
    if (!id || doutLoading[slot]) return
    const newState = !(doutState[slot] ?? false)
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

  const { data: status } = useVehicleLive(vehicle ? id : null)
  const isStale = !isEffectivelyOnline(status)

  const { data: track = [] } = useQuery({
    queryKey: [...keys.vehicleTrack(id ?? ''), trackDate],
    queryFn: () => {
      if (isTrackToday) {
        return apiClient.get<TrackPoint[]>(`/api/v1/vehicles/${id}/track/today`)
      }
      const from = `${trackDate}T00:00:00`
      const to = `${trackDate}T23:59:59`
      return apiClient.get<TrackPoint[]>(
        `/api/v1/vehicles/${id}/track?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )
    },
    staleTime: isTrackToday ? 30_000 : 5 * 60_000,
    refetchInterval: isTrackToday ? 30_000 : false,
    enabled: !!vehicle,
  })

  const { data: kpis = [] } = useQuery({
    queryKey: [...keys.vehicleKpis(id ?? ''), 24],
    queryFn: () => { const e=new Date(); const s=new Date(e.getTime()-24*3600000); return apiClient.get<KpiHour[]>(`/api/v1/vehicles/${id}/kpis?start=${encodeURIComponent(s.toISOString())}&end=${encodeURIComponent(e.toISOString())}`) },
    enabled: !!vehicle,
  })

  const { data: maintenancePlans = [] } = useQuery({
    queryKey: keys.vehicleMaintenance(id ?? ''),
    queryFn: () => apiClient.get<MaintenancePlanOut[]>(`/api/v1/vehicles/${id}/maintenance`),
    enabled: !!vehicle && canMaintenance,
  })
  const urgentCount = maintenancePlans.filter(
    p => p.progress.status === 'vencido' || p.progress.status === 'próximo'
  ).length


  const [activityOpen, setActivityOpen] = useState(false)

  const { data: firingAlerts = [] } = useQuery<AlertInstanceEnrichedOut[]>({
    queryKey: [...keys.alerts(), 'firing', id],
    queryFn: () => apiClient.get<AlertInstanceEnrichedOut[]>('/api/v1/alerts?status=firing'),
    refetchInterval: 30_000,
    enabled: !!vehicle && canAlerts,
  })

  const { data: commandHistory = [] } = useQuery<CommandLogEntry[]>({
    queryKey: keys.vehicleCommands(id ?? ''),
    queryFn: () => apiClient.get<CommandLogEntry[]>(`/api/v1/vehicles/${id}/commands?limit=10`),
    refetchInterval: 30_000,
    enabled: !!vehicle,
  })

  const { data: manualCanSlots = [] } = useQuery<{ id: string; slot: number; description: string | null; param_id: number; active: boolean }[]>({
    queryKey: ['manual-can-slots', id ?? ''],
    queryFn: () => apiClient.get(`/api/v1/vehicles/${id}/manual-can-slots`),
    staleTime: 300_000,
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


  const liveBlocks = useMemo((): SystemBlock[] => {
    if (!vehicleType) return []
    const s = vehicleType.sensor_schema
    if (vehicleType.system_blocks.length > 0) {
      const assignedKeys = new Set(vehicleType.system_blocks.flatMap(b => b.sensor_keys))
      const orphans = s.filter(o => !assignedKeys.has(o.key))
      const bs = [...vehicleType.system_blocks]
      if (orphans.length > 0) {
        bs.push({ id: '__orphans__', name: 'Otros', icon: 'ti-settings', sensor_keys: orphans.map(o => o.key), key_sensor_keys: orphans.map(o => o.key), key_count: orphans.length })
      }
      return bs
    }
    const allKeys = s.map(o => o.key)
    return [{ id: '__all__', name: 'Sensores', icon: 'ti-dashboard', sensor_keys: allKeys, key_sensor_keys: allKeys, key_count: allKeys.length }]
  }, [vehicleType])

  const activeAlerts = firingAlerts.filter(a => a.vehicle_id === id)
  const activeAlertsCount = activeAlerts.length

  // ── Orden de tarjetas de sensores (preferencia por usuario, por tipo) ──
  const { data: userPrefs } = useUserPreferences()
  const patchPrefs = usePatchUserPreferences()
  const [orderEdit, setOrderEdit] = useState(false)
  const savedSensorOrder = (vehicleType && userPrefs?.sensor_order?.[vehicleType.id]) || []

  const handleReorderBlock = (blockId: string, newKeys: string[]) => {
    if (!vehicleType) return
    // Reconstruye el orden plano de TODO el tipo: el bloque editado usa el nuevo
    // orden; el resto conserva su orden guardado actual.
    const flat = liveBlocks.flatMap(b =>
      b.id === blockId ? newKeys : sortByOrder(b.sensor_keys, savedSensorOrder, k => k),
    )
    patchPrefs.mutate({ sensor_order: { [vehicleType.id]: flat } })
  }

  const handleResetOrder = () => {
    if (!vehicleType) return
    patchPrefs.mutate({ sensor_order: { [vehicleType.id]: null } })
    setOrderEdit(false)
  }

  if (!id) return <Navigate to="/fleet" replace />

  if (loadingVehicle) {
    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SkeletonCard width="100%" height={60} />
        <SkeletonCard width="100%" height={200} />
        <SkeletonCard width="100%" height={160} />
      </div>
    )
  }

  if (vehicleError || !vehicle) return <Navigate to="/fleet" replace />

  return (
    <Shell title={vehicle.name}>
      {urgentCount > 0 && (
        <div style={{ padding: '6px 24px 0', flexShrink: 0 }}>
          <Link
            to={`/maintenance?vehicle=${id}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid var(--danger)',
              borderRadius: 6, padding: '4px 10px',
              fontSize: 11, color: 'var(--danger)',
              textDecoration: 'none', fontWeight: 600,
            }}
          >
            ⚠ {urgentCount} plan{urgentCount > 1 ? 'es' : ''} de mantenimiento pendiente{urgentCount > 1 ? 's' : ''}
          </Link>
        </div>
      )}
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <VehicleHeader
          vehicle={vehicle}
          status={status}
          iconUrl={vehicleType?.icon_url ?? undefined}
          vehicleTypeSlug={vehicleType?.slug}
          activeAlerts={activeAlerts}
          tenantName={vehicleTenant?.name}
          onOpenActivity={() => setActivityOpen(true)}
          isStale={isStale}
        />
        <div style={{ padding: isMobile ? '0 12px' : '0 24px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
          <div style={{ overflowX: 'auto', overflowY: 'hidden', flexShrink: 1, minWidth: 0 }}>
            <Tabs tabs={PAGE_TABS} activeTab={tab} onTabChange={(newTab) => setTab(newTab as 'live' | 'historic' | 'cycles' | 'maintenance')} />
          </div>
          {canReports && (
            <div style={{ flexShrink: 0, marginLeft: 12, position: 'relative', zIndex: 100 }}>
              <PdfDownloadBtn vehicleId={id} vehicleName={vehicle.name} isCmg={isCmg} tenantId={vehicle.tenant_id} />
            </div>
          )}
        </div>
        <div ref={liveScrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', ...(tab !== 'live' && { padding: isMobile ? 12 : 24 }) }}>

          {tab === 'live' && (
            <div style={{ padding: isMobile ? 10 : 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {selectedBlockId === null ? (<>

                {/* ALERTAS ACTIVAS — enlace a página de Alertas */}
                {activeAlertsCount > 0 && (
                  <Link
                    to={`/alerts?vehicle=${id}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderLeft: '3px solid var(--danger)', borderRadius: 8, padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--danger)', textDecoration: 'none', fontFamily: 'var(--font-sans)' }}
                  >
                    ⚠ {activeAlertsCount} alerta{activeAlertsCount > 1 ? 's' : ''} activa{activeAlertsCount > 1 ? 's' : ''} — Ver todas →
                  </Link>
                )}

                {/* MANTENIMIENTO URGENTE */}
                {maintenancePlans.some(p => p.progress.status !== 'ok') && (
                  <div style={{
                    background: maintenancePlans.some(p => p.progress.status === 'vencido') ? 'rgba(239,68,68,0.07)' : 'rgba(234,179,8,0.07)',
                    border: `1px solid ${maintenancePlans.some(p => p.progress.status === 'vencido') ? 'rgba(239,68,68,0.3)' : 'rgba(234,179,8,0.3)'}`,
                    borderLeft: `3px solid ${maintenancePlans.some(p => p.progress.status === 'vencido') ? 'var(--danger)' : 'var(--warn)'}`,
                    borderRadius: 8, padding: '10px 12px',
                  }}>
                    <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: maintenancePlans.some(p => p.progress.status === 'vencido') ? 'var(--danger)' : 'var(--warn)' }}>
                      🔧 {maintenancePlans.filter(p => p.progress.status !== 'ok').length} plan{maintenancePlans.filter(p => p.progress.status !== 'ok').length > 1 ? 'es' : ''} de mantenimiento {maintenancePlans.some(p => p.progress.status === 'vencido') ? 'vencido' : 'próximo'}
                    </div>
                  </div>
                )}

                {/* MAPA COLAPSABLE — plegado por defecto, solo se monta al expandir */}
                <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
                  {/* Barra de cabecera — NUNCA condicionada, siempre visible */}
                  <div style={{ background: 'var(--bg-surface)', borderBottom: mapExpanded ? '1px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', minHeight: 36 }}>
                    <button
                      onClick={toggleMap}
                      style={{ flex: 1, background: 'transparent', border: 'none', padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--fg-muted)', fontSize: 12, fontWeight: 600, textAlign: 'left' }}
                    >
                      <span style={{ transform: mapExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s', display: 'inline-block' }}>▾</span>
                      <span>{mapExpanded ? 'Ocultar mapa' : 'Ver mapa'}</span>
                    </button>
                  </div>
                  {mapExpanded && (
                    <div style={{ height: 300, position: 'relative' }}>
                      <TrackMap track={[]} status={status} />
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 400, background: 'rgba(28,25,23,0.82)', backdropFilter: 'blur(6px)', padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 11 }}>
                        {vehicle.driver_name && (
                          <span><span style={{ color: 'rgba(255,255,255,0.45)' }}>Conductor </span><span style={{ color: '#fff', fontWeight: 600 }}>{vehicle.driver_name}</span></span>
                        )}
                        {vehicleTenant && !isCmg && (
                          <span><span style={{ color: 'rgba(255,255,255,0.45)' }}>Cliente </span><span style={{ color: 'rgba(255,255,255,0.8)' }}>{vehicleTenant.name}</span></span>
                        )}
                        <button
                          onClick={() => { setFleetSelected(id); navigate('/fleet') }}
                          style={{ color: 'var(--info)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', fontSize: 11 }}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                          Ver en mapa de flota
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* BARRA DE ESTADO TELEMETRÍA + PANEL DE DIAGNÓSTICO */}
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderTop: '2px solid var(--cmg-teal)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--fg-muted)', letterSpacing: '0.07em', textTransform: 'uppercase' as const }}>
                      Telemetría
                    </span>
                    {isEffectivelyOnline(status)
                      ? <span style={{ color: 'var(--ok)', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <i className="ti ti-antenna-bars-5" style={{ fontSize: 12 }} />
                          En directo
                        </span>
                      : <span style={{ color: statusStamp(status).color, fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <i className="ti ti-antenna-bars-off" style={{ fontSize: 12 }} />
                          {statusStamp(status).text}
                        </span>
                    }
                    {status && (
                      <>
                        <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', padding: '1px 6px', borderRadius: 4,
                          color: isStale ? 'var(--fg-muted)' : (status.ignition ? 'var(--ok)' : 'var(--offline)'),
                          background: isStale ? 'rgba(100,116,139,0.15)' : (status.ignition ? 'var(--ok-soft)' : 'rgba(100,116,139,0.15)'),
                        }}>
                          IGN {status.ignition ? 'ON' : 'OFF'}
                        </span>
                        {(status.pto_active || status.can_data?.avl_2 === 1 || status.can_data?.avl_179 === 1) && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                            color: isStale ? 'var(--fg-muted)' : 'var(--cmg-teal)',
                            background: isStale ? 'rgba(100,116,139,0.15)' : 'var(--cmg-teal-soft)',
                          }}>PTO ON</span>
                        )}
                        {status.speed_kmh != null && status.speed_kmh > 0 && (
                          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-tertiary)' }}>{status.speed_kmh.toFixed(0)} km/h</span>
                        )}
                        {status.can_data && Object.keys(status.can_data).length > 0 && (
                          <button onClick={() => setShowFullTelemetry(true)} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 7px', fontSize: 10, color: 'var(--fg-muted)', cursor: 'pointer', fontWeight: 600 }}>
                            📡 Completa
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {status && vehicleType ? (
                    <DiagnosticPanel
                      vehicleType={vehicleType}
                      status={status}
                      derived={derivedValues as Record<string, number | null>}
                      alerts={activeAlerts}
                      isMobile={isMobile}
                      onBlockClick={setSelectedBlockId}
                      isStale={isStale}
                    />
                  ) : (
                    <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Sin datos en vivo</div>
                  )}

                  {status?.last_seen && (
                    <div style={{ fontSize: 9, color: 'var(--fg-dim)', marginTop: 8 }}>
                      Último dato: {new Date(status.last_seen).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>

                {/* CONTROLES DOUT */}
                {(vehicleType?.dout_config ?? []).filter(d => d.enabled).length > 0 && (
                  <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px' }}>
                    <div style={{ fontFamily: 'var(--font-sans)', fontSize: 9, fontWeight: 700, color: 'var(--fg-muted)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>Controles de mando</div>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                      {(vehicleType?.dout_config ?? []).filter(d => d.enabled).map(d => {
                        const active = !!doutState[d.slot]
                        const loading = !!doutLoading[d.slot]
                        const assocSensor = d.sensor_key ? sensorSchema.find(s => s.key === d.sensor_key) : null
                        const assocRawVal: number | null = assocSensor?.avl_id != null
                          ? ((status?.can_data?.[`avl_${assocSensor.avl_id}`] as number | undefined) ?? null)
                          : null
                        const assocVal = assocRawVal != null && assocSensor
                          ? (assocRawVal * (assocSensor.scale ?? 1) + (assocSensor.offset ?? 0)).toFixed(1)
                          : null
                        return (
                          <div key={d.slot} style={{
                            background: active ? 'var(--ok-soft)' : 'var(--bg-card)',
                            border: `1px solid ${active ? 'var(--ok)' : 'var(--border)'}`,
                            borderRadius: 8, padding: '10px 12px',
                            display: 'flex', flexDirection: 'column', gap: 6,
                            transition: 'background 0.2s, border-color 0.2s',
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)' }}>{d.label}</span>
                              <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: active ? 'var(--ok)' : 'var(--offline)' }}>
                                {active ? '● ON' : '○ OFF'}
                              </span>
                            </div>
                            {assocVal != null && assocSensor && (
                              <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                                {assocVal} {assocSensor.unit}
                              </div>
                            )}
                            <button onClick={() => sendDout(d.slot)} disabled={loading}
                              style={{
                                background: active ? 'rgba(34,197,94,0.2)' : 'var(--bg-elevated)',
                                border: `1px solid ${active ? 'var(--ok)' : 'var(--border)'}`,
                                borderRadius: 6, padding: '5px 0', fontSize: 11, fontWeight: 600,
                                cursor: loading ? 'wait' : 'pointer', color: active ? 'var(--ok)' : 'var(--fg-tertiary)',
                                opacity: loading ? 0.6 : 1, width: '100%', fontFamily: 'var(--font-sans)',
                                transition: 'all 0.15s',
                              }}>
                              {loading ? '…' : active ? 'Desactivar' : 'Activar'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* CONTROL CAN MANUAL — solo visible si el vehículo tiene slots configurados */}
                {id && manualCanSlots.length > 0 && (
                  <ManualCanControl vehicleId={id} slots={manualCanSlots} />
                )}

                {/* CONFIGURACIÓN MANUAL CAN — solo visible para admin */}
                {id && <ManualCanSlotManager vehicleId={id} />}
                {id && <ManualCanButtonManager vehicleId={id} />}

                {/* VER REPORTES */}
                <button
                  onClick={() => navigate('/reports', { state: { vehicleId: id, tab: 'historico' } })}
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg-muted)', fontWeight: 600, textAlign: 'left', width: '100%', transition: 'border-color 0.15s, color 0.15s' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = 'var(--info)'; el.style.color = 'var(--info)' }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--fg-muted)' }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                  Ver reportes de este vehículo
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto' }}><polyline points="9 18 15 12 9 6"/></svg>
                </button>

              {/* HISTORIAL DE COMANDOS */}
              <div style={{ borderTop: '1px solid var(--border)', flexShrink: 0 }}>
                <button onClick={() => setShowBottomPanel(v => !v)}
                  style={{ width: '100%', background: 'var(--bg-surface)', border: 'none', padding: '5px 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--fg-muted)', fontSize: 11 }}>
                  <span style={{ transform: showBottomPanel ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s', display: 'inline-block' }}>▾</span>
                  {showBottomPanel ? 'Ocultar historial técnico' : 'Historial de comandos e incidencias'}
                </button>
              </div>
              {showBottomPanel && (
                <div style={isMobile ? { display: 'flex', flexDirection: 'column' } : { display: 'grid', gridTemplateColumns: '2fr 1fr', borderTop: '1px solid var(--border)', height: 180, overflow: 'hidden' }}>
                  <div style={{ borderRight: isMobile ? 'none' : '1px solid var(--border)', borderBottom: isMobile ? '1px solid var(--border)' : 'none', padding: '10px 14px', overflowY: 'auto' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', marginBottom: 8 }}>HISTORIAL DE COMANDOS</div>
                    {commandHistory.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--fg-muted)', fontStyle: 'italic' }}>Sin historial disponible</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {commandHistory.map(entry => (
                          <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'start', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
                            <div>
                              <div style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                                {new Date(entry.sent_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)' }}>{entry.command}</div>
                              {(entry.response || entry.error_message) && (
                                <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{entry.response ?? entry.error_message}</div>
                              )}
                            </div>
                            <CommandStatusBadge status={entry.status} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ padding: '10px 14px', overflowY: 'auto' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', marginBottom: 8 }}>INCIDENCIAS</div>
                    {firingAlerts.filter(a => a.vehicle_id === id).length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--ok)' }}>✓ Sin incidencias</div>
                    ) : (
                      firingAlerts.filter(a => a.vehicle_id === id).slice(0, 5).map(a => (
                        <div key={a.id} style={{ fontSize: 11, color: 'var(--warn)', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 4 }}>
                          {a.rule_id.slice(0, 8)}… {new Date(a.triggered_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
              </>) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => { setSelectedBlockId(null); setOrderEdit(false) }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--cmg-teal)', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', fontFamily: 'var(--font-sans)' }}
                  >
                    ← Volver al panel
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {orderEdit && (
                      <button
                        onClick={handleResetOrder}
                        style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 10px' }}
                      >
                        Restablecer
                      </button>
                    )}
                    <button
                      onClick={() => setOrderEdit(v => !v)}
                      style={{ background: orderEdit ? 'var(--cmg-teal)' : 'transparent', border: '1px solid var(--cmg-teal)', borderRadius: 6, color: orderEdit ? '#fff' : 'var(--cmg-teal)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 5 }}
                    >
                      {orderEdit ? '✓ Hecho' : '⠿ Ordenar'}
                    </button>
                  </div>
                </div>
                {orderEdit && (
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: -2 }}>
                    Arrastra las tarjetas para ordenarlas a tu gusto. El orden se guarda solo para ti.
                  </div>
                )}
                {(() => {
                  const block = liveBlocks.find(b => b.id === selectedBlockId)
                  if (!block || !status || !id) return null
                  return (
                    <BlockDetailSection
                      block={block}
                      schema={sensorSchema}
                      status={status}
                      derived={derivedValues as Record<string, number | null>}
                      alerts={activeAlerts}
                      vehicleId={id}
                      isStale={isStale}
                      order={savedSensorOrder}
                      editMode={orderEdit}
                      onReorder={(newKeys) => handleReorderBlock(block.id, newKeys)}
                    />
                  )
                })()}
              </>
              )}
            </div>
          )}

          {tab === 'historic' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* ── Sección RECORRIDO ── */}
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderTop: '2px solid var(--cmg-teal)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-muted)', letterSpacing: '0.07em', textTransform: 'uppercase' as const }}>
                    Recorrido
                  </span>
                  <input
                    type="date"
                    value={trackDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={e => setTrackDate(e.target.value)}
                    style={{ fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', color: 'var(--fg-primary)', colorScheme: 'dark' }}
                  />
                  {isTrackToday && (
                    <span style={{ fontSize: 10, color: 'var(--ok)', fontWeight: 600 }}>Hoy</span>
                  )}
                  {track.length > 0 && (
                    <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{track.length} puntos GPS</span>
                  )}
                </div>
                <div style={{ height: 340, borderRadius: 6, overflow: 'hidden' }}>
                  <TrackMap
                    track={track}
                    status={isTrackToday ? status : undefined}
                    emptyMessage={isTrackToday ? 'Sin recorrido registrado hoy' : 'Sin recorrido registrado para esta fecha'}
                  />
                </div>
              </div>

              {/* ── Sección KPIs y Gráficas ── */}
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderTop: '2px solid var(--cmg-teal)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-muted)', letterSpacing: '0.07em', textTransform: 'uppercase' as const, marginBottom: 12 }}>
                  Estadísticas
                </div>
                <KpiChart vehicleId={id} vehicleTypeId={vehicle.vehicle_type_id} />
              </div>

            </div>
          )}

          {tab === 'cycles' && vehicle.vehicle_type_id && (
            <WorkCyclesTab vehicleId={vehicle.id} vehicleTypeId={vehicle.vehicle_type_id} tenantId={vehicle.tenant_id} />
          )}

          {tab === 'maintenance' && id && (
            <MaintenanceTab vehicleId={id} isCmg={isCmg} />
          )}

        </div>
      </div>
      {showFullTelemetry && status?.can_data && (
        <FullTelemetryModal
          canData={status.can_data as Record<string, unknown>}
          sensorSchema={sensorSchema}
          onClose={() => setShowFullTelemetry(false)}
        />
      )}
      <ActivityDrawer
        isOpen={activityOpen}
        onClose={() => setActivityOpen(false)}
        commands={commandHistory}
      />
    </Shell>
  )
}

function FullTelemetryModal({ canData, sensorSchema, onClose }: {
  canData: Record<string, unknown>
  sensorSchema: import('../../lib/types').SensorDef[]
  onClose: () => void
}) {
  // Combinar: datos recibidos + sensores del schema sin dato
  const receivedKeys = new Set(Object.keys(canData))
  const schemaOnlyEntries: [string, unknown][] = sensorSchema
    .filter(s => s.avl_id != null && !receivedKeys.has(`avl_${s.avl_id}`))
    .map(s => [`avl_${s.avl_id}`, null])
  const allEntries = [...Object.entries(canData), ...schemaOnlyEntries]
  const entries = allEntries.sort((a, b) => {
    const aId = parseInt(a[0].replace('avl_', '')) || 0
    const bId = parseInt(b[0].replace('avl_', '')) || 0
    return aId - bId
  })
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
      zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        width: 640, maxWidth: '95vw', maxHeight: '85vh',
        background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-primary)' }}>📡 Telemetría completa</div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>{Object.keys(canData).length} recibidos · {entries.length} total</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--fg-muted)', padding: '4px 8px' }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-elevated)', zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['ID AVL', 'Nombre', 'Valor', 'Unidad'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--fg-muted)', fontWeight: 600, fontSize: 10, letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map(([key, val]) => {
                const avlIdNum = parseInt(key.replace('avl_', ''))
                const sensor = sensorSchema.find(s => s.avl_id === avlIdNum)
                // Nombres estándar FMC650 para IDs sin sensor configurado
                const AVL_NAMES: Record<number,{label:string,unit:string}> = {
                  1:{label:'DIN1 (Ignición)',unit:''},2:{label:'DIN2 (PTO)',unit:''},
                  3:{label:'DIN3 (Entrada digital 3)',unit:''},4:{label:'DIN4 (Entrada digital 4)',unit:''},5:{label:'Analog 3',unit:'mV'},6:{label:'Analog 4',unit:'mV'},
                  9:{label:'Analógico 1',unit:'mV'},10:{label:'Analógico 2',unit:'mV'},
                  21:{label:'GSM Señal',unit:''},22:{label:'GNSS Estado',unit:''},
                  24:{label:'Vel. GPS',unit:'km/h'},66:{label:'Voltaje Ext.',unit:'mV'},
                  67:{label:'Batería GPS',unit:'mV'},68:{label:'Temp. GNSS',unit:''},
                  71:{label:'Satelites',unit:''},72:{label:'HDOP',unit:''},
                  181:{label:'GNSS PDOP',unit:''},182:{label:'GSM Oper.',unit:''},
                  199:{label:'Triángulo Emergencia',unit:''},
                  200:{label:'Deep Sleep',unit:''},201:{label:'LLS1 Fuel Level',unit:'%'},
                  202:{label:'LLS2 Fuel Level',unit:'%'},203:{label:'LLS3 Fuel Level',unit:'%'},
                  204:{label:'Wheel Speed',unit:'km/h'},205:{label:'Odómetro Total',unit:'m'},
                  206:{label:'Eje. Trip',unit:'m'},216:{label:'Temp. Dallas 1',unit:'°C'},
                  239:{label:'Ignición CAN',unit:''},240:{label:'Movimiento',unit:''},
                  241:{label:'Actividad',unit:''},1148:{label:'Record count',unit:''},
                  285:{label:'Odómetro',unit:'m'},286:{label:'Odómetro Trip',unit:'m'},
                }
                const fallback = AVL_NAMES[avlIdNum]
                return (
                  <tr key={key} style={{ borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '6px 12px', fontFamily: 'var(--font-mono)', color: 'var(--cmg-teal)', fontSize: 11 }}>{key}</td>
                    <td style={{ padding: '6px 12px', color: (sensor||fallback) ? 'var(--fg-primary)' : 'var(--fg-muted)', fontStyle: (sensor||fallback) ? 'normal' : 'italic' }}>
                      {sensor?.label ?? fallback?.label ?? '—'}
                    </td>
                    <td style={{ padding: '6px 12px', fontFamily: 'var(--font-mono)', color: val != null ? 'var(--info)' : 'var(--fg-muted)', fontWeight: val != null ? 600 : 400, fontStyle: val != null ? 'normal' : 'italic' }}>
                      {val != null ? String(val) : 'Sin dato'}
                    </td>
                    <td style={{ padding: '6px 12px', color: 'var(--fg-muted)' }}>
                      {sensor?.unit ?? fallback?.unit ?? '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function CommandStatusBadge({ status }: { status: CommandLogEntry['status'] }) {
  const map: Record<CommandLogEntry['status'], { label: string; color: string }> = {
    pending:   { label: 'Pendiente',  color: 'var(--offline)' },
    sent:      { label: 'Enviado',    color: 'var(--info)' },
    failed:    { label: 'Fallido',    color: 'var(--danger)' },
    confirmed: { label: 'Confirmado', color: 'var(--ok)' },
  }
  const { label, color } = map[status] ?? map.pending
  return (
    <span style={{
      fontSize: 9, padding: '2px 6px', borderRadius: 8, fontWeight: 600,
      background: `color-mix(in srgb, ${color} 15%, transparent)`,
      color, border: `1px solid ${color}`, whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}


function PdfDownloadBtn({ vehicleId, vehicleName, isCmg, tenantId }: {
  vehicleId: string
  vehicleName: string
  isCmg: boolean
  tenantId: string
}) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i)
  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

  async function download() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) })
      params.append('vehicle_ids', vehicleId)
      if (isCmg && tenantId) params.append('tenant_id', tenantId)
      const blob = await apiClient.getBlob(`/api/v1/reports/monthly?${params}`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `informe-${vehicleName.replace(/\s+/g, '-')}-${year}-${String(month).padStart(2, '0')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      setOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al generar el informe')
    } finally {
      setLoading(false)
    }
  }


  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '5px 12px',
          fontSize: 12,
          color: 'var(--fg-muted)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        ⬇ Informe PDF
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '110%', zIndex: 200,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 14, minWidth: 240, boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-primary)' }}>Selecciona período</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Select size="sm" value={month} onChange={e => setMonth(Number(e.target.value))} style={{ flex: 1 }}>
              {months.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </Select>
            <Select size="sm" value={year} onChange={e => setYear(Number(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </Select>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Vehículo: {vehicleName}</div>
          <button
            onClick={download}
            disabled={loading}
            style={{
              background: 'var(--cmg-teal)', color: '#fff',
              border: 'none', borderRadius: 6, padding: '7px 14px',
              fontSize: 12, cursor: 'pointer', fontWeight: 600,
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Generando…' : '⬇ Descargar PDF'}
          </button>
        </div>
      )}
    </div>
  )
}
