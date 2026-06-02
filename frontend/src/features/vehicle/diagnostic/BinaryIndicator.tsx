interface BinaryIndicatorProps {
  value: boolean | null
  label: string
  onLabel?: string
  offLabel?: string
}

export function BinaryIndicator({
  value,
  label,
  onLabel = 'ON',
  offLabel = 'OFF',
}: BinaryIndicatorProps) {
  let bg: string
  let textColor: string
  let dotColor: string
  let displayText: string

  if (value === null) {
    bg = 'var(--offline-soft)'
    textColor = 'var(--offline)'
    dotColor = 'var(--offline)'
    displayText = '—'
  } else if (value) {
    bg = 'var(--cmg-teal-soft)'
    textColor = 'var(--cmg-teal)'
    dotColor = 'var(--cmg-teal)'
    displayText = onLabel
  } else {
    bg = 'var(--offline-soft)'
    textColor = 'var(--offline)'
    dotColor = 'var(--offline)'
    displayText = offLabel
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {label}
      </span>
      <div
        data-testid="binary-pill"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 12px',
          borderRadius: 'var(--r-pill)',
          background: bg,
          border: `1px solid ${dotColor}44`,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: textColor, letterSpacing: '0.04em' }}>
          {displayText}
        </span>
      </div>
    </div>
  )
}
