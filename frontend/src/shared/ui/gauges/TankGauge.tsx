import { useId } from 'react'

interface TankGaugeProps {
  value: number | null
  max: number
  min?: number
  label: string
  unit?: string
  warnAbove?: number
  alertAbove?: number
  color?: string
  width?: number
  height?: number
}

function tankColor(value: number | null, warnAbove?: number, alertAbove?: number, def = 'var(--info)'): string {
  if (value == null) return 'var(--offline)'
  if (alertAbove != null && value >= alertAbove) return 'var(--danger)'
  if (warnAbove != null && value >= warnAbove) return 'var(--warn)'
  return def
}

export function TankGauge({ value, max, min = 0, label, unit, warnAbove, alertAbove, color, width = 72, height = 96 }: TankGaugeProps) {
  const uid = useId()
  const clipId = `clip-${uid.replace(/:/g, '')}`
  const range = max - min || 1
  const pct = value != null ? Math.max(0, Math.min(1, (value - min) / range)) : 0
  const fill = tankColor(value, warnAbove, alertAbove, color ?? 'var(--info)')
  const PAD = 6
  const innerW = width - PAD * 2
  const innerH = height - PAD * 2
  const fillH = innerH * pct
  const fillY = PAD + innerH - fillH
  const waveW = innerW * 2
  const waveAmp = 3
  const wavePath = fillH > 0
    ? `M0,${waveAmp} Q${waveW*0.25},${-waveAmp} ${waveW*0.5},${waveAmp} Q${waveW*0.75},${waveAmp*3} ${waveW},${waveAmp} L${waveW},${fillH} L0,${fillH} Z`
    : ''
  const displayVal = value != null ? (value % 1 === 0 ? String(value) : value.toFixed(1)) : '—'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'hidden' }}>
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD} y={PAD} width={innerW} height={innerH} rx={6}/>
          </clipPath>
        </defs>
        <rect x={PAD} y={PAD} width={innerW} height={innerH} rx={8} fill="var(--bg-elevated)" stroke="var(--border)" strokeWidth={1.5}/>
        <rect x={PAD} y={PAD} width={innerW} height={8} rx={6} fill="rgba(255,255,255,0.06)"/>
        <g clipPath={`url(#${clipId})`}>
          {wavePath && (
            <g transform={`translate(${PAD},${fillY - waveAmp})`}>
              <path d={wavePath} fill={fill} opacity={0.88}>
                <animateTransform attributeName="transform" type="translate"
                  from="0 0" to={`${-innerW} 0`} dur="2.5s" repeatCount="indefinite"/>
              </path>
            </g>
          )}
        </g>
        {[0.25, 0.5, 0.75].map(p => (
          <line key={p} x1={PAD+3} y1={PAD + innerH*(1-p)} x2={PAD+innerW-3} y2={PAD + innerH*(1-p)}
            stroke="var(--border-soft)" strokeWidth={0.8} strokeDasharray="2 3"/>
        ))}
        <text x={width/2} y={PAD + innerH*0.5 + 5} textAnchor="middle" dominantBaseline="middle"
          fontFamily="var(--font-mono)" fontWeight={700} fontSize={displayVal.length > 4 ? 11 : 13}
          fill="var(--fg-primary)" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
          {displayVal}
        </text>
        {unit && <text x={width/2} y={PAD + innerH*0.5 + 20} textAnchor="middle"
          fontFamily="var(--font-sans)" fontSize={9} fill="var(--fg-muted)">{unit}</text>}
      </svg>
      <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)', fontWeight: 600, textAlign: 'center', maxWidth: width, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
        {label}
      </span>
    </div>
  )
}
