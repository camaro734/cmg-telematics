import type { SensorDef } from '../../lib/types'
import CircularGauge from '../../shared/ui/gauges/CircularGauge'
import BatteryGauge from '../../shared/ui/gauges/BatteryGauge'
import LinearGauge from '../../shared/ui/gauges/LinearGauge'
import NumericDisplay from '../../shared/ui/gauges/NumericDisplay'

interface SensorGridProps {
  sensorSchema: SensorDef[]
  canData: Record<string, unknown>
  // Partial porque los KPIs derivados pueden no estar presentes para todas las claves
  derivedValues?: Partial<Record<string, number | null>>
}

function getSensorValue(
  sensor: SensorDef,
  canData: Record<string, unknown>,
  derived: Partial<Record<string, number | null>>,
): number | null {
  if (sensor.kpi_key) return derived[sensor.kpi_key] ?? null
  if (sensor.avl_id != null) {
    const raw = canData[`avl_${sensor.avl_id}`]
    if (typeof raw !== 'number') {
      if (import.meta.env.DEV && raw != null) {
        console.warn(`SensorGrid: avl_${sensor.avl_id} tiene tipo inesperado "${typeof raw}", se esperaba number`)
      }
      return null
    }
    return sensor.scale != null ? raw * sensor.scale : raw
  }
  return null
}

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: 8,
}

const unit = (s: SensorDef) => s.unit ?? ''

export default function SensorGrid({ sensorSchema, canData, derivedValues = {} }: SensorGridProps) {
  return (
    <div style={gridStyle}>
      {sensorSchema.map(sensor => {
        const value = getSensorValue(sensor, canData, derivedValues)

        if (sensor.gauge_type === 'circular') {
          return (
            <CircularGauge
              key={sensor.key}
              value={value}
              min={sensor.min ?? 0}
              max={sensor.max ?? 100}
              unit={unit(sensor)}
              label={sensor.label}
              warnAbove={sensor.warn_above}
              alertAbove={sensor.alert_above}
              warnBelow={sensor.warn_below}
              alertBelow={sensor.alert_below}
            />
          )
        }

        // battery y linear son sensores de nivel — solo alertan por valor bajo, no alto
        if (sensor.gauge_type === 'battery') {
          return (
            <BatteryGauge
              key={sensor.key}
              value={value}
              min={sensor.min ?? 0}
              max={sensor.max ?? 100}
              label={sensor.label}
              unit={unit(sensor)}
              warnBelow={sensor.warn_below}
              alertBelow={sensor.alert_below}
            />
          )
        }

        if (sensor.gauge_type === 'linear') {
          return (
            <LinearGauge
              key={sensor.key}
              value={value}
              min={sensor.min ?? 0}
              max={sensor.max ?? 100}
              unit={unit(sensor)}
              label={sensor.label}
              warnBelow={sensor.warn_below}
              alertBelow={sensor.alert_below}
            />
          )
        }

        if (sensor.gauge_type === 'numeric') {
          return (
            <NumericDisplay
              key={sensor.key}
              value={value}
              unit={unit(sensor)}
              label={sensor.label}
            />
          )
        }

        // Tipo no reconocido — mostrar como numérico con aviso en dev
        if (import.meta.env.DEV) {
          console.warn(`SensorGrid: gauge_type no reconocido "${sensor.gauge_type}" para clave "${sensor.key}"`)
        }
        return (
          <NumericDisplay
            key={sensor.key}
            value={value}
            unit={unit(sensor)}
            label={sensor.label}
          />
        )
      })}
    </div>
  )
}
