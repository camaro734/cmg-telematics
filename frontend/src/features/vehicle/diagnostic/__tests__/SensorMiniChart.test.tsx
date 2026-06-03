import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SensorMiniChart } from '../SensorMiniChart'
import type { SensorDef, VehicleStatus } from '../../../../lib/types'

const baseStatus: VehicleStatus = {
  vehicle_id: 'v1', ignition: false, speed_kmh: 0,
  lat: null, lon: null, last_seen: null, pto_active: false,
  can_data: { avl_145: 80 }, ext_voltage_mv: null, dout_state: {},
}

const sensorConAvlId: SensorDef = {
  key: 'presion', label: 'Presión', unit: 'bar',
  gauge_type: 'numeric', avl_id: 145,
}

const sensorSinAvlId: SensorDef = {
  key: 'pto_hours', label: 'Horas PTO', unit: 'h',
  gauge_type: 'numeric', kpi_key: 'pto_hours_today',
}

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect() {}
    constructor(_cb: IntersectionObserverCallback) {}
  })
})

describe('SensorMiniChart', () => {
  it('sin avl_id no renderiza nada', () => {
    const { container } = renderWithQuery(
      <SensorMiniChart sensor={sensorSinAvlId} vehicleId="v1" status={baseStatus} derived={{}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('con avl_id renderiza el contenedor', () => {
    renderWithQuery(
      <SensorMiniChart sensor={sensorConAvlId} vehicleId="v1" status={baseStatus} derived={{}} />,
    )
    expect(screen.getByTestId('sensor-mini-chart')).toBeInTheDocument()
  })

  it('sin datos muestra Sin histórico', () => {
    renderWithQuery(
      <SensorMiniChart sensor={sensorConAvlId} vehicleId="v1" status={baseStatus} derived={{}} />,
    )
    expect(screen.getByTestId('sensor-mini-chart-empty')).toBeInTheDocument()
    expect(screen.getByText('Sin histórico')).toBeInTheDocument()
  })
})
