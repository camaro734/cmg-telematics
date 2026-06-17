import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { toast } from '../../shared/ui/Toast'
import type { CommandLogEntry, FmcStatus } from '../../lib/types'

interface ManualCanSlot {
  id: string
  slot: number
  description: string | null
}

interface CanButton {
  id: string
  slot_id: string
  label: string
  byte_index: number
  bit_index: number
  active: boolean
  sort_order: number
  current_bit: boolean
  function: 'toggle' | 'hold'
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

function SlotButtonsPanel({
  vehicleId,
  slotId,
  slotLabel,
  connected,
}: {
  vehicleId: string
  slotId: string
  slotLabel: string
  connected: boolean
}) {
  const qc = useQueryClient()
  const [toggling, setToggling] = useState<Record<string, boolean>>({})
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({})
  // Botones hold actualmente pulsados; sirve para garantizar el OFF de soltar
  // aunque el componente se desmonte o la pestaña pierda el foco.
  const heldRef = useRef<Set<string>>(new Set())

  const { data: buttons = [] } = useQuery<CanButton[]>({
    queryKey: ['can-buttons', slotId],
    queryFn: () =>
      apiClient.get<CanButton[]>(
        `/api/v1/vehicles/${vehicleId}/can-slots/${slotId}/buttons`,
      ),
    refetchInterval: 30_000,
  })

  // Envía un valor concreto (o alterna si value=null) al backend.
  async function sendValue(btn: CanButton, value: boolean | null) {
    const optimisticNext = value === null ? !(optimistic[btn.id] ?? btn.current_bit) : value
    setOptimistic(o => ({ ...o, [btn.id]: optimisticNext }))
    setToggling(t => ({ ...t, [btn.id]: true }))
    try {
      await apiClient.post(
        `/api/v1/vehicles/${vehicleId}/can-slots/${slotId}/buttons/${btn.id}/toggle`,
        value === null ? {} : { value },
      )
      qc.invalidateQueries({ queryKey: ['can-buttons', slotId] })
    } catch (e) {
      qc.invalidateQueries({ queryKey: ['can-buttons', slotId] })
      toast.error(e instanceof Error ? e.message : 'Error al cambiar el botón')
    } finally {
      setToggling(t => ({ ...t, [btn.id]: false }))
    }
  }

  function handleToggleClick(btn: CanButton) {
    if (toggling[btn.id] || !connected) return
    void sendValue(btn, null)
  }

  function handleHoldStart(btn: CanButton) {
    if (!connected || heldRef.current.has(btn.id)) return
    heldRef.current.add(btn.id)
    void sendValue(btn, true)
  }

  // El OFF de soltar NO se bloquea por el guard de pending del ON: el backend
  // reintenta el lock para no dejar la salida físicamente encendida.
  function handleHoldEnd(btn: CanButton) {
    if (!heldRef.current.has(btn.id)) return
    heldRef.current.delete(btn.id)
    void sendValue(btn, false)
  }

  // OFF de seguridad: al desmontar o perder visibilidad/foco, soltar todo lo pulsado.
  useEffect(() => {
    function releaseAll() {
      for (const btn of buttons) {
        if (heldRef.current.has(btn.id)) {
          heldRef.current.delete(btn.id)
          void apiClient.post(
            `/api/v1/vehicles/${vehicleId}/can-slots/${slotId}/buttons/${btn.id}/toggle`,
            { value: false },
          )
        }
      }
    }
    window.addEventListener('visibilitychange', releaseAll)
    window.addEventListener('blur', releaseAll)
    return () => {
      window.removeEventListener('visibilitychange', releaseAll)
      window.removeEventListener('blur', releaseAll)
      releaseAll()
    }
  }, [buttons, vehicleId, slotId])

  const active = buttons.filter(b => b.active)
  if (active.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{
        fontSize: 9, fontWeight: 700, color: 'var(--fg-muted)',
        letterSpacing: '0.07em', textTransform: 'uppercase',
      }}>{slotLabel}</div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 8,
      }}>
        {active.map(btn => {
          const on = optimistic[btn.id] ?? btn.current_bit
          const loading = toggling[btn.id]
          const isHold = btn.function === 'hold'
          // En hold el botón no se deshabilita por loading: el soltar debe poder
          // disparar el OFF aunque el ON siga en vuelo.
          const disabled = isHold ? !connected : (!connected || !!loading)
          const holdHandlers = isHold
            ? {
                onPointerDown: () => handleHoldStart(btn),
                onPointerUp: () => handleHoldEnd(btn),
                onPointerLeave: () => handleHoldEnd(btn),
                onPointerCancel: () => handleHoldEnd(btn),
              }
            : { onClick: () => handleToggleClick(btn) }
          // Texto del botón inferior según modo (toggle/hold) y estado actual.
          const btnText = loading && !isHold
            ? '…'
            : isHold
              ? (on ? 'Enviando…' : 'Mantener pulsado')
              : (on ? 'Desactivar' : 'Activar')
          return (
            // Misma tarjeta que los controles DOUT del FMC650 (ver VehicleDetailPage):
            // cabecera con etiqueta + estado ● ON/○ OFF y un único botón ancho debajo.
            <div key={btn.id} style={{
              background: on ? 'var(--ok-soft)' : 'var(--bg-card)',
              border: `1px solid ${on ? 'var(--ok)' : 'var(--border)'}`,
              borderRadius: 8, padding: '10px 12px',
              display: 'flex', flexDirection: 'column', gap: 6,
              transition: 'background 0.2s, border-color 0.2s',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)' }}>
                  {btn.label}
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: on ? 'var(--ok)' : 'var(--offline)' }}>
                  {on ? '● ON' : '○ OFF'}
                </span>
              </div>
              <button
                data-testid={`btn-toggle-${btn.id}`}
                disabled={disabled}
                title={isHold ? 'Mantener pulsado para enviar; soltar para parar' : undefined}
                {...holdHandlers}
                style={{
                  background: on ? 'rgba(34,197,94,0.2)' : 'var(--bg-elevated)',
                  border: `1px solid ${on ? 'var(--ok)' : 'var(--border)'}`,
                  borderRadius: 6, padding: '5px 0', fontSize: 11, fontWeight: 600,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  color: on ? 'var(--ok)' : 'var(--fg-tertiary)',
                  opacity: loading ? 0.6 : 1, width: '100%', fontFamily: 'var(--font-sans)',
                  transition: 'all 0.15s', touchAction: 'none', userSelect: 'none',
                }}
              >
                {btnText}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ManualCanControl({ vehicleId, slots }: Props) {
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

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 8, overflow: 'hidden',
    }}>
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
        <span style={{
          fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)',
          color: connected ? 'var(--ok)' : 'var(--danger)',
        }}>
          {connected ? '● FMC Online' : '○ FMC Offline'}
        </span>
      </button>

      {open && (
        <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Cada slot renderiza sus botones de bit configurados (estilo DOUT).
                Toggle = un clic alterna; hold = activo mientras se mantiene pulsado. */}
            {slots.map(s => (
              <SlotButtonsPanel
                key={s.slot}
                vehicleId={vehicleId}
                slotId={s.id}
                slotLabel={s.description ?? `Slot ${s.slot}`}
                connected={connected}
              />
            ))}
          </div>

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
