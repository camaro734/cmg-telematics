import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useState, useEffect, useMemo } from 'react'
import FleetMap from './FleetMap'
import { useFleetStore } from './useFleetStore'
import { useVehicleStatuses } from './useVehicleStatuses'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useIsMobile } from '../../lib/useIsMobile'
import { useTenantContext } from '../../lib/useTenantContext'
import type { VehicleOut, VehicleTypeOut, AlertInstanceOut, VehicleStatus, RuleOut, WorkOrderOut } from '../../lib/types'
import { SkeletonRow } from '../../shared/ui/SkeletonCard'
import { VehicleListPanel, type VehicleEntry } from './VehicleListPanel'
import { VehicleDetailPanel } from './VehicleDetailPanel'

function isEffectivelyOnline(status: VehicleStatus | undefined): boolean {
  if (!status?.online || !status.last_seen) return false
  return (Date.now() - new Date(status.last_seen).getTime()) < 5 * 60_000
}

type VehicleState = 'moving' | 'idle' | 'parked' | 'offline' | 'alert'
const STATE_ORDER: Record<VehicleState, number> = { alert: 0, moving: 1, idle: 2, parked: 3, offline: 4 }

function getVehicleState(
  vehicle: VehicleOut,
  status: VehicleStatus | undefined,
  alerts: AlertInstanceOut[]
): VehicleState {
  if (!isEffectivelyOnline(status)) return 'offline'
  if (alerts.some(a => a.vehicle_id === vehicle.id)) return 'alert'
  if ((status!.speed_kmh ?? 0) > 2) return 'moving'
  if (status!.ignition) return 'idle'
  return 'parked'
}

function stateColor(state: VehicleState): string {
  return state === 'alert' ? 'var(--danger)'
    : state === 'moving' ? 'var(--ok)'
    : state === 'idle' ? 'var(--warn)'
    : state === 'parked' ? 'var(--info)'
    : 'var(--offline)'
}

// ── Main component ──────────────────────────────────────────────────────────

export default function FleetDashboard() {
  const selectedId = useFleetStore(s => s.selectedId)
  const setSelected = useFleetStore(s => s.setSelected)
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const { activeTenantId } = useTenantContext()

  const tenantQ = activeTenantId ? `?tenant_id=${activeTenantId}` : ''

  const { data: vehicles = [], isLoading: loadingVehicles } = useQuery({
    queryKey: [...keys.vehicles(), activeTenantId],
    queryFn: () => apiClient.get<VehicleOut[]>(`/api/v1/vehicles${tenantQ}`),
    staleTime: 5 * 60_000,
  })

  const { data: vehicleTypes = [] } = useQuery({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: 10 * 60_000,
  })

  const { data: firingAlerts = [] } = useQuery({
    queryKey: [...keys.alerts(), 'firing', activeTenantId],
    queryFn: () => apiClient.get<AlertInstanceOut[]>(`/api/v1/alerts?status=firing${activeTenantId ? `&tenant_id=${activeTenantId}` : ''}`),
    refetchInterval: 30_000,
  })

  const { data: rules = [] } = useQuery({
    queryKey: keys.rules(),
    queryFn: () => apiClient.get<RuleOut[]>('/api/v1/rules'),
    staleTime: 5 * 60_000,
  })

  const { data: activeOrders = [] } = useQuery({
    queryKey: ['fleet-orders', activeTenantId],
    queryFn: () => apiClient.get<WorkOrderOut[]>(`/api/v1/work-orders?limit=200${activeTenantId ? `&tenant_id=${activeTenantId}` : ''}`),
    staleTime: 60_000,
  })

  const statuses = useVehicleStatuses(vehicles)
  const vehicleById = new Map(vehicles.map(v => [v.id, v]))

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

  const [search, setSearch] = useState('')
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)

  // Auto-colapsa el sidebar global al entrar en /fleet; lo restaura al salir
  useEffect(() => {
    const prev = localStorage.getItem('cmg_sidebar_expanded') ?? 'false'
    localStorage.setItem('cmg_sidebar_prev_state', prev)
    localStorage.setItem('cmg_sidebar_expanded', 'false')
    window.dispatchEvent(new Event('cmg_sidebar_change'))
    return () => {
      const prevState = localStorage.getItem('cmg_sidebar_prev_state') ?? 'false'
      localStorage.setItem('cmg_sidebar_expanded', prevState)
      window.dispatchEvent(new Event('cmg_sidebar_change'))
    }
  }, [])

  const filteredVehicles = sortedVehicles.filter(v =>
    search === '' ||
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    (v.license_plate ?? '').toLowerCase().includes(search.toLowerCase())
  )

  // Adapta vehículos al formato VehicleEntry para VehicleListPanel
  const vehicleEntries: VehicleEntry[] = useMemo(() =>
    sortedVehicles.map(v => {
      const s = statuses.get(v.id)
      const online = isEffectivelyOnline(s)
      const moving = online && (s?.speed_kmh ?? 0) > 2
      return {
        id: v.id,
        plate: v.license_plate ?? v.name,
        name: v.name !== v.license_plate ? v.name : undefined,
        online,
        moving,
        speed: s?.speed_kmh != null ? Math.round(s.speed_kmh) : undefined,
        speedHistory: undefined,
      }
    }),
    [sortedVehicles, statuses]
  )

  // Sincroniza selección del panel con el FleetStore (marcadores del mapa)
  const handlePanelSelect = (id: string) => {
    setSelectedVehicleId(prev => prev === id ? null : id)
    useFleetStore.getState().setSelected(id)
  }

  const handlePanelClose = () => {
    setSelectedVehicleId(null)
    useFleetStore.getState().setSelected(null)
  }

  // ── Mobile layout ──────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ width: '100%', height: '55vh', minHeight: 260, flexShrink: 0 }}>
          <FleetMap vehicles={vehicles} statuses={statuses} vehicleTypes={vehicleTypes} firingAlerts={firingAlerts} rules={rules} workOrders={activeOrders} />
        </div>

        {selectedVehicle && (
          <div style={{
            padding: '10px 14px', background: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedVehicle.name}</div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                {isEffectivelyOnline(selectedStatus) ? '● Online' : '○ Offline'}
                {selectedStatus?.ignition ? ' · Ign. ON' : ''}
              </div>
            </div>
            <button
              onClick={() => navigate(`/vehicles/${selectedVehicle.id}`)}
              style={{ background: 'var(--cmg-teal)', border: 'none', borderRadius: 6, padding: '7px 12px', color: '#000', fontWeight: 700, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>
              Ver detalle →
            </button>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 18, padding: 0 }}>×</button>
          </div>
        )}

        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
            <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: '0.07em' }}>FLOTA</span>
            <span style={{ fontSize: 11, color: 'var(--ok)' }}>● {movingCount}</span>
            <span style={{ fontSize: 11, color: 'var(--warn)' }}>◑ {idleCount}</span>
            <span style={{ fontSize: 11, color: 'var(--offline)' }}>○ {offlineCount}</span>
          </div>
          <input type="search" placeholder="Buscar vehículo o matrícula…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', color: 'var(--fg-primary)', fontSize: 13, outline: 'none' }} />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
          {loadingVehicles
            ? Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} height={44} />)
            : filteredVehicles.map(vehicle => {
              const vStatus = statuses.get(vehicle.id)
              const vState = getVehicleState(vehicle, vStatus, firingAlerts)
              const sc = stateColor(vState)
              const isSelected = vehicle.id === selectedId
              return (
                <div key={vehicle.id}
                  onClick={() => useFleetStore.getState().setSelected(vehicle.id === selectedId ? null : vehicle.id)}
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '8px', borderRadius: 6, marginBottom: 3,
                    background: isSelected ? 'var(--bg-card)' : 'transparent',
                    border: `1px solid ${isSelected ? 'var(--cmg-teal)' : 'transparent'}` }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: sc, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vehicle.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{vehicle.license_plate ?? '—'}</span>
                  <span style={{ fontSize: 11, color: sc, fontWeight: 600, flexShrink: 0 }}>
                    {vState === 'moving' ? `${vStatus?.speed_kmh?.toFixed(0) ?? 0} km/h` : vState === 'idle' ? 'Parado' : vState === 'alert' ? '⚠' : '○'}
                  </span>
                </div>
              )
            })
          }
        </div>
      </div>
    )
  }

  // ── Desktop layout — mapa protagonista ────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>

      {/* MAP — fills everything */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <FleetMap vehicles={vehicles} statuses={statuses} vehicleTypes={vehicleTypes} firingAlerts={firingAlerts} rules={rules} workOrders={activeOrders} />
      </div>

      {/* Panel izquierdo — lista de vehículos */}
      <VehicleListPanel
        vehicles={vehicleEntries}
        selectedId={selectedVehicleId}
        onSelect={handlePanelSelect}
      />

      {/* Panel derecho — detalle del vehículo seleccionado */}
      <VehicleDetailPanel
        vehicleId={selectedVehicleId}
        plate={selectedVehicleId ? vehicleById.get(selectedVehicleId)?.license_plate ?? undefined : undefined}
        vehicleName={selectedVehicleId ? vehicleById.get(selectedVehicleId)?.name : undefined}
        onClose={handlePanelClose}
      />
    </div>
  )
}
