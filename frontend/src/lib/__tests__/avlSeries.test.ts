import { describe, it, expect } from 'vitest'
import { injectGaps, buildChartTicks } from '../avlSeries'
import type { ChartPointTime } from '../avlSeries'

const pt = (ts: number, value: number | null): ChartPointTime => ({ ts, label: '', value })

// ─── injectGaps ──────────────────────────────────────────────────────────────

describe('injectGaps — modo ≤24h (umbral 10 min)', () => {
  it('no inserta null cuando delta es menor al umbral', () => {
    const data = [pt(0, 100), pt(5 * 60_000, 110)] // 5 min < 10 min
    expect(injectGaps(data, 24)).toEqual(data)
  })

  it('inserta null en el punto medio cuando delta > 10 min', () => {
    const data = [pt(0, 100), pt(15 * 60_000, 110)] // 15 min > 10 min
    const result = injectGaps(data, 24)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual(pt(0, 100))
    expect(result[1].value).toBeNull()
    expect(result[1].ts).toBe(Math.round(15 * 60_000 / 2))
    expect(result[2]).toEqual(pt(15 * 60_000, 110))
  })

  it('inserta exactamente en el umbral (10 min = no inserta)', () => {
    const data = [pt(0, 100), pt(10 * 60_000, 110)]
    expect(injectGaps(data, 24)).toEqual(data)
  })

  it('no inserta si algún extremo ya es null (ya roto)', () => {
    const data = [pt(0, null), pt(60 * 60_000, 100)]
    expect(injectGaps(data, 24)).toHaveLength(2)
  })

  it('inserta múltiples nulls cuando hay varios huecos', () => {
    // 3 puntos, 2 pares con 15 min cada uno → 2 nulls insertados → length 5
    const data = [
      pt(0, 100),
      pt(15 * 60_000, 110),  // hueco: 15 min > 10 min
      pt(30 * 60_000, 120),  // hueco: 15 min > 10 min
    ]
    const result = injectGaps(data, 24)
    expect(result).toHaveLength(5)
    expect(result[1].value).toBeNull()
    expect(result[3].value).toBeNull()
  })
})

describe('injectGaps — modo >24h (umbral 2h)', () => {
  const h = 60 * 60_000

  it('no inserta null cuando delta < 2h en modo 7d', () => {
    const data = [pt(0, 100), pt(1.5 * h, 110)]
    expect(injectGaps(data, 168)).toEqual(data)
  })

  it('inserta null cuando delta > 2h en modo 7d', () => {
    const data = [pt(0, 100), pt(3 * h, 110)]
    expect(injectGaps(data, 168)).toHaveLength(3)
    expect(injectGaps(data, 168)[1].value).toBeNull()
  })
})

describe('injectGaps — casos borde', () => {
  it('devuelve vacío sin modificar', () => {
    expect(injectGaps([], 24)).toEqual([])
  })

  it('devuelve un solo punto sin modificar', () => {
    const data = [pt(0, 100)]
    expect(injectGaps(data, 24)).toEqual(data)
  })
})

// ─── buildChartTicks ─────────────────────────────────────────────────────────

describe('buildChartTicks — todos los ticks tienen minutos y segundos = 0', () => {
  it('6h: ticks en minuto 0 y segundo 0', () => {
    const end = Date.now()
    const start = end - 6 * 60 * 60_000
    const ticks = buildChartTicks(start, end, 6)
    expect(ticks.length).toBeGreaterThan(0)
    ticks.forEach(t => {
      expect(new Date(t).getMinutes()).toBe(0)
      expect(new Date(t).getSeconds()).toBe(0)
    })
  })

  it('24h: ticks en minuto 0, hora múltiplo de 4', () => {
    const end = Date.now()
    const start = end - 24 * 60 * 60_000
    const ticks = buildChartTicks(start, end, 24)
    expect(ticks.length).toBeGreaterThan(0)
    ticks.forEach(t => {
      const d = new Date(t)
      expect(d.getMinutes()).toBe(0)
      expect(d.getHours() % 4).toBe(0)
    })
  })

  it('7d: ticks a medianoche local (hora 0, minuto 0)', () => {
    const end = Date.now()
    const start = end - 7 * 24 * 60 * 60_000
    const ticks = buildChartTicks(start, end, 168)
    expect(ticks.length).toBeGreaterThan(0)
    ticks.forEach(t => {
      const d = new Date(t)
      expect(d.getHours()).toBe(0)
      expect(d.getMinutes()).toBe(0)
    })
  })

  it('30d: ticks a medianoche local, separados 7 días', () => {
    const end = Date.now()
    const start = end - 30 * 24 * 60 * 60_000
    const ticks = buildChartTicks(start, end, 720)
    expect(ticks.length).toBeGreaterThan(0)
    ticks.forEach(t => {
      expect(new Date(t).getHours()).toBe(0)
    })
    // Separación entre ticks consecutivos ≈ 7 días (±1h por DST)
    for (let i = 1; i < ticks.length; i++) {
      const diff = ticks[i] - ticks[i - 1]
      expect(diff).toBeGreaterThanOrEqual(6 * 24 * 60 * 60_000)
      expect(diff).toBeLessThanOrEqual(8 * 24 * 60 * 60_000)
    }
  })

  it('todos los ticks caen dentro del dominio', () => {
    const end = Date.now()
    const start = end - 24 * 60 * 60_000
    buildChartTicks(start, end, 24).forEach(t => {
      expect(t).toBeGreaterThanOrEqual(start)
      expect(t).toBeLessThanOrEqual(end)
    })
  })
})
