import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ManualCanConfigSection from '../ManualCanConfigSection'

vi.mock('../../../lib/apiClient', () => ({ apiClient: { patch: vi.fn() } }))
vi.mock('../../../shared/ui/Toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { apiClient } from '../../../lib/apiClient'

const TYPE = {
  id: 't1', name: 'Cisterna', manual_can_slots: [], manual_can_buttons: [],
} as never

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ManualCanConfigSection typeId="t1" selectedType={TYPE} />
    </QueryClientProvider>,
  )
}

describe('ManualCanConfigSection', () => {
  it('un slot recién añadido NO trae param_id 16000 por defecto y bloquea guardado', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(screen.getByRole('button', { name: /\+ slot/i }))
    // El input de param_id debe estar vacío o 0, nunca 16000.
    const paramInput = screen.getByTestId('slot-param-id-0') as HTMLInputElement
    expect(paramInput.value === '' || paramInput.value === '0').toBe(true)
    // Guardar con param_id inválido no debe llamar al API.
    await user.click(screen.getByRole('button', { name: /guardar configuración/i }))
    expect(apiClient.patch).not.toHaveBeenCalled()
  })
})
