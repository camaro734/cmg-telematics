import type { ChartPointTime } from './avlSeries'

export type SensorStats =
  | { kind: 'numeric'; last: number | null; min: number | null; max: number | null; avg: number | null }
  | { kind: 'boolean'; pctActive: number; activations: number }

export function computeSensorStats(data: ChartPointTime[], isBoolean: boolean): SensorStats {
  const valid = data.map(d => d.value).filter((v): v is number => v !== null)

  if (isBoolean) {
    const total = valid.length
    if (total === 0) return { kind: 'boolean', pctActive: 0, activations: 0 }
    const active = valid.filter(v => v > 0).length
    let activations = 0
    let prev: number | null = null
    for (const d of data) {
      if (d.value === null) continue
      if (prev !== null && prev === 0 && d.value > 0) activations++
      prev = d.value
    }
    return { kind: 'boolean', pctActive: Math.round((active / total) * 1000) / 10, activations }
  }

  if (valid.length === 0) return { kind: 'numeric', last: null, min: null, max: null, avg: null }
  const last = valid[valid.length - 1]
  const min = Math.min(...valid)
  const max = Math.max(...valid)
  const avg = Math.round((valid.reduce((s, v) => s + v, 0) / valid.length) * 100) / 100
  return { kind: 'numeric', last, min, max, avg }
}
