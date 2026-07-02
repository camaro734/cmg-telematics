import { useNavigate } from 'react-router-dom'
import { isEffectivelyOnline, statusStamp } from '../../lib/staleStatus'
import { useVehicleLive } from '../../lib/useVehicleLive'
import type { VehicleTypeOut, SensorDef, GeoResult, DestinationOut, RouteInfo } from '../../lib/types'
import { sensorDisplayValue } from './popupHtml'
import { useSetDestination, useCancelDestination, useReverseGeocode } from './useDestination'
import { useWorkOrdersByVehicle, useCurrentStop } from './useVehicleWorkOrders'
import { resolveRawValue, applyTransform } from '../../lib/sensorValue'
import { LiveSensorWidget, hasVisualWidget } from '../vehicle/diagnostic/LiveSensorWidget'

interface VehicleDetailPanelProps {
  vehicleId: string | null
  plate?: string
  vehicleName?: string
  vehicleType?: VehicleTypeOut
  // Props de destino — inyectadas desde FleetDashboard
  pendingDest?: GeoResult | null
  previewRoute?: RouteInfo | null
  activeDest?: DestinationOut | null
  onDestSent?: () => void
  onDestCancelled?: () => void
  onClose: () => void
}

/** Formatea segundos como "X min" o "Xh Ymin" */
function fmtEta(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)}h ${m % 60} min`
}

function KpiRow({ label, value, unit }: { label: string; value: React.ReactNode; unit?: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 0', borderBottom: '1px solid var(--border-soft)',
    }}>
      <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)' }}>
        {value}{unit && <span style={{ fontSize: 11, color: 'var(--fg-muted)', marginLeft: 3 }}>{unit}</span>}
      </span>
    </div>
  )
}

export function VehicleDetailPanel({ vehicleId, plate, vehicleName, vehicleType, pendingDest, previewRoute, activeDest, onDestSent, onDestCancelled, onClose }: VehicleDetailPanelProps) {
  const navigate = useNavigate()

  const { data: status } = useVehicleLive(vehicleId)

  // Dirección textual en vivo (calle) por geocode inverso de la posición actual.
  // El hook redondea lat/lon y cachea → no llama a Nominatim en cada tick.
  const { data: geo } = useReverseGeocode(status?.lat, status?.lon)
  const address = geo?.address ?? null

  // Órdenes de trabajo vigentes (pendientes/en curso) del vehículo. La parada
  // actual solo se pide para la OT en curso, no para todas.
  const { data: orders } = useWorkOrdersByVehicle(vehicleId)
  const activeOrders = orders ?? []
  const inProgressOrder = activeOrders.find(o => o.status === 'in_progress') ?? null
  const { data: currentStop } = useCurrentStop(inProgressOrder?.id ?? null)

  // Hooks de mutación para enviar/cancelar destino
  const setDest = useSetDestination(vehicleId ?? '')
  const cancelDest = useCancelDestination(vehicleId ?? '')

  // Sensores marcados para el panel de flota; si no hay ninguno, fallback a los 4 fijos.
  const panelSensors: SensorDef[] = (vehicleType?.sensor_schema ?? [])
    .filter(s => s.show_in_fleet_panel === true)

  const online = status ? isEffectivelyOnline(status) : false
  const stale = !online

  const moving = online && (status?.speed_kmh ?? 0) > 2

  const statusColor = !online ? 'var(--offline)'
    : moving ? 'var(--cmg-teal)'
    : 'var(--ok)'

  const statusLabel = !online ? 'Offline'
    : moving ? 'En movimiento'
    : 'En línea'

  const lastSeenText = status?.last_seen
    ? (() => {
        const diff = Date.now() - new Date(status.last_seen).getTime()
        const mins = Math.floor(diff / 60000)
        if (mins < 1) return 'ahora'
        if (mins < 60) return `hace ${mins} min`
        return `hace ${Math.floor(mins / 60)}h`
      })()
    : null

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0,
      width: 320, zIndex: 400,
      background: 'var(--bg-surface)',
      borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      transform: vehicleId ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 250ms cubic-bezier(0.32, 0.72, 0, 1)',
    }}>
      {vehicleId && (
        <>
          {/* Header */}
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border-soft)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)' }}>
                  {plate ?? '—'}
                </p>
                {vehicleName && (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-muted)' }}>{vehicleName}</p>
                )}
              </div>
              <button onClick={onClose}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg-dim)', fontSize: 18, padding: 2, lineHeight: 1 }}>
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
              <span style={{ fontSize: 12, color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
              {lastSeenText && (
                <span style={{ fontSize: 11, color: 'var(--fg-dim)' }}>· señal {lastSeenText}</span>
              )}
            </div>
          </div>

          {/* KPIs */}
          <div style={{ padding: '12px 16px', flex: 1, overflowY: 'auto' }}>
            {stale && status?.last_seen && (
              <div style={{ fontSize: 11, color: statusStamp(status).color, marginBottom: 10, padding: '5px 0 8px', borderBottom: '1px solid var(--border-soft)' }}>
                {statusStamp(status).text}
              </div>
            )}
            {/* Ubicación: dirección textual (calle) o, si no resuelve, lat/lon */}
            {status?.lat != null && status?.lon != null && (
              <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border-soft)' }}>
                <div style={{ fontSize: 10, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>
                  Ubicación
                </div>
                <div style={{ fontSize: 12, color: stale ? 'var(--fg-muted)' : 'var(--fg-primary)', lineHeight: 1.35 }}>
                  {address ?? `${status.lat.toFixed(5)}, ${status.lon.toFixed(5)}`}
                </div>
              </div>
            )}
            {panelSensors.length > 0 ? (
              panelSensors.map(s => {
                // Sensor con widget visual → mismo componente que la ficha (label + widget).
                if (hasVisualWidget(s)) {
                  const scaled = status ? applyTransform(resolveRawValue(s, status, {}), s) : null
                  return (
                    <div key={s.key} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
                      <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 4 }}>{s.label}</div>
                      <LiveSensorWidget sensor={s} value={scaled} isStale={stale} />
                    </div>
                  )
                }
                return (
                  <KpiRow
                    key={s.key}
                    label={s.label}
                    value={<span style={{ color: stale ? 'var(--fg-muted)' : undefined }}>
                      {status ? sensorDisplayValue(s, status) : '—'}
                    </span>}
                  />
                )
              })
            ) : (
              <>
                <KpiRow label="Ignición" value={
                  <span style={{ color: stale ? 'var(--fg-muted)' : (status?.ignition ? 'var(--ok)' : 'var(--offline)') }}>
                    {status?.ignition ? 'ON' : 'OFF'}
                  </span>
                } />
                {status?.speed_kmh != null && (
                  <KpiRow label="Velocidad" value={status.speed_kmh.toFixed(0)} unit="km/h" />
                )}
                {status?.ext_voltage_mv != null && (
                  <KpiRow label="Tensión batería" value={(status.ext_voltage_mv / 1000).toFixed(1)} unit="V" />
                )}
                {status?.pto_active != null && (
                  <KpiRow label="PTO" value={
                    <span style={{ color: stale ? 'var(--fg-muted)' : (status.pto_active ? 'var(--cmg-teal)' : 'var(--fg-dim)') }}>
                      {status.pto_active ? 'Activo' : 'Inactivo'}
                    </span>
                  } />
                )}
              </>
            )}

            {/* Órdenes de trabajo vigentes (pendientes/en curso) del vehículo */}
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
              <div style={{ fontSize: 10, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Órdenes de trabajo
              </div>
              {activeOrders.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--fg-dim)' }}>Sin órdenes activas</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {activeOrders.map(o => {
                    const isCurrent = o.status === 'in_progress'
                    // Destino = parada actual de la OT en curso; si no hay paradas,
                    // cae a la dirección general de la orden.
                    const destText = isCurrent
                      ? (currentStop?.address ?? currentStop?.title ?? o.location_address)
                      : null
                    return (
                      <button
                        key={o.id}
                        onClick={() => navigate('/work-orders')}
                        style={{
                          textAlign: 'left', cursor: 'pointer', width: '100%',
                          padding: '9px 10px', borderRadius: 8,
                          background: isCurrent ? 'var(--cmg-teal-soft)' : 'var(--bg-elevated)',
                          border: `1px solid ${isCurrent ? 'var(--cmg-teal-line)' : 'var(--border)'}`,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <span style={{
                            fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
                            padding: '1px 6px', borderRadius: 4,
                            color: isCurrent ? 'var(--cmg-teal)' : 'var(--fg-muted)',
                            background: isCurrent ? 'var(--cmg-teal-line)' : 'var(--border)',
                          }}>
                            {isCurrent ? 'En curso' : 'Pendiente'}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {o.title}
                          </span>
                        </div>
                        {o.final_client_name && (
                          <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{o.final_client_name}</div>
                        )}
                        {o.location_address && (
                          <div style={{ fontSize: 11, color: 'var(--fg-dim)', lineHeight: 1.3 }}>{o.location_address}</div>
                        )}
                        {isCurrent && destText && (
                          <div style={{ fontSize: 11, color: 'var(--cmg-teal)', marginTop: 3, fontWeight: 600 }}>
                            → Destino: {destText}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Sección de destino y ETA */}
          <div style={{ padding: '0 16px 12px', flexShrink: 0 }}>
            {/* Botón "Enviar destino" cuando hay un candidato seleccionado y ningún destino activo */}
            {pendingDest && !activeDest && (
              <>
                <button
                  onClick={() => {
                    setDest.mutate(
                      { lat: pendingDest.lat, lon: pendingDest.lon, label: pendingDest.label },
                      { onSuccess: () => onDestSent?.() },
                    )
                  }}
                  disabled={setDest.isPending}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8,
                    background: 'var(--cmg-teal)', color: '#fff',
                    border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  {setDest.isPending ? 'Enviando…' : `Enviar destino: ${pendingDest.label}`}
                </button>
                {setDest.isError && (
                  <span style={{ color: 'var(--accent-crit)', fontSize: 12 }}>Error al enviar destino</span>
                )}
                {/* ETA previsualizado vehículo→candidato (antes de confirmar el destino) */}
                {previewRoute && (
                  <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 6, textAlign: 'center' }}>
                    {(previewRoute.distance_m / 1000).toFixed(1)} km · {fmtEta(previewRoute.duration_s)}
                  </div>
                )}
              </>
            )}

            {/* ETA en tiempo real cuando hay destino activo */}
            {activeDest?.remaining_distance_m != null && (
              <div style={{
                padding: 12, background: 'var(--bg-elevated)', borderRadius: 8,
                border: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 4 }}>
                  Hacia {activeDest.label}
                </div>
                <div style={{ fontSize: 20, fontFamily: 'var(--font-data)', color: 'var(--fg-primary)', fontWeight: 700 }}>
                  {(activeDest.remaining_distance_m / 1000).toFixed(1)} km
                  {activeDest.remaining_duration_s != null && (
                    <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--fg-muted)', marginLeft: 8 }}>
                      · {fmtEta(activeDest.remaining_duration_s)}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => cancelDest.mutate(undefined, { onSuccess: () => onDestCancelled?.() })}
                  disabled={cancelDest.isPending}
                  style={{
                    marginTop: 8, background: 'none',
                    border: '1px solid var(--border)', color: 'var(--accent-crit)',
                    borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
                    fontSize: 12, fontFamily: 'var(--font-sans)',
                  }}
                >
                  {cancelDest.isPending ? 'Cancelando…' : 'Cancelar destino'}
                </button>
                {cancelDest.isError && (
                  <span style={{ color: 'var(--accent-crit)', fontSize: 12 }}>Error al cancelar destino</span>
                )}
              </div>
            )}

            {/* Confirmación de llegada */}
            {activeDest?.status === 'arrived' && (
              <div style={{ fontSize: 13, color: 'var(--accent-ok)', padding: '8px 0', fontWeight: 600 }}>
                ✓ Vehículo llegado al destino
              </div>
            )}
          </div>

          {/* CTA */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-soft)', flexShrink: 0 }}>
            <button
              onClick={() => navigate(`/vehicles/${vehicleId}`)}
              style={{
                width: '100%', padding: '9px 14px',
                background: 'var(--cmg-teal-soft)', color: 'var(--cmg-teal)',
                border: '1px solid var(--cmg-teal-line)', borderRadius: 8,
                fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              Ver detalle completo →
            </button>
          </div>
        </>
      )}
    </div>
  )
}
