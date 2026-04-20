import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TenantDetailPage from '../TenantDetailPage'
import type { TenantOut, UserOut, VehicleOut, GrantOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))
vi.mock('../../../features/auth/useAuthStore', () => ({ useAuthStore: vi.fn() }))

import { apiClient } from '../../../lib/apiClient'
import { useAuthStore } from '../../../features/auth/useAuthStore'

const cmgUser = { user_id: 'u1', tenant_id: 't0', tenant_tier: 'cmg' as const, role: 'admin' as const, email: 'admin@cmg.es' }
const tenant: TenantOut = { id: 't1', parent_id: 't0', tier: 'client', name: 'Wasterent', slug: 'wasterent', active: true, brand_name: null, brand_color: null, logo_url: null, custom_domain: null, brand_tokens: null, created_at: '2026-01-01T00:00:00Z' }
const users: UserOut[] = [{ id: 'u2', tenant_id: 't1', email: 'op@wasterent.com', full_name: 'Operador', role: 'operator', active: true, created_at: '2026-01-01T00:00:00Z' }]

function renderDetail() {
  vi.mocked(useAuthStore).mockReturnValue(cmgUser)
  vi.mocked(apiClient.get).mockImplementation((url: string) => {
    if (url.includes('/users')) return Promise.resolve(users)
    if (url.includes('/vehicles')) return Promise.resolve([] as VehicleOut[])
    if (url.includes('/grants')) return Promise.resolve([] as GrantOut[])
    if (url.includes('/brand-tokens')) return Promise.resolve({})
    return Promise.resolve(tenant)
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/clientes/t1']}>
        <Routes><Route path="/clientes/:id" element={<TenantDetailPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('TenantDetailPage', () => {
  it('muestra nombre del cliente', async () => {
    renderDetail()
    // El nombre aparece en la cabecera de la página (h2) y en el Shell (title)
    const matches = await screen.findAllByText('Wasterent')
    expect(matches.length).toBeGreaterThan(0)
  })

  it('muestra usuario en sección Usuarios', async () => {
    renderDetail()
    expect(await screen.findByText('op@wasterent.com')).toBeInTheDocument()
  })

  it('muestra las 5 secciones', async () => {
    renderDetail()
    expect(await screen.findByText('Usuarios')).toBeInTheDocument()
    expect(await screen.findByText('Vehículos')).toBeInTheDocument()
    expect(await screen.findByText('Permission Grants')).toBeInTheDocument()
    expect(await screen.findByText('White-label')).toBeInTheDocument()
  })
})
