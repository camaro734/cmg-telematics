import type { CSSProperties } from 'react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { AlertInstanceOut, VehicleOut, RuleOut } from '../../lib/types'

type HistoryStatus = 'all' | 'acknowledged' | 'resolved'

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  firing:       { label: 'ACTIVA',     color: 'var(--accent-crit)' },
  escalated:    { label: 'ESCALADA',   color: 'var(--accent-crit)' },
  acknowledged: { label: 'RECONOCIDA', color: 'var(--accent-warn)' },
  resolved:     { label: 'RESUELTA',   color: 'var(--accent-ok)'   },
}

const SELECT: CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--bg-border)',
  borderRadius: 6, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
  fontSize: 12, padding: '4px 8px',
}

const TH: CSSProperties = { padding: '6px 8px', textAlign: 'left', fontWeight: 600 }
const TD: CSSProperties = { padding: '6px 8px' }

interface AlertHistoryProps {
  vehicles: VehicleOut[]
  rules: RuleOut[]
}

export default function AlertHistory({ vehicles, rules }: AlertHistoryProps) {
  const [status, setStatus] = useState<HistoryStatus>('all')
  const [vehicleId, setVehicleId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const vehicleMap = Object.fromEntries(vehicles.map(v => [v.id, v.name]))
  const ruleMap = Object.fromEntries(rules.map(r => [r.id, r.name]))

  const buildUrl = (s: string) => {
    const p = new URLSearchParams({ status: s, limit: '50' })
    if (vehicleId) p.set('vehicle_id', vehicleId)
    return `/api/v1/alerts?${p}`
  }

  const { data: acked = [] } = useQuery({
    queryKey: [...keys.alerts(), 'acknowledged', vehicleId],
    queryFn: () => apiClient.get<AlertInstanceOut[]>(buildUrl('acknowledged')),
    enabled: status === 'all' || status === 'acknowledged',
  })

  const { data: resolved = [] } = useQuery({
    queryKey: [...keys.alerts(), 'resolved', vehicleId],
    queryFn: () => apiClient.get<AlertInstanceOut[]>(buildUrl('resolved')),
    enabled: status === 'all' || status === 'resolved',
  })

  let rows = status === 'all' ? [...acked, ...resolved]
    : status === 'acknowledged' ? acked
    : resolved

  if (dateFrom) rows = rows.filter(a => a.triggered_at >= dateFrom)
  if (dateTo)   rows = rows.filter(a => a.triggered_at <= dateTo + 'T23:59:59Z')
  rows = [...rows].sort((a, b) => b.triggered_at.localeCompare(a.triggered_at))

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={status} onChange={e => setStatus(e.target.value as HistoryStatus)} style={SELECT}>
          <option value="all">Todos los estados</option>
          <option value="acknowledged">Reconocidas</option>
          <option value="resolved">Resueltas</option>
        </select>
        <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} style={SELECT} aria-label="Filtrar por vehículo">
          <option value="">Todos los vehículos</option>
          {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={SELECT} title="Desde" />
        <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   style={SELECT} title="Hasta" />
      </div>

      {rows.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>
          Sin registros para el período seleccionado
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-ui)', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--bg-border)' }}>
                {['Fecha', 'Vehículo', 'Regla', 'Valor', 'Ubicación', 'Estado', 'Nota'].map(h => (
                  <th key={h} style={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(a => {
                const badge = STATUS_BADGE[a.status] ?? { label: a.status, color: 'var(--text-muted)' }
                const tv = a.trigger_value
                const lat = tv?.lat as number | undefined
                const lon = tv?.lon as number | undefined
                const loc = lat != null && lon != null ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : '—'
                const val = tv?.value != null ? String(tv.value) : '—'
                return (
                  <tr key={a.id} style={{ borderBottom: '1px solid var(--bg-elevated)' }}>
                    <td style={{ ...TD, fontFamily: 'var(--font-data)', whiteSpace: 'nowrap' }}>
                      {new Date(a.triggered_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td style={TD}>{vehicleMap[a.vehicle_id] ?? '—'}</td>
                    <td style={TD}>{ruleMap[a.rule_id] ?? '—'}</td>
                    <td style={{ ...TD, fontFamily: 'var(--font-data)' }}>{val}</td>
                    <td style={{ ...TD, fontFamily: 'var(--font-data)' }}>{loc}</td>
                    <td style={TD}>
                      <span style={{ color: badge.color, fontWeight: 600 }}>{badge.label}</span>
                    </td>
                    <td style={{ ...TD, color: 'var(--text-muted)' }}>{a.ack_note ?? '—'}</td>
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
