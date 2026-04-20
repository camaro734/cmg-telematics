import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import LogInterventionModal from '../LogInterventionModal'
import type { MaintenanceThreshold } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: { post: vi.fn() },
}))

import { apiClient } from '../../../lib/apiClient'

const THRESHOLDS: MaintenanceThreshold[] = [
  { type: 'pto_hours', value: 500 },
  { type: 'calendar_days', value: 365 },
]

function wrap(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LogInterventionModal planId="p1" thresholds={THRESHOLDS} onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('LogInterventionModal', () => {
  it('muestra checkboxes para cada contador', () => {
    wrap()
    expect(screen.getByText('Horas PTO')).toBeInTheDocument()
    expect(screen.getByText('Días calendario')).toBeInTheDocument()
  })

  it('submit llama a POST con contadores seleccionados', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ id: 'log1', reset_counters: ['pto_hours'] })
    wrap()

    fireEvent.click(screen.getByLabelText('Horas PTO'))
    fireEvent.click(screen.getByText('Registrar'))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/maintenance/plans/p1/logs',
      expect.objectContaining({ reset_counters: ['pto_hours'] })
    ))
  })

  it('llama onClose al cancelar', () => {
    const onClose = vi.fn()
    wrap(onClose)
    fireEvent.click(screen.getByText('Cancelar'))
    expect(onClose).toHaveBeenCalled()
  })
})
