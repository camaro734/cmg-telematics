import { describe, it, expect } from 'vitest'
import { buildPopupHtml, sensorDisplayValue } from '../popupHtml'
import type { VehicleOut, VehicleStatus, VehicleTypeOut, SensorDef } from '../../../lib/types'

const vacioSensor: SensorDef = {
  key: 'vacio',
  label: 'Vacío depresor',
  unit: 'bar',
  gauge_type: 'linear',
  avl_id: 152,
  visible_in_detail: true,
  transform: { type: 'linear_range', in_min: 4000, in_max: 20000, out_min: -1, out_max: 10 },
}

const vehicleType = { sensor_schema: [vacioSensor] } as unknown as VehicleTypeOut

const vehicle = {
  id: 'v1',
  tenant_id: 't1',
  name: 'Cisterna 1',
  license_plate: '1234-ABC',
  driver_name: null,
} as unknown as VehicleOut

const status: VehicleStatus = {
  vehicle_id: 'v1',
  ignition: true,
  speed_kmh: 0,
  lat: null,
  lon: null,
  last_seen: new Date().toISOString(),
  pto_active: false,
  can_data: { avl_152: 12000 },
}

describe('sensorDisplayValue', () => {
  it('transforma 12000 → 4.5 bar', () => {
    expect(sensorDisplayValue(vacioSensor, status)).toBe('4.5 bar')
  })

  it('avl_id sin dato → "—"', () => {
    const noData = { ...status, can_data: {} }
    expect(sensorDisplayValue(vacioSensor, noData)).toBe('—')
  })

  it('batería por status_field (ext_voltage_mv 13613 → 13.6 V)', () => {
    const battery: SensorDef = {
      key: 'ext_voltage', label: 'Batería', unit: 'V', gauge_type: 'numeric',
      status_field: 'ext_voltage_mv', scale: 0.001, visible_in_detail: true,
    }
    const st = { ...status, ext_voltage_mv: 13613 } as VehicleStatus
    expect(sensorDisplayValue(battery, st)).toBe('13.6 V')
  })
})

describe('buildPopupHtml — desplegable "Ver más"', () => {
  const html = buildPopupHtml(vehicle, status, [], new Map(), new Map(), vehicleType)

  it('incluye el bloque desplegable de sensores', () => {
    expect(html).toContain('data-popup-section="more"')
    expect(html).toContain('Sensores')
  })

  it('muestra el valor transformado del sensor numérico (4.5 bar)', () => {
    expect(html).toContain('Vacío depresor')
    expect(html).toContain('4.5 bar')
  })

  it('conserva el botón "Ver más"', () => {
    expect(html).toContain('data-popup-action="toggle-more"')
  })

  it('ya no incluye el bloque "Equipo industrial"', () => {
    expect(html).not.toContain('Equipo industrial')
  })

  it('omite sensores sin lectura actual (no muestra "—" en la lista)', () => {
    const sinDato: SensorDef = {
      key: 'led_x', label: 'Bomba', unit: null, gauge_type: 'led',
      avl_id: 383, visible_in_detail: true,
    }
    const vt = { sensor_schema: [vacioSensor, sinDato] } as unknown as VehicleTypeOut
    const out = buildPopupHtml(vehicle, status, [], new Map(), new Map(), vt)
    expect(out).toContain('Vacío depresor')   // con dato → presente
    expect(out).not.toContain('Bomba')        // sin dato → omitido
  })
})
