interface LinearGaugeProps {
  value: number | null
  min: number
  max: number
  unit?: string
  label: string
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

const barStyle = {
  position: 'relative' as const,
  width: 32,
  height: 100,
  background: 'var(--gauge-track, #3C3330)',
  borderRadius: 4,
  border: '1px solid var(--bg-border)',
  overflow: 'hidden' as const,
}

function linearColor(value: number | null, warnBelow?: number, alertBelow?: number): string {
  if (value == null) return 'var(--accent-off)'
  if (alertBelow != null && value <= alertBelow) return 'var(--accent-crit)'
  if (warnBelow != null && value <= warnBelow) return 'var(--accent-warn)'
  return 'var(--accent-energy)'
}

function linearStatus(value: number | null, warnBelow?: number, alertBelow?: number): string {
  if (value == null) return '—'
  if (alertBelow != null && value <= alertBelow) return 'CRÍTICO'
  if (warnBelow != null && value <= warnBelow) return 'BAJO'
  return 'OK'
}

export default function LinearGauge({
  value, min, max, label,
  warnBelow, alertBelow,
}: LinearGaugeProps) {
  if (import.meta.env.DEV && warnBelow != null && alertBelow != null && alertBelow >= warnBelow) {
    console.warn(`LinearGauge "${label}": alertBelow (${alertBelow}) must be < warnBelow (${warnBelow})`)
  }

  const range = max - min
  const pct = value == null || range === 0
    ? 0
    : Math.round(Math.max(0, Math.min(1, (value - min) / range)) * 100)

  const color = linearColor(value, warnBelow, alertBelow)
  const status = linearStatus(value, warnBelow, alertBelow)
  const warnPct = warnBelow != null && range !== 0
    ? Math.round(Math.max(0, Math.min(1, (warnBelow - min) / range)) * 100)
    : null

  return (
    <div style={cardStyle} aria-label={label}>
      <div style={{ fontFamily: 'var(--font-ui)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.8px', textTransform: 'uppercase' as const }}>
        {label}
      </div>

      <div
        style={barStyle}
        role="meter"
        aria-valuenow={value ?? 0}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-label={label}
      >
        <div
          className="linear-fill"
          style={{
            position: 'absolute', bottom: 0, left: 0, width: '100%',
            height: `${pct}%`,
            background: color,
            transition: 'height 0.3s',
          }}
        />
        {warnPct != null && (
          <div
            style={{
              position: 'absolute', bottom: `${warnPct}%`, left: 0, width: '100%',
              height: 1,
              background: 'var(--accent-warn)',
              opacity: 0.7,
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      <div style={{ fontFamily: 'var(--font-data)', fontSize: 20, fontWeight: 700, color }}>
        {value != null ? `${pct}%` : '—'}
      </div>
      {value != null && (
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, color, marginTop: 2 }}>
          {status}
        </div>
      )}
    </div>
  )
}
