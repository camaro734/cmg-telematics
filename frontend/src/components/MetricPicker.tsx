import { useState } from 'react'
import type { HistoricMetricItem } from '../lib/types'

interface Props {
  allMetrics: HistoricMetricItem[]
  savedKeys: string[] | undefined
  onSave: (keys: string[] | null) => void
  onClose: () => void
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1000,
  background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const modal: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: '20px 22px', width: 360, maxWidth: '94vw',
  maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 12,
}

const rowBase: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '6px 4px', borderRadius: 6,
}

const arrowBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--fg-muted)', fontSize: 12, padding: '2px 4px',
  lineHeight: 1, borderRadius: 4,
}

const dot = (color: string): React.CSSProperties => ({
  width: 8, height: 8, borderRadius: '50%',
  background: color || 'var(--cmg-teal)', flexShrink: 0,
})

const btnGhost: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, fontWeight: 500,
  border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
  background: 'transparent', color: 'var(--fg-muted)',
}

const btnPrimary: React.CSSProperties = {
  padding: '6px 16px', fontSize: 12, fontWeight: 600,
  border: 'none', borderRadius: 6, cursor: 'pointer',
  background: 'var(--cmg-teal)', color: '#fff',
}

export function MetricPicker({ allMetrics, savedKeys, onSave, onClose }: Props) {
  const [selected, setSelected] = useState<string[]>(
    () => savedKeys ?? allMetrics.map(m => m.key),
  )

  const toggle = (key: string) =>
    setSelected(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
    )

  const moveUp = (key: string) =>
    setSelected(prev => {
      const i = prev.indexOf(key)
      if (i <= 0) return prev
      const next = [...prev]
      ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
      return next
    })

  const moveDown = (key: string) =>
    setSelected(prev => {
      const i = prev.indexOf(key)
      if (i < 0 || i >= prev.length - 1) return prev
      const next = [...prev]
      ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
      return next
    })

  const selectedMetrics = selected
    .map(k => allMetrics.find(m => m.key === k))
    .filter((m): m is HistoricMetricItem => m !== undefined)

  const unselectedMetrics = allMetrics.filter(m => !selected.includes(m.key))

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>

        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-primary)' }}>
          Personalizar métricas
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: -6 }}>
          Activa, oculta y ordena las métricas a tu gusto.
        </div>

        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>

          {selectedMetrics.map((metric, i) => (
            <div key={metric.key} style={{ ...rowBase, background: 'var(--bg-surface)' }}>
              <input
                type="checkbox"
                checked
                onChange={() => toggle(metric.key)}
                style={{ accentColor: 'var(--cmg-teal)', cursor: 'pointer' }}
              />
              <span style={dot(metric.color)} />
              <span style={{ fontSize: 13, color: 'var(--fg-primary)', flex: 1 }}>
                {metric.label}
                {metric.unit ? <span style={{ color: 'var(--fg-muted)', marginLeft: 4, fontSize: 11 }}>{metric.unit}</span> : null}
              </span>
              <button style={arrowBtn} onClick={() => moveUp(metric.key)} disabled={i === 0} title="Subir">▲</button>
              <button style={arrowBtn} onClick={() => moveDown(metric.key)} disabled={i === selectedMetrics.length - 1} title="Bajar">▼</button>
            </div>
          ))}

          {unselectedMetrics.length > 0 && selectedMetrics.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
          )}

          {unselectedMetrics.map(metric => (
            <div key={metric.key} style={{ ...rowBase, opacity: 0.5 }}>
              <input
                type="checkbox"
                checked={false}
                onChange={() => toggle(metric.key)}
                style={{ cursor: 'pointer' }}
              />
              <span style={dot(metric.color)} />
              <span style={{ fontSize: 13, color: 'var(--fg-muted)', flex: 1 }}>
                {metric.label}
                {metric.unit ? <span style={{ marginLeft: 4, fontSize: 11 }}>{metric.unit}</span> : null}
              </span>
            </div>
          ))}

        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 12, gap: 8 }}>
          <button style={{ ...btnGhost, fontSize: 11 }} onClick={() => onSave(null)}>
            Restablecer
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={btnGhost} onClick={onClose}>Cancelar</button>
            <button style={btnPrimary} onClick={() => onSave(selected)}>Guardar</button>
          </div>
        </div>

      </div>
    </div>
  )
}
