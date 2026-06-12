import { Link } from 'react-router-dom'
import ProgressBar from './ProgressBar'
import { MaintenanceStatusBadge } from '../../shared/ui/MaintenanceStatusBadge'
import type { MaintenancePlanOut, MaintenanceProjectionOut, MaintenanceLogOut } from '../../lib/types'

const THRESHOLD_UNIT: Record<string, string> = {
  pto_hours: 'h PTO',
  engine_hours: 'h motor',
  calendar_days: 'días',
}

const card: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '14px 16px',
}

interface Props {
  plan: MaintenancePlanOut
  projection?: MaintenanceProjectionOut
  lastLog: MaintenanceLogOut | null
  accumulatedCost: number
  isOperatorOrAdmin: boolean
  canManage: boolean
  onRegister: () => void
}

export default function PlanSideCard({ plan, projection, lastLog, accumulatedCost, isOperatorOrAdmin, canManage, onRegister }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Estado + intervalo de mantenimiento */}
      <div style={card}>
        <div style={{ marginBottom: 8 }}>
          <MaintenanceStatusBadge status={plan.progress.status} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 4 }}>
          {plan.trigger_condition.thresholds.map((t, i) => (
            <span key={t.type}>
              {i > 0 && ' / '}
              Cada {t.value} {THRESHOLD_UNIT[t.type] ?? t.type}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
          Aviso al {plan.warn_before_pct}% restante
        </div>
      </div>

      {/* Progreso + proyección por umbral */}
      {plan.progress.thresholds.map(t => {
        const proj = projection?.thresholds.find(pt => pt.type === t.type)
        const remaining = t.limit - t.current
        return (
          <div key={t.type} style={card}>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 4 }}>
              {THRESHOLD_UNIT[t.type] ?? t.type}
            </div>
            <ProgressBar pct={t.pct} status={plan.progress.status} showLabel />
            <div style={{ fontSize: 11, color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
              {Math.round(t.current)} / {t.limit}
              <span style={{ color: 'var(--fg-muted)', marginLeft: 6 }}>
                · {remaining < 0
                  ? `excedido ${Math.abs(remaining).toFixed(0)}`
                  : `quedan ${remaining.toFixed(0)}`}
              </span>
            </div>
            {proj?.days_remaining != null && (
              <div style={{ fontSize: 10, color: 'var(--accent-info)', marginTop: 3 }}>
                ≈ {Math.round(proj.days_remaining)} días restantes
              </div>
            )}
          </div>
        )
      })}

      {/* Última intervención + coste acumulado */}
      <div style={card}>
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Última intervención
        </div>
        {lastLog ? (
          <>
            <div style={{ fontSize: 12, color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)' }}>
              {new Date(lastLog.performed_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })}
            </div>
            {lastLog.performed_by_email && (
              <div style={{ fontSize: 11, color: 'var(--fg-secondary)', marginTop: 2 }}>{lastLog.performed_by_email}</div>
            )}
          </>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Sin registros</span>
        )}
        {accumulatedCost > 0 && (
          <div style={{ fontSize: 11, color: 'var(--accent-warn)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
            Coste total: {accumulatedCost.toFixed(2)} €
          </div>
        )}
      </div>

      {/* Acciones */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(plan.progress.status === 'próximo' || plan.progress.status === 'vencido') && isOperatorOrAdmin && (
          <button
            onClick={onRegister}
            style={{ background: 'var(--cmg-teal)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', width: '100%' }}
          >
            Completar intervención
          </button>
        )}
        {canManage && (
          <Link
            to={`/maintenance/${plan.id}/edit`}
            style={{ display: 'block', textAlign: 'center', background: 'var(--bg-elevated)', color: 'var(--fg-secondary)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 14px', fontSize: 12, textDecoration: 'none' }}
          >
            Editar plan
          </Link>
        )}
      </div>
    </div>
  )
}
