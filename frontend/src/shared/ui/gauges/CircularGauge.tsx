interface CircularGaugeProps {
  value: number | null
  min: number
  max: number
  unit: string
  label: string
  size?: number
  warnAbove?: number
  alertAbove?: number
  warnBelow?: number
  alertBelow?: number
}

const CX = 70
const CY = 72
const R = 50
const START_DEG = 135
const TOTAL_DEG = 270

const cardStyle = {
  background: 'var(--bg-surface)',
  borderRadius: 8,
  padding: 8,
  textAlign: 'center' as const,
  border: '1px solid var(--bg-elevated)',
}

function arcPath(startDeg: number, sweepDeg: number): string {
  if (sweepDeg < 0.3) return ''
  const rad = Math.PI / 180
  const sx = CX + R * Math.cos(startDeg * rad)
  const sy = CY + R * Math.sin(startDeg * rad)
  const ex = CX + R * Math.cos((startDeg + sweepDeg) * rad)
  const ey = CY + R * Math.sin((startDeg + sweepDeg) * rad)
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${R} ${R} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`
}

function gaugeColor(
  value: number,
  alertAbove?: number,
  warnAbove?: number,
  warnBelow?: number,
  alertBelow?: number,
): string {
  if (alertAbove != null && value >= alertAbove) return 'var(--accent-crit)'
  if (warnAbove != null && value >= warnAbove) return 'var(--accent-warn)'
  if (alertBelow != null && value <= alertBelow) return 'var(--accent-crit)'
  if (warnBelow != null && value <= warnBelow) return 'var(--accent-warn)'
  return 'var(--accent-energy)'
}

export default function CircularGauge({
  value, min, max, unit, label,
  size = 120,
  warnAbove, alertAbove, warnBelow, alertBelow,
}: CircularGaugeProps) {
  const hasValue = value != null
  const range = max - min
  const pct = hasValue && range !== 0 ? Math.max(0, Math.min(1, (value - min) / range)) : 0
  const valueDeg = pct * TOTAL_DEG
  const color = hasValue
    ? gaugeColor(value, alertAbove, warnAbove, warnBelow, alertBelow)
    : 'var(--accent-off)'

  const dotAngle = (START_DEG + valueDeg) * Math.PI / 180
  const dotX = CX + R * Math.cos(dotAngle)
  const dotY = CY + R * Math.sin(dotAngle)
  const displayHeight = Math.round(size * 128 / 120)

  return (
    <div style={cardStyle}>
      <svg width={size} height={displayHeight} viewBox="0 0 140 140" aria-label={label}>
        {/* Track */}
        <path
          className="g-track"
          d={arcPath(START_DEG, TOTAL_DEG - 0.3)}
          fill="none"
          stroke="var(--gauge-track)"
          strokeWidth="4"
          strokeLinecap="round"
        />
        {/* Value arc */}
        <path
          className="g-val"
          d={hasValue && valueDeg > 0.3 ? arcPath(START_DEG, valueDeg) : ''}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
        />
        {/* Glowing dot */}
        {hasValue && valueDeg > 0.3 && (
          <circle
            className="g-dot"
            cx={dotX}
            cy={dotY}
            r="5"
            fill={color}
            style={{ filter: `drop-shadow(0 0 5px ${color})` }}
          />
        )}
        {/* Value number */}
        <text
          x="70" y="64"
          textAnchor="middle"
          fontSize="22"
          fontWeight="700"
          fill={hasValue ? color : 'var(--text-muted)'}
          fontFamily="var(--font-data)"
        >
          {hasValue ? value : '—'}
        </text>
        {/* Max + unit */}
        <text
          x="70" y="79"
          textAnchor="middle"
          fontSize="10"
          fill={hasValue ? color : 'var(--text-muted)'}
          fontFamily="var(--font-data)"
        >
          {`/ ${max} ${unit}`}
        </text>
        {/* Label */}
        <text
          x="70" y="116"
          textAnchor="middle"
          fontSize="8"
          fill="var(--text-muted)"
          fontFamily="var(--font-data)"
          letterSpacing="0.8"
        >
          {label.toUpperCase()}
        </text>
      </svg>
    </div>
  )
}
