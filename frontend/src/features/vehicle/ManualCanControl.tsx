import { useEffect, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { toast } from '../../shared/ui/Toast'
import type { CommandLogEntry } from '../../lib/types'
import { useAuthStore } from '../auth/useAuthStore'

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

export default function ManualCanControl({ vehicleId, slots }: Props) {
  const qc = useQueryClient()
  const isAdmin = useAuthStore(s => s.user?.role === 'admin')
  const [open, setOpen] = useState(true)
  const [toggling, setToggling] = useState<Record<string, boolean>>({})
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({})
  // Botón hold pendiente de confirmación en el modal
  const [confirmBtn, setConfirmBtn] = useState<CanButton | null>(null)
  // Estado de feedback por botón: 'queued' = encolado en backend; 'sent' = confirmado
  const [queuedBtns, setQueuedBtns] = useState<Record<string, 'queued' | 'sent'>>({})
  // Mapa btn.id → command_log_id devuelto por el backend al encolar; permite rastrear
  // la entrega exacta sin depender de comparaciones de timestamp.
  const [queuedLogIds, setQueuedLogIds] = useState<Record<string, string>>({})

  const { data: history = [] } = useQuery<CommandLogEntry[]>({
    queryKey: ['manual-can-history', vehicleId],
    queryFn: () =>
      apiClient.get<CommandLogEntry[]>(
        `/api/v1/vehicles/${vehicleId}/commands?command_type=MANUAL_CAN&limit=5`,
      ),
    refetchInterval: 15_000,
    enabled: isAdmin,
  })

  // Una query por slot; aplanamos todos los botones en una única rejilla.
  const buttonQueries = useQueries({
    queries: slots.map(s => ({
      queryKey: ['can-buttons', s.id],
      queryFn: () =>
        apiClient.get<CanButton[]>(`/api/v1/vehicles/${vehicleId}/can-slots/${s.id}/buttons`),
      refetchInterval: 30_000,
      enabled: !!s.id,
    })),
  })

  // Orden global: primero por orden del slot en la plantilla, luego por sort_order.
  const slotOrder = new Map(slots.map((s, i) => [s.id, i]))
  const buttons = buttonQueries
    .flatMap(q => q.data ?? [])
    .filter(b => b.active)
    .sort(
      (a, b) =>
        (slotOrder.get(a.slot_id) ?? 0) - (slotOrder.get(b.slot_id) ?? 0) ||
        a.sort_order - b.sort_order,
    )

  // Query ligera de comandos recientes: activa solo si hay algún botón encolado.
  const hasQueued = Object.values(queuedBtns).some(s => s === 'queued')
  const { data: recent = [] } = useQuery<CommandLogEntry[]>({
    queryKey: ['manual-can-recent', vehicleId],
    queryFn: () =>
      apiClient.get<CommandLogEntry[]>(
        `/api/v1/vehicles/${vehicleId}/commands?command_type=MANUAL_CAN&limit=10`,
      ),
    refetchInterval: hasQueued ? 8_000 : false,
    enabled: hasQueued,
  })

  // Para cada botón encolado, busca en `recent` el log con el id exacto devuelto por
  // el backend al encolar. Empareja por log_id (no por timestamp) para evitar falsos
  // positivos/negativos al comparar relojes de navegador y servidor.
  useEffect(() => {
    if (!recent.length || !hasQueued) return
    setQueuedBtns(prev => {
      const next: Record<string, 'queued' | 'sent'> = { ...prev }
      let changed = false
      for (const [btnId, st] of Object.entries(prev)) {
        if (st !== 'queued') continue
        const logId = queuedLogIds[btnId]
        if (!logId) continue
        const match = recent.find(r => r.id === logId && (r.status === 'confirmed' || r.status === 'failed'))
        if (!match) continue
        next[btnId] = 'sent'
        changed = true
        if (match.status === 'confirmed') {
          toast.success('Comando entregado al FMC')
        } else {
          toast.error('El FMC rechazó el comando encolado')
        }
      }
      return changed ? next : prev
    })
  }, [recent, hasQueued, queuedLogIds])

  // Auto-limpiar badges 'sent' a los 5 segundos; limpia también queuedLogIds para no acumular.
  useEffect(() => {
    const sent = Object.entries(queuedBtns).filter(([, s]) => s === 'sent').map(([id]) => id)
    if (!sent.length) return
    const t = setTimeout(() => {
      setQueuedBtns(q => {
        const next = { ...q }; sent.forEach(id => delete next[id]); return next
      })
      setQueuedLogIds(m => {
        const next = { ...m }; sent.forEach(id => delete next[id]); return next
      })
    }, 5_000)
    return () => clearTimeout(t)
  }, [queuedBtns])

  // Envía un valor concreto (o alterna si value=null) al backend.
  async function sendValue(btn: CanButton, value: boolean | null) {
    const optimisticNext = value === null ? !(optimistic[btn.id] ?? btn.current_bit) : value
    setOptimistic(o => ({ ...o, [btn.id]: optimisticNext }))
    setToggling(t => ({ ...t, [btn.id]: true }))
    try {
      const res = await apiClient.post<{ queued?: boolean; command_log_id?: string }>(
        `/api/v1/vehicles/${vehicleId}/can-slots/${btn.slot_id}/buttons/${btn.id}/toggle`,
        value === null ? {} : { value },
      )
      if (res?.queued) {
        setQueuedBtns(q => ({ ...q, [btn.id]: 'queued' }))
        if (res.command_log_id) setQueuedLogIds(m => ({ ...m, [btn.id]: res.command_log_id! }))
        toast.info('Comando encolado: se enviará cuando el FMC reconecte')
      }
      qc.invalidateQueries({ queryKey: ['can-buttons', btn.slot_id] })
    } catch (e) {
      qc.invalidateQueries({ queryKey: ['can-buttons', btn.slot_id] })
      toast.error(e instanceof Error ? e.message : 'Error al cambiar el botón')
    } finally {
      setToggling(t => ({ ...t, [btn.id]: false }))
    }
  }

  // Envía un pulso ON+OFF (reset de contador/horas) al backend.
  async function sendPulse(btn: CanButton) {
    setToggling(t => ({ ...t, [btn.id]: true }))
    try {
      const res = await apiClient.post<{ queued?: boolean; command_log_id?: string }>(
        `/api/v1/vehicles/${vehicleId}/can-slots/${btn.slot_id}/buttons/${btn.id}/toggle`,
        { pulse: true },
      )
      if (res?.queued) {
        setQueuedBtns(q => ({ ...q, [btn.id]: 'queued' }))
        if (res.command_log_id) setQueuedLogIds(m => ({ ...m, [btn.id]: res.command_log_id! }))
        toast.info('Comando encolado: se enviará cuando el FMC reconecte')
      } else {
        toast.success('Comando enviado al FMC')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al enviar el comando')
    } finally {
      setToggling(t => ({ ...t, [btn.id]: false }))
    }
  }

  function handleToggleClick(btn: CanButton) {
    if (toggling[btn.id]) return
    void sendValue(btn, null)
  }

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
      </button>

      {open && (
        <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {buttons.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{
                fontSize: 9, fontWeight: 700, color: 'var(--fg-muted)',
                letterSpacing: '0.07em', textTransform: 'uppercase',
              }}>Salidas CR2530</div>
              {/* Rejilla compacta unificada: chips pequeños de todas las salidas,
                  varios por fila, mismo lenguaje visual que las tarjetas de la página. */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(116px, 1fr))',
                gap: 6,
              }}>
                {buttons.map(btn => {
                  const on = optimistic[btn.id] ?? btn.current_bit
                  const loading = toggling[btn.id]
                  const isHold = btn.function === 'hold'
                  // Online envía ya; offline encola en backend. Solo bloqueamos toggles en vuelo.
                  const disabled = !!loading
                  const clickHandler = isHold
                    ? { onClick: () => setConfirmBtn(btn) }
                    : { onClick: () => handleToggleClick(btn) }
                  const btnText = loading
                    ? '…'
                    : isHold
                      ? 'Reset'
                      : (on ? 'Desactivar' : 'Activar')
                  return (
                    <div key={btn.id} style={{
                      background: on ? 'var(--ok-soft)' : 'var(--bg-card)',
                      border: `1px solid ${on ? 'var(--ok)' : 'var(--border)'}`,
                      borderRadius: 8, padding: '7px 8px',
                      display: 'flex', flexDirection: 'column', gap: 5,
                      transition: 'background 0.2s, border-color 0.2s',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                        <span style={{
                          fontSize: 11, fontWeight: 600, color: 'var(--fg-primary)',
                          fontFamily: 'var(--font-sans)', overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
                        }} title={btn.label}>
                          {btn.label}
                        </span>
                        <span style={{
                          fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)',
                          color: on ? 'var(--ok)' : 'var(--offline)', whiteSpace: 'nowrap',
                        }}>
                          {on ? '● ON' : '○ OFF'}
                        </span>
                      </div>
                      <button
                        data-testid={`btn-toggle-${btn.id}`}
                        disabled={disabled}
                        title={isHold ? 'Envía un pulso de reset (ON+OFF) al equipo' : undefined}
                        {...clickHandler}
                        style={{
                          background: on ? 'rgba(34,197,94,0.2)' : 'var(--bg-elevated)',
                          border: `1px solid ${on ? 'var(--ok)' : 'var(--border)'}`,
                          borderRadius: 6, padding: '4px 0', fontSize: 10, fontWeight: 600,
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          color: on ? 'var(--ok)' : 'var(--fg-tertiary)',
                          opacity: loading ? 0.6 : 1, width: '100%', fontFamily: 'var(--font-sans)',
                          transition: 'all 0.15s', userSelect: 'none',
                        }}
                      >
                        {btnText}
                      </button>
                      {/* Badge de estado de encolado/entrega */}
                      {queuedBtns[btn.id] === 'queued' && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--warn)' }}>⏳ Encolado</span>
                      )}
                      {queuedBtns[btn.id] === 'sent' && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--ok)' }}>✓ Enviado OK</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {isAdmin && history.length > 0 && (
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

      {/* Modal de confirmación para botones hold (reset de contador/horas) */}
      {confirmBtn && (
        <div onClick={() => setConfirmBtn(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
            padding: 18, maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ fontWeight: 700, color: 'var(--fg-primary)' }}>Confirmar envío</div>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
              Vas a enviar un dato al equipo «{confirmBtn.label}» (reset de contador/horas).
              Si el FMC está offline, se enviará al reconectar. ¿Confirmar?
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmBtn(null)} style={{
                padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'var(--bg-elevated)', color: 'var(--fg-muted)', cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={() => { const b = confirmBtn; setConfirmBtn(null); void sendPulse(b) }}
                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--cmg-teal)',
                background: 'var(--cmg-teal)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                Enviar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
