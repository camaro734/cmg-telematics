import { describe, it, expect } from 'vitest'
import { computeSensorStats } from '../sensorStats'
import type { ChartPointTime } from '../avlSeries'

const pts = (vals: (number | null)[]): ChartPointTime[] =>
  vals.map((v, i) => ({ ts: i * 1000, label: `t${i}`, value: v }))

describe('computeSensorStats — numérico', () => {
  it('calcula last/min/max/avg ignorando nulls', () => {
    const s = computeSensorStats(pts([null, 10, 20, 30, null, 40]), false)
    expect(s.kind).toBe('numeric')
    if (s.kind === 'numeric') {
      expect(s.last).toBe(40)
      expect(s.min).toBe(10)
      expect(s.max).toBe(40)
      expect(s.avg).toBeCloseTo(25)
    }
  })

  it('devuelve nulls cuando todos los puntos son null', () => {
    const s = computeSensorStats(pts([null, null, null]), false)
    expect(s.kind).toBe('numeric')
    if (s.kind === 'numeric') {
      expect(s.last).toBeNull()
      expect(s.min).toBeNull()
      expect(s.max).toBeNull()
      expect(s.avg).toBeNull()
    }
  })

  it('funciona con un único punto válido', () => {
    const s = computeSensorStats(pts([42]), false)
    expect(s.kind).toBe('numeric')
    if (s.kind === 'numeric') {
      expect(s.last).toBe(42)
      expect(s.min).toBe(42)
      expect(s.max).toBe(42)
      expect(s.avg).toBe(42)
    }
  })

  it('maneja lista vacía', () => {
    const s = computeSensorStats([], false)
    expect(s.kind).toBe('numeric')
    if (s.kind === 'numeric') {
      expect(s.last).toBeNull()
    }
  })
})

describe('computeSensorStats — booleano', () => {
  it('calcula % activo y activaciones con patrón simple', () => {
    // [0, 1, 1, 0] → 2 de 4 activos = 50%, 1 activación (flanco 0→1)
    const s = computeSensorStats(pts([0, 1, 1, 0]), true)
    expect(s.kind).toBe('boolean')
    if (s.kind === 'boolean') {
      expect(s.pctActive).toBeCloseTo(50)
      expect(s.activations).toBe(1)
    }
  })

  it('cuenta múltiples activaciones', () => {
    // [0, 1, 0, 1, 0] → 2 flancos 0→1
    const s = computeSensorStats(pts([0, 1, 0, 1, 0]), true)
    expect(s.kind).toBe('boolean')
    if (s.kind === 'boolean') {
      expect(s.activations).toBe(2)
    }
  })

  it('devuelve 0% y 0 activaciones si todos son 0', () => {
    const s = computeSensorStats(pts([0, 0, 0]), true)
    expect(s.kind).toBe('boolean')
    if (s.kind === 'boolean') {
      expect(s.pctActive).toBe(0)
      expect(s.activations).toBe(0)
    }
  })

  it('devuelve 100% si todos son 1', () => {
    const s = computeSensorStats(pts([1, 1, 1]), true)
    expect(s.kind).toBe('boolean')
    if (s.kind === 'boolean') {
      expect(s.pctActive).toBe(100)
      expect(s.activations).toBe(0) // ya estaba activo, no hubo flanco
    }
  })

  it('ignora nulls al calcular % activo', () => {
    // [null, 1, null, 0] → 1 de 2 no-null = 50%
    const s = computeSensorStats(pts([null, 1, null, 0]), true)
    expect(s.kind).toBe('boolean')
    if (s.kind === 'boolean') {
      expect(s.pctActive).toBeCloseTo(50)
    }
  })
})
