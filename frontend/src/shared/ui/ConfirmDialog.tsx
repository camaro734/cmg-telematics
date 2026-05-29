import { useEffect } from 'react'
import { create } from 'zustand'

type ConfirmKind = 'danger' | 'warning' | 'info'

interface ConfirmRequest {
  message: string
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  kind?: ConfirmKind
  resolve: (ok: boolean) => void
}

interface ConfirmStore {
  request: ConfirmRequest | null
  ask: (req: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>
  answer: (ok: boolean) => void
}

const useConfirmStore = create<ConfirmStore>((set, get) => ({
  request: null,
  ask(req) {
    return new Promise<boolean>(resolve => {
      set({ request: { ...req, resolve } })
    })
  },
  answer(ok) {
    const req = get().request
    if (req) req.resolve(ok)
    set({ request: null })
  },
}))

export function useConfirm() {
  const ask = useConfirmStore(s => s.ask)
  return ask
}

const KIND_COLORS: Record<ConfirmKind, string> = {
  danger: 'var(--danger)',
  warning: 'var(--warn)',
  info: 'var(--info)',
}

export function ConfirmDialogHost() {
  const request = useConfirmStore(s => s.request)
  const answer = useConfirmStore(s => s.answer)

  useEffect(() => {
    if (!request) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answer(false)
      if (e.key === 'Enter') answer(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, answer])

  if (!request) return null

  const accent = KIND_COLORS[request.kind ?? 'danger']

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cmg-confirm-title"
      onClick={() => answer(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'cmg-fade-in 0.12s ease-out',
      }}
    >
      <style>{`@keyframes cmg-fade-in { from { opacity: 0 } to { opacity: 1 } }`}</style>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          minWidth: 320, maxWidth: 420,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderTop: `3px solid ${accent}`,
          borderRadius: 10,
          padding: 20,
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          fontFamily: 'var(--font-sans)',
          color: 'var(--fg-primary, #E7E5E4)',
        }}
      >
        {request.title && (
          <h3 id="cmg-confirm-title" style={{ margin: '0 0 8px 0', fontSize: 15, fontWeight: 700 }}>
            {request.title}
          </h3>
        )}
        <p style={{ margin: '0 0 18px 0', fontSize: 13, lineHeight: 1.5, color: 'var(--fg-muted)' }}>
          {request.message}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={() => answer(false)}
            style={{
              background: 'transparent', color: 'var(--fg-primary, #E7E5E4)',
              border: '1px solid var(--border)', borderRadius: 6,
              padding: '7px 14px', fontSize: 13, cursor: 'pointer',
            }}
          >
            {request.cancelLabel ?? 'Cancelar'}
          </button>
          <button
            onClick={() => answer(true)}
            autoFocus
            style={{
              background: accent, color: '#fff', border: 'none',
              borderRadius: 6, padding: '7px 14px', fontSize: 13,
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            {request.confirmLabel ?? 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
