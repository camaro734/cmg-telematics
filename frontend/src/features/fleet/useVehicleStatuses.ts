import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useWsConnected } from '../../lib/useWsConnected'
import type { VehicleOut, VehicleStatus } from '../../lib/types'

export function useVehicleStatuses(vehicles: VehicleOut[]) {
  const queryClient = useQueryClient()
  const wsConnected = useWsConnected()

  // Un único query bulk en lugar de N queries paralelos
  const ids = vehicles.map(v => v.id).join(',')
  const { data: statusList = [] } = useQuery<VehicleStatus[]>({
    queryKey: [...keys.vehicles(), 'statuses', ids],
    queryFn: async () => {
      if (!ids) return []
      return apiClient.get<VehicleStatus[]>(`/api/v1/vehicles/statuses?ids=${ids}`)
    },
    enabled: vehicles.length > 0,
    staleTime: wsConnected ? Infinity : 0,      // WS fresco; polling si cae
    // Refetch cada 60 s incluso con WS: garantiza re-render para que isOnline() recalcule
    // con Date.now() actualizado, y recupera datos frescos si el WS perdió algún evento.
    refetchInterval: 60_000,
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
