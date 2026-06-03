import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BlockDetailSection } from '../BlockDetailSection'
import type { SystemBlock, SensorDef, VehicleStatus, AlertInstanceEnrichedOut } from '../../../../lib/types'

const baseStatus: VehicleStatus = {
  vehicle_id: 'v1', ignition: false, speed_kmh: 0,
  lat: null, lon: null, last_seen: null, pto_active: false,
  can_data: { avl_145: 120, avl_146: 5 }, ext_voltage_mv: null, dout_state: {},
}

const sensorPresion: SensorDef = {
  key: 'presion', label: 'Presión', unit: 'bar', gauge_type: 'numeric', avl_id: 145,
}
const sensorNivel: SensorDef = {
  key: 'nivel', label: 'Nivel', unit: '%', gauge_type: 'numeric', avl_id: 146,
}
const sensorOtro: SensorDef = {
  key: 'rpm', label: 'RPM', unit: 'rpm', gauge_type: 'numeric', avl_id: 200,
}

const block: SystemBlock = {
  id: 'b1', name: 'Hidráulico', icon: 'ti-gauge',
  sensor_keys: ['presion', 'nivel'],
  key_sensor_keys: ['presion'],
  key_count: 1,
}

const schema = [sensorPresion, sensorNivel, sensorOtro]

const alertEnBloque: AlertInstanceEnrichedOut = {
  id: 'a1', rule_id: 'r1', vehicle_id: 'v1', tenant_id: 't1',
  rule_name: 'Presión alta', severity: 'critical',
  triggered_at: '2026-06-02T10:00:00Z', resolved_at: null,
  status: 'firing', trigger_value: { field: 'avl_145' },
  ack_by_user_id: null, ack_at: null, ack_note: null,
  vehicle_name: 'Test',
}

const alertFueraDeBloque: AlertInstanceEnrichedOut = {
  ...alertEnBloque,
  id: 'a2', rule_name: 'RPM alta', trigger_value: { field: 'avl_200' },
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

describe('BlockDetailSection', () => {
  it('muestra el nombre del bloque', () => {
    renderWithQuery(
      <BlockDetailSection block={block} schema={schema} status={baseStatus}
        derived={{}} alerts={[]} vehicleId="v1" />,
    )
    expect(screen.getByText('Hidráulico')).toBeInTheDocument()
  })

  it('muestra todos los sensores de sensor_keys (no solo key_sensor_keys)', () => {
    renderWithQuery(
      <BlockDetailSection block={block} schema={schema} status={baseStatus}
        derived={{}} alerts={[]} vehicleId="v1" />,
    )
    expect(screen.getByText('Presión')).toBeInTheDocument()
    expect(screen.getByText('Nivel')).toBeInTheDocument()
    expect(screen.queryByText('RPM')).not.toBeInTheDocument()
  })

  it('muestra solo alertas que mapean a sensores del bloque', () => {
    renderWithQuery(
      <BlockDetailSection block={block} schema={schema} status={baseStatus}
        derived={{}} alerts={[alertEnBloque, alertFueraDeBloque]} vehicleId="v1" />,
    )
    expect(screen.getByText('Presión alta')).toBeInTheDocument()
    expect(screen.queryByText('RPM alta')).not.toBeInTheDocument()
  })

  it('no muestra sección de alertas cuando no hay alertas del bloque', () => {
    renderWithQuery(
      <BlockDetailSection block={block} schema={schema} status={baseStatus}
        derived={{}} alerts={[alertFueraDeBloque]} vehicleId="v1" />,
    )
    expect(screen.queryByText('Alertas activas')).not.toBeInTheDocument()
  })
})
