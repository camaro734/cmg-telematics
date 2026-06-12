import type { MaintenanceLogOut } from '../../lib/types'

const THRESHOLD_LABEL: Record<string, string> = {
  pto_hours: 'h PTO',
  engine_hours: 'h motor',
  calendar_days: 'días',
}

interface Props {
  logs: MaintenanceLogOut[]
  isOperatorOrAdmin: boolean
  onRegister: () => void
}

export default function InterventionTimeline({ logs, isOperatorOrAdmin, onRegister }: Props) {
  if (logs.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingTop: 32, color: 'var(--fg-muted)', fontSize: 13 }}>
        <span>Sin intervenciones registradas</span>
        {isOperatorOrAdmin && (
          <button
            onClick={onRegister}
            style={{ background: 'none', border: '1px dashed var(--border)', color: 'var(--fg-muted)', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}
          >
            + Registrar primera intervención
          </button>
        )}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', left: 7, top: 8, bottom: 8, width: 2, background: 'var(--border)' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {logs.map(log => (
          <div key={log.id} style={{ display: 'flex', gap: 16, position: 'relative' }}>
            <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--bg-elevated)', border: '2px solid var(--cmg-teal)', flexShrink: 0, marginTop: 2, position: 'relative', zIndex: 1 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-primary)' }}>
                  {log.performed_by_email ?? 'Operario'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                  {log.performed_at
                    ? new Date(log.performed_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })
                    : '—'}
                </span>
              </div>
              {log.description && (
                <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--fg-secondary)' }}>{log.description}</p>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {log.reset_counters.map(c => (
                  <span key={c} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(29,158,117,0.15)', color: 'var(--cmg-teal)', fontWeight: 600 }}>
                    {THRESHOLD_LABEL[c] ?? c}
                  </span>
                ))}
                {log.cost_eur != null && (
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(234,179,8,0.12)', color: 'var(--accent-warn)', fontWeight: 600 }}>
                    {log.cost_eur.toFixed(2)} €
                  </span>
                )}
                {log.document_url && (
                  <a
                    href={log.document_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(56,189,248,0.12)', color: 'var(--accent-info)', fontWeight: 600, textDecoration: 'none' }}
                  >
                    Doc
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
