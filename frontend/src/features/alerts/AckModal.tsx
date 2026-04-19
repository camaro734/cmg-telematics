import type { CSSProperties } from 'react'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { AlertInstanceOut } from '../../lib/types'

const OVERLAY: CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 200,
}

const MODAL: CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--bg-border)',
  borderRadius: 10,
  padding: 28,
  width: 420,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
}

const BTN_BASE: CSSProperties = {
  padding: '6px 16px', fontSize: 13,
  fontFamily: 'var(--font-ui)',
  borderRadius: 6, cursor: 'pointer',
}

interface AckModalProps {
  alert: AlertInstanceOut
  ruleName: string
  vehicleName: string
  onClose: () => void
  onSuccess: () => void
}

export default function AckModal({ alert, ruleName, vehicleName, onClose, onSuccess }: AckModalProps) {
  const [note, setNote] = useState('')
  const queryClient = useQueryClient()

  const { mutate, isPending, error } = useMutation({
    mutationFn: () =>
      apiClient.post<AlertInstanceOut>(
        `/api/v1/alerts/${alert.id}/acknowledge`,
        { note: note.trim() || null },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.alerts() })
      onSuccess()
    },
  })

  return (
    <div style={OVERLAY} onClick={onClose} role="dialog" aria-modal="true" aria-label="Reconocer alerta">
      <div style={MODAL} onClick={e => e.stopPropagation()}>
        <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
          Reconocer alerta
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          <span style={{ color: 'var(--accent-energy)' }}>{ruleName}</span>{' — '}{vehicleName}
        </div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Nota (opcional)"
          rows={3}
          style={{
            background: 'var(--bg-base)',
            border: '1px solid var(--bg-border)',
            borderRadius: 6,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-ui)',
            fontSize: 13,
            padding: '8px 10px',
            resize: 'vertical',
            width: '100%',
            boxSizing: 'border-box',
          }}
        />
        {error && (
          <div style={{ fontSize: 12, color: 'var(--accent-crit)' }}>
            {(error as Error).message}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={isPending}
            style={{ ...BTN_BASE, background: 'transparent', border: '1px solid var(--bg-border)', color: 'var(--text-muted)' }}
          >
            Cancelar
          </button>
          <button
            onClick={() => mutate()}
            disabled={isPending}
            style={{ ...BTN_BASE, background: 'var(--accent-energy)', border: 'none', color: 'var(--bg-base)', cursor: isPending ? 'wait' : 'pointer' }}
          >
            {isPending ? 'Enviando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
