import type { SensorDef, VehicleStatus, SystemBlock, AlertInstanceEnrichedOut } from './types'
import { resolveRawValue, applyScaleOffset } from './sensorValue'
import { sensorSeverity, type Zone } from './sensorSeverity'

export type BlockZone = Zone | 'nodata'

const SEVERITY_TO_ZONE: Record<string, Zone> = {
  critical: 'crit',
  warning: 'warn',
  info: 'ok',
}

function worstZone(a: Zone | null, b: Zone | null): Zone | null {
  const rank: Record<Zone, number> = { crit: 2, warn: 1, ok: 0 }
  if (a == null) return b
  if (b == null) return a
  return rank[a] >= rank[b] ? a : b
}

export function alertSensorKey(
  alert: AlertInstanceEnrichedOut,
  schema: SensorDef[],
): string | null {
  const field = alert.trigger_value?.['field']
  if (typeof field !== 'string') return null
  if (field.startsWith('avl_')) {
    const avlId = parseInt(field.slice(4), 10)
    if (isNaN(avlId)) return null
    return schema.find(s => s.avl_id === avlId)?.key ?? null
  }
  return schema.find(s => s.key === field) ? field : null
}

export interface BlockResult {
  zone: BlockZone
  phrase: string
}

export function blockDiagnostics(
  block: SystemBlock,
  schema: SensorDef[],
  status: VehicleStatus,
  derived: Record<string, number | null>,
  alerts: AlertInstanceEnrichedOut[],
): BlockResult {
  const keySensorKeys = new Set(block.key_sensor_keys)

  // Pre-index: alertas activas mapeadas a sensor key (solo las del bloque clave)
  const alertByKey = new Map<string, AlertInstanceEnrichedOut>()
  for (const alert of alerts) {
    const key = alertSensorKey(alert, schema)
    if (key && keySensorKeys.has(key)) {
      const existing = alertByKey.get(key)
      const newZone = SEVERITY_TO_ZONE[alert.severity] ?? 'ok'
      if (!existing || (newZone === 'crit')) {
        alertByKey.set(key, alert)
      }
    }
  }

  const incidents: string[] = []
  let blockZone: Zone = 'ok'
  let hasAnyData = false

  for (const sensorKey of block.key_sensor_keys) {
    const sensor = schema.find(s => s.key === sensorKey)
    if (!sensor) continue

    const raw = resolveRawValue(sensor, status, derived)
    if (raw !== null) hasAnyData = true
    const scaled = applyScaleOffset(raw, sensor.scale, sensor.offset)
    const tz = sensorSeverity(sensor, scaled)
    const matchedAlert = alertByKey.get(sensorKey)
    const az: Zone | null = matchedAlert ? (SEVERITY_TO_ZONE[matchedAlert.severity] ?? 'ok') : null

    const sensorZone = worstZone(tz, az)
    blockZone = worstZone(blockZone, sensorZone) ?? 'ok'

    if (sensorZone === 'warn' || sensorZone === 'crit') {
      if (matchedAlert) {
        incidents.push(matchedAlert.rule_name)
      } else {
        // Determinar si fue por arriba o por abajo
        const aboveThresh = scaled != null && (
          (sensor.alert_above != null && scaled >= sensor.alert_above) ||
          (sensor.warn_above != null && scaled >= sensor.warn_above)
        )
        incidents.push(aboveThresh ? `${sensor.label} alto` : `${sensor.label} bajo`)
      }
    }
  }

  // Todos los sensores clave sin dato y sin alertas mapeadas → nodata
  if (!hasAnyData && alertByKey.size === 0) {
    return { zone: 'nodata', phrase: 'Sin datos' }
  }

  let phrase: string
  if (incidents.length === 0) {
    phrase = 'Funcionando normal'
  } else if (incidents.length === 1) {
    phrase = incidents[0]
  } else {
    phrase = `${incidents.length} incidencias`
  }

  return { zone: blockZone, phrase }
}
