import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { AlertInstanceOut, VehicleOut, RuleOut } from '../../lib/types'
import { getAlertDisplay } from './alertUtils'

export type HistoryStatus = 'all' | 'acknowledged' | 'resolved'

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  firing:       { label: 'ACTIVA',     color: 'var(--danger)' },
  escalated:    { label: 'ESCALADA',   color: 'var(--danger)' },
  acknowledged: { label: 'RECONOCIDA', color: 'var(--warn)' },
  resolved:     { label: 'RESUELTA',   color: 'var(--ok)'   },
}

const TH: CSSProperties = { padding: '6px 8px', textAlign: 'left', fontWeight: 600 }
const TD: CSSProperties = { padding: '6px 8px' }

interface AlertHistoryProps {
  vehicles: VehicleOut[]
  rules: RuleOut[]
  status: HistoryStatus
  vehicleId: string
  dateFrom: string
  dateTo: string
}

export default function AlertHistory({ vehicles, rules, status, vehicleId, dateFrom, dateTo }: AlertHistoryProps) {
  const vehicleMap = Object.fromEntries(vehicles.map(v => [v.id, v.name]))

  const buildUrl = (s: string) => {
    const p = new URLSearchParams({ status: s, limit: '50' })
    if (vehicleId) p.set('vehicle_id', vehicleId)
    if (dateFrom) p.set('triggered_at_from', dateFrom + 'T00:00:00Z')
    if (dateTo)   p.set('triggered_at_to',   dateTo   + 'T23:59:59Z')
    return `/api/v1/alerts?${p}`
  }

  const queryKey = (s: string) => [...keys.alerts(), s, vehicleId, dateFrom, dateTo]

  const { data: acked = [] } = useQuery({
    queryKey: queryKey('acknowledged'),
    queryFn: () => apiClient.get<AlertInstanceOut[]>(buildUrl('acknowledged')),
    enabled: status === 'all' || status === 'acknowledged',
  })

  const { data: resolved = [] } = useQuery({
    queryKey: queryKey('resolved'),
    queryFn: () => apiClient.get<AlertInstanceOut[]>(buildUrl('resolved')),
    enabled: status === 'all' || status === 'resolved',
  })

  const rows = [...(status === 'all' ? [...acked, ...resolved] : status === 'acknowledged' ? acked : resolved)]
    .sort((a, b) => (b.triggered_at > a.triggered_at ? 1 : b.triggered_at < a.triggered_at ? -1 : 0))

  return (
    <div>
      {rows.length === 0 ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 13, padding: '20px 0' }}>
          Sin registros para el período seleccionado
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-sans)', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--fg-muted)', borderBottom: '1px solid var(--border)' }}>
                {['Fecha', 'Vehículo', 'Regla', 'Valor', 'Estado', 'Nota'].map(h => (
                  <th key={h} style={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(a => {
                const badge = STATUS_BADGE[a.status] ?? { label: a.status, color: 'var(--fg-muted)' }
                const display = getAlertDisplay(a, rules)
                return (
                  <tr key={a.id} style={{ borderBottom: '1px solid var(--bg-card)' }}>
                    <td style={{ ...TD, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                      {new Date(a.triggered_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td style={TD}>{vehicleMap[a.vehicle_id] ?? '—'}</td>
                    <td style={TD}>{display.title}</td>
                    <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {display.detail ?? '—'}
                    </td>
                    <td style={TD}>
                      <span style={{ color: badge.color, fontWeight: 600 }}>{badge.label}</span>
                    </td>
                    <td style={{ ...TD, color: 'var(--fg-muted)' }}>{a.ack_note ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
