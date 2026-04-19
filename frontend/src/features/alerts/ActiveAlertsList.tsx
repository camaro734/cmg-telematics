import type { CSSProperties } from 'react'
import { useState } from 'react'
import type { AlertInstanceOut, VehicleOut, RuleOut } from '../../lib/types'
import AckModal from './AckModal'

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
  background: 'var(--bg-surface)',
  border: '1px solid var(--bg-border)',
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
  const ruleMap = Object.fromEntries(rules.map(r => [r.id, r]))

  if (alerts.length === 0) {
    return (
      <div style={{ padding: '20px 0', color: 'var(--accent-ok)', fontFamily: 'var(--font-ui)', fontSize: 13 }}>
        Sin alertas activas
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {alerts.map(alert => {
        const rule = ruleMap[alert.rule_id]
        const color = alert.status === 'escalated' || rule?.severity === 'critical'
          ? 'var(--accent-crit)'
          : 'var(--accent-warn)'

        return (
          <div key={alert.id} style={{ ...CARD, borderLeft: `3px solid ${color}` }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                {rule?.name ?? 'Regla desconocida'}
              </div>
              <div style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-muted)' }}>
                {vehicleMap[alert.vehicle_id] ?? 'Vehículo desconocido'}{' · '}{timeAgo(alert.triggered_at)}
              </div>
            </div>
            {alert.trigger_value != null && (
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 13, color, flexShrink: 0 }}>
                {String(alert.trigger_value['value'] ?? JSON.stringify(alert.trigger_value))}
              </div>
            )}
            <button
              onClick={() => setAckAlert(alert)}
              style={{
                padding: '4px 12px', fontSize: 12, fontFamily: 'var(--font-ui)',
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
          ruleName={ruleMap[ackAlert.rule_id]?.name ?? 'Regla desconocida'}
          vehicleName={vehicleMap[ackAlert.vehicle_id] ?? 'Vehículo desconocido'}
          onClose={() => setAckAlert(null)}
          onSuccess={() => setAckAlert(null)}
        />
      )}
    </div>
  )
}
