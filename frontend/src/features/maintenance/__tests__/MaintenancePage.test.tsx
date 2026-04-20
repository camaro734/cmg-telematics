import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import MaintenancePage from '../MaintenancePage'
import type { MaintenancePlanOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: { get: vi.fn() },
}))
vi.mock('../../../features/auth/useAuthStore', () => ({
  useAuthStore: vi.fn(() => ({ user: { role: 'admin', tenant_tier: 'client' } })),
}))

import { apiClient } from '../../../lib/apiClient'

const mockPlan: MaintenancePlanOut = {
  id: 'p1', vehicle_id: 'v1', vehicle_name: 'WR-04', tenant_id: 't1',
  name: 'Cambio aceite', trigger_condition: { thresholds: [{ type: 'pto_hours', value: 500 }], op: 'OR' },
  warn_before_pct: 10, active: true, created_at: '2026-04-20T00:00:00Z',
  progress: {
    status: 'próximo',
    thresholds: [{ type: 'pto_hours', current: 460, limit: 500, pct: 92 }],
  },
}

function wrap(plans: MaintenancePlanOut[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(['maintenance', 'plans'], plans)
  qc.setQueryData(['vehicles'], [])
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MaintenancePage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('MaintenancePage', () => {
  it('muestra mensaje vacío cuando no hay planes', () => {
    vi.mocked(apiClient.get).mockResolvedValue([])
    wrap([])
    expect(screen.getByText(/Sin planes de mantenimiento/)).toBeInTheDocument()
  })

  it('muestra nombre del vehículo y del plan', () => {
    vi.mocked(apiClient.get).mockResolvedValue([mockPlan])
    wrap([mockPlan])
    expect(screen.getByText('WR-04')).toBeInTheDocument()
    expect(screen.getByText('Cambio aceite')).toBeInTheDocument()
  })

  it('muestra badge de estado PRÓXIMO', () => {
    vi.mocked(apiClient.get).mockResolvedValue([mockPlan])
    wrap([mockPlan])
    expect(screen.getByText('PRÓXIMO')).toBeInTheDocument()
  })
})
