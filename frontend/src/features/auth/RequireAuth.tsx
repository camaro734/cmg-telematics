import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from './useAuthStore'

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { accessToken, refresh } = useAuthStore()
  const [checking, setChecking] = useState(!accessToken)

  useEffect(() => {
    let cancelled = false
    if (!accessToken) {
      refresh().finally(() => { if (!cancelled) setChecking(false) })
    }
    return () => { cancelled = true }
  }, [accessToken, refresh])

  if (checking) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-base)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
      }}>
        Cargando…
      </div>
    )
  }

  if (!accessToken) return <Navigate to="/login" replace />
  return <>{children}</>
}
