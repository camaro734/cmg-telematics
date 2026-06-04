import { useNavigate } from 'react-router-dom'
import { isOnline, statusStamp } from '../../lib/staleStatus'
import StatusBadge from '../../shared/ui/StatusBadge'
import { Chip } from '../../shared/ui/Chip'
import { getVehicleIconForSlug } from '../../shared/ui/icons'
import type { VehicleOut, VehicleStatus, AlertInstanceEnrichedOut } from '../../lib/types'

function alertSeverityColor(alerts: AlertInstanceEnrichedOut[]): string | null {
  if (alerts.length === 0) return null
  if (alerts.some(a => a.severity === 'critical')) return 'var(--danger)'
  if (alerts.some(a => a.severity === 'warning')) return 'var(--warn)'
  return 'var(--info)'
}

function batteryColor(mv: number): string {
  const v = mv / 1000
  if (v < 11.5) return 'var(--danger)'
  if (v < 12.0) return 'var(--warn)'
  return 'var(--ok)'
}


interface VehicleHeaderProps {
  vehicle: VehicleOut
  status: VehicleStatus | undefined
  iconUrl?: string
  vehicleTypeSlug?: string
  activeAlerts?: AlertInstanceEnrichedOut[]
  tenantName?: string
  onOpenActivity?: () => void
  isStale?: boolean
}

export default function VehicleHeader({ vehicle, status, iconUrl, vehicleTypeSlug, activeAlerts = [], tenantName, onOpenActivity }: VehicleHeaderProps) {
  const navigate = useNavigate()
  const online = isOnline(status)
  const ignition = status?.ignition ?? false
  const VehicleTypeIcon = getVehicleIconForSlug(vehicleTypeSlug ?? '')
  const alertColor = alertSeverityColor(activeAlerts)

  return (
    <div style={{
      padding: '12px 20px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-surface)',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
    }}>
      <button
        onClick={() => navigate('/fleet')}
        style={{
          background: 'transparent',
          color: 'var(--fg-muted)',
          fontSize: 13,
          padding: '4px 10px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          flexShrink: 0,
          cursor: 'pointer',
        }}
      >
        ← Flota
      </button>

      {/* Icono del tipo de vehículo — contenedor landscape para no deformar */}
      <div style={{
        width: 72, height: 40, borderRadius: 8, flexShrink: 0,
        background: 'var(--bg-card)',
        border: `2px solid ${online ? 'var(--ok)' : 'var(--border)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', padding: 4,
        transition: 'border-color 0.3s',
      }}>
        {iconUrl
          ? <img src={iconUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          : <VehicleTypeIcon width={60} height={30} style={{ color: online ? 'var(--ok)' : 'var(--offline)', opacity: online ? 1 : 0.5 }} />
        }
      </div>

      {/* Nombre + matrícula + señal */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{vehicle.name}</h1>
          <StatusBadge variant={online ? 'online' : 'offline'} size="md" />
          {alertColor && (
            <Chip color={alertColor} soft dot size="sm">
              {activeAlerts.length} alerta{activeAlerts.length !== 1 ? 's' : ''}
            </Chip>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {tenantName && <span style={{ color: 'var(--fg-secondary)', fontWeight: 500 }}>{tenantName}</span>}
          {vehicle.license_plate && <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--fg-primary)', letterSpacing: '0.05em' }}>{vehicle.license_plate}</span>}
          {status?.ext_voltage_mv != null && (
            <span style={{ color: batteryColor(status.ext_voltage_mv) }}>
              ⚡ {(status.ext_voltage_mv / 1000).toFixed(2)} V
            </span>
          )}
          {status && (
            online
              ? status.last_seen && <span>En directo</span>
              : <span style={{ color: statusStamp(status).color }}>{statusStamp(status).text}</span>
          )}
        </div>
      </div>

      {/* Botón Actividad */}
      {onOpenActivity && (
        <button
          onClick={onOpenActivity}
          style={{
            background: 'var(--bg-card)', color: 'var(--fg-muted)',
            border: '1px solid var(--border)', borderRadius: 6,
            padding: '5px 12px', fontSize: 12, cursor: 'pointer',
            flexShrink: 0, fontWeight: 500,
          }}
        >
          Actividad
        </button>
      )}

      {/* Ignición — indicador prominente a la derecha */}
      {status && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          padding: '6px 14px',
          background: ignition ? 'rgba(34,197,94,0.12)' : 'var(--bg-card)',
          border: `1px solid ${ignition ? 'var(--ok)' : 'var(--border)'}`,
          borderRadius: 8,
          flexShrink: 0,
          transition: 'background 0.3s, border-color 0.3s',
        }}>
          <span style={{ fontSize: 9, color: 'var(--fg-muted)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Ignición</span>
          <span style={{
            fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-mono)',
            color: ignition ? 'var(--ok)' : 'var(--offline)',
            lineHeight: 1,
          }}>
            {online ? (ignition ? 'ON' : 'OFF') : '—'}
          </span>
        </div>
      )}
    </div>
  )
}
