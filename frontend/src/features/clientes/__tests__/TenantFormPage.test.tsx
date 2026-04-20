import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TenantFormPage from '../TenantFormPage'

vi.mock('../../../lib/apiClient', () => ({ apiClient: { post: vi.fn(), put: vi.fn(), get: vi.fn() } }))
vi.mock('../../../features/auth/useAuthStore', () => ({ useAuthStore: vi.fn() }))

import { apiClient } from '../../../lib/apiClient'
import { useAuthStore } from '../../../features/auth/useAuthStore'

const cmgUser = { user_id: 'u1', tenant_id: 't0', tenant_tier: 'cmg' as const, role: 'admin' as const, email: 'admin@cmg.es' }
const newTenant = { id: 't1', parent_id: 't0', tier: 'client', name: 'Wasterent', slug: 'wasterent', active: true, brand_name: null, brand_color: null, logo_url: null, custom_domain: null, brand_tokens: null, created_at: '2026-01-01T00:00:00Z' }

function renderCreate() {
  // TenantFormPage usa useAuthStore() y destructura { user }
  vi.mocked(useAuthStore).mockReturnValue({ user: cmgUser } as ReturnType<typeof useAuthStore>)
  vi.mocked(apiClient.post).mockResolvedValue(newTenant)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/clientes/new']}>
        <Routes><Route path="/clientes/new" element={<TenantFormPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('TenantFormPage', () => {
  it('muestra campos de formulario', () => {
    renderCreate()
    expect(screen.getByText('Nombre')).toBeInTheDocument()
    expect(screen.getByText(/Slug/)).toBeInTheDocument()
  })

  it('llama a POST con tier=client al crear', async () => {
    renderCreate()
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[0], { target: { value: 'Wasterent' } })
    fireEvent.change(inputs[1], { target: { value: 'wasterent' } })
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/tenants',
      expect.objectContaining({ name: 'Wasterent', slug: 'wasterent', tier: 'client' })
    ))
  })
})
