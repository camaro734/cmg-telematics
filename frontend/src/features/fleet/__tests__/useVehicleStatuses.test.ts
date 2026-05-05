import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import type { VehicleOut, VehicleStatus } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: { get: vi.fn() },
}))

import { apiClient } from '../../../lib/apiClient'
import { useVehicleStatuses } from '../useVehicleStatuses'

function makeVehicle(id: string): VehicleOut {
  return {
    id,
    tenant_id: 't1',
    vehicle_type_id: 'vt1',
    name: `Vehículo ${id}`,
    license_plate: null,
    vin: null,
    driver_name: null,
    year: null,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
  }
}

function makeStatus(vehicle_id: string): VehicleStatus {
  return {
    vehicle_id,
    online: true,
    last_seen: new Date().toISOString(),
    lat: 39.4,
    lon: -0.37,
    speed_kmh: 55,
    ignition: true,
    pto_active: false,
    ext_voltage_mv: 13500,
    can_data: null,
    dout_state: {},
  }
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

describe('useVehicleStatuses', () => {
  let qc: QueryClient

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.mocked(apiClient.get).mockReset()
  })

  it('no hace request cuando la lista de vehículos está vacía', async () => {
    const { result } = renderHook(() => useVehicleStatuses([]), {
      wrapper: wrapper(qc),
    })

    // El hook debe devolver un Map vacío sin llamar a apiClient
    expect(result.current.size).toBe(0)
    expect(apiClient.get).not.toHaveBeenCalled()
  })

  it('hace un único request bulk con los IDs unidos por coma', async () => {
    const vehicles = [makeVehicle('v1'), makeVehicle('v2')]
    const statuses = [makeStatus('v1'), makeStatus('v2')]
    vi.mocked(apiClient.get).mockResolvedValue(statuses)

    const { result } = renderHook(() => useVehicleStatuses(vehicles), {
      wrapper: wrapper(qc),
    })

    await waitFor(() => expect(result.current.size).toBe(2))

    expect(apiClient.get).toHaveBeenCalledTimes(1)
    expect(apiClient.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/vehicles/statuses?ids=')
    )
    // Verifica que el endpoint contiene ambos IDs
    const calledUrl = vi.mocked(apiClient.get).mock.calls[0][0] as string
    expect(calledUrl).toContain('v1')
    expect(calledUrl).toContain('v2')
  })

  it('devuelve un Map<string, VehicleStatus> correctamente poblado', async () => {
    const vehicles = [makeVehicle('v1'), makeVehicle('v2')]
    const statuses = [makeStatus('v1'), makeStatus('v2')]
    vi.mocked(apiClient.get).mockResolvedValue(statuses)

    const { result } = renderHook(() => useVehicleStatuses(vehicles), {
      wrapper: wrapper(qc),
    })

    await waitFor(() => expect(result.current.size).toBe(2))

    expect(result.current.has('v1')).toBe(true)
    expect(result.current.has('v2')).toBe(true)
    expect(result.current.get('v1')?.speed_kmh).toBe(55)
    expect(result.current.get('v2')?.online).toBe(true)
  })

  it('mantiene el cache sin refetch automático (staleTime: Infinity)', async () => {
    const vehicles = [makeVehicle('v1')]
    const statuses = [makeStatus('v1')]
    vi.mocked(apiClient.get).mockResolvedValue(statuses)

    const { result, rerender } = renderHook(() => useVehicleStatuses(vehicles), {
      wrapper: wrapper(qc),
    })

    await waitFor(() => expect(result.current.size).toBe(1))
    const callCount = vi.mocked(apiClient.get).mock.calls.length

    // Re-renderizar el hook no debe disparar un nuevo fetch
    rerender()
    await waitFor(() => expect(result.current.size).toBe(1))

    expect(vi.mocked(apiClient.get).mock.calls.length).toBe(callCount)
  })

  it('precarga el cache individual de cada vehículo desde la respuesta bulk', async () => {
    const vehicles = [makeVehicle('v1')]
    const statuses = [makeStatus('v1')]
    vi.mocked(apiClient.get).mockResolvedValue(statuses)

    const { result } = renderHook(() => useVehicleStatuses(vehicles), {
      wrapper: wrapper(qc),
    })

    await waitFor(() => expect(result.current.size).toBe(1))

    // El useEffect propaga cada status al cache individual del vehículo
    await waitFor(() => {
      const cached = qc.getQueryData<VehicleStatus>(['vehicles', 'v1', 'status'])
      expect(cached).toBeDefined()
      expect(cached?.vehicle_id).toBe('v1')
    })
  })
})
