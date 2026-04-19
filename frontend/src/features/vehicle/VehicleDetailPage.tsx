import { useParams, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import VehicleHeader from './VehicleHeader'
import TrackMap from './TrackMap'
import StatusPanel from './StatusPanel'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleOut, VehicleStatus, TrackPoint } from '../../lib/types'

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>()
  if (!id) return <Navigate to="/fleet" replace />

  const { data: vehicle, isLoading: loadingVehicle, error: vehicleError } = useQuery({
    queryKey: keys.vehicle(id),
    queryFn: () => apiClient.get<VehicleOut>(`/api/v1/vehicles/${id}`),
  })

  const { data: status } = useQuery({
    queryKey: keys.vehicleStatus(id),
    queryFn: () => apiClient.get<VehicleStatus>(`/api/v1/vehicles/${id}/status`),
    refetchInterval: 15_000,
    enabled: !!vehicle,
  })

  const { data: track = [] } = useQuery({
    queryKey: keys.vehicleTrack(id),
    queryFn: () => apiClient.get<TrackPoint[]>(`/api/v1/vehicles/${id}/track/today`),
    staleTime: 60_000,
    enabled: !!vehicle,
  })

  if (loadingVehicle) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-base)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
      }}>
        Cargando…
      </div>
    )
  }

  if (vehicleError || !vehicle) {
    return <Navigate to="/fleet" replace />
  }

  return (
    <Shell title={vehicle.name}>
      <div style={{ height: '100%', overflowY: 'auto' }}>
        <VehicleHeader vehicle={vehicle} status={status} />

        <div style={{
          padding: 24,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 24,
          maxWidth: 1200,
        }}>
          {/* Left: map */}
          <div>
            <div style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              fontWeight: 600,
              letterSpacing: '0.06em',
              marginBottom: 10,
            }}>
              RECORRIDO DE HOY
            </div>
            <TrackMap track={track} status={status} />
          </div>

          {/* Right: status */}
          <div>
            <div style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              fontWeight: 600,
              letterSpacing: '0.06em',
              marginBottom: 10,
            }}>
              ESTADO EN TIEMPO REAL
            </div>
            <StatusPanel status={status} />
          </div>
        </div>
      </div>
    </Shell>
  )
}
