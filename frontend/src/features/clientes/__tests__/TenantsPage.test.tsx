import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TenantsPage from '../TenantsPage'
import type { TenantOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({ apiClient: { get: vi.fn() } }))
vi.mock('../../../features/auth/useAuthStore', () => ({ useAuthStore: vi.fn() }))

import { apiClient } from '../../../lib/apiClient'
import { useAuthStore } from '../../../features/auth/useAuthStore'

const cmgUser = { user_id: 'u1', tenant_id: 't0', tenant_tier: 'cmg' as const, role: 'admin' as const, email: 'admin@cmg.es', enabledModules: [] as string[], logoUrl: null, brandName: null, logout: vi.fn(), user: { user_id: 'u1', tenant_id: 't0', tenant_tier: 'cmg' as const, role: 'admin' as const, email: 'admin@cmg.es' } }
const mockTenants: TenantOut[] = [
  { id: 't1', parent_id: 't0', tier: 'client', name: 'Wasterent', slug: 'wasterent', active: true, brand_name: null, brand_color: null, logo_url: null, custom_domain: null, brand_tokens: null, created_at: '2026-01-01T00:00:00Z' },
]

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter><TenantsPage /></MemoryRouter></QueryClientProvider>)
}

describe('TenantsPage', () => {
  it('muestra lista de clientes', async () => {
    vi.mocked(useAuthStore).mockReturnValue(cmgUser)
    vi.mocked(apiClient.get).mockResolvedValue(mockTenants)
    renderPage()
    expect(await screen.findByText('Wasterent')).toBeInTheDocument()
  })

  it('muestra enlace Nuevo cliente', () => {
    vi.mocked(useAuthStore).mockReturnValue(cmgUser)
    vi.mocked(apiClient.get).mockResolvedValue([])
    renderPage()
    expect(screen.getByText('+ Nuevo cliente')).toBeInTheDocument()
  })

  it('filtra CMG tenant de la lista', async () => {
    const withCmg: TenantOut[] = [
      ...mockTenants,
      { id: 't0', parent_id: null, tier: 'cmg', name: 'CMG', slug: 'cmg', active: true, brand_name: null, brand_color: null, logo_url: null, custom_domain: null, brand_tokens: null, created_at: '2026-01-01T00:00:00Z' },
    ]
    vi.mocked(useAuthStore).mockReturnValue(cmgUser)
    vi.mocked(apiClient.get).mockResolvedValue(withCmg)
    renderPage()
    expect(await screen.findByText('Wasterent')).toBeInTheDocument()
    expect(screen.queryByText('CMG')).not.toBeInTheDocument()
  })
})
