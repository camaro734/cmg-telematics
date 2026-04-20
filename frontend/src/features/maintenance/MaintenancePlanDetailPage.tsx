import { useState } from 'react'
import { useParams, Navigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import ProgressBar from './ProgressBar'
import LogInterventionModal from './LogInterventionModal'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { MaintenancePlanOut, MaintenanceLogOut } from '../../lib/types'

const THRESHOLD_LABEL: Record<string, string> = {
  pto_hours: 'Horas PTO',
  engine_hours: 'Horas motor',
  calendar_days: 'Días calendario',
}

export default function MaintenancePlanDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [showLog, setShowLog] = useState(false)

  const { data: plan, isLoading } = useQuery({
    queryKey: keys.maintenancePlan(id ?? ''),
    queryFn: () => apiClient.get<MaintenancePlanOut>(`/api/v1/maintenance/plans/${id}`),
    enabled: !!id,
    refetchInterval: 60_000,
  })

  const { data: logs = [] } = useQuery({
    queryKey: keys.maintenanceLogs(id ?? ''),
    queryFn: () => apiClient.get<MaintenanceLogOut[]>(`/api/v1/maintenance/plans/${id}/logs`),
    enabled: !!id,
  })

  if (!id) return <Navigate to="/maintenance" replace />
  if (isLoading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
      Cargando…
    </div>
  )
  if (!plan) return <Navigate to="/maintenance" replace />

  return (
    <Shell title={plan.name}>
      <div style={{ padding: 24, maxWidth: 800 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{plan.vehicle_name}</div>
            <div style={{ fontSize: 18, color: 'var(--text-primary)', fontWeight: 600, marginTop: 2 }}>{plan.name}</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link to={`/maintenance/${id}/edit`} style={{ background: 'none', border: '1px solid var(--bg-border)', color: 'var(--text-muted)', borderRadius: 6, padding: '8px 16px', fontSize: 12, textDecoration: 'none' }}>
              Editar
            </Link>
            <button
              onClick={() => setShowLog(true)}
              style={{ background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              Registrar intervención
            </button>
          </div>
        </div>

        {/* Progress cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
          {plan.progress.thresholds.map(t => (
            <div key={t.type} style={{ background: 'var(--bg-surface)', borderRadius: 8, padding: '16px', border: '1px solid var(--bg-border)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 10 }}>
                {THRESHOLD_LABEL[t.type] ?? t.type.toUpperCase()}
              </div>
              <div style={{ fontSize: 22, fontFamily: 'var(--font-data)', fontWeight: 500, color: 'var(--text-primary)', marginBottom: 10 }}>
                {Math.round(t.current)} <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/ {t.limit}</span>
              </div>
              <ProgressBar pct={t.pct} status={plan.progress.status} />
            </div>
          ))}
        </div>

        {/* History */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 12 }}>
            HISTORIAL DE INTERVENCIONES
          </div>
          {logs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Sin intervenciones registradas</div>
          ) : (
            <div style={{ background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--bg-border)', overflow: 'hidden' }}>
              {logs.map((log, i) => (
                <div key={log.id} style={{ padding: '12px 16px', borderBottom: i < logs.length - 1 ? '1px solid var(--bg-border)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                        {log.description ?? 'Intervención registrada'}
                      </div>
                      {log.reset_counters.length > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                          Resetea: {log.reset_counters.map(c => THRESHOLD_LABEL[c] ?? c).join(', ')}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>
                        {new Date(log.performed_at).toLocaleDateString('es-ES')}
                      </div>
                      {log.cost_eur != null && (
                        <div style={{ fontSize: 12, color: 'var(--accent-ok)', fontFamily: 'var(--font-data)', marginTop: 2 }}>
                          {log.cost_eur.toFixed(2)} €
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showLog && (
        <LogInterventionModal
          planId={id}
          thresholds={plan.trigger_condition.thresholds}
          onClose={() => setShowLog(false)}
        />
      )}
    </Shell>
  )
}
