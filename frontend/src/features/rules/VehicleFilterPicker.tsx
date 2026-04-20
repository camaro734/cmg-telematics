import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleFilter, VehicleTypeOut, VehicleOut } from '../../lib/types'

const SELECT: CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
  borderRadius: 6, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
  fontSize: 13, padding: '6px 8px', width: '100%', boxSizing: 'border-box' as const,
}

interface Props {
  value: VehicleFilter
  onChange: (f: VehicleFilter) => void
}

export default function VehicleFilterPicker({ value, onChange }: Props) {
  const { data: vehicleTypes = [] } = useQuery({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: Infinity,
    enabled: value.scope === 'type',
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: keys.vehicles(),
    queryFn: () => apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    staleTime: Infinity,
    enabled: value.scope === 'vehicle',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <select
        value={value.scope}
        onChange={e => {
          const scope = e.target.value as VehicleFilter['scope']
          onChange({ scope })
        }}
        style={SELECT}
      >
        <option value="all">Todos los vehículos</option>
        <option value="type">Por tipo de vehículo</option>
        <option value="vehicle">Vehículo específico</option>
      </select>

      {value.scope === 'type' && (
        <select
          value={value.vehicle_type_id ?? ''}
          onChange={e => onChange({ scope: 'type', vehicle_type_id: e.target.value })}
          style={SELECT}
        >
          <option value="">Selecciona un tipo…</option>
          {vehicleTypes.map(vt => <option key={vt.id} value={vt.id}>{vt.name}</option>)}
        </select>
      )}

      {value.scope === 'vehicle' && (
        <select
          value={value.vehicle_id ?? ''}
          onChange={e => onChange({ scope: 'vehicle', vehicle_id: e.target.value })}
          style={SELECT}
        >
          <option value="">Selecciona un vehículo…</option>
          {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}
    </div>
  )
}
