import type { SensorDef } from './types'

export type Zone = 'ok' | 'warn' | 'crit'

interface Thresholds {
  warnAbove?: number
  alertAbove?: number
  warnBelow?: number
  alertBelow?: number
}

export function zoneForValue(value: number | null, t: Thresholds): Zone | null {
  if (value == null) return null
  if (t.alertAbove != null && value >= t.alertAbove) return 'crit'
  if (t.alertBelow != null && value <= t.alertBelow) return 'crit'
  if (t.warnAbove != null && value >= t.warnAbove) return 'warn'
  if (t.warnBelow != null && value <= t.warnBelow) return 'warn'
  return 'ok'
}

export function sensorSeverity(sensor: SensorDef, value: number | null): Zone | null {
  return zoneForValue(value, {
    warnAbove: sensor.warn_above,
    alertAbove: sensor.alert_above,
    warnBelow: sensor.warn_below,
    alertBelow: sensor.alert_below,
  })
}
