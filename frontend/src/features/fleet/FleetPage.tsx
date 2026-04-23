import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import Shell from '../../shared/ui/Shell'
import FleetMap from './FleetMap'
import VehicleCard from './VehicleCard'
import { useFleetStore } from './useFleetStore'
import { useVehicleStatuses } from './useVehicleStatuses'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleOut, VehicleTypeOut, AlertInstanceOut, TenantOut } from '../../lib/types'

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

export default function FleetPage() {
  const selectedId = useFleetStore(s => s.selectedId)
  const setSelected = useFleetStore(s => s.setSelected)

  const { data: vehicles = [] } = useQuery({
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

  const onlineCount = vehicles.filter(v => statuses.get(v.id)?.online).length
  const offlineCount = vehicles.length - onlineCount

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

  return (
    <Shell title="Flota">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

        {/* ── Top section ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', height: '55vh', minHeight: 0 }}>

          {/* Left: vehicle grid */}
          <div style={{
            width: '55%',
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid var(--bg-border)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--bg-border)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexShrink: 0,
            }}>
              <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 14, color: 'var(--text-default)' }}>
                FLOTA
              </span>
              <span style={{ fontSize: 12, color: 'var(--accent-ok)' }}>
                ● Activos: {onlineCount}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                ○ No activos: {offlineCount}
              </span>
            </div>

            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: 12,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 10,
              alignContent: 'start',
            }}>
              {vehicles.map(vehicle => (
                <VehicleCard
                  key={vehicle.id}
                  vehicle={vehicle}
                  vehicleType={typeById.get(vehicle.vehicle_type_id)}
                  status={statuses.get(vehicle.id)}
                  isSelected={vehicle.id === selectedId}
                />
              ))}
              {vehicles.length === 0 && (
                <div style={{ gridColumn: '1 / -1', color: 'var(--text-muted)', fontSize: 13, paddingTop: 20 }}>
                  Sin vehículos registrados
                </div>
              )}
            </div>
          </div>

          {/* Right: map */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <FleetMap vehicles={vehicles} statuses={statuses} />
          </div>
        </div>

        {/* ── Bottom section ───────────────────────────────────────── */}
        <div style={{
          flex: 1,
          display: 'flex',
          minHeight: 0,
          borderTop: '1px solid var(--bg-border)',
          overflow: 'hidden',
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
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-default)' }}>Servicios del día</span>
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
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              textAlign: 'center',
            }}>
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
            <div style={{
              padding: '8px 14px',
              borderBottom: '1px solid var(--bg-border)',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-default)' }}>Incidencias activas</span>
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
                      <Link
                        to="/alerts"
                        style={{ fontSize: 11, color: 'var(--accent-info)', flexShrink: 0 }}
                      >
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
              <div style={{
                width: '100%',
                height: '100%',
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
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-default)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedTenant?.name ?? '—'}
                  </span>
                  <button
                    onClick={() => setSelected(null)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      fontSize: 16,
                      lineHeight: 1,
                      padding: '0 2px',
                    }}
                    title="Cerrar panel"
                  >
                    ×
                  </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Conductor</div>
                      <div style={{ fontSize: 12, color: 'var(--text-default)' }}>—</div>
                    </div>
                    <Link
                      to={`/vehicles/${selectedVehicle.id}`}
                      style={{ fontSize: 12, color: 'var(--accent-info)', alignSelf: 'flex-end' }}
                    >
                      Detalle →
                    </Link>
                  </div>

                  <div style={{
                    background: 'var(--bg-elevated)',
                    borderRadius: 6,
                    padding: '10px 12px',
                    marginBottom: 12,
                  }}>
                    <Row label="Tipo" value={selectedType?.name ?? '—'} />
                    <Row label="Matrícula" value={selectedVehicle.license_plate ?? '—'} />
                    <Row label="VIN" value={selectedVehicle.vin ?? '—'} />
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Estados CAN
                    </div>
                    <CanBadge label="Ignición" active={selectedStatus?.ignition ?? false} />
                    <CanBadge label="PTO" active={selectedStatus?.pto_active ?? false} />
                    {canLedStates.map(s => (
                      <CanBadge key={s.label} label={s.label} active={s.active} />
                    ))}
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
    </Shell>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--text-default)', fontFamily: 'var(--font-data)', textAlign: 'right', maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
        <div style={{ width: 44, height: 18, border: `2px solid var(--bg-border)`, borderRadius: 3, background: 'var(--bg-base)', overflow: 'hidden' }}>
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
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    }}>
      <span style={{ fontSize: 12, color: 'var(--text-default)' }}>{label}</span>
      <span style={{
        fontSize: 10,
        padding: '2px 8px',
        borderRadius: 10,
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
