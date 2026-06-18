import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../lib/apiClient'
import { Input } from '../../shared/ui/Input'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    try {
      await apiClient.post('/api/v1/auth/forgot-password', { email })
    } catch {
      // Respuesta genérica: no revelamos errores al usuario
    } finally {
      setSent(true)
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: 'clamp(24px, 5vw, 36px) clamp(20px, 5vw, 32px)', width: 'min(380px, calc(100vw - 32px))', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.35)' }}>
        <h1 style={{ color: 'var(--fg-primary)', fontSize: 18, marginBottom: 8, textAlign: 'center' }}>Recuperar contraseña</h1>
        {sent ? (
          <p style={{ color: 'var(--fg-muted)', fontSize: 13, textAlign: 'center', marginTop: 16 }}>
            Si el correo está registrado, recibirás un enlace para restablecer la contraseña.
          </p>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ color: 'var(--fg-muted)', fontSize: 13, textAlign: 'center', marginBottom: 8 }}>
              Introduce tu correo y te enviaremos un enlace.
            </p>
            <Input id="email" label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus autoComplete="email" />
            <button type="submit" disabled={loading} style={{ background: loading ? 'var(--offline)' : 'var(--cmg-teal)', color: '#fff', borderRadius: 6, padding: '10px 0', fontWeight: 600, fontSize: 14, marginTop: 8, cursor: loading ? 'not-allowed' : 'pointer', border: 'none' }}>
              {loading ? 'Enviando…' : 'Enviar enlace'}
            </button>
          </form>
        )}
        <p style={{ marginTop: 24, fontSize: 12, textAlign: 'center' }}>
          <Link to="/login" style={{ color: 'var(--cmg-teal)' }}>Volver a iniciar sesión</Link>
        </p>
      </div>
    </div>
  )
}
