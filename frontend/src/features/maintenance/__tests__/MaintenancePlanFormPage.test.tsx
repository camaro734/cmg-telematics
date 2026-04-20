import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import MaintenancePlanFormPage from '../MaintenancePlanFormPage'
import { keys } from '../../../lib/queryKeys'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}))
vi.mock('../../../features/auth/useAuthStore', () => ({
  useAuthStore: vi.fn(() => ({ user: { role: 'admin', tenant_tier: 'client' } })),
}))

import { apiClient } from '../../../lib/apiClient'

function wrap(path = '/maintenance/new') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(keys.vehicles(), [{ id: 'v1', name: 'WR-04' }])
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/maintenance/new" element={<MaintenancePlanFormPage />} />
          <Route path="/maintenance/:id/edit" element={<MaintenancePlanFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('MaintenancePlanFormPage', () => {
  it('renderiza el formulario con campo nombre', () => {
    vi.mocked(apiClient.get).mockResolvedValue([{ id: 'v1', name: 'WR-04' }])
    wrap()
    expect(screen.getByPlaceholderText(/Nombre del plan/i)).toBeInTheDocument()
  })

  it('no permite submit sin nombre', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([])
    wrap()
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(apiClient.post).not.toHaveBeenCalled())
  })

  it('submit llama a POST con el payload correcto', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([{ id: 'v1', name: 'WR-04' }])
    vi.mocked(apiClient.post).mockResolvedValue({ id: 'p1', name: 'Aceite' })
    wrap()

    fireEvent.change(screen.getByPlaceholderText(/Nombre del plan/i), { target: { value: 'Aceite hidráulico' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/maintenance/plans',
      expect.objectContaining({ name: 'Aceite hidráulico' })
    ))
  })
})
