import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import VehicleList from './VehicleList'
import FleetMap from './FleetMap'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useVehicleStatuses } from './useVehicleStatuses'
import type { VehicleOut } from '../../lib/types'

export default function FleetPage() {
  const { data: vehicles = [] } = useQuery({
    queryKey: keys.vehicles(),
    queryFn: () => apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    staleTime: 5 * 60_000,
  })

  const statuses = useVehicleStatuses(vehicles)

  return (
    <Shell title="Flota">
      <div style={{ display: 'flex', height: '100%' }}>
        {/* Left panel — 35% */}
        <div style={{
          width: '35%',
          minWidth: 260,
          maxWidth: 400,
          borderRight: '1px solid var(--bg-border)',
          background: 'var(--bg-surface)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <VehicleList />
        </div>

        {/* Right panel — 65% */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <FleetMap vehicles={vehicles} statuses={statuses} />
        </div>
      </div>
    </Shell>
  )
}
