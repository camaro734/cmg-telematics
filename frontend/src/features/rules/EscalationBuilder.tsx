import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { EscalationStep } from '../../lib/types'
import { Input } from '../../shared/ui/Input'

const INPUT: CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)',
  fontSize: 13, padding: '6px 8px',
}

interface Props {
  value: EscalationStep[]
  onChange: (steps: EscalationStep[]) => void
}

export default function EscalationBuilder({ value, onChange }: Props) {
  const [drafts, setDrafts] = useState<string[]>(value.map(() => ''))

  const addStep = () => {
    const lastDelay = value[value.length - 1]?.delay_minutes ?? 0
    onChange([...value, { delay_minutes: lastDelay + 30, actions: [] }])
    setDrafts(prev => [...prev, ''])
  }

  const removeStep = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i))
    setDrafts(prev => prev.filter((_, idx) => idx !== i))
  }

  const updateDelay = (i: number, minutes: number) => {
    onChange(value.map((s, idx) => idx === i ? { ...s, delay_minutes: minutes } : s))
  }

  const addEmailToStep = (i: number, addr: string) => {
    if (!addr.trim() || !addr.includes('@')) return
    const step = value[i]
    const existing = step.actions.find(a => a.type === 'email')
    const filtered = step.actions.filter(a => a.type !== 'email')
    const newRecipients = [...(existing?.recipients ?? []), addr.trim()]
    onChange(value.map((s, idx) => idx === i ? { ...s, actions: [...filtered, { type: 'email', recipients: newRecipients }] } : s))
    setDrafts(prev => prev.map((d, idx) => idx === i ? '' : d))
  }

  const removeEmailFromStep = (stepIdx: number, addr: string) => {
    const step = value[stepIdx]
    const existing = step.actions.find(a => a.type === 'email')
    const newRecipients = (existing?.recipients ?? []).filter(r => r !== addr)
    const filtered = step.actions.filter(a => a.type !== 'email')
    onChange(value.map((s, idx) => idx === stepIdx
      ? { ...s, actions: newRecipients.length ? [...filtered, { type: 'email', recipients: newRecipients }] : filtered }
      : s
    ))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {value.map((step, i) => {
        const emailAction = step.actions.find(a => a.type === 'email')
        return (
          <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 12, border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-muted)' }}>Si no reconocida en</span>
              <Input
                type="number"
                value={step.delay_minutes}
                onChange={e => updateDelay(i, parseInt(e.target.value) || 1)}
                style={{ width: 70 }}
                min={1}
              />
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-muted)' }}>minutos, enviar email a:</span>
              <button type="button" onClick={() => removeStep(i)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 13 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 8 }}>
              {emailAction?.recipients?.map(addr => (
                <div key={addr} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-muted)', flex: 1 }}>{addr}</span>
                  <button type="button" onClick={() => removeEmailFromStep(i, addr)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12 }}>✕</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  type="email"
                  value={drafts[i] ?? ''}
                  onChange={e => setDrafts(prev => prev.map((d, idx) => idx === i ? e.target.value : d))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmailToStep(i, drafts[i] ?? '') } }}
                  placeholder="supervisor@empresa.com"
                  style={{ flex: 1 }}
                />
                <button type="button" onClick={() => addEmailToStep(i, drafts[i] ?? '')} style={{ ...INPUT, cursor: 'pointer' }}>+</button>
              </div>
            </div>
          </div>
        )
      })}
      <button
        type="button"
        onClick={addStep}
        style={{ alignSelf: 'flex-start', padding: '6px 14px', fontSize: 12, fontFamily: 'var(--font-sans)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg-muted)', cursor: 'pointer' }}
      >+ Añadir escalón</button>
    </div>
  )
}
