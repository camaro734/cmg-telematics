import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuthStore } from './useAuthStore'
import { apiClient } from '../../lib/apiClient'
import type { BrandTokens } from '../../lib/types'
import { CmgLogoFull } from '../../shared/ui/CmgLogo'
import { Input } from '../../shared/ui/Input'

const DEFAULT_LOGO = '/static/logos/cmgtrack.png'

export default function LoginPage() {
  const navigate = useNavigate()
  const { slug } = useParams<{ slug?: string }>()
  const { login, applyBrandTokens, user } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [logoSrc, setLogoSrc] = useState<string>(() => {
    try { return localStorage.getItem('cmg_brand_logo') ?? DEFAULT_LOGO } catch { return DEFAULT_LOGO }
  })
  const [logoOk, setLogoOk] = useState(true)
  const [brandColor, setBrandColor] = useState<string | null>(null)

  useEffect(() => {
    if (user) navigate('/fleet', { replace: true })
  }, [user, navigate])

  useEffect(() => {
    if (!slug) return
    apiClient.get<{ brand_name?: string; logo_url?: string; brand_color?: string }>(
      `/api/v1/public/brand/${encodeURIComponent(slug)}`
    ).then(brand => {
      applyBrandTokens(brand)
      if (brand.logo_url) setLogoSrc(brand.logo_url)
      if (brand.brand_color) setBrandColor(brand.brand_color)
    }).catch(() => { /* slug desconocido — mostrar branding CMG por defecto */ })
  }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

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
          if (tokens.logo_url) setLogoSrc(tokens.logo_url)
        } catch {
          // brand tokens opcionales — ignorar
        }
      }
      navigate('/fleet', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión')
    } finally {
      setLoading(false)
    }
  }

  const isClientLogo = logoSrc.startsWith('/uploads/')
  const accentColor = brandColor ?? 'var(--cmg-teal)'

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

      {/* CMG default login: logo flotante encima de la tarjeta */}
      {!slug && (
        <div style={{ marginBottom: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          {logoOk
            ? <img
                src={logoSrc}
                alt="CMG Track"
                onError={() => setLogoOk(false)}
                style={{ width: 'clamp(180px, 40vw, 260px)', height: 'auto', objectFit: 'contain', display: 'block' }}
              />
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
      )}

      {/* Tarjeta de login */}
      <div style={{
        background: 'var(--bg-surface)',
        borderRadius: 12,
        width: 'min(400px, calc(100vw - 32px))',
        border: '1px solid var(--border)',
        boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
        overflow: 'hidden',
      }}>

        {/* Cabecera de marca (solo en login personalizado /:slug/login) */}
        {slug && (
          <div style={{
            position: 'relative',
            padding: '32px 32px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0,
            background: brandColor
              ? `linear-gradient(160deg, ${brandColor}22 0%, ${brandColor}10 100%)`
              : 'var(--bg-elevated)',
            borderBottom: `1px solid ${brandColor ? brandColor + '2a' : 'var(--border)'}`,
          }}>
            {/* Franja de color superior */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 4,
              background: accentColor,
              borderRadius: '12px 12px 0 0',
            }} />

            {/* Badge de logo */}
            {logoOk && isClientLogo && (
              <div style={{
                background: '#ffffff',
                borderRadius: 10,
                padding: '14px 28px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.25), 0 1px 4px rgba(0,0,0,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <img
                  src={logoSrc}
                  alt="Logo"
                  onError={() => setLogoOk(false)}
                  style={{
                    maxWidth: 'clamp(120px, 28vw, 190px)',
                    maxHeight: 58,
                    objectFit: 'contain',
                    display: 'block',
                  }}
                />
              </div>
            )}
            {/* Fallback si el logo falla */}
            {(!logoOk || !isClientLogo) && slug && (
              <div style={{
                width: 56, height: 56, borderRadius: 14,
                background: accentColor,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 24, fontWeight: 800, color: '#fff',
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
              }}>
                {slug[0]?.toUpperCase()}
              </div>
            )}
          </div>
        )}

        {/* Cuerpo del formulario */}
        <div style={{
          padding: 'clamp(24px, 5vw, 32px) clamp(20px, 5vw, 32px)',
        }}>
          <p style={{ color: 'var(--fg-muted)', marginBottom: 24, fontSize: 13, textAlign: 'center' }}>
            Inicia sesión para continuar
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Input
              id="email"
              label="Email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
            />

            <Input
              id="password"
              label="Contraseña"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />

            {error && (
              <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: -4 }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                background: loading ? 'var(--offline)' : accentColor,
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
            <Link to="/forgot-password" style={{ color: accentColor }}>¿Olvidaste tu contraseña?</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
