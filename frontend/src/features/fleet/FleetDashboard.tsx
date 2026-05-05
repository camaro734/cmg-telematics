import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
// react-window v2 tiene API incompatible con @types/react-window v1; usamos scroll nativo
import FleetMap from './FleetMap'
import VehicleCard from './VehicleCard'
import type { VehicleState } from './VehicleCard'
import { useFleetStore } from './useFleetStore'
import { useVehicleStatuses } from './useVehicleStatuses'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useIsMobile } from '../../lib/useIsMobile'
import type { VehicleOut, VehicleTypeOut, AlertInstanceOut, TenantOut, VehicleStatus } from '../../lib/types'
import { SkeletonCard, SkeletonRow } from '../../shared/ui/SkeletonCard'

interface AlertRuleBrief { id: string; name: string }

function relativeTime(iso: string | null): string {
  if (!iso) return 'Sin señal'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'Hace un momento'
  if (mins < 60) return `Hace ${mins} min`
  const h = Math.floor(mins / 60)
  if (h < 24) return `Hace ${h}h`
  return `Hace ${Math.floor(h / 24)}d`
}

function isEffectivelyOnline(status: VehicleStatus | undefined): boolean {
  if (!status?.online || !status.last_seen) return false
  return (Date.now() - new Date(status.last_seen).getTime()) < 5 * 60_000
}

const STATE_ORDER: Record<VehicleState, number> = { alert: 0, moving: 1, idle: 2, offline: 3 }

function getVehicleState(
  vehicle: VehicleOut,
  status: VehicleStatus | undefined,
  alerts: AlertInstanceOut[]
): VehicleState {
  if (!isEffectivelyOnline(status)) return 'offline'
  if (alerts.some(a => a.vehicle_id === vehicle.id)) return 'alert'
  if ((status!.speed_kmh ?? 0) > 2) return 'moving'
  return 'idle'
}

export default function FleetDashboard() {
  const selectedId = useFleetStore(s => s.selectedId)
  const setSelected = useFleetStore(s => s.setSelected)
  const isMobile = useIsMobile()

  const { data: vehicles = [], isLoading: loadingVehicles } = useQuery({
    queryKey: keys.vehicles(),
    queryFn: () => apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    staleTime: 5 * 60_000,
  })

  const { data: vehicleTypes = [] } = useQuery({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: 10 * 60_000,
  })

  const { data: tenants = [] } = useQuery({
    queryKey: keys.tenants(),
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants'),
    staleTime: 10 * 60_000,
  })

  const { data: firingAlerts = [] } = useQuery({
    queryKey: [...keys.alerts(), 'firing'],
    queryFn: () => apiClient.get<AlertInstanceOut[]>('/api/v1/alerts?status=firing'),
    refetchInterval: 30_000,
  })

  const { data: rules = [] } = useQuery({
    queryKey: keys.rules(),
    queryFn: () => apiClient.get<AlertRuleBrief[]>('/api/v1/alert-rules'),
    staleTime: 5 * 60_000,
  })

  const statuses = useVehicleStatuses(vehicles)

  const typeById = new Map(vehicleTypes.map(t => [t.id, t]))
  const vehicleById = new Map(vehicles.map(v => [v.id, v]))
  const tenantById = new Map(tenants.map(t => [t.id, t]))
  const ruleById = new Map(rules.map(r => [r.id, r]))

  const movingCount = vehicles.filter(v => {
    const s = statuses.get(v.id)
    return isEffectivelyOnline(s) && (s!.speed_kmh ?? 0) > 2
  }).length
  const idleCount = vehicles.filter(v => {
    const s = statuses.get(v.id)
    return isEffectivelyOnline(s) && (s!.speed_kmh ?? 0) <= 2
  }).length
  const offlineCount = vehicles.filter(v => !isEffectivelyOnline(statuses.get(v.id))).length

  const sortedVehicles = [...vehicles].sort((a, b) =>
    STATE_ORDER[getVehicleState(a, statuses.get(a.id), firingAlerts)] -
    STATE_ORDER[getVehicleState(b, statuses.get(b.id), firingAlerts)]
  )

  const selectedVehicle = selectedId ? vehicleById.get(selectedId) : undefined
  const selectedStatus = selectedId ? statuses.get(selectedId) : undefined
  const selectedType = selectedVehicle ? typeById.get(selectedVehicle.vehicle_type_id) : undefined
  const selectedTenant = selectedVehicle ? tenantById.get(selectedVehicle.tenant_id) : undefined

  const topAlerts = [...firingAlerts]
    .sort((a, b) => new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime())
    .slice(0, 5)

  const canLedStates = (() => {
    if (!selectedType || !selectedStatus) return []
    return selectedType.sensor_schema
      .filter(def => def.gauge_type === 'led' && def.avl_id != null)
      .map(def => {
        const raw = selectedStatus.can_data?.[`avl_${def.avl_id}`]
        let active = false
        if (raw != null) {
          const num = Number(raw)
          if (def.bit_index != null) {
            active = ((num >> def.bit_index) & 1) === 1
          } else {
            active = num === 1
          }
        }
        return { label: def.label, active }
      })
  })()

  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards')
  const [desktopSearch, setDesktopSearch] = useState('')
  const [desktopViewMode, setDesktopViewMode] = useState<'cards' | 'list'>('cards')
  const [bottomCollapsed, setBottomCollapsed] = useState(false)

  const mobileListContainerRef = useRef<HTMLDivElement>(null)
  const desktopListContainerRef = useRef<HTMLDivElement>(null)
  const [desktopListHeight, setDesktopListHeight] = useState(400)

  useEffect(() => {
    const el = desktopListContainerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const h = entries[0]?.contentRect.height
      if (h) setDesktopListHeight(h)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Filtrado por búsqueda
  const filteredVehicles = sortedVehicles.filter(v =>
    searchQuery === '' ||
    v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (v.license_plate ?? '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
        {/* Map — full width, fixed height */}
        <div style={{ width: '100%', height: '50vh', minHeight: 240, flexShrink: 0 }}>
          <FleetMap vehicles={vehicles} statuses={statuses} vehicleTypes={vehicleTypes} firingAlerts={firingAlerts} />
        </div>

        {/* Fleet header + buscador + toggle vista */}
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--bg-border)', borderTop: '1px solid var(--bg-border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 14 }}>FLOTA</span>
            <span style={{ fontSize: 12, color: 'var(--accent-ok)' }}>● {movingCount} en ruta</span>
            <span style={{ fontSize: 12, color: 'var(--accent-warn)' }}>◑ {idleCount} parados</span>
            <span style={{ fontSize: 12, color: 'var(--accent-off)' }}>○ {offlineCount} sin señal</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button onClick={() => setViewMode('cards')} title="Tarjetas" style={{ background: viewMode === 'cards' ? 'var(--accent)' : 'var(--bg-elevated)', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', color: viewMode === 'cards' ? '#000' : 'var(--text-muted)', fontSize: 14 }}>&#9632;&#9632;</button>
              <button onClick={() => setViewMode('list')} title="Lista" style={{ background: viewMode === 'list' ? 'var(--accent)' : 'var(--bg-elevated)', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', color: viewMode === 'list' ? '#000' : 'var(--text-muted)', fontSize: 14 }}>☰</button>
            </div>
          </div>
          <input
            type="search"
            placeholder="Buscar vehículo o matrícula…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', borderRadius: 6, padding: '7px 10px', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
          />
        </div>

        {/* Vehicle cards o lista */}
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: viewMode === 'list' ? 2 : 8 }}>
          {loadingVehicles ? (
            /* Skeletons mientras cargan */
            Array.from({ length: 6 }, (_, i) => (
              viewMode === 'list'
                ? <SkeletonRow key={i} height={48} />
                : <SkeletonCard key={i} width="100%" height={110} />
            ))
          ) : filteredVehicles.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, paddingTop: 20 }}>
              {searchQuery ? `Sin resultados para «${searchQuery}»` : 'Sin vehículos registrados'}
            </div>
          ) : viewMode === 'list' ? (
            /* Lista con scroll nativo — suficiente para 500 vehículos */
            <div ref={mobileListContainerRef} style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 500, overflowY: 'auto' }}>
              {filteredVehicles.map(vehicle => {
                const vStatus = statuses.get(vehicle.id)
                const vState = getVehicleState(vehicle, vStatus, firingAlerts)
                const stateColor = vState === 'alert' ? 'var(--accent-crit)' : vState === 'moving' ? 'var(--accent-ok)' : vState === 'idle' ? 'var(--accent-warn)' : 'var(--accent-off)'
                return (
                  <div key={vehicle.id} onClick={() => navigate(`/vehicles/${vehicle.id}`)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, background: 'var(--bg-surface)', border: '1px solid var(--bg-border)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: stateColor, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontWeight: 500, fontSize: 13 }}>{vehicle.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>{vehicle.license_plate ?? '—'}</span>
                    <span style={{ fontSize: 11, color: stateColor, fontWeight: 600, minWidth: 60, textAlign: 'right' }}>
                      {vState === 'moving' ? `${vStatus?.speed_kmh?.toFixed(0) ?? 0} km/h` : vState === 'idle' ? 'Parado' : vState === 'alert' ? '⚠ Alerta' : 'Sin señal'}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>›</span>
                  </div>
                )
              })}
            </div>
          ) : (
            /* Cards en flex-wrap */
            filteredVehicles.map(vehicle => {
              const vStatus = statuses.get(vehicle.id)
              const vState = getVehicleState(vehicle, vStatus, firingAlerts)
              return (
                <div key={vehicle.id} onClick={() => navigate(`/vehicles/${vehicle.id}`)} style={{ cursor: 'pointer' }}>
                  <VehicleCard
                    vehicle={vehicle}
                    vehicleType={typeById.get(vehicle.vehicle_type_id)}
                    status={vStatus}
                    isSelected={vehicle.id === selectedId}
                    vehicleState={vState}
                  />
                </div>
              )
            })
          )}
        </div>

        {/* Incidencias activas — simple list on mobile */}
        <div style={{ borderTop: '1px solid var(--bg-border)', padding: '10px 14px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Incidencias activas</div>
          {topAlerts.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--accent-ok)' }}>✓ Sin incidencias activas</div>
          ) : (
            topAlerts.map(alert => {
              const v = vehicleById.get(alert.vehicle_id)
              const rule = ruleById.get(alert.rule_id)
              return (
                <div key={alert.id} style={{ borderBottom: '1px solid var(--bg-border)', padding: '8px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--accent-warn)', fontWeight: 500 }}>{rule?.name ?? alert.rule_id.slice(0, 8)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{v?.license_plate ?? v?.name ?? '—'} · {relativeTime(alert.triggered_at)}</div>
                  </div>
                  <Link to="/alerts" style={{ fontSize: 11, color: 'var(--accent-info)', flexShrink: 0 }}>Ver →</Link>
                </div>
              )
            })
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Top section ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', minHeight: 0, ...(bottomCollapsed ? { flex: 1 } : { flex: '0 0 55vh' }) }}>

        {/* Left: vehicle grid */}
        <div style={{
          width: '55%',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--bg-border)',
          overflow: 'hidden',
        }}>
          {/* Cabecera desktop con buscador y toggle */}
          <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--bg-border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
              <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>FLOTA</span>
              <span style={{ fontSize: 11, color: 'var(--accent-ok)' }}>● {movingCount} en ruta</span>
              <span style={{ fontSize: 11, color: 'var(--accent-warn)' }}>◑ {idleCount} parados</span>
              <span style={{ fontSize: 11, color: 'var(--accent-off)' }}>○ {offlineCount} sin señal</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button onClick={() => setDesktopViewMode('cards')} title="Tarjetas"
                  style={{ background: desktopViewMode === 'cards' ? 'var(--accent)' : 'var(--bg-elevated)', border: 'none', borderRadius: 4, padding: '3px 7px', cursor: 'pointer', color: desktopViewMode === 'cards' ? '#000' : 'var(--text-muted)', fontSize: 13 }}>&#9632;&#9632;</button>
                <button onClick={() => setDesktopViewMode('list')} title="Lista"
                  style={{ background: desktopViewMode === 'list' ? 'var(--accent)' : 'var(--bg-elevated)', border: 'none', borderRadius: 4, padding: '3px 7px', cursor: 'pointer', color: desktopViewMode === 'list' ? '#000' : 'var(--text-muted)', fontSize: 13 }}>☰</button>
              </div>
            </div>
            <input type="search" placeholder="Buscar vehículo o matrícula…" value={desktopSearch}
              onChange={e => setDesktopSearch(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', borderRadius: 5, padding: '5px 9px', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }} />
          </div>

          {/* Lista de vehículos desktop */}
          <div
            ref={desktopListContainerRef}
            style={{
              flex: 1, overflowY: 'auto', padding: desktopViewMode === 'list' ? '6px 10px' : 12,
              display: desktopViewMode === 'cards' ? 'grid' : 'flex',
              flexDirection: 'column',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: desktopViewMode === 'list' ? 2 : 10,
              alignContent: 'start',
            }}>
            {(() => {
              const desktopFiltered = sortedVehicles.filter(v =>
                desktopSearch === '' ||
                v.name.toLowerCase().includes(desktopSearch.toLowerCase()) ||
                (v.license_plate ?? '').toLowerCase().includes(desktopSearch.toLowerCase())
              )
              if (loadingVehicles) {
                return Array.from({ length: 6 }, (_, i) => (
                  desktopViewMode === 'list'
                    ? <SkeletonRow key={i} height={40} />
                    : <SkeletonCard key={i} width="100%" height={100} />
                ))
              }
              if (desktopFiltered.length === 0) {
                return (
                  <div style={{ gridColumn: '1 / -1', color: 'var(--text-muted)', fontSize: 13, paddingTop: 20 }}>
                    {desktopSearch ? `Sin resultados para «${desktopSearch}»` : 'Sin vehículos registrados'}
                  </div>
                )
              }
              if (desktopViewMode === 'list') {
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: desktopListHeight || 400, overflowY: 'auto' }}>
                    {desktopFiltered.map(vehicle => {
                      const vStatus = statuses.get(vehicle.id)
                      const vState = getVehicleState(vehicle, vStatus, firingAlerts)
                      const stateColor = vState === 'alert' ? 'var(--accent-crit)' : vState === 'moving' ? 'var(--accent-ok)' : vState === 'idle' ? 'var(--accent-warn)' : 'var(--accent-off)'
                      return (
                        <div key={vehicle.id}
                          onClick={() => useFleetStore.getState().setSelected(vehicle.id === selectedId ? null : vehicle.id)}
                          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 5,
                            background: vehicle.id === selectedId ? 'var(--bg-elevated)' : 'transparent',
                            border: `1px solid ${vehicle.id === selectedId ? 'var(--accent)' : 'var(--bg-border)'}` }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: stateColor, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vehicle.name}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-data)', flexShrink: 0 }}>{vehicle.license_plate ?? '—'}</span>
                          <span style={{ fontSize: 11, color: stateColor, fontWeight: 600, flexShrink: 0 }}>
                            {vState === 'moving' ? `${vStatus?.speed_kmh?.toFixed(0) ?? 0} km/h` : vState === 'idle' ? 'Parado' : vState === 'alert' ? '⚠' : '○'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )
              }
              return desktopFiltered.map(vehicle => {
                const vStatus = statuses.get(vehicle.id)
                const vState = getVehicleState(vehicle, vStatus, firingAlerts)
                return (
                  <VehicleCard
                    key={vehicle.id}
                    vehicle={vehicle}
                    vehicleType={typeById.get(vehicle.vehicle_type_id)}
                    status={vStatus}
                    isSelected={vehicle.id === selectedId}
                    vehicleState={vState}
                  />
                )
              })
            })()}
          </div>
        </div>

        {/* Right: map */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <FleetMap vehicles={vehicles} statuses={statuses} vehicleTypes={vehicleTypes} firingAlerts={firingAlerts} />
        </div>
      </div>

      {/* ── Bottom section (colapsable) */}
      <div style={{
        borderTop: '1px solid var(--bg-border)',
        ...(bottomCollapsed
          ? { flexShrink: 0, overflow: 'hidden' }
          : { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
        ),
      }}>
        <button onClick={() => setBottomCollapsed(c => !c)}
          style={{ width: '100%', background: 'var(--bg-surface)', border: 'none', padding: '5px 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11 }}>
          <span style={{ transform: bottomCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-block' }}>▾</span>
          {bottomCollapsed ? 'Mostrar Servicios e Incidencias' : 'Ocultar Servicios e Incidencias'}
        </button>
        <div style={{
          ...(bottomCollapsed
            ? { height: 0, overflow: 'hidden', display: 'flex', minHeight: 0 }
            : { flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }
          ),
        }}>

        {/* Servicios del día */}
        <div style={{
          width: selectedId ? '25%' : '50%',
          transition: 'width 0.2s ease',
          borderRight: '1px solid var(--bg-border)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '8px 14px',
            borderBottom: '1px solid var(--bg-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Servicios del día</span>
            <input
              type="date"
              disabled
              style={{
                fontSize: 11,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--bg-border)',
                borderRadius: 4,
                color: 'var(--text-muted)',
                padding: '2px 6px',
                cursor: 'not-allowed',
              }}
            />
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: 22, marginBottom: 8 }}>📋</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Próximamente — configuración<br />por cliente y tipo de vehículo
              </div>
            </div>
          </div>
        </div>

        {/* Incidencias */}
        <div style={{
          width: selectedId ? '35%' : '50%',
          transition: 'width 0.2s ease',
          borderRight: selectedId ? '1px solid var(--bg-border)' : 'none',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--bg-border)', flexShrink: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Incidencias activas</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {topAlerts.length === 0 ? (
              <div style={{ padding: '16px 14px', fontSize: 12, color: 'var(--accent-ok)' }}>
                ✓ Sin incidencias activas
              </div>
            ) : (
              topAlerts.map(alert => {
                const v = vehicleById.get(alert.vehicle_id)
                const rule = ruleById.get(alert.rule_id)
                return (
                  <div key={alert.id} style={{
                    padding: '8px 14px',
                    borderBottom: '1px solid var(--bg-border)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
                        {relativeTime(alert.triggered_at)}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--accent-warn)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {rule?.name ?? alert.rule_id.slice(0, 8)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v?.license_plate ?? v?.name ?? '—'}
                      </div>
                    </div>
                    <Link to="/alerts" style={{ fontSize: 11, color: 'var(--accent-info)', flexShrink: 0 }}>
                      Detalles →
                    </Link>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Panel vehículo seleccionado */}
        <div style={{
          width: selectedId ? '40%' : 0,
          overflow: 'hidden',
          transition: 'width 0.2s ease',
          flexShrink: 0,
        }}>
          {selectedVehicle && (
            <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{
                padding: '8px 14px',
                borderBottom: '1px solid var(--bg-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedTenant?.name ?? '—'}
                </span>
                <button
                  onClick={() => setSelected(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                  title="Cerrar panel"
                >
                  ×
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Conductor</div>
                    <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>{selectedVehicle.driver_name ?? '—'}</div>
                  </div>
                  <Link to={`/vehicles/${selectedVehicle.id}`} style={{ fontSize: 12, color: 'var(--accent-info)', alignSelf: 'flex-end' }}>
                    Detalle →
                  </Link>
                </div>

                <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: '10px 12px', marginBottom: 12 }}>
                  <Row label="Tipo" value={selectedType?.name ?? '—'} />
                  <Row label="Matrícula" value={selectedVehicle.license_plate ?? '—'} />
                  <Row label="VIN" value={selectedVehicle.vin ?? '—'} />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Estados CAN
                  </div>
                  {/* Solo mostrar estados CAN si hay señal activa */}
                  {isEffectivelyOnline(selectedStatus) ? (
                    <>
                      <CanBadge label="Ignición" active={selectedStatus?.ignition ?? false} />
                      <CanBadge label="PTO" active={selectedStatus?.pto_active ?? false} />
                      {canLedStates.map(s => (
                        <CanBadge key={s.label} label={s.label} active={s.active} />
                      ))}
                    </>
                  ) : (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      Sin señal — últimos datos hace{' '}
                      {selectedStatus?.last_seen ? (() => {
                        const mins = Math.round((Date.now() - new Date(selectedStatus.last_seen).getTime()) / 60000);
                        return mins < 60 ? `${mins} min` : `${Math.round(mins/60)} h`;
                      })() : '--'}
                    </div>
                  )}
                </div>

                {selectedStatus?.ext_voltage_mv != null && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Batería vehículo
                    </div>
                    <BatteryPanel mv={selectedStatus.ext_voltage_mv} />
                  </div>
                )}

                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Última señal: {relativeTime(selectedStatus?.last_seen ?? null)}
                </div>
              </div>
            </div>
          )}
        </div>

        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-data)', textAlign: 'right', maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </span>
    </div>
  )
}

function BatteryPanel({ mv }: { mv: number }) {
  const v = mv / 1000
  const pct = Math.round(Math.max(0, Math.min(1, (mv - 11000) / (14400 - 11000))) * 100)
  const color = mv < 11500 ? 'var(--accent-crit)' : mv < 12000 ? 'var(--accent-warn)' : 'var(--accent-ok)'
  const label = mv < 11500 ? 'BAJA' : mv < 12000 ? 'ADVERTENCIA' : 'OK'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <div style={{ width: 44, height: 18, border: '2px solid var(--bg-border)', borderRadius: 3, background: 'var(--bg-base)', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
        </div>
        <div style={{ width: 3, height: 8, background: 'var(--bg-border)', borderRadius: '0 2px 2px 0' }} />
      </div>
      <span style={{ fontSize: 13, fontFamily: 'var(--font-data)', color, fontWeight: 700 }}>{v.toFixed(2)} V</span>
      <span style={{ fontSize: 10, color, fontWeight: 600 }}>{label}</span>
    </div>
  )
}

function CanBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{label}</span>
      <span style={{
        fontSize: 10, padding: '2px 8px', borderRadius: 10,
        background: active ? 'color-mix(in srgb, var(--accent-ok) 20%, transparent)' : 'var(--bg-elevated)',
        color: active ? 'var(--accent-ok)' : 'var(--text-muted)',
        border: `1px solid ${active ? 'var(--accent-ok)' : 'var(--bg-border)'}`,
        fontWeight: 500,
      }}>
        {active ? 'Activo' : 'Desactivado'}
      </span>
    </div>
  )
}
