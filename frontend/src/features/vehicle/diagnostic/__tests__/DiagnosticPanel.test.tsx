import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiagnosticPanel } from '../DiagnosticPanel'
import type { VehicleTypeOut, VehicleStatus, AlertInstanceEnrichedOut } from '../../../../lib/types'

const baseStatus: VehicleStatus = {
  vehicle_id: 'v1', ignition: true, speed_kmh: 0, lat: null, lon: null,
  last_seen: null, pto_active: false,
  can_data: { avl_145: 150 },
}

const noAlerts: AlertInstanceEnrichedOut[] = []

const sensorPresion = {
  key: 'presion', label: 'Presión', unit: 'bar', gauge_type: 'circular' as const,
  avl_id: 145, min: 0, max: 600,
}

const sensorNivel = {
  key: 'nivel', label: 'Nivel', unit: '%', gauge_type: 'tank' as const,
  avl_id: 146, min: 0, max: 100,
}

describe('DiagnosticPanel — fallback sin bloques', () => {
  it('muestra un bloque "Sensores" cuando system_blocks está vacío', () => {
    const vt: VehicleTypeOut = {
      id: 'vt1', slug: 'test', name: 'Test', icon_url: null,
      sensor_schema: [sensorPresion],
      maintenance_templates: [], historic_metrics: [],
      dout_config: [], pdf_metrics: [],
      system_blocks: [],
    }
    render(<DiagnosticPanel vehicleType={vt} status={baseStatus} derived={{}} alerts={noAlerts} />)
    expect(screen.getByText('Sensores')).toBeInTheDocument()
  })
})

describe('DiagnosticPanel — con bloques definidos', () => {
  const vt: VehicleTypeOut = {
    id: 'vt1', slug: 'test', name: 'Test', icon_url: null,
    sensor_schema: [sensorPresion, sensorNivel],
    maintenance_templates: [], historic_metrics: [],
    dout_config: [], pdf_metrics: [],
    system_blocks: [
      {
        id: 'b1', name: 'Hidráulico', icon: 'ti-gauge',
        sensor_keys: ['presion'],
        key_sensor_keys: ['presion'],
        key_count: 1,
      },
    ],
  }

  it('pinta las tarjetas de los bloques definidos', () => {
    const { container } = render(
      <DiagnosticPanel vehicleType={vt} status={baseStatus} derived={{}} alerts={noAlerts} />
    )
    expect(screen.getByText('Hidráulico')).toBeInTheDocument()
    const cards = container.querySelectorAll('[data-testid="system-block-card"]')
    expect(cards.length).toBeGreaterThanOrEqual(1)
  })

  it('añade tarjeta "Otros" con sensores huérfanos', () => {
    render(<DiagnosticPanel vehicleType={vt} status={baseStatus} derived={{}} alerts={noAlerts} />)
    // sensorNivel no está en ningún sensor_keys del bloque → aparece en "Otros"
    expect(screen.getByText('Otros')).toBeInTheDocument()
  })

  it('NO añade "Otros" si todos los sensores están asignados', () => {
    const vtCompleto: VehicleTypeOut = {
      ...vt,
      system_blocks: [{
        id: 'b1', name: 'Hidráulico', icon: 'ti-gauge',
        sensor_keys: ['presion', 'nivel'],
        key_sensor_keys: ['presion', 'nivel'],
        key_count: 2,
      }],
    }
    render(<DiagnosticPanel vehicleType={vtCompleto} status={baseStatus} derived={{}} alerts={noAlerts} />)
    expect(screen.queryByText('Otros')).toBeNull()
  })
})

describe('DiagnosticPanel — contenedor', () => {
  it('renderiza el contenedor con data-testid="diagnostic-panel"', () => {
    const vt: VehicleTypeOut = {
      id: 'vt1', slug: 'test', name: 'Test', icon_url: null,
      sensor_schema: [],
      maintenance_templates: [], historic_metrics: [],
      dout_config: [], pdf_metrics: [],
      system_blocks: [],
    }
    const { container } = render(
      <DiagnosticPanel vehicleType={vt} status={baseStatus} derived={{}} alerts={noAlerts} />
    )
    expect(container.querySelector('[data-testid="diagnostic-panel"]')).toBeTruthy()
  })
})
