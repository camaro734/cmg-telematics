import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useFleetStore } from './useFleetStore'
import { useVehicleStatuses } from './useVehicleStatuses'
import VehicleRow from './VehicleRow'
import type { VehicleOut } from '../../lib/types'

export default function VehicleList() {
  const { selectedId, setSelected } = useFleetStore()

  const { data: vehicles = [], isLoading, error } = useQuery({
    queryKey: keys.vehicles(),
    queryFn: () => apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    staleTime: 5 * 60_000,
  })

  const statuses = useVehicleStatuses(vehicles)

  // Sort: online first, then offline
  const sorted = [...vehicles].sort((a, b) => {
    const aOnline = statuses.get(a.id)?.online ?? false
    const bOnline = statuses.get(b.id)?.online ?? false
    return Number(bOnline) - Number(aOnline)
  })

  if (isLoading) {
    return (
      <div style={{ padding: 20, color: 'var(--fg-muted)', fontSize: 13 }}>
        Cargando vehículos…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 20, color: 'var(--danger)', fontSize: 13 }}>
        Error al cargar vehículos
      </div>
    )
  }

  if (sorted.length === 0) {
    return (
      <div style={{ padding: 20, color: 'var(--fg-muted)', fontSize: 13 }}>
        No hay vehículos en la flota
      </div>
    )
  }

  const onlineCount = sorted.filter(v => statuses.get(v.id)?.online).length

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px',
        borderBottom: '1px solid var(--border)',
        fontSize: 11,
        color: 'var(--fg-muted)',
        fontWeight: 600,
        letterSpacing: '0.06em',
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>VEHÍCULOS ({sorted.length})</span>
        <span style={{ color: 'var(--ok)' }}>{onlineCount} EN LÍNEA</span>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sorted.map(v => (
          <VehicleRow
            key={v.id}
            vehicle={v}
            status={statuses.get(v.id)}
            selected={selectedId === v.id}
            onSelect={() => setSelected(v.id)}
          />
        ))}
      </div>
    </div>
  )
}
