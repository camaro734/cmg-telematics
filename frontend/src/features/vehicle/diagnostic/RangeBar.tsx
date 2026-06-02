import { zoneForValue } from '../../../lib/sensorSeverity'

interface RangeBarProps {
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

const ZONE_COLOR: Record<string, string> = {
  crit: 'var(--danger)',
  warn: 'var(--warn)',
  ok: 'var(--ok)',
}

function severityColor(
  value: number,
  opts: Pick<RangeBarProps, 'warnAbove' | 'alertAbove' | 'warnBelow' | 'alertBelow'>
): string {
  const zone = zoneForValue(value, opts)
  return zone ? ZONE_COLOR[zone] : 'var(--ok)'
}

export function RangeBar({
  value, min, max, unit, label,
  warnAbove, alertAbove, warnBelow, alertBelow,
}: RangeBarProps) {
  const fillPct = value !== null
    ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
    : 0
  const color = value !== null
    ? severityColor(value, { warnAbove, alertAbove, warnBelow, alertBelow })
    : 'var(--offline)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
          {label}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-md)', fontWeight: 600, color: value !== null ? color : 'var(--offline)' }}>
          {value !== null ? `${value}${unit ? ' ' + unit : ''}` : '—'}
        </span>
      </div>

      <div style={{ height: 6, borderRadius: 'var(--r-pill)', background: 'var(--bg-elevated)', overflow: 'hidden' }}>
        <div
          data-testid="rangebar-fill"
          style={{
            height: '100%',
            width: `${fillPct}%`,
            borderRadius: 'var(--r-pill)',
            background: value !== null ? color : 'var(--offline)',
            transition: 'width var(--dur-slow) var(--ease-std), background var(--dur-base)',
          }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--fg-dim)' }}>{min}{unit ? ' ' + unit : ''}</span>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--fg-dim)' }}>{max}{unit ? ' ' + unit : ''}</span>
      </div>
    </div>
  )
}
