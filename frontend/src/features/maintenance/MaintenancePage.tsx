import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import ProgressBar from './ProgressBar'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { MaintenancePlanOut, VehicleOut } from '../../lib/types'

const STATUS_LABEL: Record<string, string> = { ok: 'OK', 'próximo': 'PRÓXIMO', vencido: 'VENCIDO' }
const STATUS_COLOR: Record<string, string> = {
  ok: 'var(--accent-ok)',
  'próximo': 'var(--accent-warn)',
  vencido: 'var(--accent-crit)',
}
const THRESHOLD_LABEL: Record<string, string> = {
  pto_hours: 'h PTO',
  engine_hours: 'h motor',
  calendar_days: 'días',
}
const STATUS_ORDER: Record<string, number> = { vencido: 0, 'próximo': 1, ok: 2 }

export default function MaintenancePage() {
  const [vehicleFilter, setVehicleFilter] = useState('')

  const { data: plans = [], isLoading } = useQuery({
    queryKey: keys.maintenancePlans(),
    queryFn: () => apiClient.get<MaintenancePlanOut[]>('/api/v1/maintenance/plans'),
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: keys.vehicles(),
    queryFn: () => apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    staleTime: Infinity,
  })

  const sorted = [...plans]
    .filter(p => !vehicleFilter || p.vehicle_id === vehicleFilter)
    .sort((a, b) => (STATUS_ORDER[a.progress.status] ?? 3) - (STATUS_ORDER[b.progress.status] ?? 3))

  return (
    <Shell title="Mantenimiento">
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <select
            value={vehicleFilter}
            onChange={e => setVehicleFilter(e.target.value)}
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--bg-border)',
              color: 'var(--text-primary)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
            }}
          >
            <option value="">Todos los vehículos</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <Link
            to="/maintenance/new"
            style={{
              background: 'var(--accent-energy)',
              color: '#fff',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 12,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            + Nuevo plan
          </Link>
        </div>

        {isLoading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Cargando…</div>
        ) : sorted.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Sin planes de mantenimiento configurados</div>
        ) : (
          <div style={{ background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--bg-border)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
                  {['VEHÍCULO', 'PLAN', 'PROGRESO', 'ESTADO', ''].map(h => (
                    <th key={h} style={{ padding: '8px 16px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', textAlign: 'left' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((plan, i) => {
                  const worst = plan.progress.thresholds.length > 0
                    ? plan.progress.thresholds.reduce((a, b) => a.pct > b.pct ? a : b)
                    : null
                  return (
                    <tr key={plan.id} style={{ borderBottom: i < sorted.length - 1 ? '1px solid var(--bg-border)' : 'none' }}>
                      <td style={{ padding: '10px 16px', fontSize: 13 }}>{plan.vehicle_name}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <Link to={`/maintenance/${plan.id}`} style={{ color: 'var(--text-primary)', fontSize: 13 }}>
                          {plan.name}
                        </Link>
                      </td>
                      <td style={{ padding: '10px 16px', minWidth: 200 }}>
                        {worst && (
                          <div>
                            <ProgressBar pct={worst.pct} status={plan.progress.status} />
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                              {THRESHOLD_LABEL[worst.type] ?? worst.type}: {Math.round(worst.current)}/{worst.limit}
                            </div>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: STATUS_COLOR[plan.progress.status] ?? 'var(--text-muted)' }}>
                          {STATUS_LABEL[plan.progress.status] ?? plan.progress.status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <Link to={`/maintenance/${plan.id}/edit`} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          Editar
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  )
}
