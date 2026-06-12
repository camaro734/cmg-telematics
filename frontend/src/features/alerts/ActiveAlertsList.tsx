import type { CSSProperties } from 'react'
import { useState } from 'react'
import type { AlertInstanceOut, VehicleOut, RuleOut } from '../../lib/types'
import AckModal from './AckModal'
import { getAlertDisplay } from './alertUtils'

function timeAgo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'ahora mismo'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h}h`
  return `hace ${Math.floor(h / 24)}d`
}

const CARD: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 8, padding: '12px 16px',
}

interface ActiveAlertsListProps {
  alerts: AlertInstanceOut[]
  vehicles: VehicleOut[]
  rules: RuleOut[]
}

export default function ActiveAlertsList({ alerts, vehicles, rules }: ActiveAlertsListProps) {
  const [ackAlert, setAckAlert] = useState<AlertInstanceOut | null>(null)

  const vehicleMap = Object.fromEntries(vehicles.map(v => [v.id, v.name]))

  if (alerts.length === 0) {
    return (
      <div style={{ padding: '20px 0', color: 'var(--ok)', fontFamily: 'var(--font-sans)', fontSize: 13 }}>
        Sin alertas activas
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {alerts.map(alert => {
        const display = getAlertDisplay(alert, rules)
        const isCritical = display.severity === 'critical' || alert.status === 'escalated'
        const color = isCritical ? 'var(--danger)' : 'var(--warn)'

        return (
          <div key={alert.id} style={{ ...CARD, borderLeft: `3px solid ${color}` }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13, color: 'var(--fg-primary)' }}>
                {display.title}
              </div>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--fg-muted)' }}>
                {vehicleMap[alert.vehicle_id] ?? 'Vehículo desconocido'}{' · '}{timeAgo(alert.triggered_at)}
              </div>
              {display.detail && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
                  {display.detail}
                </div>
              )}
            </div>
            <button
              onClick={() => setAckAlert(alert)}
              style={{
                padding: '4px 12px', fontSize: 12, fontFamily: 'var(--font-sans)',
                background: 'transparent', border: `1px solid ${color}`,
                borderRadius: 6, color, cursor: 'pointer', flexShrink: 0,
              }}
            >
              Reconocer
            </button>
          </div>
        )
      })}
      {ackAlert && (
        <AckModal
          alert={ackAlert}
          ruleName={getAlertDisplay(ackAlert, rules).title}
          vehicleName={vehicleMap[ackAlert.vehicle_id] ?? 'Vehículo desconocido'}
          onClose={() => setAckAlert(null)}
          onSuccess={() => setAckAlert(null)}
        />
      )}
    </div>
  )
}
