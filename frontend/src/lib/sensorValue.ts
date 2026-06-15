import type { SensorDef, VehicleStatus } from './types'

// Valores "not available" del estándar J1939: 1-byte, 2-byte, 4-byte
export const J1939_NA = new Set<number>([0xff, 0xffff, 0xffffffff])

export function isJ1939NA(raw: number): boolean {
  return J1939_NA.has(raw)
}

export function resolveRawValue(
  sensor: SensorDef,
  status: VehicleStatus,
  derived: Record<string, number | null>,
): number | null {
  if (sensor.status_field) {
    const val = (status as unknown as Record<string, unknown>)[sensor.status_field]
    if (val == null) return null
    if (typeof val === 'boolean') return val ? 1 : 0
    if (typeof val === 'number') return val
    return null
  }
  if (sensor.avl_id != null) {
    const v = status.can_data?.[`avl_${sensor.avl_id}`]
    const raw = typeof v === 'number' ? v : null
    if (raw !== null && (sensor.invalid_values?.includes(raw) || J1939_NA.has(raw))) return null
    return raw
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

// Campos de un sensor que definen su transformación. Subconjunto de SensorDef
// para que cualquier consumidor (incluido buildSensorSeries) pueda transformar.
export type TransformInput = Pick<SensorDef, 'scale' | 'offset' | 'transform'>

// Transforma el valor crudo del sensor a su valor físico.
// 'linear_range' = interpolación lineal de 2 puntos (entrada → salida);
// sin transform cae al modo legado scale/offset. Sin recorte fuera de rango.
export function applyTransform(raw: number | null, sensor: TransformInput): number | null {
  if (raw == null) return null
  const t = sensor.transform
  if (t && t.type === 'linear_range') {
    const span = t.in_max - t.in_min
    if (span === 0) return null
    // 4-20 mA: raw=0 = 0 mA = lazo sin señal (p. ej. PLC arrancando) → sin lectura.
    if (t.in_min > 0 && raw === 0) return null
    return (raw - t.in_min) * (t.out_max - t.out_min) / span + t.out_min
  }
  return applyScaleOffset(raw, sensor.scale, sensor.offset)
}

export function bitValue(raw: number | null, bitIndex?: number): boolean | null {
  if (raw == null) return null
  if (bitIndex != null) return ((raw >> bitIndex) & 1) === 1
  return raw !== 0
}

// Redondea a 1 decimal máximo, sin ceros sobrantes; enteros quedan enteros.
export function formatSensorValue(value: number | null): string | null {
  if (value == null) return null
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}
