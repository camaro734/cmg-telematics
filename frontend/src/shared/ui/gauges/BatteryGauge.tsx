interface BatteryGaugeProps {
  value: number | null
  min: number
  max: number
  label: string
  unit?: string
  warnBelow?: number
  alertBelow?: number
}

const cardStyle = {
  background: 'var(--bg-surface)',
  borderRadius: 8,
  padding: 8,
  border: '1px solid var(--bg-elevated)',
  display: 'inline-flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  gap: 6,
}

function batteryColor(value: number | null, warnBelow?: number, alertBelow?: number): string {
  if (value == null) return 'var(--accent-off)'
  if (alertBelow != null && value <= alertBelow) return 'var(--accent-crit)'
  if (warnBelow != null && value <= warnBelow) return 'var(--accent-warn)'
  return 'var(--accent-energy)'
}

function batteryStatus(value: number | null, warnBelow?: number, alertBelow?: number): string {
  if (value == null) return '—'
  if (alertBelow != null && value <= alertBelow) return 'BAJA'
  if (warnBelow != null && value <= warnBelow) return 'ADVERTENCIA'
  return 'OK'
}

export default function BatteryGauge({
  value, min, max, label,
  unit = 'V',
  warnBelow, alertBelow,
}: BatteryGaugeProps) {
  if (import.meta.env.DEV && warnBelow != null && alertBelow != null && alertBelow >= warnBelow) {
    console.warn(`BatteryGauge "${label}": alertBelow (${alertBelow}) must be < warnBelow (${warnBelow})`)
  }

  const range = max - min
  const pct = value == null || range === 0
    ? 0
    : Math.round(Math.max(0, Math.min(1, (value - min) / range)) * 100)

  const color = batteryColor(value, warnBelow, alertBelow)
  const status = batteryStatus(value, warnBelow, alertBelow)
  const valueText = value != null ? `${value.toFixed(1)} ${unit}` : `— ${unit}`

  return (
    <div style={cardStyle} aria-label={label}>
      <div style={{ fontFamily: 'var(--font-ui)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.8px' }}>
        {label}
      </div>

      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div
          style={{
            width: 70, height: 26,
            border: '2px solid var(--bg-border)',
            borderRadius: 4,
            background: 'var(--bg-base)',
            overflow: 'hidden',
          }}
          role="meter"
          aria-valuenow={value ?? 0}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-label={label}
        >
          <div
            className="bat-fill"
            style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s' }}
          />
        </div>
        <div style={{ width: 4, height: 10, background: 'var(--bg-border)', borderRadius: '0 2px 2px 0' }} />
      </div>

      <div style={{ fontFamily: 'var(--font-data)', fontSize: 20, fontWeight: 700, color }}>
        {valueText}
      </div>
      <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, color, marginTop: 4 }}>
        {status}
      </div>
    </div>
  )
}
