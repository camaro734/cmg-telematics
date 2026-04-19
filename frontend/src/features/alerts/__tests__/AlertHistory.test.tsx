import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AlertHistory from '../AlertHistory'
import type { AlertInstanceOut, VehicleOut, RuleOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: { get: vi.fn().mockResolvedValue([]) },
}))

const vehicles: VehicleOut[] = [{
  id: 'v1', tenant_id: 't1', vehicle_type_id: 'vt1',
  name: 'Camión 01', license_plate: null, vin: null,
  year: 2020, active: true, created_at: '2026-01-01T00:00:00Z',
}]

const rules: RuleOut[] = [{ id: 'r1', name: 'Presión alta', severity: 'warning', active: true }]

const ackedAlert: AlertInstanceOut = {
  id: 'a2', rule_id: 'r1', vehicle_id: 'v1', tenant_id: 't1',
  triggered_at: '2026-04-19T08:00:00Z',
  resolved_at: null, status: 'acknowledged',
  trigger_value: { value: 380, lat: 39.4698, lon: -0.3774 },
  ack_by_user_id: 'u1', ack_at: '2026-04-19T08:05:00Z',
  ack_note: 'Revisado',
}

function wrap(node: React.ReactNode, prefill?: AlertInstanceOut[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  if (prefill) {
    qc.setQueryData(['alerts', 'acknowledged', ''], prefill)
    qc.setQueryData(['alerts', 'resolved', ''], [])
  }
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>)
}

describe('AlertHistory', () => {
  it('muestra mensaje vacío cuando no hay registros', () => {
    wrap(<AlertHistory vehicles={vehicles} rules={rules} />, [])
    expect(screen.getByText(/Sin registros/)).toBeInTheDocument()
  })

  it('muestra fila de alerta reconocida', () => {
    wrap(<AlertHistory vehicles={vehicles} rules={rules} />, [ackedAlert])
    expect(screen.getByText('Presión alta')).toBeInTheDocument()
    expect(screen.getByText('Camión 01')).toBeInTheDocument()
    expect(screen.getByText('RECONOCIDA')).toBeInTheDocument()
    expect(screen.getByText('Revisado')).toBeInTheDocument()
  })

  it('muestra ubicación cuando trigger_value tiene lat/lon', () => {
    wrap(<AlertHistory vehicles={vehicles} rules={rules} />, [ackedAlert])
    expect(screen.getByText('39.4698, -0.3774')).toBeInTheDocument()
  })

  it('muestra — en ubicación cuando no hay lat/lon', () => {
    const noLoc = { ...ackedAlert, trigger_value: { value: 380 } }
    wrap(<AlertHistory vehicles={vehicles} rules={rules} />, [noLoc])
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})
