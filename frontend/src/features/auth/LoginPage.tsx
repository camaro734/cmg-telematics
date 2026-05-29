import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from './useAuthStore'
import { apiClient } from '../../lib/apiClient'
import type { BrandTokens } from '../../lib/types'
import { CmgLogoFull } from '../../shared/ui/CmgLogo'

const LOGO_URL = '/static/logos/cmgtrack.png'

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, applyBrandTokens, user } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [logoOk, setLogoOk] = useState(true)

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true })
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
      navigate('/dashboard', { replace: true })
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
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
    }}>
      {/* Logo sobre la tarjeta */}
      <div style={{ marginBottom: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        {logoOk
          ? (
            <img
              src={LOGO_URL}
              alt="CMG Track"
              onError={() => setLogoOk(false)}
              style={{
                width: 'clamp(180px, 40vw, 260px)',
                height: 'auto',
                objectFit: 'contain',
                display: 'block',
              }}
            />
          )
          : <CmgLogoFull />
        }
        <span style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 11,
          color: 'var(--offline)',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
        }}>
          Plataforma de telemetría
        </span>
      </div>

      <div style={{
        background: 'var(--bg-surface)',
        borderRadius: 12,
        padding: 'clamp(24px, 5vw, 36px) clamp(20px, 5vw, 32px)',
        width: 'min(380px, calc(100vw - 32px))',
        border: '1px solid var(--border)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
      }}>
        <p style={{ color: 'var(--fg-muted)', marginBottom: 24, fontSize: 13, textAlign: 'center' }}>
          Inicia sesión para continuar
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="email" style={{ fontSize: 12, color: 'var(--fg-dim)', fontWeight: 500 }}>
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
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '8px 12px',
                color: 'var(--fg-primary)',
                outline: 'none',
                fontSize: 14,
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="password" style={{ fontSize: 12, color: 'var(--fg-dim)', fontWeight: 500 }}>
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
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '8px 12px',
                color: 'var(--fg-primary)',
                outline: 'none',
                fontSize: 14,
              }}
            />
          </div>

          {error && (
            <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: -4 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              background: loading ? 'var(--offline)' : 'var(--cmg-teal)',
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

        <p style={{ marginTop: 24, fontSize: 12, color: 'var(--fg-muted)', textAlign: 'center' }}>
          ¿Olvidaste tu contraseña? Contacta con tu administrador.
        </p>
      </div>
    </div>
  )
}
