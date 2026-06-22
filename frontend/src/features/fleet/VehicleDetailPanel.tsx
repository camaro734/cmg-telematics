import { useNavigate } from 'react-router-dom'
import { isEffectivelyOnline, statusStamp } from '../../lib/staleStatus'
import { useVehicleLive } from '../../lib/useVehicleLive'
import type { VehicleTypeOut, SensorDef } from '../../lib/types'
import { sensorDisplayValue } from './popupHtml'

interface VehicleDetailPanelProps {
  vehicleId: string | null
  plate?: string
  vehicleName?: string
  vehicleType?: VehicleTypeOut
  onClose: () => void
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

export function VehicleDetailPanel({ vehicleId, plate, vehicleName, vehicleType, onClose }: VehicleDetailPanelProps) {
  const navigate = useNavigate()

  const { data: status } = useVehicleLive(vehicleId)

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
            {panelSensors.length > 0 ? (
              panelSensors.map(s => (
                <KpiRow
                  key={s.key}
                  label={s.label}
                  value={<span style={{ color: stale ? 'var(--fg-muted)' : undefined }}>
                    {status ? sensorDisplayValue(s, status) : '—'}
                  </span>}
                />
              ))
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
