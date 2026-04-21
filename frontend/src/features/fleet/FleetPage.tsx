import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import VehicleList from './VehicleList'
import FleetMap from './FleetMap'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useVehicleStatuses } from './useVehicleStatuses'
import type { VehicleOut } from '../../lib/types'

export default function FleetPage() {
  const [listOpen, setListOpen] = useState(false)

  const { data: vehicles = [] } = useQuery({
    queryKey: keys.vehicles(),
    queryFn: () => apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    staleTime: 5 * 60_000,
  })

  const statuses = useVehicleStatuses(vehicles)

  return (
    <Shell title="Flota">
      <div style={{ display: 'flex', height: '100%', position: 'relative' }}>
        {/* Left panel — collapsible */}
        <div style={{
          width: listOpen ? 'clamp(260px, 35%, 400px)' : 0,
          overflow: 'hidden',
          borderRight: listOpen ? '1px solid var(--bg-border)' : 'none',
          background: 'var(--bg-surface)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.2s ease',
          flexShrink: 0,
        }}>
          <VehicleList />
        </div>

        {/* Toggle tab */}
        <button
          onClick={() => setListOpen(o => !o)}
          title={listOpen ? 'Ocultar lista' : 'Mostrar lista'}
          style={{
            position: 'absolute',
            top: 12,
            left: listOpen ? 'clamp(260px, 35%, 400px)' : 0,
            zIndex: 10,
            width: 22,
            height: 48,
            background: 'var(--bg-surface)',
            border: '1px solid var(--bg-border)',
            borderLeft: listOpen ? 'none' : '1px solid var(--bg-border)',
            borderRadius: listOpen ? '0 6px 6px 0' : '0 6px 6px 0',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontSize: 11,
            transition: 'left 0.2s ease',
            padding: 0,
          }}
        >
          {listOpen ? '◀' : '▶'}
        </button>

        {/* Map */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <FleetMap vehicles={vehicles} statuses={statuses} />
        </div>
      </div>
    </Shell>
  )
}
