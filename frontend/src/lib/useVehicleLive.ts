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
    // Refetch cada 60 s incluso con WS (mismo patrón que useVehicleStatuses):
    // recupera datos frescos de Redis si el WS perdió un evento o pisó un campo
    // con null (p. ej. evento de desconexión TCP parcial), evitando que un valor
    // como ext_voltage_mv se quede en blanco sin recuperarse.
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  })
}
