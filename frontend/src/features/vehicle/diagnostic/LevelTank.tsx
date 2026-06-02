interface LevelTankProps {
  value: number | null
  min: number
  max: number
  unit: string | null
  label: string
  warnAbove?: number
  alertAbove?: number
  warnBelow?: number
  alertBelow?: number
}

function severityColor(
  value: number,
  opts: Pick<LevelTankProps, 'warnAbove' | 'alertAbove' | 'warnBelow' | 'alertBelow'>
): string {
  if (opts.alertAbove !== undefined && value >= opts.alertAbove) return 'var(--danger)'
  if (opts.alertBelow !== undefined && value <= opts.alertBelow) return 'var(--danger)'
  if (opts.warnAbove !== undefined && value >= opts.warnAbove) return 'var(--warn)'
  if (opts.warnBelow !== undefined && value <= opts.warnBelow) return 'var(--warn)'
  return 'var(--ok)'
}

export function LevelTank({
  value, min, max, unit, label,
  warnAbove, alertAbove, warnBelow, alertBelow,
}: LevelTankProps) {
  const fillPct = value !== null
    ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
    : 0
  const color = value !== null
    ? severityColor(value, { warnAbove, alertAbove, warnBelow, alertBelow })
    : 'var(--offline)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {label}
      </span>

      <div style={{
        width: 36,
        height: 80,
        borderRadius: 'var(--r-md)',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div
          data-testid="leveltank-fill"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: `${fillPct}%`,
            background: value !== null ? color : 'var(--offline)',
            transition: 'height var(--dur-slow) var(--ease-std), background var(--dur-base)',
          }}
        />
      </div>

      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', fontWeight: 600, color: value !== null ? color : 'var(--offline)' }}>
        {value !== null ? `${value}${unit ? ' ' + unit : ''}` : '—'}
      </span>
    </div>
  )
}
