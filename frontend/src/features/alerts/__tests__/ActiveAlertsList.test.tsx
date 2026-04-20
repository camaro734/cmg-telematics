import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ActiveAlertsList from '../ActiveAlertsList'
import type { AlertInstanceOut, VehicleOut, RuleOut } from '../../../lib/types'

vi.mock('../AckModal', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="ack-modal"><button onClick={onClose}>cerrar</button></div>
  ),
}))

const alert1: AlertInstanceOut = {
  id: 'a1', rule_id: 'r1', vehicle_id: 'v1', tenant_id: 't1',
  triggered_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  resolved_at: null, status: 'firing',
  trigger_value: { value: 450 },
  ack_by_user_id: null, ack_at: null, ack_note: null,
}

const vehicles: VehicleOut[] = [{
  id: 'v1', tenant_id: 't1', vehicle_type_id: 'vt1',
  name: 'Camión 01', license_plate: null, vin: null,
  year: 2020, active: true, created_at: '2026-01-01T00:00:00Z',
}]

const rules: RuleOut[] = [{ id: 'r1', tenant_id: 't1', name: 'Presión alta', description: null, severity: 'warning', active: true, vehicle_filter: { scope: 'all' }, condition: { type: 'threshold' }, actions: [], escalation: [], cooldown_minutes: 30, created_at: '2026-04-19T00:00:00Z' }]

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>)
}

describe('ActiveAlertsList', () => {
  it('muestra estado vacío si no hay alertas', () => {
    wrap(<ActiveAlertsList alerts={[]} vehicles={[]} rules={[]} />)
    expect(screen.getByText('Sin alertas activas')).toBeInTheDocument()
  })

  it('muestra nombre de regla y vehículo', () => {
    wrap(<ActiveAlertsList alerts={[alert1]} vehicles={vehicles} rules={rules} />)
    expect(screen.getByText('Presión alta')).toBeInTheDocument()
    expect(screen.getByText(/Camión 01/)).toBeInTheDocument()
  })

  it('muestra tiempo transcurrido', () => {
    wrap(<ActiveAlertsList alerts={[alert1]} vehicles={vehicles} rules={rules} />)
    expect(screen.getByText(/hace 5 min/)).toBeInTheDocument()
  })

  it('abre AckModal al hacer clic en Reconocer', () => {
    wrap(<ActiveAlertsList alerts={[alert1]} vehicles={vehicles} rules={rules} />)
    fireEvent.click(screen.getByText('Reconocer'))
    expect(screen.getByTestId('ack-modal')).toBeInTheDocument()
  })

  it('cierra AckModal al llamar onClose', () => {
    wrap(<ActiveAlertsList alerts={[alert1]} vehicles={vehicles} rules={rules} />)
    fireEvent.click(screen.getByText('Reconocer'))
    fireEvent.click(screen.getByText('cerrar'))
    expect(screen.queryByTestId('ack-modal')).not.toBeInTheDocument()
  })
})
