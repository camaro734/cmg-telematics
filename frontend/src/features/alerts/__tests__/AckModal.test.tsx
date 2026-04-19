import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AckModal from '../AckModal'
import type { AlertInstanceOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: {
    post: vi.fn(),
  },
}))

import { apiClient } from '../../../lib/apiClient'

const mockAlert: AlertInstanceOut = {
  id: 'alert-1',
  rule_id: 'rule-1',
  vehicle_id: 'v-1',
  tenant_id: 't-1',
  triggered_at: '2026-04-19T10:00:00Z',
  resolved_at: null,
  status: 'firing',
  trigger_value: { value: 450 },
  ack_by_user_id: null,
  ack_at: null,
  ack_note: null,
}

function renderModal(onClose = vi.fn(), onSuccess = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AckModal
        alert={mockAlert}
        ruleName="Presión alta"
        vehicleName="Camión 01"
        onClose={onClose}
        onSuccess={onSuccess}
      />
    </QueryClientProvider>
  )
}

describe('AckModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('muestra nombre de regla y vehículo', () => {
    renderModal()
    expect(screen.getByText('Presión alta')).toBeInTheDocument()
    // Search for the vehicle name in the subtitle div specifically
    const subtitleDiv = screen.getByText('Presión alta').closest('div')
    expect(subtitleDiv?.textContent).toContain('Camión 01')
  })

  it('llama onClose al cancelar', () => {
    const onClose = vi.fn()
    renderModal(onClose)
    fireEvent.click(screen.getByText('Cancelar'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('llama apiClient.post al confirmar', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ ...mockAlert, status: 'acknowledged' })
    const onSuccess = vi.fn()
    renderModal(vi.fn(), onSuccess)
    fireEvent.click(screen.getByText('Confirmar'))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/alerts/alert-1/acknowledge',
      { note: null },
    )
  })

  it('envía nota si se escribe', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ ...mockAlert, status: 'acknowledged' })
    renderModal()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Revisado en campo' } })
    fireEvent.click(screen.getByText('Confirmar'))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/alerts/alert-1/acknowledge',
      { note: 'Revisado en campo' },
    ))
  })

  it('muestra error si la petición falla', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('500: Error interno'))
    renderModal()
    fireEvent.click(screen.getByText('Confirmar'))
    await waitFor(() => expect(screen.getByText('500: Error interno')).toBeInTheDocument())
  })
})
