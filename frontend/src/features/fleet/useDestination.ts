import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useWsConnected } from '../../lib/useWsConnected'
import type { GeoResult, DestinationOut, RouteInfo } from '../../lib/types'

/**
 * Búsqueda geocodificada de una dirección. Se modela como mutation porque
 * el usuario la dispara manualmente (no se cachea ni se refetch automático).
 */
export function useGeocode() {
  return useMutation({
    mutationFn: (q: string) =>
      apiClient.get<GeoResult[]>(`/api/v1/geocode?q=${encodeURIComponent(q)}&limit=5`),
  })
}

/**
 * Previsualización de ruta entre dos puntos (vehículo → destino candidato).
 * Mutation porque se dispara al seleccionar un destino, no en cada render.
 * Origen = posición actual del vehículo seleccionado.
 */
export function useRoutePreview() {
  return useMutation({
    mutationFn: (p: { fromLat: number; fromLon: number; toLat: number; toLon: number }) =>
      apiClient.get<RouteInfo>(
        `/api/v1/route?from_lat=${p.fromLat}&from_lon=${p.fromLon}&to_lat=${p.toLat}&to_lon=${p.toLon}`,
      ),
  })
}

/**
 * Destino activo de un vehículo. Devuelve undefined (no lanza error) cuando
 * el backend responde 404 (sin destino asignado) gracias a retry:false.
 * El intervalo de refetch se acorta cuando el WS está conectado.
 */
export function useVehicleDestination(vehicleId: string | null, enabled: boolean) {
  const wsConnected = useWsConnected()
  return useQuery({
    queryKey: keys.vehicleDestination(vehicleId ?? ''),
    queryFn: () => apiClient.get<DestinationOut>(`/api/v1/vehicles/${vehicleId}/destination`),
    enabled: enabled && !!vehicleId,
    // 404 = sin destino activo, no tiene sentido reintentar
    retry: false,
    refetchInterval: wsConnected ? 30_000 : 60_000,
  })
}

/**
 * Asigna un destino a un vehículo (POST). Invalida la caché del destino
 * del mismo vehículo al completarse.
 */
export function useSetDestination(vehicleId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { lat: number; lon: number; label: string }) =>
      apiClient.post<DestinationOut>(`/api/v1/vehicles/${vehicleId}/destination`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.vehicleDestination(vehicleId) }),
  })
}

/**
 * Cancela el destino activo de un vehículo (DELETE → 204). Invalida la caché
 * del destino del mismo vehículo al completarse.
 */
export function useCancelDestination(vehicleId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiClient.delete<void>(`/api/v1/vehicles/${vehicleId}/destination`),
    // Tras cancelar, el GET del destino devuelve 404 (sin destino activo), lo
    // que deja la query en estado error SIN limpiar su `data` previo: React
    // Query conserva el último valor exitoso ante un error, por lo que
    // `activeDest` seguiría poblado hasta un refresco manual. Eliminamos la
    // entrada de caché para que `activeDest` pase a null y la UI se actualice
    // al instante.
    onSuccess: () => qc.removeQueries({ queryKey: keys.vehicleDestination(vehicleId) }),
  })
}
