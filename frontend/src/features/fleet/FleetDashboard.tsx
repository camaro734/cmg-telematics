import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import FleetMap from './FleetMap'
import { useFleetStore } from './useFleetStore'
import { useVehicleStatuses } from './useVehicleStatuses'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useIsMobile } from '../../lib/useIsMobile'
import { useTenantContext } from '../../lib/useTenantContext'
import type { VehicleOut, VehicleTypeOut, AlertInstanceOut, TenantOut, VehicleStatus } from '../../lib/types'
import { SkeletonRow } from '../../shared/ui/SkeletonCard'
import { getVehicleIconForSlug } from '../../shared/ui/icons'

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

type VehicleState = 'moving' | 'idle' | 'offline' | 'alert'
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

function stateColor(state: VehicleState): string {
  return state === 'alert' ? 'var(--accent-crit)'
    : state === 'moving' ? 'var(--accent-ok)'
    : state === 'idle' ? 'var(--accent-warn)'
    : 'var(--accent-off)'
}

const SIDEBAR_W = 290

// ── Selected vehicle floating card ──────────────────────────────────────────

interface SelectedCardProps {
  vehicle: VehicleOut
  status: VehicleStatus | undefined
  vehicleType: VehicleTypeOut | undefined
  tenant: TenantOut | undefined
  alertCount: number
  onClose: () => void
  onDetail: () => void
}

function SelectedCard({ vehicle, status, vehicleType, tenant, alertCount, onClose, onDetail }: SelectedCardProps) {
  const online = isEffectivelyOnline(status)
  const ignition = status?.ignition ?? false
  const speed = status?.speed_kmh ?? 0
  const VehicleTypeIcon = getVehicleIconForSlug(vehicleType?.slug ?? '')

  return (
    <div style={{
      position: 'absolute', bottom: 24, right: 20,
      width: 268,
      background: 'rgba(41,37,36,0.97)',
      border: `1px solid ${online ? 'var(--accent-ok)' : 'var(--bg-border)'}`,
      borderRadius: 10,
      boxShadow: '0 6px 32px rgba(0,0,0,0.55)',
      zIndex: 1000,
      overflow: 'hidden',
      backdropFilter: 'blur(6px)',
    }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--bg-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 68, height: 36, borderRadius: 5, background: 'var(--bg-elevated)', border: `1px solid ${online ? 'var(--accent-ok)' : 'var(--bg-border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', padding: 3 }}>
          {vehicleType?.icon_url
            ? <img src={vehicleType.icon_url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            : <VehicleTypeIcon width={58} height={28} style={{ color: online ? 'var(--accent-ok)' : 'var(--accent-off)', opacity: online ? 1 : 0.5 }} />
          }
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vehicle.name}</div>
          {vehicle.license_plate && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-data)', letterSpacing: '0.05em' }}>{vehicle.license_plate}</div>
          )}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>×</button>
      </div>

      {/* Status badges */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--bg-border)' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
            background: online ? 'rgba(34,197,94,0.15)' : 'var(--bg-elevated)',
            color: online ? 'var(--accent-ok)' : 'var(--accent-off)',
            border: `1px solid ${online ? 'var(--accent-ok)' : 'var(--bg-border)'}`,
          }}>
            {online ? '● Online' : '○ Offline'}
          </span>
          {online && (
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
              background: ignition ? 'rgba(34,197,94,0.12)' : 'var(--bg-elevated)',
              color: ignition ? 'var(--accent-ok)' : 'var(--accent-off)',
              border: `1px solid ${ignition ? 'var(--accent-ok)' : 'var(--bg-border)'}`,
            }}>
              Ign. {ignition ? 'ON' : 'OFF'}
            </span>
          )}
          {alertCount > 0 && (
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
              background: 'rgba(239,68,68,0.15)', color: 'var(--accent-crit)',
              border: '1px solid var(--accent-crit)',
            }}>
              ⚠ {alertCount} alerta{alertCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          {online && speed > 2 && (
            <span><span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-data)', fontWeight: 600 }}>{speed.toFixed(0)}</span> km/h</span>
          )}
          {status?.ext_voltage_mv != null && (
            <span><span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-data)', fontWeight: 600 }}>{(status.ext_voltage_mv / 1000).toFixed(1)}</span> V</span>
          )}
          {tenant && <span style={{ color: 'var(--text-muted)' }}>{tenant.name}</span>}
        </div>

        {status?.last_seen && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
            {online ? '● Señal en directo' : relativeTime(status.last_seen)}
          </div>
        )}
      </div>

      {/* CTA */}
      <div style={{ padding: '10px 14px' }}>
        <button
          onClick={onDetail}
          style={{
            width: '100%',
            background: 'var(--accent-energy)', border: 'none', borderRadius: 6,
            padding: '9px 12px', color: '#000', fontWeight: 700, fontSize: 13,
            cursor: 'pointer', fontFamily: 'var(--font-ui)',
            transition: 'opacity 0.15s',
          }}>
          Ver detalle →
        </button>
      </div>
    </div>
  )
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

  const { data: tenants = [] } = useQuery({
    queryKey: keys.tenants(),
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants'),
    staleTime: 10 * 60_000,
  })

  const { data: firingAlerts = [] } = useQuery({
    queryKey: [...keys.alerts(), 'firing', activeTenantId],
    queryFn: () => apiClient.get<AlertInstanceOut[]>(`/api/v1/alerts?status=firing${activeTenantId ? `&tenant_id=${activeTenantId}` : ''}`),
    refetchInterval: 30_000,
  })


  const statuses = useVehicleStatuses(vehicles)
  const typeById = new Map(vehicleTypes.map(t => [t.id, t]))
  const vehicleById = new Map(vehicles.map(v => [v.id, v]))
  const tenantById = new Map(tenants.map(t => [t.id, t]))

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
  const selectedAlertCount = selectedId ? firingAlerts.filter(a => a.vehicle_id === selectedId).length : 0

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [search, setSearch] = useState('')

  const filteredVehicles = sortedVehicles.filter(v =>
    search === '' ||
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    (v.license_plate ?? '').toLowerCase().includes(search.toLowerCase())
  )

  // ── Mobile layout ──────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ width: '100%', height: '55vh', minHeight: 260, flexShrink: 0 }}>
          <FleetMap vehicles={vehicles} statuses={statuses} vehicleTypes={vehicleTypes} firingAlerts={firingAlerts} />
        </div>

        {selectedVehicle && (
          <div style={{
            padding: '10px 14px', background: 'var(--bg-surface)',
            borderBottom: '1px solid var(--bg-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedVehicle.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {isEffectivelyOnline(selectedStatus) ? '● Online' : '○ Offline'}
                {selectedStatus?.ignition ? ' · Ign. ON' : ''}
              </div>
            </div>
            <button
              onClick={() => navigate(`/vehicles/${selectedVehicle.id}`)}
              style={{ background: 'var(--accent-energy)', border: 'none', borderRadius: 6, padding: '7px 12px', color: '#000', fontWeight: 700, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>
              Ver detalle →
            </button>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, padding: 0 }}>×</button>
          </div>
        )}

        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--bg-border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
            <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: '0.07em' }}>FLOTA</span>
            <span style={{ fontSize: 11, color: 'var(--accent-ok)' }}>● {movingCount}</span>
            <span style={{ fontSize: 11, color: 'var(--accent-warn)' }}>◑ {idleCount}</span>
            <span style={{ fontSize: 11, color: 'var(--accent-off)' }}>○ {offlineCount}</span>
          </div>
          <input type="search" placeholder="Buscar vehículo o matrícula…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', borderRadius: 6, padding: '7px 10px', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }} />
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
                    background: isSelected ? 'var(--bg-elevated)' : 'transparent',
                    border: `1px solid ${isSelected ? 'var(--accent-energy)' : 'transparent'}` }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: sc, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vehicle.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-data)', flexShrink: 0 }}>{vehicle.license_plate ?? '—'}</span>
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
        <FleetMap vehicles={vehicles} statuses={statuses} vehicleTypes={vehicleTypes} firingAlerts={firingAlerts} />
      </div>

      {/* SIDEBAR — collapsible left panel */}
      <div style={{
        position: 'absolute', top: 0, left: 0, bottom: 0,
        width: sidebarOpen ? SIDEBAR_W : 0,
        overflow: 'hidden',
        transition: 'width 0.25s ease',
        zIndex: 1000,
      }}>
        <div style={{
          width: SIDEBAR_W, height: '100%',
          display: 'flex', flexDirection: 'column',
          background: 'rgba(28,25,23,0.96)',
          backdropFilter: 'blur(10px)',
          borderRight: '1px solid var(--bg-border)',
        }}>
          {/* Header — stats */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--bg-border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>FLOTA</span>
              <span style={{ fontSize: 11, color: 'var(--accent-ok)' }}>● {movingCount}</span>
              <span style={{ fontSize: 11, color: 'var(--accent-warn)' }}>◑ {idleCount}</span>
              <span style={{ fontSize: 11, color: 'var(--accent-off)' }}>○ {offlineCount}</span>
            </div>
            <input type="search" placeholder="Buscar vehículo o matrícula…" value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', borderRadius: 5, padding: '6px 9px', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }} />
          </div>

          {/* Vehicle list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
            {loadingVehicles
              ? Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} height={40} />)
              : filteredVehicles.length === 0
                ? <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '16px 4px' }}>
                    {search ? `Sin resultados para «${search}»` : 'Sin vehículos registrados'}
                  </div>
                : filteredVehicles.map(vehicle => {
                  const vStatus = statuses.get(vehicle.id)
                  const vState = getVehicleState(vehicle, vStatus, firingAlerts)
                  const sc = stateColor(vState)
                  const isSelected = vehicle.id === selectedId
                  return (
                    <div key={vehicle.id}
                      onClick={() => useFleetStore.getState().setSelected(vehicle.id === selectedId ? null : vehicle.id)}
                      style={{
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                        padding: '7px 8px', borderRadius: 5, marginBottom: 2,
                        background: isSelected ? 'var(--bg-elevated)' : 'transparent',
                        border: `1px solid ${isSelected ? 'var(--accent-energy)' : 'transparent'}`,
                      }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {vehicle.name}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-data)', flexShrink: 0 }}>
                        {vehicle.license_plate ?? '—'}
                      </span>
                      <span style={{ fontSize: 10, color: sc, fontWeight: 600, flexShrink: 0, minWidth: 48, textAlign: 'right' }}>
                        {vState === 'moving' ? `${vStatus?.speed_kmh?.toFixed(0) ?? 0} km/h`
                          : vState === 'idle' ? 'Parado'
                          : vState === 'alert' ? '⚠ Alerta'
                          : '—'}
                      </span>
                    </div>
                  )
                })
            }
          </div>

          {/* Alerts footer */}
          {firingAlerts.length > 0 && (
            <div style={{ borderTop: '1px solid var(--bg-border)', padding: '8px 14px', flexShrink: 0 }}>
              <button
                onClick={() => navigate('/alerts')}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--accent-warn)', fontSize: 11, cursor: 'pointer', fontWeight: 600, padding: 0, width: '100%' }}>
                ⚠ {firingAlerts.length} incidencia{firingAlerts.length !== 1 ? 's' : ''} activa{firingAlerts.length !== 1 ? 's' : ''} →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* TOGGLE BUTTON */}
      <button
        onClick={() => setSidebarOpen(o => !o)}
        style={{
          position: 'absolute',
          top: 12,
          left: sidebarOpen ? SIDEBAR_W + 8 : 8,
          transition: 'left 0.25s ease',
          zIndex: 1001,
          background: 'rgba(28,25,23,0.92)',
          border: '1px solid var(--bg-border)',
          borderRadius: 6,
          padding: '7px 9px',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: 12,
          backdropFilter: 'blur(4px)',
          lineHeight: 1,
        }}>
        {sidebarOpen ? '◀' : '▶ Flota'}
      </button>

      {/* SELECTED VEHICLE — floating card (z-index above Leaflet controls) */}
      {selectedVehicle && (
        <SelectedCard
          vehicle={selectedVehicle}
          status={selectedStatus}
          vehicleType={selectedType}
          tenant={selectedTenant}
          alertCount={selectedAlertCount}
          onClose={() => setSelected(null)}
          onDetail={() => navigate(`/vehicles/${selectedVehicle.id}`)}
        />
      )}
    </div>
  )
}
