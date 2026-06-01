import { useEffect, useRef } from 'react'
import { create } from 'zustand'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ToastKind = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

interface ToastStore {
  toasts: ToastItem[]
  add: (message: string, kind?: ToastKind) => void
  remove: (id: number) => void
}

let _nextId = 0

// ── Store ─────────────────────────────────────────────────────────────────────

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add(message, kind = 'info') {
    const id = ++_nextId
    set(s => ({ toasts: [...s.toasts, { id, message, kind }] }))
  },
  remove(id) {
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
  },
}))

// ── Public hook ───────────────────────────────────────────────────────────────

export function useToast() {
  const add = useToastStore(s => s.add)
  return {
    success: (msg: string) => add(msg, 'success'),
    error:   (msg: string) => add(msg, 'error'),
    warning: (msg: string) => add(msg, 'warning'),
    info:    (msg: string) => add(msg, 'info'),
  }
}

// ── Imperative API (for use outside React components) ────────────────────────

export const toast = {
  success: (msg: string) => useToastStore.getState().add(msg, 'success'),
  error:   (msg: string) => useToastStore.getState().add(msg, 'error'),
  warning: (msg: string) => useToastStore.getState().add(msg, 'warning'),
  info:    (msg: string) => useToastStore.getState().add(msg, 'info'),
}

// ── Single toast item ─────────────────────────────────────────────────────────

const KIND_STYLE: Record<ToastKind, { border: string; icon: string }> = {
  success: { border: 'var(--ok)',     icon: '✓' },
  error:   { border: 'var(--danger)', icon: '✕' },
  warning: { border: 'var(--warn)',   icon: '!' },
  info:    { border: 'var(--info)',   icon: 'i' },
}

const AUTO_CLOSE_MS = 4000

function ToastItem({ toast }: { toast: ToastItem }) {
  const remove = useToastStore(s => s.remove)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    timerRef.current = setTimeout(() => remove(toast.id), AUTO_CLOSE_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [toast.id, remove])

  const { border, icon } = KIND_STYLE[toast.kind]

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${border}`,
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        color: 'var(--fg-primary)',
        maxWidth: 360,
        animation: 'cmg-toast-in 0.18s ease-out',
      }}
    >
      {/* Icon dot */}
      <span style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: border,
        color: '#fff',
        fontSize: 10,
        fontWeight: 700,
        flexShrink: 0,
      }}>
        {icon}
      </span>

      <span style={{ flex: 1 }}>{toast.message}</span>

      <button
        onClick={() => remove(toast.id)}
        aria-label="Cerrar"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--fg-muted)',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
          padding: '0 2px',
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  )
}

// ── Container rendered once at app root ──────────────────────────────────────

export function ToastContainer() {
  const toasts = useToastStore(s => s.toasts)

  if (toasts.length === 0) return null

  return (
    <>
      <style>{`
        @keyframes cmg-toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div
        aria-label="Notificaciones"
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: 'auto' }}>
            <ToastItem toast={t} />
          </div>
        ))}
      </div>
    </>
  )
}
