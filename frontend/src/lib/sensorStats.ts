import type { ChartPointTime } from './avlSeries'

export type SensorStats =
  | {
      kind: 'numeric'
      last: number | null
      min: number | null
      max: number | null
      // Media de todos los valores no-null (incluye ceros de parado)
      avg: number | null
      // Media de valores > 0 (excluye nulls y ceros).
      // Criterio: valores = 0 en sensores de actividad (RPM, presión, caudal)
      // corresponden a parado; esta media refleja el nivel real de funcionamiento.
      avgActive: number | null
    }
  | { kind: 'boolean'; pctActive: number; activations: number; activeMs: number }

export function computeSensorStats(data: ChartPointTime[], isBoolean: boolean): SensorStats {
  const valid = data.map(d => d.value).filter((v): v is number => v !== null)

  if (isBoolean) {
    const total = valid.length
    if (total === 0) return { kind: 'boolean', pctActive: 0, activations: 0, activeMs: 0 }
    const active = valid.filter(v => v > 0).length
    let activations = 0
    let prev: number | null = null
    for (const d of data) {
      if (d.value === null) continue
      if (prev !== null && prev === 0 && d.value > 0) activations++
      prev = d.value
    }
    // Tiempo total en ON: integra la serie de escalón (cada muestra mantiene su
    // valor hasta la siguiente). Suma la duración de los tramos con valor > 0.
    let activeMs = 0
    for (let i = 0; i < data.length - 1; i++) {
      const v = data[i].value
      if (v !== null && v > 0) activeMs += data[i + 1].ts - data[i].ts
    }
    return { kind: 'boolean', pctActive: Math.round((active / total) * 1000) / 10, activations, activeMs }
  }

  if (valid.length === 0) {
    return { kind: 'numeric', last: null, min: null, max: null, avg: null, avgActive: null }
  }

  const last = valid[valid.length - 1]
  const min = Math.min(...valid)
  const max = Math.max(...valid)
  const avg = Math.round((valid.reduce((s, v) => s + v, 0) / valid.length) * 100) / 100

  const working = valid.filter(v => v > 0)
  const avgActive = working.length > 0
    ? Math.round((working.reduce((s, v) => s + v, 0) / working.length) * 100) / 100
    : null

  return { kind: 'numeric', last, min, max, avg, avgActive }
}
