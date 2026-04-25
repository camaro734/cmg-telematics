import { useNavigate } from 'react-router-dom'
import StatusBadge from '../../shared/ui/StatusBadge'
import type { VehicleOut, VehicleStatus } from '../../lib/types'

function batteryColor(mv: number): string {
  const v = mv / 1000
  if (v < 11.5 || (v > 15 && v < 22)) return 'var(--accent-crit)'
  if (v < 12.0 || (v > 14.8 && v < 22)) return 'var(--accent-warn)'
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
}

export default function VehicleHeader({ vehicle, status }: VehicleHeaderProps) {
  const navigate = useNavigate()
  const online = status?.online ?? false

  return (
    <div style={{
      padding: '16px 24px',
      borderBottom: '1px solid var(--bg-border)',
      background: 'var(--bg-surface)',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
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

      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>{vehicle.name}</h1>
          <StatusBadge variant={online ? 'online' : 'offline'} size="md" />
          {status?.pto_active && <StatusBadge variant="pto" size="md" />}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-data)', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span>{vehicle.license_plate ?? '—'}</span>
          {status?.ext_voltage_mv != null && (
            <span style={{ color: batteryColor(status.ext_voltage_mv) }}>
              ⚡ {(status.ext_voltage_mv / 1000).toFixed(2)} V
            </span>
          )}
          {status?.last_seen && (
            <span>Última señal: {relativeTime(status.last_seen)}</span>
          )}
        </div>
      </div>
    </div>
  )
}
