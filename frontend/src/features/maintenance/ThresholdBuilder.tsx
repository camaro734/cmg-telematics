import type { MaintenanceThreshold } from '../../lib/types'

const TYPE_OPTIONS = [
  { value: 'pto_hours', label: 'Horas PTO' },
  { value: 'engine_hours', label: 'Horas motor' },
  { value: 'calendar_days', label: 'Días calendario' },
] as const

const TYPE_UNIT: Record<string, string> = {
  pto_hours: 'horas',
  engine_hours: 'horas',
  calendar_days: 'días',
}

interface Props {
  thresholds: MaintenanceThreshold[]
  onChange: (thresholds: MaintenanceThreshold[]) => void
}

export default function ThresholdBuilder({ thresholds, onChange }: Props) {
  function add() {
    onChange([...thresholds, { type: 'pto_hours', value: 500 }])
  }

  function remove(i: number) {
    onChange(thresholds.filter((_, idx) => idx !== i))
  }

  function update(i: number, field: keyof MaintenanceThreshold, val: string) {
    const next = thresholds.map((t, idx) =>
      idx === i ? { ...t, [field]: field === 'value' ? Number(val) : val } : t
    )
    onChange(next)
  }

  const inputStyle = {
    background: 'var(--bg-base)',
    border: '1px solid var(--border)',
    color: 'var(--fg-primary)',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 13,
  }

  return (
    <div>
      {thresholds.map((t, i) => (
        <div key={`${t.type}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <select
            value={t.type}
            onChange={e => update(i, 'type', e.target.value)}
            style={inputStyle}
          >
            {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            type="number"
            value={t.value}
            min={1}
            onChange={e => update(i, 'value', e.target.value)}
            style={{ ...inputStyle, width: 90 }}
          />
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{TYPE_UNIT[t.type]}</span>
          {thresholds.length > 1 && (
            <button
              type="button"
              onClick={() => remove(i)}
              style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16 }}
              title="Eliminar umbral"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        style={{
          background: 'none',
          border: '1px dashed var(--border)',
          color: 'var(--fg-muted)',
          borderRadius: 6,
          padding: '5px 12px',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        + Añadir umbral
      </button>
    </div>
  )
}
