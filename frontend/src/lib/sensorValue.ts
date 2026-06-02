import type { SensorDef, VehicleStatus } from './types'

export function resolveRawValue(
  sensor: SensorDef,
  status: VehicleStatus,
  derived: Record<string, number | null>,
): number | null {
  if (sensor.avl_id != null) {
    const v = status.can_data?.[`avl_${sensor.avl_id}`]
    return typeof v === 'number' ? v : null
  }
  if (sensor.kpi_key) {
    return derived[sensor.kpi_key] ?? null
  }
  return null
}

export function applyScaleOffset(
  raw: number | null,
  scale?: number,
  offset?: number,
): number | null {
  if (raw == null) return null
  return raw * (scale ?? 1) + (offset ?? 0)
}

export function bitValue(raw: number | null, bitIndex?: number): boolean | null {
  if (raw == null) return null
  if (bitIndex != null) return ((raw >> bitIndex) & 1) === 1
  return raw !== 0
}
