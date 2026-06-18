import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiClient } from '../../lib/apiClient'
import { Input } from '../../shared/ui/Input'
import { useToast } from '../../shared/ui/Toast'

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { success } = useToast()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)
    if (password.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return }
    if (password !== repeat) { setError('Las contraseñas no coinciden.'); return }
    setLoading(true)
    try {
      await apiClient.post('/api/v1/auth/reset-password', { token, new_password: password })
      success('Contraseña actualizada. Inicia sesión.')
      navigate('/login', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo restablecer la contraseña.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: 'clamp(24px, 5vw, 36px) clamp(20px, 5vw, 32px)', width: 'min(380px, calc(100vw - 32px))', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.35)' }}>
        <h1 style={{ color: 'var(--fg-primary)', fontSize: 18, marginBottom: 16, textAlign: 'center' }}>Nueva contraseña</h1>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Input id="password" label="Nueva contraseña" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoFocus autoComplete="new-password" />
          <Input id="repeat" label="Repetir contraseña" type="password" value={repeat} onChange={e => setRepeat(e.target.value)} required autoComplete="new-password" />
          {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: -4 }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ background: loading ? 'var(--offline)' : 'var(--cmg-teal)', color: '#fff', borderRadius: 6, padding: '10px 0', fontWeight: 600, fontSize: 14, marginTop: 8, cursor: loading ? 'not-allowed' : 'pointer', border: 'none' }}>
            {loading ? 'Guardando…' : 'Guardar contraseña'}
          </button>
        </form>
      </div>
    </div>
  )
}
