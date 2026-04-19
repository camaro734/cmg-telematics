import { useState, useMemo } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import Tabs from '../../shared/ui/Tabs'
import VehicleHeader from './VehicleHeader'
import TrackMap from './TrackMap'
import SensorGrid from './SensorGrid'
import KpiChart from './KpiChart'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleOut, VehicleStatus, TrackPoint, VehicleTypeOut, KpiHour } from '../../lib/types'

const PAGE_TABS = [
  { id: 'live', label: 'EN VIVO' },
  { id: 'historic', label: 'HISTÓRICO' },
]

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<'live' | 'historic'>('live')

  if (!id) return <Navigate to="/fleet" replace />

  const { data: vehicle, isLoading: loadingVehicle, error: vehicleError } = useQuery({
    queryKey: keys.vehicle(id),
    queryFn: () => apiClient.get<VehicleOut>(`/api/v1/vehicles/${id}`),
  })

  const { data: vehicleTypes = [] } = useQuery({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: Infinity,
  })

  const { data: status } = useQuery({
    queryKey: keys.vehicleStatus(id),
    queryFn: () => apiClient.get<VehicleStatus>(`/api/v1/vehicles/${id}/status`),
    refetchInterval: 30_000,
    enabled: !!vehicle,
  })

  const { data: track = [] } = useQuery({
    queryKey: keys.vehicleTrack(id),
    queryFn: () => apiClient.get<TrackPoint[]>(`/api/v1/vehicles/${id}/track/today`),
    staleTime: 60_000,
    enabled: !!vehicle,
  })

  const { data: kpis = [] } = useQuery({
    queryKey: [...keys.vehicleKpis(id), 24],
    queryFn: () => apiClient.get<KpiHour[]>(`/api/v1/vehicles/${id}/kpis?hours=24`),
    enabled: tab === 'historic' && !!vehicle,
  })

  const vehicleType = vehicleTypes.find(vt => vt.id === vehicle?.vehicle_type_id)
  const sensorSchema = vehicleType?.sensor_schema ?? []

  const derivedValues = useMemo(() => ({
    pto_hours_today: kpis.length > 0
      ? Math.round(kpis.reduce((s, h) => s + (h.pto_active_minutes ?? 0), 0) / 60 * 10) / 10
      : null,
  }), [kpis])

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

  if (vehicleError || !vehicle) return <Navigate to="/fleet" replace />

  return (
    <Shell title={vehicle.name}>
      <div style={{ height: '100%', overflowY: 'auto' }}>
        <VehicleHeader vehicle={vehicle} status={status} />

        <div style={{ padding: '0 24px' }}>
          <Tabs
            tabs={PAGE_TABS}
            activeTab={tab}
            onTabChange={(newTab) => setTab(newTab as 'live' | 'historic')}
          />
        </div>

        {tab === 'live' && (
          <div style={{
            padding: 24,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 24,
            maxWidth: 1400,
          }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 10 }}>
                RECORRIDO DE HOY
              </div>
              <TrackMap track={track} status={status} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 10 }}>
                SENSORES EN VIVO
              </div>
              {sensorSchema.length > 0 ? (
                <SensorGrid
                  sensorSchema={sensorSchema}
                  canData={status?.can_data ?? {}}
                  derivedValues={derivedValues}
                />
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  Sin schema de sensores configurado para este tipo de vehículo.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'historic' && (
          <div style={{ padding: 24, maxWidth: 1400 }}>
            <KpiChart vehicleId={id} />
          </div>
        )}
      </div>
    </Shell>
  )
}
