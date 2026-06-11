import { useQuery } from '@tanstack/react-query'
import { apiClient } from './apiClient'
import { keys } from './queryKeys'
import { useWsConnected } from './useWsConnected'
import type { VehicleStatus } from './types'

/**
 * Status en vivo de un vehículo. Hace un fetch inicial y delega en wsClient
 * para mantener la caché fresca. Si el WS cae, activa polling cada 60 s.
 */
export function useVehicleLive(vehicleId: string | null | undefined) {
  const wsConnected = useWsConnected()
  return useQuery({
    queryKey: keys.vehicleStatus(vehicleId ?? ''),
    queryFn: () => apiClient.get<VehicleStatus>(`/api/v1/vehicles/${vehicleId}/status`),
    enabled: !!vehicleId,
    staleTime: wsConnected ? Infinity : 0,
    refetchInterval: wsConnected ? false : 60_000,
    refetchOnWindowFocus: false,
  })
}
