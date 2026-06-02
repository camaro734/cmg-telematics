import { formatSensorValue } from '../../../lib/sensorValue'

interface BigNumberProps {
  value: number | null
  unit: string | null
  label: string
}

export function BigNumber({ value, unit, label }: BigNumberProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-4xl)',
          fontWeight: 'var(--fw-bold)',
          lineHeight: 1,
          letterSpacing: '-0.02em',
          color: value !== null ? 'var(--fg-primary)' : 'var(--offline)',
        }}>
          {value !== null ? (formatSensorValue(value) ?? value) : '—'}
        </span>
        {value !== null && unit !== null && (
          <span
            data-testid="bignumber-unit"
            style={{ fontSize: 'var(--fs-lg)', color: 'var(--fg-tertiary)', fontWeight: 'var(--fw-medium)' }}
          >
            {unit}
          </span>
        )}
      </div>
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {label}
      </span>
    </div>
  )
}
