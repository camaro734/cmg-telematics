interface GaugeArcProps {
  value: number | null
  max: number
  min?: number
  label: string
  unit?: string
  warnAbove?: number
  alertAbove?: number
  color?: string
  size?: number
}

function arcFill(value: number | null, warnAbove?: number, alertAbove?: number, def = 'var(--cmg-teal)'): string {
  if (value == null) return 'var(--offline)'
  if (alertAbove != null && value >= alertAbove) return 'var(--danger)'
  if (warnAbove != null && value >= warnAbove) return 'var(--warn)'
  return def
}

function polarToXY(angleDeg: number, r: number, cx: number, cy: number) {
  const rad = ((180 - angleDeg) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) }
}

export function GaugeArc({ value, max, min = 0, label, unit, warnAbove, alertAbove, color, size = 130 }: GaugeArcProps) {
  const cx = size / 2
  const cy = size * 0.62
  const r = size * 0.38
  const STROKE = 10
  const range = max - min || 1
  const pct = value != null ? Math.max(0, Math.min(1, (value - min) / range)) : 0
  const fillColor = arcFill(value, warnAbove, alertAbove, color ?? 'var(--cmg-teal)')

  const startPt = polarToXY(0, r, cx, cy)
  const endPt = polarToXY(180, r, cx, cy)
  const fillPt = polarToXY(pct * 180, r, cx, cy)

  const trackPath = `M ${startPt.x} ${startPt.y} A ${r} ${r} 0 0 1 ${endPt.x} ${endPt.y}`
  const fillPath = pct > 0
    ? `M ${startPt.x} ${startPt.y} A ${r} ${r} 0 ${pct > 0.5 ? 1 : 0} 1 ${fillPt.x} ${fillPt.y}`
    : ''
  const needlePt = polarToXY(pct * 180, r * 0.78, cx, cy)
  const displayVal = value != null ? (value % 1 === 0 ? String(value) : value.toFixed(1)) : '—'
  const fontSize = displayVal.length > 5 ? 18 : 22

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <svg width={size} height={size * 0.72} viewBox={`0 0 ${size} ${size * 0.72}`} style={{ display: 'block', overflow: 'visible' }}>
        <path d={trackPath} fill="none" stroke="var(--border)" strokeWidth={STROKE} strokeLinecap="round"/>
        {fillPath && <path d={fillPath} fill="none" stroke={fillColor} strokeWidth={STROKE} strokeLinecap="round" style={{ transition: 'stroke 0.3s' }}/>}
        <line x1={cx} y1={cy} x2={needlePt.x} y2={needlePt.y} stroke={fillColor} strokeWidth={2} strokeLinecap="round"/>
        <circle cx={cx} cy={cy} r={4} fill={fillColor}/>
        <circle cx={cx} cy={cy} r={2} fill="var(--bg-surface)"/>
        <text x={startPt.x - 2} y={startPt.y + 14} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={8} fill="var(--fg-dim)">{min}</text>
        <text x={endPt.x + 2} y={endPt.y + 14} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={8} fill="var(--fg-dim)">{max}</text>
        <text x={cx} y={cy - 6} textAnchor="middle" fontFamily="var(--font-mono)" fontWeight={700} fontSize={fontSize} fill="var(--fg-primary)">{displayVal}</text>
        {unit && <text x={cx} y={cy + 10} textAnchor="middle" fontFamily="var(--font-sans)" fontSize={9} fill="var(--fg-muted)">{unit}</text>}
      </svg>
      <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)', fontWeight: 600, textAlign: 'center' as const }}>
        {label}
      </span>
    </div>
  )
}
