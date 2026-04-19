import type { VehicleStatus } from '../../lib/types'

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      borderRadius: 8,
      padding: '12px 16px',
      border: '1px solid var(--bg-border)',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function Value({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{
      fontSize: 22,
      fontFamily: 'var(--font-data)',
      fontWeight: 500,
      color: color ?? 'var(--text-primary)',
    }}>
      {children}
    </div>
  )
}

interface StatusPanelProps {
  status: VehicleStatus | undefined
}

export default function StatusPanel({ status }: StatusPanelProps) {
  if (!status) {
    return (
      <div style={{ padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>
        Sin datos de estado disponibles
      </div>
    )
  }

  return (
    <div>
      {/* Status cards grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 12,
        marginBottom: 24,
      }}>
        <Card label="VELOCIDAD">
          <Value color="var(--accent-info)">
            {status.speed_kmh != null ? `${Math.round(status.speed_kmh)} km/h` : '—'}
          </Value>
        </Card>

        <Card label="IGNICIÓN">
          <Value color={status.ignition ? 'var(--accent-ok)' : 'var(--accent-off)'}>
            {status.ignition == null ? '—' : status.ignition ? 'ON' : 'OFF'}
          </Value>
        </Card>

        <Card label="PTO">
          <Value color={status.pto_active ? 'var(--accent-energy)' : 'var(--accent-off)'}>
            {status.pto_active == null ? '—' : status.pto_active ? 'ACTIVO' : 'INACTIVO'}
          </Value>
        </Card>
      </div>

      {/* CAN data */}
      {status.can_data && Object.keys(status.can_data).length > 0 && (
        <div>
          <div style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            fontWeight: 600,
            letterSpacing: '0.06em',
            marginBottom: 10,
          }}>
            DATOS CAN BUS
          </div>
          <div style={{
            background: 'var(--bg-elevated)',
            borderRadius: 8,
            border: '1px solid var(--bg-border)',
            overflow: 'hidden',
          }}>
            {Object.entries(status.can_data).map(([key, val], i) => (
              <div key={key} style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 16px',
                borderBottom: i < Object.keys(status.can_data!).length - 1
                  ? '1px solid var(--bg-border)' : 'none',
              }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>
                  {key}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-data)' }}>
                  {String(val)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(!status.can_data || Object.keys(status.can_data).length === 0) && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Sin datos CAN disponibles
        </div>
      )}
    </div>
  )
}
