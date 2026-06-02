import { describe, it, expect } from 'vitest'
import { resolveRawValue, applyScaleOffset, bitValue } from '../sensorValue'
import type { SensorDef, VehicleStatus } from '../types'

const baseStatus: VehicleStatus = {
  vehicle_id: 'v1',
  ignition: false,
  speed_kmh: 0,
  lat: null,
  lon: null,
  last_seen: null,
  pto_active: false,
  can_data: { avl_145: 250, avl_30: 800 },
}

const baseSensor: SensorDef = {
  key: 'presion',
  label: 'Presión',
  unit: 'bar',
  gauge_type: 'circular',
}

describe('resolveRawValue', () => {
  it('resuelve por avl_id desde can_data', () => {
    const sensor: SensorDef = { ...baseSensor, avl_id: 145 }
    expect(resolveRawValue(sensor, baseStatus, {})).toBe(250)
  })

  it('devuelve null si avl_id no existe en can_data', () => {
    const sensor: SensorDef = { ...baseSensor, avl_id: 999 }
    expect(resolveRawValue(sensor, baseStatus, {})).toBeNull()
  })

  it('resuelve por kpi_key desde derived', () => {
    const sensor: SensorDef = { ...baseSensor, kpi_key: 'pto_hours' }
    expect(resolveRawValue(sensor, baseStatus, { pto_hours: 42 })).toBe(42)
  })

  it('devuelve null si kpi_key no existe en derived', () => {
    const sensor: SensorDef = { ...baseSensor, kpi_key: 'inexistente' }
    expect(resolveRawValue(sensor, baseStatus, {})).toBeNull()
  })

  it('devuelve null si no hay avl_id ni kpi_key', () => {
    expect(resolveRawValue(baseSensor, baseStatus, {})).toBeNull()
  })

  it('devuelve null si can_data es null', () => {
    const sensor: SensorDef = { ...baseSensor, avl_id: 145 }
    const status = { ...baseStatus, can_data: null }
    expect(resolveRawValue(sensor, status, {})).toBeNull()
  })
})

describe('resolveRawValue — status_field', () => {
  const statusFull: VehicleStatus = {
    ...baseStatus,
    ext_voltage_mv: 12400,
    ignition: true,
    can_data: null,
  }

  it('resuelve número desde status_field (ext_voltage_mv)', () => {
    const sensor: SensorDef = { ...baseSensor, status_field: 'ext_voltage_mv' }
    expect(resolveRawValue(sensor, statusFull, {})).toBe(12400)
  })

  it('resuelve boolean true → 1 (ignition)', () => {
    const sensor: SensorDef = { ...baseSensor, status_field: 'ignition' }
    expect(resolveRawValue(sensor, statusFull, {})).toBe(1)
  })

  it('resuelve boolean false → 0', () => {
    const sensor: SensorDef = { ...baseSensor, status_field: 'ignition' }
    const statusOff = { ...statusFull, ignition: false }
    expect(resolveRawValue(sensor, statusOff, {})).toBe(0)
  })

  it('devuelve null si el status_field es null', () => {
    const sensor: SensorDef = { ...baseSensor, status_field: 'ext_voltage_mv' }
    const statusNoVolt = { ...statusFull, ext_voltage_mv: null }
    expect(resolveRawValue(sensor, statusNoVolt, {})).toBeNull()
  })

  it('status_field tiene prioridad sobre avl_id', () => {
    const sensor: SensorDef = { ...baseSensor, status_field: 'ext_voltage_mv', avl_id: 145 }
    // avl_145 = 250 en can_data, ext_voltage_mv = 12400 → debe ganar status_field
    const status = { ...statusFull, can_data: { avl_145: 250 } }
    expect(resolveRawValue(sensor, status, {})).toBe(12400)
  })
})

describe('applyScaleOffset', () => {
  it('aplica escala y offset', () => {
    expect(applyScaleOffset(100, 0.1, 5)).toBeCloseTo(15)
  })

  it('sin argumentos usa scale=1 y offset=0', () => {
    expect(applyScaleOffset(100)).toBe(100)
  })

  it('devuelve null si raw es null', () => {
    expect(applyScaleOffset(null, 2, 10)).toBeNull()
  })
})

describe('bitValue', () => {
  it('extrae un bit concreto (bit 2 de 0b0100 = true)', () => {
    expect(bitValue(4, 2)).toBe(true)
  })

  it('extrae bit a 0 correctamente', () => {
    expect(bitValue(4, 0)).toBe(false)
  })

  it('sin bit_index: raw != 0 → true', () => {
    expect(bitValue(5)).toBe(true)
  })

  it('sin bit_index: raw === 0 → false', () => {
    expect(bitValue(0)).toBe(false)
  })

  it('devuelve null si raw es null', () => {
    expect(bitValue(null, 2)).toBeNull()
    expect(bitValue(null)).toBeNull()
  })
})
