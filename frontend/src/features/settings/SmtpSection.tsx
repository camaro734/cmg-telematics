import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { toast } from '../../shared/ui/Toast'
import type { SmtpConfig, SmtpConfigUpdate } from '../../lib/types'
import { Input } from '../../shared/ui/Input'

const LBL: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)',
  letterSpacing: '0.05em', display: 'block', marginBottom: 5,
  fontFamily: 'var(--font-sans)',
}
const HELP: React.CSSProperties = {
  fontSize: 11, color: 'var(--fg-dim)', fontFamily: 'var(--font-sans)',
  marginTop: 4, lineHeight: 1.5,
}

export default function SmtpSection() {
  const qc = useQueryClient()
  const [showPwd, setShowPwd] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [draft, setDraft] = useState<SmtpConfigUpdate>({
    host: '', port: 587, user: '', password: '', from_addr: 'alertas@cmg.es', tls: true,
  })

  const { data: config } = useQuery({
    queryKey: keys.smtpConfig(),
    queryFn: () => apiClient.get<SmtpConfig>('/api/v1/settings/smtp'),
    staleTime: 60_000,
  })

  useEffect(() => {
    if (config) setDraft({ host: config.host, port: config.port, user: config.user, password: '', from_addr: config.from_addr, tls: config.tls })
  }, [config])

  const saveMutation = useMutation({
    mutationFn: () => apiClient.put<SmtpConfig>('/api/v1/settings/smtp', draft),
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.smtpConfig() }); toast.success('Configuración SMTP guardada') },
    onError: (err) => toast.error((err as Error).message),
  })

  const handleTest = async () => {
    if (!testEmail || !testEmail.includes('@')) return
    setIsTesting(true); setTestResult(null)
    try {
      await apiClient.put('/api/v1/settings/smtp', draft)
      const result = await apiClient.post<{ ok: boolean; error?: string }>('/api/v1/settings/smtp/test', { to: testEmail })
      setTestResult(result)
      if (result.ok) toast.success(`Email de prueba enviado a ${testEmail}`)
    } catch (err) {
      setTestResult({ ok: false, error: (err as Error).message })
    } finally {
      setIsTesting(false)
    }
  }

  const set = (k: keyof SmtpConfigUpdate) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft(p => ({ ...p, [k]: k === 'port' ? parseInt(e.target.value) || 587 : e.target.value }))

  return (
    <div style={{ marginBottom: 32, paddingBottom: 32, borderBottom: '1px solid var(--border)' }}>
      <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)', letterSpacing: '0.06em', marginBottom: 16, fontFamily: 'var(--font-sans)' }}>
        CORREO (SMTP)
      </p>
      <p style={{ fontSize: 13, color: 'var(--fg-tertiary)', marginBottom: 20, lineHeight: 1.5 }}>
        Configura el servidor de correo para el envío de alertas por email.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '12px 16px', marginBottom: 12 }}>
        <Input label="Servidor SMTP" value={draft.host} onChange={set('host')} placeholder="smtp.gmail.com" />
        <Input label="Puerto" type="number" value={draft.port} onChange={set('port')} min={1} max={65535} />
        <Input label="Usuario" value={draft.user} onChange={set('user')} placeholder="usuario@empresa.com" autoComplete="off" />
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={LBL}>
            CONTRASEÑA
            {config?.password_set && <span style={{ color: 'var(--ok)', fontWeight: 400, letterSpacing: 0 }}> · configurada</span>}
          </label>
          <Input
            type={showPwd ? 'text' : 'password'}
            value={draft.password}
            onChange={set('password')}
            placeholder={config?.password_set ? 'Dejar vacío para mantener la actual' : 'Contraseña SMTP'}
            autoComplete="new-password"
            suffix={
              <button type="button" onClick={() => setShowPwd(p => !p)}
                style={{ background: 'transparent', border: 'none', color: 'var(--fg-dim)', cursor: 'pointer', fontSize: 11 }}>
                {showPwd ? 'Ocultar' : 'Ver'}
              </button>
            }
          />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <Input
            label="Dirección remitente"
            value={draft.from_addr}
            onChange={set('from_addr')}
            placeholder="alertas@cmg.es"
            helperText="Esta dirección aparece como remitente en los emails de alerta."
          />
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 12, fontSize: 13, color: 'var(--fg-secondary)', fontFamily: 'var(--font-sans)' }}>
        <input type="checkbox" checked={draft.tls} onChange={e => setDraft(p => ({ ...p, tls: e.target.checked }))}
          style={{ accentColor: 'var(--cmg-teal)', width: 15, height: 15 }} />
        Activar STARTTLS (recomendado con puerto 587)
      </label>

      <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 20 }}>
        <p style={{ ...HELP, margin: 0 }}>
          <strong style={{ color: 'var(--fg-tertiary)' }}>Gmail:</strong> smtp.gmail.com · puerto 587 · usa una <em>contraseña de aplicación</em> (Cuenta Google &rarr; Seguridad &rarr; Contraseñas de aplicación).<br/>
          <strong style={{ color: 'var(--fg-tertiary)' }}>Outlook / Office 365:</strong> smtp.office365.com · puerto 587 · usuario = dirección de correo completa.<br/>
          <strong style={{ color: 'var(--fg-tertiary)' }}>OVH / cPanel:</strong> mail.tudominio.com · puerto 587.
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={LBL}>ENVIAR EMAIL DE PRUEBA</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)}
            placeholder="destino@empresa.com" style={{ flex: 1 }} />
          <button type="button" onClick={handleTest} disabled={isTesting || !testEmail}
            style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg-tertiary)', cursor: isTesting ? 'wait' : 'pointer', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' as const }}>
            {isTesting ? 'Enviando…' : 'Enviar prueba →'}
          </button>
        </div>
        {testResult && (
          <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, background: testResult.ok ? 'var(--ok-soft)' : 'var(--danger-soft)', border: `1px solid ${testResult.ok ? 'var(--ok)' : 'var(--danger)'}`, fontSize: 12, color: testResult.ok ? 'var(--ok)' : 'var(--danger)', fontFamily: 'var(--font-sans)' }}>
            {testResult.ok ? '✓ Email enviado correctamente' : `✗ ${testResult.error}`}
          </div>
        )}
        <p style={HELP}>Guarda la configuración y envía un email de prueba para verificar que funciona correctamente.</p>
      </div>

      <button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
        style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, background: 'var(--cmg-teal)', border: 'none', borderRadius: 6, color: '#fff', cursor: saveMutation.isPending ? 'wait' : 'pointer', fontFamily: 'var(--font-sans)' }}>
        {saveMutation.isPending ? 'Guardando…' : 'Guardar configuración SMTP'}
      </button>
    </div>
  )
}
