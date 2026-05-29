import type { SensorDef } from '../../lib/types'
import CircularGauge from '../../shared/ui/gauges/CircularGauge'
import LinearGauge from '../../shared/ui/gauges/LinearGauge'
import BatteryGauge from '../../shared/ui/gauges/BatteryGauge'
import NumericDisplay from '../../shared/ui/gauges/NumericDisplay'
import { TankGauge } from '../../shared/ui/gauges/TankGauge'
import { GaugeArc } from '../../shared/ui/gauges/GaugeArc'
import { SensorIconComponent } from '../../shared/ui/gauges/SensorIconSet'

interface SensorWidgetProps {
  sensor: SensorDef
  value: number | null
}

const SIZES = { sm: 72, md: 96, lg: 120 } as const

function scaleValue(raw: number | null, scale?: number, offset?: number): number | null {
  if (raw == null) return null
  return raw * (scale ?? 1) + (offset ?? 0)
}

/** Deriva el estado semafórico para NumericDisplay a partir de los umbrales del sensor. */
function deriveNumericStatus(
  scaled: number | null,
  warnAbove?: number,
  alertAbove?: number,
  warnBelow?: number,
  alertBelow?: number,
): 'normal' | 'warn' | 'alert' | 'offline' {
  if (scaled == null) return 'offline'
  if (alertAbove != null && scaled > alertAbove) return 'alert'
  if (alertBelow != null && scaled < alertBelow) return 'alert'
  if (warnAbove != null && scaled > warnAbove) return 'warn'
  if (warnBelow != null && scaled < warnBelow) return 'warn'
  return 'normal'
}

export function SensorWidget({ sensor, value }: SensorWidgetProps) {
  const scaled = scaleValue(value, sensor.scale, sensor.offset)
  const size = SIZES[sensor.widget_size ?? 'md']
  const color = sensor.color ?? undefined

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '10px 8px 8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    transition: 'border-color 0.15s',
  }

  const icon = sensor.icon ? (
    <SensorIconComponent icon={sensor.icon} size={14} color={color ?? 'var(--fg-dim)'} />
  ) : null

  switch (sensor.gauge_type) {
    case 'tank':
      return (
        <div style={cardStyle}>
          {icon}
          <TankGauge
            value={scaled}
            min={sensor.min ?? 0}
            max={sensor.max ?? 100}
            label={sensor.label}
            unit={sensor.unit ?? undefined}
            warnAbove={sensor.warn_above}
            alertAbove={sensor.alert_above}
            color={color}
            width={Math.round(size * 0.7)}
            height={size}
          />
        </div>
      )

    case 'gauge_arc':
      return (
        <div style={cardStyle}>
          {icon}
          <GaugeArc
            value={scaled}
            min={sensor.min ?? 0}
            max={sensor.max ?? 100}
            label={sensor.label}
            unit={sensor.unit ?? undefined}
            warnAbove={sensor.warn_above}
            alertAbove={sensor.alert_above}
            color={color}
            size={size + 20}
          />
        </div>
      )

    case 'linear':
      return (
        <div style={{ ...cardStyle, width: '100%' }}>
          {icon && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
              {icon}
              <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600 }}>
                {sensor.label}
              </span>
            </div>
          )}
          <div style={{ width: '100%' }}>
            <LinearGauge
              value={scaled}
              min={sensor.min ?? 0}
              max={sensor.max ?? 100}
              label={sensor.label}
              unit={sensor.unit ?? ''}
              warnAbove={sensor.warn_above}
              alertAbove={sensor.alert_above}
              warnBelow={sensor.warn_below}
              alertBelow={sensor.alert_below}
              colorOverride={color}
            />
          </div>
        </div>
      )

    case 'battery':
      return (
        <div style={cardStyle}>
          {icon}
          <BatteryGauge
            value={scaled}
            min={sensor.min ?? 0}
            max={sensor.max ?? 100}
            label={sensor.label}
            unit={sensor.unit ?? ''}
            warnBelow={sensor.warn_below}
            alertBelow={sensor.alert_below}
          />
        </div>
      )

    case 'numeric': {
      const status = deriveNumericStatus(
        scaled,
        sensor.warn_above,
        sensor.alert_above,
        sensor.warn_below,
        sensor.alert_below,
      )
      return (
        <div style={cardStyle}>
          {icon}
          <NumericDisplay
            value={scaled}
            label={sensor.label}
            unit={sensor.unit ?? ''}
            status={status}
          />
        </div>
      )
    }

    case 'led': {
      const on = scaled != null && scaled > 0
      return (
        <div style={{ ...cardStyle, flexDirection: 'row', justifyContent: 'space-between', width: '100%', padding: '8px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {icon}
            <span style={{ fontSize: 12, color: 'var(--fg-secondary)', fontWeight: 500, fontFamily: 'var(--font-sans)' }}>
              {sensor.label}
            </span>
          </div>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '3px 10px', borderRadius: 9999,
            fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-sans)',
            background: on ? 'var(--ok-soft)' : 'var(--offline-soft)',
            color: on ? 'var(--ok)' : 'var(--offline)',
            border: `1px solid ${on ? 'rgba(34,197,94,0.3)' : 'rgba(100,116,139,0.3)'}`,
            flexShrink: 0,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', display: 'inline-block', flexShrink: 0 }}/>
            {on ? 'ON' : 'OFF'}
          </span>
        </div>
      )
    }

    case 'counter':
      return (
        <div style={{ ...cardStyle, minWidth: 80 }}>
          {icon}
          <div style={{ textAlign: 'center' as const }}>
            <div style={{
              fontSize: size > 80 ? 20 : 16, fontWeight: 700,
              fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)',
              letterSpacing: '-0.02em', lineHeight: 1,
            }}>
              {scaled != null
                ? scaled.toLocaleString('es-ES', { maximumFractionDigits: 1 })
                : '—'}
            </div>
            {sensor.unit && scaled != null && (
              <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginTop: 3, fontFamily: 'var(--font-sans)' }}>
                {sensor.unit}
              </div>
            )}
            <div style={{ fontSize: 10, color: 'var(--fg-dim)', marginTop: 2, fontFamily: 'var(--font-sans)' }}>
              {sensor.label}
            </div>
          </div>
        </div>
      )

    case 'circular':
    default:
      return (
        <div style={cardStyle}>
          {icon}
          <CircularGauge
            value={scaled}
            min={sensor.min ?? 0}
            max={sensor.max ?? 100}
            label={sensor.label}
            unit={sensor.unit ?? ''}
            size={size}
            warnAbove={sensor.warn_above}
            alertAbove={sensor.alert_above}
            warnBelow={sensor.warn_below}
            alertBelow={sensor.alert_below}
            colorOverride={color}
          />
        </div>
      )
  }
}
