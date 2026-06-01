import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleFilter, VehicleTypeOut, VehicleOut } from '../../lib/types'
import { Select } from '../../shared/ui/Select'

interface Props {
  value: VehicleFilter
  onChange: (f: VehicleFilter) => void
}

export default function VehicleFilterPicker({ value, onChange }: Props) {
  const { data: vehicleTypes = [] } = useQuery({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: 60_000,
    enabled: value.scope === 'type',
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: keys.vehicles(),
    queryFn: () => apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    staleTime: 60_000,
    enabled: value.scope === 'vehicle',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Select value={value.scope} style={{ background: 'var(--bg-card)' }}
        onChange={e => {
          const scope = e.target.value as VehicleFilter['scope']
          onChange({ scope })
        }}>
        <option value="all">Todos los vehículos</option>
        <option value="type">Por tipo de vehículo</option>
        <option value="vehicle">Vehículo específico</option>
      </Select>

      {value.scope === 'type' && (
        <Select value={value.vehicle_type_id ?? ''} style={{ background: 'var(--bg-card)' }}
          onChange={e => onChange({ scope: 'type', vehicle_type_id: e.target.value })}>
          <option value="">Selecciona un tipo…</option>
          {vehicleTypes.map(vt => <option key={vt.id} value={vt.id}>{vt.name}</option>)}
        </Select>
      )}

      {value.scope === 'vehicle' && (
        <Select value={value.vehicle_id ?? ''} style={{ background: 'var(--bg-card)' }}
          onChange={e => onChange({ scope: 'vehicle', vehicle_id: e.target.value })}>

          <option value="">Selecciona un vehículo…</option>
          {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </Select>
      )}
    </div>
  )
}
