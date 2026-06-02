import type { SensorDef } from '../../../lib/types'
import { applyScaleOffset, bitValue } from '../../../lib/sensorValue'
import { RangeBar } from './RangeBar'
import { LevelTank } from './LevelTank'
import { BigNumber } from './BigNumber'
import { BinaryIndicator } from './BinaryIndicator'

interface DiagnosticSensorProps {
  sensor: SensorDef
  raw: number | null
}

export function DiagnosticSensor({ sensor, raw }: DiagnosticSensorProps) {
  const scaled = applyScaleOffset(raw, sensor.scale, sensor.offset)

  switch (sensor.gauge_type) {
    case 'circular':
    case 'linear':
    case 'gauge_arc':
      return (
        <RangeBar
          value={scaled}
          min={sensor.min ?? 0}
          max={sensor.max ?? 100}
          unit={sensor.unit ?? null}
          label={sensor.label}
          warnAbove={sensor.warn_above}
          alertAbove={sensor.alert_above}
          warnBelow={sensor.warn_below}
          alertBelow={sensor.alert_below}
        />
      )

    case 'tank':
    case 'battery':
      return (
        <LevelTank
          value={scaled}
          min={sensor.min ?? 0}
          max={sensor.max ?? 100}
          unit={sensor.unit ?? null}
          label={sensor.label}
          warnAbove={sensor.warn_above}
          alertAbove={sensor.alert_above}
          warnBelow={sensor.warn_below}
          alertBelow={sensor.alert_below}
        />
      )

    case 'led':
      return (
        <BinaryIndicator
          value={bitValue(raw, sensor.bit_index)}
          label={sensor.label}
        />
      )

    case 'numeric':
    case 'counter':
    default:
      return (
        <BigNumber
          value={scaled}
          unit={sensor.unit ?? null}
          label={sensor.label}
        />
      )
  }
}
