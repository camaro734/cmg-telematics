import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ManualCanControl from '../ManualCanControl'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

vi.mock('../../../shared/ui/Toast', () => ({
  toast: { error: vi.fn() },
}))

import { apiClient } from '../../../lib/apiClient'

const VEHICLE_ID = 'v-test-001'
const SLOT_ID = 'slot-uuid-0'
const SLOTS = [{ id: SLOT_ID, slot: 0, description: 'PTO Bomba Hidráulica' }]

const TOGGLE_BTN = {
  id: 'btn-1', slot_id: SLOT_ID, label: 'Luz baliza',
  byte_index: 0, bit_index: 0, active: true, sort_order: 0,
  current_bit: false, function: 'toggle' as const,
}
const HOLD_BTN = {
  id: 'btn-2', slot_id: SLOT_ID, label: 'Subir cuba',
  byte_index: 0, bit_index: 1, active: true, sort_order: 1,
  current_bit: false, function: 'hold' as const,
}

// El GET de botones se resuelve según la URL; el resto de queries devuelve [].
function mockButtons(buttons: unknown[]) {
  vi.mocked(apiClient.get).mockImplementation(async (url: string) =>
    url.includes('/buttons') ? buttons : [],
  )
}

function renderComponent(fmcConnected: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(['fmc-status', VEHICLE_ID], {
    connected: fmcConnected,
    imei: '862272089079729',
    last_seen: fmcConnected ? new Date().toISOString() : null,
  })
  queryClient.setQueryData(['manual-can-history', VEHICLE_ID], [] as never[])

  return render(
    <QueryClientProvider client={queryClient}>
      <ManualCanControl vehicleId={VEHICLE_ID} slots={SLOTS} />
    </QueryClientProvider>,
  )
}

describe('ManualCanControl', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset()
    vi.mocked(apiClient.post).mockReset()
  })

  it('1. FMC conectado → botón de la salida habilitado', async () => {
    mockButtons([TOGGLE_BTN])
    renderComponent(true)
    expect(await screen.findByTestId(`btn-toggle-${TOGGLE_BTN.id}`)).not.toBeDisabled()
  })

  it('2. FMC desconectado → botón de la salida deshabilitado', async () => {
    mockButtons([TOGGLE_BTN])
    renderComponent(false)
    expect(await screen.findByTestId(`btn-toggle-${TOGGLE_BTN.id}`)).toBeDisabled()
  })

  it('3. Botón toggle → POST al endpoint toggle (alterna valor)', async () => {
    mockButtons([TOGGLE_BTN])
    vi.mocked(apiClient.post).mockResolvedValue({})
    const user = userEvent.setup()
    renderComponent(true)

    await user.click(await screen.findByTestId(`btn-toggle-${TOGGLE_BTN.id}`))

    expect(apiClient.post).toHaveBeenCalledWith(
      `/api/v1/vehicles/${VEHICLE_ID}/can-slots/${SLOT_ID}/buttons/${TOGGLE_BTN.id}/toggle`,
      {},
    )
  })

  it('4. Botón hold → pulsar envía value:true y soltar envía value:false', async () => {
    mockButtons([HOLD_BTN])
    vi.mocked(apiClient.post).mockResolvedValue({})
    renderComponent(true)

    const btn = await screen.findByTestId(`btn-toggle-${HOLD_BTN.id}`)
    fireEvent.pointerDown(btn)
    fireEvent.pointerUp(btn)

    const url = `/api/v1/vehicles/${VEHICLE_ID}/can-slots/${SLOT_ID}/buttons/${HOLD_BTN.id}/toggle`
    expect(apiClient.post).toHaveBeenNthCalledWith(1, url, { value: true })
    expect(apiClient.post).toHaveBeenNthCalledWith(2, url, { value: false })
  })
})
