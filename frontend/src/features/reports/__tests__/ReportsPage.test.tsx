import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import ReportsPage from '../ReportsPage'
import type { TenantOut, VehicleOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
  },
}))
vi.mock('../../auth/useAuthStore', () => ({
  useAuthStore: vi.fn(),
}))
// Fleet statuses hook — returns empty map to avoid individual vehicle status requests
vi.mock('../../fleet/useVehicleStatuses', () => ({
  useVehicleStatuses: vi.fn(() => new Map()),
}))

import { apiClient } from '../../../lib/apiClient'
import { useAuthStore } from '../../auth/useAuthStore'

const cmgUser    = { user_id: 'u1', tenant_id: 't0', tenant_tier: 'cmg',    role: 'admin', email: 'cmg@test.com' }
const clientUser = { user_id: 'u2', tenant_id: 't1', tenant_tier: 'client', role: 'admin', email: 'c@test.com' }

function makeStore(userData: typeof clientUser) {
  const store = {
    user: userData,
    enabledModules: [] as string[],
    logoUrl: null,
    brandName: null,
    logout: vi.fn(),
  }
  // Support both useAuthStore() and useAuthStore(selector) call patterns
  const mockFn = vi.fn((selector?: (s: typeof store) => unknown) =>
    selector ? selector(store) : store
  )
  return mockFn
}

const mockTenants: TenantOut[] = [
  {
    id: 't1', parent_id: 't0', tier: 'client', name: 'Wasterent', slug: 'wasterent', active: true,
    brand_name: null, brand_color: null, logo_url: null, custom_domain: null, brand_tokens: null,
    created_at: '2026-01-01T00:00:00Z', enabled_modules: [],
  },
]
const mockVehicles: VehicleOut[] = [
  {
    id: 'v1', tenant_id: 't1', vehicle_type_id: 'vt1', name: 'WAS-001',
    license_plate: 'WAS001', vin: null, year: null, active: true, created_at: '2026-01-01T00:00:00Z',
  },
]

function wrap(userData = clientUser, tenants: TenantOut[] = [], vehicles: VehicleOut[] = []) {
  vi.mocked(useAuthStore).mockImplementation(makeStore(userData) as unknown as typeof useAuthStore)
  vi.mocked(apiClient.get).mockImplementation((path: string) => {
    if (path.includes('tenants'))      return Promise.resolve(tenants) as never
    if (path.includes('vehicle-types')) return Promise.resolve([]) as never
    if (path.includes('vehicles'))     return Promise.resolve(vehicles) as never
    return Promise.resolve([]) as never
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('renderiza la página mostrando el HOME tab por defecto', () => {
    wrap()
    // HOME tab is default — shows fleet header
    expect(screen.getByText(/Flota/)).toBeInTheDocument()
  })

  it('HOME tab muestra lista de vehículos', async () => {
    wrap(clientUser, [], mockVehicles)
    await waitFor(() => expect(screen.getByText('WAS-001')).toBeInTheDocument())
    expect(screen.getByText('WAS001')).toBeInTheDocument()
  })

  it('HOME tab muestra mensaje de flota vacía', async () => {
    wrap(clientUser, [], [])
    await waitFor(() => expect(screen.getByText(/Sin vehículos/i)).toBeInTheDocument())
  })

  it('CMG admin ve selector de cliente en tab HISTÓRICO', async () => {
    wrap(cmgUser, mockTenants)
    // Switch to historico — the selector bar appears
    const { useReportsTabStore } = await import('../useReportsTabStore')
    useReportsTabStore.getState().setTab('historico')
    await waitFor(() => expect(screen.queryByText('— Cliente —')).toBeInTheDocument())
  })

  it('client admin no ve selector de cliente', () => {
    wrap(clientUser, [])
    expect(screen.queryByText('— Cliente —')).not.toBeInTheDocument()
  })
})
