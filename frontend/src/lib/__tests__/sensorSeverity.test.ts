import { describe, it, expect } from 'vitest'
import { zoneForValue, sensorSeverity } from '../sensorSeverity'
import type { SensorDef } from '../types'

describe('zoneForValue', () => {
  it('devuelve null si value es null', () => {
    expect(zoneForValue(null, { warnAbove: 50 })).toBeNull()
  })

  it('devuelve ok cuando no hay umbrales', () => {
    expect(zoneForValue(100, {})).toBe('ok')
  })

  it('devuelve ok cuando el valor está dentro de los límites', () => {
    expect(zoneForValue(100, { warnAbove: 200, alertAbove: 300, warnBelow: 50, alertBelow: 20 })).toBe('ok')
  })

  it('devuelve warn cuando supera warnAbove (pero no alertAbove)', () => {
    expect(zoneForValue(250, { warnAbove: 200, alertAbove: 300 })).toBe('warn')
  })

  it('devuelve crit cuando supera alertAbove', () => {
    expect(zoneForValue(350, { warnAbove: 200, alertAbove: 300 })).toBe('crit')
  })

  it('crit tiene prioridad sobre warn (en alertAbove exacto)', () => {
    expect(zoneForValue(300, { warnAbove: 200, alertAbove: 300 })).toBe('crit')
  })

  it('devuelve warn cuando cae por debajo de warnBelow (pero no alertBelow)', () => {
    expect(zoneForValue(15, { warnBelow: 20, alertBelow: 10 })).toBe('warn')
  })

  it('devuelve crit cuando cae por debajo de alertBelow', () => {
    expect(zoneForValue(5, { warnBelow: 20, alertBelow: 10 })).toBe('crit')
  })

  it('crit tiene prioridad sobre warn (en alertBelow exacto)', () => {
    expect(zoneForValue(10, { warnBelow: 20, alertBelow: 10 })).toBe('crit')
  })
})

describe('sensorSeverity', () => {
  const sensor: SensorDef = {
    key: 'presion',
    label: 'Presión',
    unit: 'bar',
    gauge_type: 'circular',
    warn_above: 300,
    alert_above: 400,
    warn_below: 50,
    alert_below: 20,
  }

  it('devuelve ok para valor nominal', () => {
    expect(sensorSeverity(sensor, 200)).toBe('ok')
  })

  it('devuelve warn por arriba', () => {
    expect(sensorSeverity(sensor, 350)).toBe('warn')
  })

  it('devuelve crit por arriba', () => {
    expect(sensorSeverity(sensor, 450)).toBe('crit')
  })

  it('devuelve warn por abajo', () => {
    expect(sensorSeverity(sensor, 30)).toBe('warn')
  })

  it('devuelve crit por abajo', () => {
    expect(sensorSeverity(sensor, 10)).toBe('crit')
  })

  it('devuelve null para value null', () => {
    expect(sensorSeverity(sensor, null)).toBeNull()
  })
})
