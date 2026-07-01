import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { WorkOrderOut, WorkOrderStopOut } from '../../lib/types'

// Estados que consideramos "vigentes" (activas/pendientes). Excluimos
// explícitamente 'done' y 'cancelled': el panel de flota solo muestra trabajo
// por hacer o en curso, no el histórico.
const OPEN_STATUSES: WorkOrderOut['status'][] = ['pending', 'in_progress']

/**
 * Órdenes de trabajo VIGENTES (pendientes/en curso) de un vehículo.
 * Reutiliza `GET /work-orders?vehicle_id=`, que hereda el scoping de partes
 * privados (dueño-exacto por tenant; drivers confinados a su driver_id) — el
 * panel no ve OTs de otro tenant. Filtra a estados abiertos en cliente porque
 * el endpoint solo admite un `status` a la vez.
 */
export function useWorkOrdersByVehicle(vehicleId: string | null | undefined) {
  return useQuery({
    queryKey: keys.workOrdersByVehicle(vehicleId ?? ''),
    queryFn: async () => {
      const all = await apiClient.get<WorkOrderOut[]>(
        `/api/v1/work-orders?vehicle_id=${vehicleId}`,
      )
      return all.filter(o => OPEN_STATUSES.includes(o.status))
    },
    enabled: !!vehicleId,
    refetchInterval: 25_000,
    staleTime: 15_000,
  })
}

// Estados de parada que cuentan como "ya resuelta": no pueden ser la actual.
const CLOSED_STOP_STATUSES: WorkOrderStopOut['status'][] = ['done', 'skipped']

/**
 * Parada "actual" de una lista: la primera no resuelta (status ∉ {done,skipped})
 * por menor `order_index`. Devuelve null si todas están resueltas o no hay.
 */
export function pickCurrentStop(stops: WorkOrderStopOut[]): WorkOrderStopOut | null {
  const open = stops
    .filter(s => !CLOSED_STOP_STATUSES.includes(s.status))
    .sort((a, b) => a.order_index - b.order_index)
  return open[0] ?? null
}

/**
 * Parada actual de la OT en curso. Solo se activa cuando hay un `orderId`
 * (la OT `in_progress`), evitando cargar las paradas de todas las órdenes.
 */
export function useCurrentStop(orderId: string | null | undefined) {
  return useQuery({
    queryKey: keys.workOrderStops(orderId ?? ''),
    queryFn: async () => {
      const stops = await apiClient.get<WorkOrderStopOut[]>(
        `/api/v1/work-orders/${orderId}/stops`,
      )
      return pickCurrentStop(stops)
    },
    enabled: !!orderId,
    refetchInterval: 25_000,
    staleTime: 15_000,
  })
}
