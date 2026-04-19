import { useQueries } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleOut, VehicleStatus } from '../../lib/types'

export function useVehicleStatuses(vehicles: VehicleOut[]) {
  const results = useQueries({
    queries: vehicles.map(v => ({
      queryKey: keys.vehicleStatus(v.id),
      queryFn: () => apiClient.get<VehicleStatus>(`/api/v1/vehicles/${v.id}/status`),
      refetchInterval: 30_000,
      staleTime: 20_000,
    })),
  })

  const statuses = new Map<string, VehicleStatus>()
  results.forEach((r, i) => {
    if (r.data) statuses.set(vehicles[i].id, r.data)
  })

  return statuses
}
