import { applyScaleOffset } from './sensorValue'

export type Period = 'dia' | 'semana' | 'mes'
export type AvlPoint = { bucket: string; value: number | null }
export type ChartPoint = { label: string; value: number }
export type ChartPointTime = { ts: number; label: string; value: number | null }

// Extraído de KpiChart — transforma serie cruda (multiplicando por transform)
export function buildAvlSeries(
  raw: AvlPoint[],
  transform: number,
  period: Period,
): ChartPoint[] {
  if (period === 'dia') {
    return raw
      .filter(d => d.value !== null)
      .map(d => ({
        label: new Date(d.bucket).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        value: Math.round(d.value! * transform * 100) / 100,
      }))
  }
  const byDay = new Map<string, number[]>()
  for (const d of raw) {
    if (d.value === null) continue
    const day = d.bucket.slice(0, 10)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day)!.push(d.value * transform)
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, vals]) => ({
      label: day.slice(5).replace('-', '/'),
      value: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100,
    }))
}

// Para SensorMiniChart — aplica scale+offset (J1939 offset correcto).
// Preserva puntos nulos (value: null) para que el eje temporal muestre huecos reales.
export function buildSensorSeries(
  raw: AvlPoint[],
  scale: number | undefined,
  offset: number | undefined,
): ChartPointTime[] {
  return raw.map(d => {
    const ts = new Date(d.bucket).getTime()
    const label = new Date(d.bucket).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    if (d.value === null) return { ts, label, value: null }
    const v = applyScaleOffset(d.value, scale, offset)
    if (v === null) return { ts, label, value: null }
    return { ts, label, value: Math.round(v * 100) / 100 }
  })
}
