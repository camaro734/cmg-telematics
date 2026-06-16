import { useEffect } from 'react'
import type { CommandLogEntry } from '../../lib/types'

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'hace un momento'
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`
  return `hace ${Math.floor(diff / 86400)} días`
}

const STATUS_COLOR: Record<CommandLogEntry['status'], string> = {
  confirmed:    'var(--ok)',
  sent:         'var(--cmg-teal)',
  pending:      'var(--warn)',
  failed:       'var(--danger)',
  timeout:      'var(--danger)',
  disconnected: 'var(--danger)',
  error:        'var(--danger)',
}

interface Props {
  isOpen: boolean
  onClose: () => void
  commands: CommandLogEntry[]
}

export default function ActivityDrawer({ isOpen, onClose, commands }: Props) {
  // Cerrar con Esc
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          data-testid="activity-drawer-backdrop"
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 400,
          }}
        />
      )}

      {/* Panel lateral */}
      <div
        data-testid="activity-drawer"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 340,
          background: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border)',
          zIndex: 401,
          display: 'flex', flexDirection: 'column',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.22s ease',
          boxShadow: isOpen ? '-8px 0 32px rgba(0,0,0,0.35)' : 'none',
        }}
      >
        {/* Cabecera del drawer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-primary)' }}>
            Actividad
          </span>
          <button
            onClick={onClose}
            aria-label="Cerrar panel de actividad"
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--fg-muted)', fontSize: 18,
              cursor: 'pointer', padding: '2px 6px', lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Lista de comandos */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {commands.length === 0 ? (
            <div style={{ marginTop: 32, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
              Sin actividad registrada
            </div>
          ) : (
            commands.map(cmd => (
              <div
                key={cmd.id}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderLeft: `3px solid ${STATUS_COLOR[cmd.status] ?? 'var(--border)'}`,
                  borderRadius: 8,
                  padding: '8px 12px',
                }}
              >
                {/* Comando + estado */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)', wordBreak: 'break-all' }}>
                    {cmd.command}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, flexShrink: 0,
                    color: STATUS_COLOR[cmd.status] ?? 'var(--fg-muted)',
                    textTransform: 'uppercase',
                  }}>
                    {cmd.status}
                  </span>
                </div>

                {/* Timestamp */}
                <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                  {relativeTime(cmd.sent_at)}
                </div>

                {/* Respuesta */}
                {cmd.response && (
                  <div style={{ fontSize: 11, color: 'var(--fg-secondary)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
                    → {cmd.response}
                  </div>
                )}

                {/* Error */}
                {cmd.error_message && (
                  <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 3 }}>
                    ⚠ {cmd.error_message}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
