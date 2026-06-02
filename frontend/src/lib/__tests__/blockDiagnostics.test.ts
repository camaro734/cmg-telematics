import { describe, it, expect } from 'vitest'
import { blockDiagnostics } from '../blockDiagnostics'
import type { SystemBlock, SensorDef, VehicleStatus, AlertInstanceEnrichedOut } from '../types'

const presionSensor: SensorDef = {
  key: 'presion',
  label: 'Presión bomba',
  unit: 'bar',
  gauge_type: 'circular',
  avl_id: 145,
  scale: 0.1,
  offset: 0,
  warn_above: 200,
  alert_above: 300,
}

const nivelSensor: SensorDef = {
  key: 'nivel_aceite',
  label: 'Nivel aceite',
  unit: '%',
  gauge_type: 'tank',
  avl_id: 146,
  warn_below: 20,
  alert_below: 10,
}

const schema: SensorDef[] = [presionSensor, nivelSensor]

const block: SystemBlock = {
  id: 'b1',
  name: 'Hidráulico',
  icon: 'ti-gauge',
  sensor_keys: ['presion', 'nivel_aceite'],
  key_sensor_keys: ['presion', 'nivel_aceite'],
  key_count: 2,
}

const baseStatus: VehicleStatus = {
  vehicle_id: 'v1',
  ignition: true,
  speed_kmh: 0,
  lat: null,
  lon: null,
  last_seen: null,
  pto_active: false,
  can_data: { avl_145: 1500, avl_146: 80 }, // 1500 * 0.1 = 150 bar (ok), 80% (ok)
}

const noAlerts: AlertInstanceEnrichedOut[] = []

describe('blockDiagnostics — zona ok', () => {
  it('devuelve zone=ok y frase "Funcionando normal" cuando todo está bien', () => {
    const result = blockDiagnostics(block, schema, baseStatus, {}, noAlerts)
    expect(result.zone).toBe('ok')
    expect(result.phrase).toBe('Funcionando normal')
  })
})

describe('blockDiagnostics — zona por umbral', () => {
  it('devuelve warn cuando sensor supera warnAbove', () => {
    const status = { ...baseStatus, can_data: { avl_145: 2500, avl_146: 80 } } // 2500 * 0.1 = 250 > 200
    const result = blockDiagnostics(block, schema, status, {}, noAlerts)
    expect(result.zone).toBe('warn')
    expect(result.phrase).toBe('Presión bomba alto')
  })

  it('devuelve crit cuando sensor supera alertAbove', () => {
    const status = { ...baseStatus, can_data: { avl_145: 3500, avl_146: 80 } } // 350 > 300
    const result = blockDiagnostics(block, schema, status, {}, noAlerts)
    expect(result.zone).toBe('crit')
    expect(result.phrase).toBe('Presión bomba alto')
  })

  it('devuelve warn cuando sensor cae por debajo de warnBelow', () => {
    const status = { ...baseStatus, can_data: { avl_145: 1500, avl_146: 15 } } // 15 < 20
    const result = blockDiagnostics(block, schema, status, {}, noAlerts)
    expect(result.zone).toBe('warn')
    expect(result.phrase).toBe('Nivel aceite bajo')
  })

  it('devuelve crit cuando sensor cae por debajo de alertBelow', () => {
    const status = { ...baseStatus, can_data: { avl_145: 1500, avl_146: 5 } } // 5 < 10
    const result = blockDiagnostics(block, schema, status, {}, noAlerts)
    expect(result.zone).toBe('crit')
    expect(result.phrase).toBe('Nivel aceite bajo')
  })
})

describe('blockDiagnostics — mapeo de alertas', () => {
  const alertByAvl: AlertInstanceEnrichedOut = {
    id: 'a1', rule_id: 'r1', vehicle_id: 'v1', tenant_id: 't1',
    triggered_at: '', resolved_at: null, status: 'firing',
    trigger_value: { field: 'avl_145', value: 350 },
    ack_by_user_id: null, ack_at: null, ack_note: null,
    rule_name: 'Presión crítica', vehicle_name: 'V1', severity: 'critical',
  }

  it('mapea alerta por avl_id a sensor key y usa rule_name como frase', () => {
    const result = blockDiagnostics(block, schema, baseStatus, {}, [alertByAvl])
    expect(result.zone).toBe('crit')
    expect(result.phrase).toBe('Presión crítica')
  })

  const alertByKey: AlertInstanceEnrichedOut = {
    ...alertByAvl, id: 'a2',
    trigger_value: { field: 'presion', value: 350 },
    rule_name: 'Presión por key',
  }

  it('mapea alerta por field=key directamente', () => {
    const result = blockDiagnostics(block, schema, baseStatus, {}, [alertByKey])
    expect(result.zone).toBe('crit')
    expect(result.phrase).toBe('Presión por key')
  })

  const alertGeofence: AlertInstanceEnrichedOut = {
    ...alertByAvl, id: 'a3',
    trigger_value: { lat: 1, lon: 2, action: 'enter' },
    severity: 'warning',
    rule_name: 'Geocerca',
  }

  it('no mapea alertas geofence (sin field) — se ignoran', () => {
    const result = blockDiagnostics(block, schema, baseStatus, {}, [alertGeofence])
    expect(result.zone).toBe('ok')
    expect(result.phrase).toBe('Funcionando normal')
  })

  const alertComposite: AlertInstanceEnrichedOut = {
    ...alertByAvl, id: 'a4',
    trigger_value: { composite_op: 'AND' },
    severity: 'warning',
    rule_name: 'Compuesta',
  }

  it('no mapea alertas composite', () => {
    const result = blockDiagnostics(block, schema, baseStatus, {}, [alertComposite])
    expect(result.zone).toBe('ok')
  })

  it('alerta fuera de key_sensor_keys se ignora', () => {
    const blockRestrictivo: SystemBlock = { ...block, key_sensor_keys: ['nivel_aceite'] }
    const result = blockDiagnostics(blockRestrictivo, schema, baseStatus, {}, [alertByAvl])
    expect(result.zone).toBe('ok')
  })
})

describe('blockDiagnostics — frase con múltiples incidencias', () => {
  it('una incidencia → su etiqueta', () => {
    const status = { ...baseStatus, can_data: { avl_145: 2500, avl_146: 80 } }
    const result = blockDiagnostics(block, schema, status, {}, noAlerts)
    expect(result.phrase).toBe('Presión bomba alto')
  })

  it('dos incidencias → "2 incidencias"', () => {
    const status = { ...baseStatus, can_data: { avl_145: 2500, avl_146: 5 } }
    const result = blockDiagnostics(block, schema, status, {}, noAlerts)
    expect(result.phrase).toBe('2 incidencias')
  })
})

describe('blockDiagnostics — peor entre umbral y alerta (dedup)', () => {
  it('alerta + umbral en mismo sensor → cuenta UNA incidencia, zona crit', () => {
    const alertWarn: AlertInstanceEnrichedOut = {
      id: 'a1', rule_id: 'r1', vehicle_id: 'v1', tenant_id: 't1',
      triggered_at: '', resolved_at: null, status: 'firing',
      trigger_value: { field: 'avl_145', value: 250 },
      ack_by_user_id: null, ack_at: null, ack_note: null,
      rule_name: 'Alerta warn', vehicle_name: 'V1', severity: 'warning',
    }
    // Sensor también supera alertAbove → crit por umbral
    const status = { ...baseStatus, can_data: { avl_145: 3500, avl_146: 80 } }
    const result = blockDiagnostics(block, schema, status, {}, [alertWarn])
    expect(result.zone).toBe('crit')
    // Solo una incidencia (mismo sensor, se dedup)
    expect(result.phrase).not.toBe('2 incidencias')
  })
})

describe('blockDiagnostics — estado nodata', () => {
  it('todos los sensores clave sin dato y sin alertas → zone=nodata, frase "Sin datos"', () => {
    const status = { ...baseStatus, can_data: {} }
    const result = blockDiagnostics(block, schema, status, {}, noAlerts)
    expect(result.zone).toBe('nodata')
    expect(result.phrase).toBe('Sin datos')
  })

  it('can_data null → nodata', () => {
    const status = { ...baseStatus, can_data: null }
    const result = blockDiagnostics(block, schema, status, {}, noAlerts)
    expect(result.zone).toBe('nodata')
    expect(result.phrase).toBe('Sin datos')
  })

  it('algún sensor con dato → NO es nodata (lógica normal)', () => {
    // Solo nivel_aceite tiene dato (presion sigue sin dato)
    const status = { ...baseStatus, can_data: { avl_146: 80 } }
    const result = blockDiagnostics(block, schema, status, {}, noAlerts)
    expect(result.zone).not.toBe('nodata')
    expect(result.zone).toBe('ok')
  })

  it('sin dato en sensores pero con alerta mapeada → NO es nodata', () => {
    const alert: AlertInstanceEnrichedOut = {
      id: 'a1', rule_id: 'r1', vehicle_id: 'v1', tenant_id: 't1',
      triggered_at: '', resolved_at: null, status: 'firing',
      trigger_value: { field: 'avl_145', value: 350 },
      ack_by_user_id: null, ack_at: null, ack_note: null,
      rule_name: 'Presión crítica', vehicle_name: 'V1', severity: 'critical',
    }
    const status = { ...baseStatus, can_data: {} }
    const result = blockDiagnostics(block, schema, status, {}, [alert])
    expect(result.zone).not.toBe('nodata')
    expect(result.zone).toBe('crit')
  })
})
