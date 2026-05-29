import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from './useAuthStore'
import { wsClient } from '../../lib/wsClient'

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { accessToken, refresh } = useAuthStore()
  const queryClient = useQueryClient()
  const [checking, setChecking] = useState(!accessToken)

  useEffect(() => {
    let mounted = true
    if (!accessToken) {
      refresh().finally(() => { if (mounted) setChecking(false) })
    } else {
      setChecking(false)
    }
    return () => { mounted = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (accessToken && !checking) {
      wsClient.connect(accessToken, queryClient)
    }
    return () => { wsClient.disconnect() }
  }, [accessToken, checking, queryClient])

  if (checking) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-base)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--fg-muted)',
      }}>
        Cargando…
      </div>
    )
  }

  if (!accessToken) return <Navigate to="/login" replace />
  return <>{children}</>
}
