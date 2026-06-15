import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
// Devolver array vacío por defecto para cualquier GET (evita warning de undefined en queries)
vi.mocked(apiClient.get).mockResolvedValue([])

const VEHICLE_ID = 'v-test-001'
const SLOTS = [{ slot: 0, description: 'PTO Bomba Hidráulica', param_id: 31412, active: true }]

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
  it('1. FMC conectado → botones ARRANCAR y PARAR habilitados', () => {
    renderComponent(true)
    expect(screen.getByTestId('btn-arrancar-slot-0')).not.toBeDisabled()
    expect(screen.getByTestId('btn-parar-slot-0')).not.toBeDisabled()
  })

  it('2. FMC desconectado → botones ARRANCAR y PARAR deshabilitados', () => {
    renderComponent(false)
    expect(screen.getByTestId('btn-arrancar-slot-0')).toBeDisabled()
    expect(screen.getByTestId('btn-parar-slot-0')).toBeDisabled()
  })

  it('3. Click ARRANCAR → POST con {slot:0, state:true}', async () => {
    const user = userEvent.setup()
    const mockPost = vi.mocked(apiClient.post).mockResolvedValue({
      ok: true,
      command_log_id: 'log-1',
      imei: '862272089079729',
      command_sent: 'setparam 31412:01FFFFFFFFFFFFFF',
      fmc_response: 'setparam 31412:01FFFFFFFFFFFFFF',
      latency_ms: 250,
      status: 'confirmed',
    })

    renderComponent(true)
    await user.click(screen.getByTestId('btn-arrancar-slot-0'))

    expect(mockPost).toHaveBeenCalledWith(
      `/api/v1/vehicles/${VEHICLE_ID}/commands/manual-can`,
      { slot: 0, state: true },
    )
  })
})
