import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SettingsPage from '../SettingsPage'
import type { SettingsOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}))

vi.mock('../../../features/auth/useAuthStore', () => ({
  useAuthStore: vi.fn(),
}))

import { apiClient } from '../../../lib/apiClient'
import { useAuthStore } from '../../../features/auth/useAuthStore'

function makeStoreMock(userObj: { user_id: string; tenant_id: string; tenant_tier: 'client' | 'cmg'; role: 'admin' | 'operator' | 'viewer' | 'driver'; email: string }) {
  const store = {
    user: userObj,
    enabledModules: [] as string[],
    logoUrl: null as null,
    brandName: null as null,
    logout: vi.fn(),
  }
  return vi.fn((selector?: (s: typeof store) => unknown) =>
    selector ? selector(store) : store
  )
}

const clientAdminUser = { user_id: 'u1', tenant_id: 't1', tenant_tier: 'client' as const, role: 'admin' as const, email: 'admin@wasterent.com' }
const cmgAdminUser    = { user_id: 'u2', tenant_id: 'cmg-t', tenant_tier: 'cmg' as const, role: 'admin' as const, email: 'admin@cmg.es' }

const mockSettings: SettingsOut = { tenant_id: 't1', notification_email: 'ops@wasterent.com' }

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function mockGetForClientAdmin() {
  vi.mocked(apiClient.get).mockImplementation((path: string) => {
    if (path.includes('/vehicles/statuses')) return Promise.resolve([]) as never
    if (path.includes('/alerts')) return Promise.resolve([]) as never
    if (path.includes('/users')) return Promise.resolve([]) as never
    if (path.includes('/work-cycle-defs')) return Promise.resolve([]) as never
    if (path.includes('/work-cycles/definitions')) return Promise.resolve([]) as never
    if (path.includes('settings')) return Promise.resolve(mockSettings) as never
    return Promise.resolve(mockSettings) as never
  })
}

describe('SettingsPage', () => {
  it('muestra formulario para admin de cliente', () => {
    vi.mocked(useAuthStore).mockImplementation(makeStoreMock(clientAdminUser) as unknown as typeof useAuthStore)
    mockGetForClientAdmin()
    renderPage()
    expect(screen.getByText('Notificaciones por email')).toBeInTheDocument()
  })

  it('muestra selector de tenant para admin CMG', () => {
    vi.mocked(useAuthStore).mockImplementation(makeStoreMock(cmgAdminUser) as unknown as typeof useAuthStore)
    vi.mocked(apiClient.get).mockImplementation((path: string) => {
      if (path.includes('/vehicles/statuses')) return Promise.resolve([]) as never
      if (path.includes('/alerts')) return Promise.resolve([]) as never
      return Promise.resolve([]) as never
    })
    renderPage()
    expect(screen.getByText('Tenant')).toBeInTheDocument()
  })

  it('llama apiClient.patch al guardar', async () => {
    vi.mocked(useAuthStore).mockImplementation(makeStoreMock(clientAdminUser) as unknown as typeof useAuthStore)
    mockGetForClientAdmin()
    vi.mocked(apiClient.patch).mockResolvedValue({ ...mockSettings, notification_email: 'new@test.com' })

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    qc.setQueryData(['settings'], mockSettings)

    const { getByRole } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>
    )

    const input = getByRole('textbox')
    fireEvent.change(input, { target: { value: 'new@test.com' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalled())
  })
})
