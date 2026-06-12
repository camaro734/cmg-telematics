import { describe, it, expect } from 'vitest'
import { injectGaps, buildChartTicks, buildSensorSeries, buildDerivativeSeries } from '../avlSeries'
import type { ChartPointTime, AvlPoint } from '../avlSeries'

const avlPt = (bucket: string, value: number | null): AvlPoint => ({ bucket, value })
const epoch = (offsetMs: number) => new Date(1_700_000_000_000 + offsetMs).toISOString()

const pt = (ts: number, value: number | null): ChartPointTime => ({ ts, label: '', value })

// ─── buildSensorSeries ───────────────────────────────────────────────────────

describe('buildSensorSeries — orden', () => {
  it('ordena la salida ascendente aunque la entrada sea DESC (como devuelve el API)', () => {
    // El API devuelve ORDER BY bucket DESC: más reciente primero
    const raw: AvlPoint[] = [
      avlPt(epoch(20 * 60_000), 300),  // ts +20 min (más reciente)
      avlPt(epoch(10 * 60_000), 200),  // ts +10 min
      avlPt(epoch(0), 100),            // ts base (más antiguo)
    ]
    const result = buildSensorSeries(raw, 1, 0)
    expect(result[0].ts).toBeLessThan(result[1].ts)
    expect(result[1].ts).toBeLessThan(result[2].ts)
    // Valores en el orden ascendente
    expect(result[0].value).toBe(100)
    expect(result[1].value).toBe(200)
    expect(result[2].value).toBe(300)
  })

  it('respeta el orden si la entrada ya es ASC', () => {
    const raw: AvlPoint[] = [
      avlPt(epoch(0), 100),
      avlPt(epoch(10 * 60_000), 200),
    ]
    const result = buildSensorSeries(raw, 1, 0)
    expect(result[0].value).toBe(100)
    expect(result[1].value).toBe(200)
  })
})

describe('buildSensorSeries — sentinels J1939', () => {
  it('raw=255 (0xFF) → null en la serie', () => {
    const raw: AvlPoint[] = [avlPt(epoch(0), 255)]
    const result = buildSensorSeries(raw, 1, 0)
    expect(result[0].value).toBeNull()
  })

  it('raw=65535 (0xFFFF) → null en la serie', () => {
    const raw: AvlPoint[] = [avlPt(epoch(0), 65535)]
    const result = buildSensorSeries(raw, 1, 0)
    expect(result[0].value).toBeNull()
  })

  it('raw=4294967295 (0xFFFFFFFF) → null en la serie', () => {
    const raw: AvlPoint[] = [avlPt(epoch(0), 4294967295)]
    const result = buildSensorSeries(raw, 1, 0)
    expect(result[0].value).toBeNull()
  })

  it('raw=250 (válido) pasa por scale+offset', () => {
    const raw: AvlPoint[] = [avlPt(epoch(0), 250)]
    const result = buildSensorSeries(raw, 0.1, 0)
    expect(result[0].value).toBeCloseTo(25)
  })
})

// ─── buildDerivativeSeries ───────────────────────────────────────────────────

const H = 60 * 60_000  // 1 hora en ms

describe('buildDerivativeSeries — consumo constante', () => {
  it('0.5 L/h: contador sube 0.5L en 1h → tasa 0.5 L/h', () => {
    // escala=0.5 como avl_10315; raw=2 → 1L, raw=3 → 1.5L en 1h = 0.5 L/h
    const raw: AvlPoint[] = [
      avlPt(epoch(0),     2),   // 1.0 L escalado
      avlPt(epoch(H),     3),   // 1.5 L escalado → delta 0.5 L en 1h
    ]
    const result = buildDerivativeSeries(raw, 0.5, 0)
    expect(result.length).toBeGreaterThan(0)
    const last = result[result.length - 1]
    expect(last.value).toBeCloseTo(0.5, 1)
  })

  it('1.0 L/h: contador sube 2L en 2h → tasa 1.0 L/h (ventana rodante)', () => {
    const raw: AvlPoint[] = [
      avlPt(epoch(0),     0),
      avlPt(epoch(H),     2),   // +1L en 1h = 1 L/h
      avlPt(epoch(2 * H), 4),   // +1L en 1h = 1 L/h
    ]
    const result = buildDerivativeSeries(raw, 0.5, 0)
    result.forEach(p => {
      if (p.value !== null) expect(p.value).toBeCloseTo(1.0, 1)
    })
  })

  it('motor parado: contador sin cambio → tasa 0 L/h', () => {
    const raw: AvlPoint[] = [
      avlPt(epoch(0),     10),
      avlPt(epoch(H),     10),  // sin cambio
      avlPt(epoch(2 * H), 10),
    ]
    const result = buildDerivativeSeries(raw, 0.5, 0)
    result.forEach(p => {
      if (p.value !== null) expect(p.value).toBe(0)
    })
  })

  it('devuelve vacío con menos de 2 puntos', () => {
    expect(buildDerivativeSeries([], 1, 0)).toHaveLength(0)
    expect(buildDerivativeSeries([avlPt(epoch(0), 5)], 1, 0)).toHaveLength(0)
  })

  it('descarta valores negativos (imposibles en contador acumulado)', () => {
    const raw: AvlPoint[] = [
      avlPt(epoch(0), 10),
      avlPt(epoch(H), 8),   // retroceso (no debería ocurrir, pero defensivo)
    ]
    const result = buildDerivativeSeries(raw, 0.5, 0)
    result.forEach(p => {
      if (p.value !== null) expect(p.value).toBeGreaterThanOrEqual(0)
    })
  })

  it('ordena entrada DESC correctamente antes de derivar', () => {
    // API devuelve DESC; la derivada debe ser la misma que con ASC
    const rawAsc: AvlPoint[] = [avlPt(epoch(0), 2), avlPt(epoch(H), 4)]
    const rawDesc: AvlPoint[] = [avlPt(epoch(H), 4), avlPt(epoch(0), 2)]
    const a = buildDerivativeSeries(rawAsc, 0.5, 0)
    const b = buildDerivativeSeries(rawDesc, 0.5, 0)
    expect(a.length).toBe(b.length)
    if (a.length > 0) expect(a[0].value).toBeCloseTo(b[0].value as number, 1)
  })
})

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
