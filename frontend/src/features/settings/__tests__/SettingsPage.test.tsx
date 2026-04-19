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

const clientAdminUser = {
  user_id: 'u1', tenant_id: 't1', tenant_tier: 'client' as const,
  role: 'admin' as const, email: 'admin@wasterent.com',
}

const cmgAdminUser = {
  user_id: 'u2', tenant_id: 'cmg-t', tenant_tier: 'cmg' as const,
  role: 'admin' as const, email: 'admin@cmg.es',
}

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

describe('SettingsPage', () => {
  it('muestra formulario para admin de cliente', () => {
    vi.mocked(useAuthStore).mockReturnValue(clientAdminUser)
    vi.mocked(apiClient.get).mockResolvedValue(mockSettings)
    renderPage()
    expect(screen.getByText('Notificaciones por email')).toBeInTheDocument()
  })

  it('muestra selector de tenant para admin CMG', () => {
    vi.mocked(useAuthStore).mockReturnValue(cmgAdminUser)
    vi.mocked(apiClient.get).mockResolvedValue([])
    renderPage()
    expect(screen.getByText('TENANT')).toBeInTheDocument()
  })

  it('llama apiClient.patch al guardar', async () => {
    vi.mocked(useAuthStore).mockReturnValue(clientAdminUser)
    vi.mocked(apiClient.get).mockResolvedValue(mockSettings)
    vi.mocked(apiClient.patch).mockResolvedValue({ ...mockSettings, notification_email: 'new@test.com' })

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    qc.setQueryData(['settings', undefined], mockSettings)

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
