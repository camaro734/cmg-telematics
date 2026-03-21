'use client'
import { useEffect, useState } from 'react'

export interface ToastItem {
  id: string
  level: 'high' | 'low' | 'info' | 'success'
  title: string
  message: string
}

interface ToastProps {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}

export default function Toast({ toasts, onDismiss }: ToastProps) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => {
        const colors = {
          high: { bg: '#450a0a', border: '#991b1b', text: '#fca5a5', icon: '🔴' },
          low: { bg: '#431407', border: '#9a3412', text: '#fdba74', icon: '🟠' },
          info: { bg: '#0c1a2e', border: '#1e40af', text: '#93c5fd', icon: 'ℹ️' },
          success: { bg: '#052e16', border: '#166534', text: '#86efac', icon: '✅' },
        }[toast.level]

        return (
          <div
            key={toast.id}
            className="rounded-lg px-4 py-3 flex items-start gap-3 shadow-lg"
            style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
          >
            <span className="text-base mt-0.5 shrink-0">{colors.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: colors.text }}>{toast.title}</p>
              <p className="text-xs mt-0.5 opacity-80" style={{ color: colors.text }}>{toast.message}</p>
            </div>
            <button
              onClick={() => onDismiss(toast.id)}
              className="text-sm opacity-60 hover:opacity-100 ml-1 shrink-0"
              style={{ color: colors.text }}
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
