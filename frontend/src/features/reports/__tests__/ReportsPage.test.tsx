import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import ReportsPage from '../ReportsPage'
import type { TenantOut, VehicleOut } from '../../../lib/types'

const mockGetBlob = vi.hoisted(() => vi.fn())

vi.mock('../../../lib/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    getBlob: mockGetBlob,
  },
}))
vi.mock('../../auth/useAuthStore', () => ({
  useAuthStore: vi.fn(),
}))

import { apiClient } from '../../../lib/apiClient'
import { useAuthStore } from '../../auth/useAuthStore'

const cmgUser = { user_id: 'u1', tenant_id: 't0', tenant_tier: 'cmg', role: 'admin', email: 'cmg@test.com' }
const clientUser = { user_id: 'u2', tenant_id: 't1', tenant_tier: 'client', role: 'admin', email: 'c@test.com' }

const mockTenants: TenantOut[] = [
  {
    id: 't1', parent_id: 't0', tier: 'client', name: 'Wasterent', slug: 'wasterent', active: true,
    brand_name: null, brand_color: null, logo_url: null, custom_domain: null, brand_tokens: null,
    created_at: '2026-01-01T00:00:00Z',
  },
]
const mockVehicles: VehicleOut[] = [
  {
    id: 'v1', tenant_id: 't1', vehicle_type_id: 'vt1', name: 'WAS-001',
    license_plate: 'WAS001', vin: null, year: null, active: true, created_at: '2026-01-01T00:00:00Z',
  },
]

function wrap(userData = clientUser, tenants: TenantOut[] = [], vehicles: VehicleOut[] = []) {
  vi.mocked(useAuthStore).mockReturnValue(userData as any)
  vi.mocked(apiClient.get).mockImplementation((path: string) => {
    if (path.includes('tenants')) return Promise.resolve(tenants) as any
    if (path.includes('vehicles')) return Promise.resolve(vehicles) as any
    return Promise.resolve([]) as any
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

  it('renderiza formulario con mes anterior por defecto', () => {
    wrap()
    const now = new Date()
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const expectedYear = prev.getFullYear()
    expect(screen.getByDisplayValue(String(expectedYear))).toBeInTheDocument()
  })

  it('CMG admin ve selector de cliente', async () => {
    wrap(cmgUser, mockTenants)
    expect(await screen.findByText('Cliente')).toBeInTheDocument()
  })

  it('client admin no ve selector de cliente', () => {
    wrap(clientUser, [])
    expect(screen.queryByText('Cliente')).not.toBeInTheDocument()
  })

  it('llama a getBlob con params correctos al enviar', async () => {
    mockGetBlob.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }))
    global.URL.createObjectURL = vi.fn(() => 'blob:fake')
    global.URL.revokeObjectURL = vi.fn()

    // Render first so React DOM is complete
    wrap(clientUser, [], mockVehicles)
    const btn = await screen.findByText('↓ Generar PDF')

    // Spy on body.appendChild to capture the anchor and intercept its click
    const mockClick = vi.fn()
    vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
      const el = node as HTMLAnchorElement
      el.click = mockClick
      return node
    })

    fireEvent.click(btn)
    await waitFor(() => expect(mockGetBlob).toHaveBeenCalled())
    const calledUrl: string = mockGetBlob.mock.calls[0][0]
    expect(calledUrl).toContain('/api/v1/reports/monthly')
    expect(calledUrl).toContain('year=')
    expect(calledUrl).toContain('month=')
    expect(mockClick).toHaveBeenCalled()
  })

  it('muestra estado de carga mientras genera', async () => {
    let resolve!: (v: Blob) => void
    mockGetBlob.mockReturnValue(new Promise<Blob>(r => { resolve = r }))
    global.URL.createObjectURL = vi.fn(() => 'blob:fake')
    global.URL.revokeObjectURL = vi.fn()

    wrap(clientUser)
    const btn = screen.getByText('↓ Generar PDF')
    fireEvent.click(btn)
    await waitFor(() => expect(screen.getByText('Generando…')).toBeInTheDocument())
    expect(screen.getByText('Generando…')).toBeDisabled()
    resolve(new Blob(['%PDF'], { type: 'application/pdf' }))
    await waitFor(() => expect(screen.getByText('↓ Generar PDF')).toBeInTheDocument())
  })
})
