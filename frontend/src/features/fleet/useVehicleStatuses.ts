import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleOut, VehicleStatus } from '../../lib/types'

export function useVehicleStatuses(vehicles: VehicleOut[]) {
  const queryClient = useQueryClient()

  // Un único query bulk en lugar de N queries paralelos
  const ids = vehicles.map(v => v.id).join(',')
  const { data: statusList = [] } = useQuery<VehicleStatus[]>({
    queryKey: [...keys.vehicles(), 'statuses', ids],
    queryFn: async () => {
      if (!ids) return []
      return apiClient.get<VehicleStatus[]>(`/api/v1/vehicles/statuses?ids=${ids}`)
    },
    enabled: vehicles.length > 0,
    staleTime: Infinity,      // WebSocket mantiene el cache fresco
    refetchInterval: false,   // Sin polling — el WS actualiza via setQueryData
    refetchOnWindowFocus: false,
  })

  // Precarga el cache individual de cada vehículo desde la respuesta bulk
  // para que VehicleDetailPage encuentre datos inmediatamente sin refetch
  useEffect(() => {
    for (const status of statusList) {
      if (status.vehicle_id) {
        queryClient.setQueryData(keys.vehicleStatus(status.vehicle_id), status)
      }
    }
  }, [statusList, queryClient])

  // Map para acceso O(1) en FleetDashboard y FleetMap
  const statuses = new Map<string, VehicleStatus>()
  for (const status of statusList) {
    if (status.vehicle_id) statuses.set(status.vehicle_id, status)
  }
  return statuses
}
