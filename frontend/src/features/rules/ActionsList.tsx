import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { ActionDef } from '../../lib/types'

const INPUT: CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)',
  fontSize: 13, padding: '6px 8px', flex: 1,
}
const BTN: CSSProperties = {
  padding: '4px 10px', fontSize: 12, fontFamily: 'var(--font-sans)',
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--fg-muted)', cursor: 'pointer',
}

interface Props {
  value: ActionDef[]
  onChange: (actions: ActionDef[]) => void
}

export default function ActionsList({ value, onChange }: Props) {
  const [emailDraft, setEmailDraft] = useState('')

  const hasInApp = value.some(a => a.type === 'in_app')
  const emailAction = value.find(a => a.type === 'email')
  const webhookAction = value.find(a => a.type === 'webhook')

  const setInApp = (checked: boolean) => {
    const filtered = value.filter(a => a.type !== 'in_app')
    onChange(checked ? [...filtered, { type: 'in_app' }] : filtered)
  }

  const addEmail = () => {
    const trimmed = emailDraft.trim()
    if (!trimmed || !trimmed.includes('@')) return
    const existing = emailAction?.recipients ?? []
    if (existing.includes(trimmed)) return
    const newRecipients = [...existing, trimmed]
    const filtered = value.filter(a => a.type !== 'email')
    onChange([...filtered, { type: 'email', recipients: newRecipients }])
    setEmailDraft('')
  }

  const removeEmail = (addr: string) => {
    const newRecipients = (emailAction?.recipients ?? []).filter(r => r !== addr)
    const filtered = value.filter(a => a.type !== 'email')
    onChange(newRecipients.length ? [...filtered, { type: 'email', recipients: newRecipients }] : filtered)
  }

  const setWebhook = (url: string) => {
    const filtered = value.filter(a => a.type !== 'webhook')
    onChange(url ? [...filtered, { type: 'webhook', url, method: 'POST' }] : filtered)
  }

  const LABEL_STYLE: CSSProperties = { fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-primary)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <label style={LABEL_STYLE}>
        <input type="checkbox" checked={hasInApp} onChange={e => setInApp(e.target.checked)} style={{ accentColor: 'var(--cmg-teal)' }} />
        Notificación in-app (siempre recomendado)
      </label>

      <div>
        <label style={LABEL_STYLE}>
          <input
            type="checkbox"
            checked={!!emailAction}
            onChange={e => {
              if (e.target.checked) {
                onChange([...value.filter(a => a.type !== 'email'), { type: 'email', recipients: [] }])
              } else {
                onChange(value.filter(a => a.type !== 'email'))
              }
            }}
            style={{ accentColor: 'var(--cmg-teal)' }}
          />
          Email
        </label>
        {emailAction && (
          <div style={{ marginTop: 8, paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {emailAction.recipients?.map(addr => (
              <div key={addr} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-muted)', flex: 1 }}>{addr}</span>
                <button type="button" onClick={() => removeEmail(addr)} style={{ ...BTN, color: 'var(--danger)' }}>✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="email"
                value={emailDraft}
                onChange={e => setEmailDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmail() } }}
                placeholder="destinatario@empresa.com"
                style={INPUT}
              />
              <button type="button" onClick={addEmail} style={BTN}>+</button>
            </div>
          </div>
        )}
      </div>

      <div>
        <label style={LABEL_STYLE}>
          <input type="checkbox" checked={!!webhookAction} onChange={e => { if (!e.target.checked) setWebhook('') }} style={{ accentColor: 'var(--cmg-teal)' }} />
          Webhook
        </label>
        {webhookAction && (
          <div style={{ marginTop: 8, paddingLeft: 24 }}>
            <input
              type="url"
              value={webhookAction.url ?? ''}
              onChange={e => setWebhook(e.target.value)}
              placeholder="https://erp.empresa.com/api/alerts"
              style={{ ...INPUT, width: '100%', boxSizing: 'border-box' as const }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
