import { applyTransform, J1939_NA, type TransformInput } from './sensorValue'

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
// Ordena siempre ASC por bucket (el API devuelve DESC) para que injectGaps
// y calcBrushRange reciban los datos en orden cronológico.
// Excluye centinelas J1939 "not available" (0xFF, 0xFFFF, 0xFFFFFFFF).
export function buildSensorSeries(
  raw: AvlPoint[],
  sensor: TransformInput,
): ChartPointTime[] {
  const sorted = raw.slice().sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0))
  return sorted.map(d => {
    const ts = new Date(d.bucket).getTime()
    const label = new Date(d.bucket).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    if (d.value === null) return { ts, label, value: null }
    if (J1939_NA.has(d.value)) return { ts, label, value: null }
    const v = applyTransform(d.value, sensor)
    if (v === null) return { ts, label, value: null }
    return { ts, label, value: Math.round(v * 100) / 100 }
  })
}

/**
 * Para sensores de contador acumulado (avl_10315, km totales…):
 * calcula la tasa de variación en unidades/hora usando una ventana rodante de 1h.
 *
 * Ventana 1h: suaviza la cuantización gruesa (e.g. 0.5 L/bit del J1939) —
 * con ventanas menores la tasa oscilaría entre 0 y valores pico por la resolución
 * del sensor. Se requiere al menos 15 min de ventana efectiva para emitir un punto.
 */
export function buildDerivativeSeries(
  raw: AvlPoint[],
  sensor: TransformInput,
): ChartPointTime[] {
  const sorted = raw
    .filter(d => d.value !== null && !J1939_NA.has(d.value as number))
    .slice()
    .sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0))

  if (sorted.length < 2) return []

  const WINDOW_MS    = 60 * 60_000  // ventana rodante 1h
  const MIN_WINDOW_MS = 15 * 60_000  // mínimo efectivo 15 min

  const result: ChartPointTime[] = []

  for (let i = 1; i < sorted.length; i++) {
    const currTs = new Date(sorted[i].bucket).getTime()
    const windowStart = currTs - WINDOW_MS

    // Punto de referencia: el más antiguo dentro de la ventana 1h
    let refIdx = -1
    for (let j = 0; j < i; j++) {
      if (new Date(sorted[j].bucket).getTime() >= windowStart) {
        refIdx = j
        break
      }
    }
    if (refIdx === -1) continue

    const refTs = new Date(sorted[refIdx].bucket).getTime()
    const dtHours = (currTs - refTs) / 3_600_000
    if (dtHours < MIN_WINDOW_MS / 3_600_000) continue

    const currV = applyTransform(sorted[i].value!, sensor) ?? sorted[i].value!
    const refV  = applyTransform(sorted[refIdx].value!, sensor) ?? sorted[refIdx].value!
    const rate  = Math.max(0, (currV - refV) / dtHours)

    const label = new Date(currTs).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    result.push({ ts: currTs, label, value: Math.round(rate * 10) / 10 })
  }

  return result
}

/**
 * Inserta un punto null en el medio de cada hueco real entre muestras.
 * Criterio documentado:
 *   ≤24h (raw, intervalo esperado ~1-5 min) → hueco si delta > 10 min
 *   >24h (hourly AVG, intervalo esperado 1h) → hueco si delta > 2h
 * Solo rompe cuando AMBOS extremos tienen valor; si uno ya es null, la línea
 * ya está rota y no hace falta añadir otro null.
 */
export function injectGaps(data: ChartPointTime[], hours: number): ChartPointTime[] {
  if (data.length < 2) return data
  const gapMs = hours <= 24 ? 10 * 60_000 : 2 * 60 * 60_000
  const out: ChartPointTime[] = []
  for (let i = 0; i < data.length; i++) {
    out.push(data[i])
    if (
      i < data.length - 1 &&
      data[i].value !== null &&
      data[i + 1].value !== null &&
      data[i + 1].ts - data[i].ts > gapMs
    ) {
      const midTs = Math.round((data[i].ts + data[i + 1].ts) / 2)
      out.push({ ts: midTs, label: '', value: null })
    }
  }
  return out
}

/**
 * Genera ticks redondos para el eje X según el rango seleccionado.
 *   6h  → cada hora en punto
 *   24h → cada 4 horas en punto (00:00, 04:00, 08:00…)
 *   7d  → cada día a medianoche local
 *   30d → cada semana (7 días) a medianoche local
 * Todos los ticks caen dentro del dominio [domainStart, domainEnd].
 */
export function buildChartTicks(domainStart: number, domainEnd: number, hours: number): number[] {
  const ticks: number[] = []
  const d = new Date(domainStart)

  if (hours <= 6) {
    // Primer tick: siguiente hora en punto tras domainStart
    d.setMinutes(0, 0, 0)
    d.setHours(d.getHours() + 1)
    while (d.getTime() <= domainEnd) {
      ticks.push(d.getTime())
      d.setHours(d.getHours() + 1)
    }
  } else if (hours <= 24) {
    // Primer tick: siguiente múltiplo de 4h en punto tras domainStart
    d.setMinutes(0, 0, 0)
    while (d.getHours() % 4 !== 0 || d.getTime() <= domainStart) {
      d.setHours(d.getHours() + 1)
    }
    while (d.getTime() <= domainEnd) {
      ticks.push(d.getTime())
      d.setHours(d.getHours() + 4)
    }
  } else if (hours <= 168) {
    // Primer tick: medianoche local del día siguiente a domainStart
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + 1)
    while (d.getTime() <= domainEnd) {
      ticks.push(d.getTime())
      d.setDate(d.getDate() + 1)
    }
  } else {
    // 30d: cada semana desde la primera medianoche
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + 1)
    while (d.getTime() <= domainEnd) {
      ticks.push(d.getTime())
      d.setDate(d.getDate() + 7)
    }
  }
  return ticks
}
