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
  const key = keys.vehicleDestination(vehicleId)
  return useMutation({
    mutationFn: () => apiClient.delete<void>(`/api/v1/vehicles/${vehicleId}/destination`),
    // El GET del destino incluye la ruta de Valhalla y puede tardar segundos.
    // Si un GET disparado por el `refetchInterval` ANTES de cancelar (cuando el
    // destino aún estaba activo) resuelve DESPUÉS de la cancelación, React Query
    // escribiría ese resultado `active` en caché y `activeDest` reaparecería
    // (síntoma: el botón vuelve a "Cancelar destino" y solo se limpia al
    // refrescar). Cancelamos los fetches en vuelo para descartar su resultado.
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: key })
    },
    // Marcamos el destino como cancelado en caché: `activeDest` solo es truthy
    // con status === 'active', así que pasa a null al instante sin depender de
    // un refetch que devolvería 404. El siguiente poll dará 404 (error) y React
    // Query conservará este valor cancelado, que tampoco reactiva la UI.
    onSuccess: () => {
      qc.setQueryData<DestinationOut>(key, (old) =>
        old ? { ...old, status: 'cancelled' } : old,
      )
    },
  })
}
