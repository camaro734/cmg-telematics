import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ManualCanSlotManager from '../ManualCanSlotManager'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('../../../shared/ui/Toast', () => ({
  toast: { error: vi.fn() },
}))

// Mock useConfirm para controlar confirmaciones en tests
vi.mock('../../../shared/ui/ConfirmDialog', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}))

// El estado del store de auth se controla por test
vi.mock('../../../features/auth/useAuthStore', () => ({
  useAuthStore: vi.fn(),
}))

import { apiClient } from '../../../lib/apiClient'
import { useAuthStore } from '../../../features/auth/useAuthStore'
import { toast } from '../../../shared/ui/Toast'

const VEHICLE_ID = 'v-crud-001'

const MOCK_SLOT = {
  id: 'slot-001',
  vehicle_id: VEHICLE_ID,
  slot: 0,
  param_id: 31412,
  description: 'PTO bomba',
  active: true,
}

function renderComponent() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ManualCanSlotManager vehicleId={VEHICLE_ID} />
    </QueryClientProvider>,
  )
}

describe('ManualCanSlotManager', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockResolvedValue([MOCK_SLOT])
    vi.mocked(apiClient.post).mockResolvedValue(MOCK_SLOT)
  })

  // 1. Admin ve el panel; operator no
  it('admin ve el panel de configuración', () => {
    vi.mocked(useAuthStore).mockImplementation((selector: (s: { user: { role: string } }) => unknown) =>
      selector({ user: { role: 'admin' } })
    )
    renderComponent()
    expect(screen.getByTestId('slot-manager-toggle')).toBeInTheDocument()
  })

  it('operator NO ve el panel de configuración', () => {
    vi.mocked(useAuthStore).mockImplementation((selector: (s: { user: { role: string } }) => unknown) =>
      selector({ user: { role: 'operator' } })
    )
    const { container } = renderComponent()
    expect(container.firstChild).toBeNull()
  })

  // 2. Crear slot llama POST con el payload correcto
  it('crear slot llama POST con payload correcto', async () => {
    vi.mocked(useAuthStore).mockImplementation((selector: (s: { user: { role: string } }) => unknown) =>
      selector({ user: { role: 'admin' } })
    )
    const user = userEvent.setup()
    renderComponent()

    // Abrir panel
    await user.click(screen.getByTestId('slot-manager-toggle'))
    // Abrir formulario
    await user.click(screen.getByTestId('btn-add-slot'))

    // Rellenar campos
    const slotInput = screen.getByTestId('input-slot')
    const paramIdInput = screen.getByTestId('input-param-id')
    const descInput = screen.getByTestId('input-description')

    await user.clear(slotInput)
    await user.type(slotInput, '1')
    await user.clear(paramIdInput)
    await user.type(paramIdInput, '16002')
    await user.clear(descInput)
    await user.type(descInput, 'Bomba presión')

    // Enviar formulario
    await user.click(screen.getByText('Añadir'))

    expect(vi.mocked(apiClient.post)).toHaveBeenCalledWith(
      `/api/v1/vehicles/${VEHICLE_ID}/manual-can-slots`,
      expect.objectContaining({ slot: 1, param_id: 16002, description: 'Bomba presión' }),
    )
  })

  // 3. Error 409 se muestra al usuario
  it('error 409 muestra toast con el detail del backend', async () => {
    vi.mocked(useAuthStore).mockImplementation((selector: (s: { user: { role: string } }) => unknown) =>
      selector({ user: { role: 'admin' } })
    )
    vi.mocked(apiClient.post).mockRejectedValue(
      new Error('El slot 0 ya está configurado para este vehículo'),
    )

    const user = userEvent.setup()
    renderComponent()

    await user.click(screen.getByTestId('slot-manager-toggle'))
    await user.click(screen.getByTestId('btn-add-slot'))

    const paramIdInput = screen.getByTestId('input-param-id')
    const descInput = screen.getByTestId('input-description')
    await user.clear(paramIdInput)
    await user.type(paramIdInput, '31412')
    await user.clear(descInput)
    await user.type(descInput, 'PTO duplicado')

    await user.click(screen.getByText('Añadir'))

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      'El slot 0 ya está configurado para este vehículo',
    )
  })
})
