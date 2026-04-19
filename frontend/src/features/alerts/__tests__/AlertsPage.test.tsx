import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AlertsPage from '../AlertsPage'

vi.mock('../ActiveAlertsList', () => ({
  default: () => <div data-testid="active-list" />,
}))
vi.mock('../AlertHistory', () => ({
  default: () => <div data-testid="alert-history" />,
}))
vi.mock('../../../lib/apiClient', () => ({
  apiClient: { get: vi.fn().mockResolvedValue([]) },
}))

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AlertsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('AlertsPage', () => {
  it('muestra sección ALERTAS ACTIVAS', () => {
    renderPage()
    expect(screen.getByText('ALERTAS ACTIVAS')).toBeInTheDocument()
  })

  it('muestra sección HISTORIAL', () => {
    renderPage()
    expect(screen.getByText('HISTORIAL')).toBeInTheDocument()
  })

  it('renderiza ActiveAlertsList y AlertHistory', () => {
    renderPage()
    expect(screen.getByTestId('active-list')).toBeInTheDocument()
    expect(screen.getByTestId('alert-history')).toBeInTheDocument()
  })
})
