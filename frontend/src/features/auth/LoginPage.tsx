import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from './useAuthStore'
import { apiClient } from '../../lib/apiClient'
import type { BrandTokens } from '../../lib/types'

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, applyBrandTokens, user } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user) navigate('/fleet', { replace: true })
  }, [user, navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)
    try {
      await login(email, password)
      const store = useAuthStore.getState()
      if (store.user) {
        try {
          const tokens = await apiClient.get<BrandTokens>(
            `/api/v1/tenants/${store.user.tenant_id}/brand-tokens`
          )
          applyBrandTokens(tokens)
        } catch {
          // brand tokens are optional — ignore failures
        }
      }
      navigate('/fleet', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-base)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        borderRadius: 12,
        padding: '40px 36px',
        width: 360,
        border: '1px solid var(--bg-border)',
      }}>
        {/* Logo mark */}
        <div style={{
          width: 48, height: 48,
          background: 'var(--accent-energy)',
          borderRadius: 8,
          marginBottom: 24,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-data)',
          fontWeight: 700, fontSize: 20,
          color: '#fff',
        }}>C</div>

        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>CMG Telematics</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 32, fontSize: 13 }}>
          Inicia sesión para continuar
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="email" style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 500 }}>
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--bg-border)',
                borderRadius: 6,
                padding: '8px 12px',
                color: 'var(--text-primary)',
                outline: 'none',
                fontSize: 14,
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="password" style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 500 }}>
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--bg-border)',
                borderRadius: 6,
                padding: '8px 12px',
                color: 'var(--text-primary)',
                outline: 'none',
                fontSize: 14,
              }}
            />
          </div>

          {error && (
            <p style={{ color: 'var(--accent-crit)', fontSize: 13, marginTop: -4 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              background: loading ? 'var(--accent-off)' : 'var(--accent-energy)',
              color: '#fff',
              borderRadius: 6,
              padding: '10px 0',
              fontWeight: 600,
              fontSize: 14,
              marginTop: 8,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
              border: 'none',
            }}
          >
            {loading ? 'Accediendo…' : 'Iniciar sesión'}
          </button>
        </form>

        <p style={{ marginTop: 24, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          ¿Olvidaste tu contraseña? Contacta con tu administrador.
        </p>
      </div>
    </div>
  )
}
