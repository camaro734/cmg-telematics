import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import RulesPage from '../RulesPage'
import type { RuleOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('../../../features/auth/useAuthStore', () => ({
  useAuthStore: vi.fn(() => ({ user: { role: 'admin', tenant_tier: 'client' } })),
}))

import { apiClient } from '../../../lib/apiClient'

const mockRule: RuleOut = {
  id: 'r1', tenant_id: 't1', name: 'Presión alta', description: null,
  active: true, severity: 'critical',
  vehicle_filter: { scope: 'all' },
  condition: { type: 'threshold', field: 'hydraulic_pressure_1', op: '>', value: 220 },
  actions: [{ type: 'in_app' }], escalation: [],
  cooldown_minutes: 30, created_at: '2026-04-19T00:00:00Z',
}

function wrap(rules: RuleOut[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(['rules'], rules)
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RulesPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('RulesPage', () => {
  it('muestra mensaje vacío cuando no hay reglas', () => {
    vi.mocked(apiClient.get).mockResolvedValue([])
    wrap([])
    expect(screen.getByText(/Sin reglas configuradas/)).toBeInTheDocument()
  })

  it('muestra nombre y severidad de cada regla', () => {
    vi.mocked(apiClient.get).mockResolvedValue([mockRule])
    wrap([mockRule])
    expect(screen.getByText('Presión alta')).toBeInTheDocument()
    expect(screen.getByText('CRÍTICA')).toBeInTheDocument()
  })

  it('toggle activa/desactiva llama apiClient.put', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([mockRule])
    vi.mocked(apiClient.put).mockResolvedValue({ ...mockRule, active: false })
    wrap([mockRule])
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      '/api/v1/rules/r1', expect.objectContaining({ active: false })
    ))
  })

  it('botón eliminar muestra confirmación y llama apiClient.delete', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([mockRule])
    vi.mocked(apiClient.delete).mockResolvedValue(undefined)
    wrap([mockRule])
    fireEvent.click(screen.getByTitle('Eliminar regla'))
    expect(screen.getByText(/¿Eliminar/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Sí'))
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/rules/r1'))
  })
})
