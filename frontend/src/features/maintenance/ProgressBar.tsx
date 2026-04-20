const STATUS_COLOR = {
  ok: 'var(--accent-ok)',
  'próximo': 'var(--accent-warn)',
  vencido: 'var(--accent-crit)',
} as const

interface ProgressBarProps {
  pct: number
  status: keyof typeof STATUS_COLOR
  showLabel?: boolean
}

export default function ProgressBar({ pct, status, showLabel = true }: ProgressBarProps) {
  const fill = Math.min(pct, 100)
  const color = STATUS_COLOR[status]

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        flex: 1,
        height: 6,
        background: 'var(--gauge-track)',
        borderRadius: 3,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${fill}%`,
          height: '100%',
          background: color,
          borderRadius: 3,
          transition: 'width 0.3s ease',
        }} />
      </div>
      {showLabel && (
        <span style={{
          fontSize: 11,
          fontFamily: 'var(--font-data)',
          color,
          minWidth: 36,
          textAlign: 'right',
        }}>
          {Math.round(pct)}%
        </span>
      )}
    </div>
  )
}
