import { useNavigate } from 'react-router-dom'
import StatusBadge from '../../shared/ui/StatusBadge'
import type { VehicleOut, VehicleStatus } from '../../lib/types'

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
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-data)' }}>
          {vehicle.license_plate ?? '—'}
          {status?.last_seen && (
            <span style={{ marginLeft: 12 }}>
              Última señal: {relativeTime(status.last_seen)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
