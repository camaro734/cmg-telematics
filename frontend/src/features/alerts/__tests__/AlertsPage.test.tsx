import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
  it('muestra tab Activas', () => {
    renderPage()
    expect(screen.getByText('Activas')).toBeInTheDocument()
  })

  it('muestra tab Historial', () => {
    renderPage()
    expect(screen.getByText('Historial')).toBeInTheDocument()
  })

  it('renderiza ActiveAlertsList por defecto', () => {
    renderPage()
    expect(screen.getByTestId('active-list')).toBeInTheDocument()
    expect(screen.queryByTestId('alert-history')).not.toBeInTheDocument()
  })

  it('muestra AlertHistory al cambiar a tab Historial', () => {
    renderPage()
    fireEvent.click(screen.getByText('Historial'))
    expect(screen.getByTestId('alert-history')).toBeInTheDocument()
    expect(screen.queryByTestId('active-list')).not.toBeInTheDocument()
  })
})
