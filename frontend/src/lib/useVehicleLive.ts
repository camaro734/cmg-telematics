import { useQuery } from '@tanstack/react-query'
import { apiClient } from './apiClient'
import { keys } from './queryKeys'
import type { VehicleStatus } from './types'

/**
 * Status en vivo de un vehículo. Hace un fetch inicial y delega en wsClient
 * para mantener la caché fresca (sin polling). En el fallback de WS caído
 * (COMMIT 4) se activará refetchInterval dinámicamente desde useVehicleStatuses.
 */
export function useVehicleLive(vehicleId: string | null | undefined) {
  return useQuery({
    queryKey: keys.vehicleStatus(vehicleId ?? ''),
    queryFn: () => apiClient.get<VehicleStatus>(`/api/v1/vehicles/${vehicleId}/status`),
    enabled: !!vehicleId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}
