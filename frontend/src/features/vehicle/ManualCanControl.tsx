import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { toast } from '../../shared/ui/Toast'
import type { CommandLogEntry, FmcStatus, ManualCanCommandResponse } from '../../lib/types'

interface ManualCanSlot {
  slot: number
  description: string | null
}

interface Props {
  vehicleId: string
  slots: ManualCanSlot[]
}

type CommandStatus = CommandLogEntry['status']

const STATUS_DISPLAY: Record<string, { label: string; color: string; dot: string }> = {
  confirmed:    { label: 'OK',            color: 'var(--ok)',      dot: '●' },
  pending:      { label: 'Pendiente',     color: 'var(--info)',    dot: '○' },
  sent:         { label: 'Enviado',       color: 'var(--info)',    dot: '○' },
  timeout:      { label: 'Timeout',       color: 'var(--danger)',  dot: '○' },
  disconnected: { label: 'Desconectado',  color: 'var(--danger)',  dot: '○' },
  error:        { label: 'Error',         color: 'var(--danger)',  dot: '○' },
  failed:       { label: 'Fallido',       color: 'var(--danger)',  dot: '○' },
}

function StatusDot({ status }: { status: CommandStatus }) {
  const s = STATUS_DISPLAY[status] ?? STATUS_DISPLAY.error
  return (
    <span style={{
      fontSize: 9, padding: '2px 6px', borderRadius: 8, fontWeight: 600, whiteSpace: 'nowrap',
      background: `color-mix(in srgb, ${s.color} 15%, transparent)`,
      color: s.color, border: `1px solid ${s.color}`,
    }}>
      {s.dot} {s.label}
    </span>
  )
}

export default function ManualCanControl({ vehicleId, slots }: Props) {
  const qc = useQueryClient()
  // loading por slot: slot → 'on' | 'off' | null
  const [slotLoading, setSlotLoading] = useState<Record<number, 'on' | 'off' | null>>({})
  const [open, setOpen] = useState(true)

  const { data: fmcStatus } = useQuery<FmcStatus>({
    queryKey: ['fmc-status', vehicleId],
    queryFn: () => apiClient.get<FmcStatus>(`/api/v1/vehicles/${vehicleId}/fmc-status`),
    refetchInterval: 10_000,
  })

  const { data: history = [] } = useQuery<CommandLogEntry[]>({
    queryKey: ['manual-can-history', vehicleId],
    queryFn: () =>
      apiClient.get<CommandLogEntry[]>(
        `/api/v1/vehicles/${vehicleId}/commands?command_type=MANUAL_CAN&limit=5`,
      ),
    refetchInterval: 15_000,
  })

  const connected = fmcStatus?.connected ?? false

  async function sendCommand(slot: number, state: boolean) {
    const direction = state ? 'on' : 'off'
    if (slotLoading[slot] != null) return
    setSlotLoading(prev => ({ ...prev, [slot]: direction }))
    try {
      const res = await apiClient.post<ManualCanCommandResponse>(
        `/api/v1/vehicles/${vehicleId}/commands/manual-can`,
        { slot, state },
      )
      if (res.status === 'confirmed') {
        toast.error === undefined
          ? console.info('OK')
          : (() => {})() // toast.success si existe
      }
      qc.invalidateQueries({ queryKey: ['manual-can-history', vehicleId] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al enviar el comando')
    } finally {
      setSlotLoading(prev => ({ ...prev, [slot]: null }))
    }
  }

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 8, overflow: 'hidden',
    }}>
      {/* Cabecera colapsable */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', background: 'none', border: 'none', padding: '7px 10px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 0.2s', display: 'inline-block',
            fontSize: 10, color: 'var(--fg-muted)',
          }}>▾</span>
          <span style={{
            fontFamily: 'var(--font-sans)', fontSize: 9, fontWeight: 700,
            color: 'var(--fg-muted)', letterSpacing: '0.07em', textTransform: 'uppercase',
          }}>Control CAN Manual</span>
        </div>
        {/* Indicador de conexión FMC */}
        <span style={{
          fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)',
          color: connected ? 'var(--ok)' : 'var(--danger)',
        }}>
          {connected ? '● FMC Online' : '○ FMC Offline'}
        </span>
      </button>

      {open && (
        <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Botones por slot */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {slots.map(s => {
              const loading = slotLoading[s.slot] != null
              const disabled = !connected || loading
              const label = s.description ?? `Slot ${s.slot}`
              return (
                <div key={s.slot} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '10px 12px',
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <span style={{
                      fontSize: 12, fontWeight: 600,
                      color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)',
                    }}>{label}</span>
                    {loading && (
                      <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                        Esperando FMC…
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {/* ARRANCAR */}
                    <button
                      data-testid={`btn-arrancar-slot-${s.slot}`}
                      onClick={() => sendCommand(s.slot, true)}
                      disabled={disabled}
                      style={{
                        background: disabled
                          ? 'var(--bg-elevated)'
                          : 'color-mix(in srgb, var(--cmg-teal) 20%, transparent)',
                        border: `1px solid ${disabled ? 'var(--border)' : 'var(--cmg-teal)'}`,
                        borderRadius: 6, padding: '6px 0', fontSize: 11, fontWeight: 600,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        color: disabled ? 'var(--fg-tertiary)' : 'var(--cmg-teal)',
                        opacity: loading ? 0.6 : 1,
                        fontFamily: 'var(--font-sans)', transition: 'all 0.15s',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      }}
                    >
                      {slotLoading[s.slot] === 'on' ? '…' : '▶ Arrancar'}
                    </button>
                    {/* PARAR */}
                    <button
                      data-testid={`btn-parar-slot-${s.slot}`}
                      onClick={() => sendCommand(s.slot, false)}
                      disabled={disabled}
                      style={{
                        background: 'var(--bg-elevated)',
                        border: `1px solid ${disabled ? 'var(--border)' : 'var(--accent-crit)'}`,
                        borderRadius: 6, padding: '6px 0', fontSize: 11, fontWeight: 600,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        color: disabled ? 'var(--fg-tertiary)' : 'var(--accent-crit)',
                        opacity: loading ? 0.6 : 1,
                        fontFamily: 'var(--font-sans)', transition: 'all 0.15s',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      }}
                    >
                      {slotLoading[s.slot] === 'off' ? '…' : '■ Parar'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Historial de los últimos 5 comandos Manual CAN */}
          {history.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <div style={{
                fontSize: 9, fontWeight: 700, color: 'var(--fg-muted)',
                letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6,
              }}>Historial reciente</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {history.map(entry => (
                  <div key={entry.id} style={{
                    display: 'grid', gridTemplateColumns: '1fr auto',
                    gap: 6, alignItems: 'start',
                    borderBottom: '1px solid var(--border)', paddingBottom: 4,
                  }}>
                    <div>
                      <div style={{
                        fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)',
                      }}>
                        {new Date(entry.sent_at).toLocaleString('es-ES', {
                          day: '2-digit', month: '2-digit',
                          hour: '2-digit', minute: '2-digit', second: '2-digit',
                        })}
                        {entry.latency_ms != null && (
                          <span style={{ marginLeft: 6, color: 'var(--fg-dim)' }}>
                            {entry.latency_ms}ms
                          </span>
                        )}
                      </div>
                      <div style={{
                        fontSize: 11, color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)',
                      }}>{entry.command}</div>
                    </div>
                    <StatusDot status={entry.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
