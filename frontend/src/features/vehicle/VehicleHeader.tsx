import { useNavigate } from 'react-router-dom'
import StatusBadge from '../../shared/ui/StatusBadge'
import type { VehicleOut, VehicleStatus } from '../../lib/types'

function batteryColor(mv: number): string {
  const v = mv / 1000
  if (v < 11.5) return 'var(--accent-crit)'
  if (v < 12.0) return 'var(--accent-warn)'
  return 'var(--accent-ok)'
}

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'hace un momento'
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`
  return `hace ${Math.floor(diff / 86400)} días`
}

interface VehicleHeaderProps {
  vehicle: VehicleOut
  status: VehicleStatus | undefined
  iconUrl?: string
}

export default function VehicleHeader({ vehicle, status, iconUrl }: VehicleHeaderProps) {
  const navigate = useNavigate()
  const online = status?.online ?? false
  const ignition = status?.ignition ?? false

  return (
    <div style={{
      padding: '12px 20px',
      borderBottom: '1px solid var(--bg-border)',
      background: 'var(--bg-surface)',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
    }}>
      <button
        onClick={() => navigate('/fleet')}
        style={{
          background: 'transparent',
          color: 'var(--text-muted)',
          fontSize: 13,
          padding: '4px 10px',
          border: '1px solid var(--bg-border)',
          borderRadius: 6,
          flexShrink: 0,
          cursor: 'pointer',
        }}
      >
        ← Flota
      </button>

      {/* Icono del tipo de vehículo */}
      <div style={{
        width: 44, height: 44, borderRadius: 8, flexShrink: 0,
        background: 'var(--bg-elevated)',
        border: `2px solid ${online ? 'var(--accent-ok)' : 'var(--bg-border)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
        transition: 'border-color 0.3s',
      }}>
        {iconUrl
          ? <img src={iconUrl} alt="" style={{ width: 36, height: 36, objectFit: 'contain' }} />
          : <span style={{ fontSize: 22 }}>🚛</span>
        }
      </div>

      {/* Nombre + matrícula + señal */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{vehicle.name}</h1>
          <StatusBadge variant={online ? 'online' : 'offline'} size="md" />
          {status?.pto_active && <StatusBadge variant="pto" size="md" />}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {vehicle.license_plate && <span style={{ fontFamily: 'var(--font-data)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.05em' }}>{vehicle.license_plate}</span>}
          {status?.ext_voltage_mv != null && (
            <span style={{ color: batteryColor(status.ext_voltage_mv) }}>
              ⚡ {(status.ext_voltage_mv / 1000).toFixed(2)} V
            </span>
          )}
          {status?.last_seen && (
            <span>{online ? 'En directo' : `Última señal ${relativeTime(status.last_seen)}`}</span>
          )}
        </div>
      </div>

      {/* Ignición — indicador prominente a la derecha */}
      {status && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          padding: '6px 14px',
          background: ignition ? 'rgba(34,197,94,0.12)' : 'var(--bg-elevated)',
          border: `1px solid ${ignition ? 'var(--accent-ok)' : 'var(--bg-border)'}`,
          borderRadius: 8,
          flexShrink: 0,
          transition: 'background 0.3s, border-color 0.3s',
        }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Ignición</span>
          <span style={{
            fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-data)',
            color: ignition ? 'var(--accent-ok)' : 'var(--accent-off)',
            lineHeight: 1,
          }}>
            {online ? (ignition ? 'ON' : 'OFF') : '—'}
          </span>
        </div>
      )}
    </div>
  )
}
