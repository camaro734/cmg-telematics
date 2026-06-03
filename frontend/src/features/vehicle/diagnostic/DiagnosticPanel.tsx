import type { VehicleTypeOut, VehicleStatus, AlertInstanceEnrichedOut, SystemBlock } from '../../../lib/types'
import { SystemBlockCard } from './SystemBlockCard'

interface DiagnosticPanelProps {
  vehicleType: VehicleTypeOut
  status: VehicleStatus
  derived: Record<string, number | null>
  alerts: AlertInstanceEnrichedOut[]
  isMobile?: boolean
  onBlockClick?: (blockId: string) => void
  isStale?: boolean
}

export function DiagnosticPanel({ vehicleType, status, derived, alerts, isMobile, onBlockClick, isStale }: DiagnosticPanelProps) {
  const schema = vehicleType.sensor_schema

  let blocks: SystemBlock[]

  if (vehicleType.system_blocks.length > 0) {
    // Sensores en al menos un bloque
    const assignedKeys = new Set(vehicleType.system_blocks.flatMap(b => b.sensor_keys))
    const orphans = schema.filter(s => !assignedKeys.has(s.key))

    blocks = [...vehicleType.system_blocks]
    if (orphans.length > 0) {
      blocks.push({
        id: '__orphans__',
        name: 'Otros',
        icon: 'ti-settings',
        sensor_keys: orphans.map(s => s.key),
        key_sensor_keys: orphans.slice(0, 3).map(s => s.key),
        key_count: Math.min(orphans.length, 3),
      })
    }
  } else {
    // Fallback: un bloque genérico con todos los sensores
    const allKeys = schema.map(s => s.key)
    blocks = [{
      id: '__all__',
      name: 'Sensores',
      icon: 'ti-dashboard',
      sensor_keys: allKeys,
      key_sensor_keys: allKeys.slice(0, 3),
      key_count: Math.min(allKeys.length, 3),
    }]
  }

  return (
    <div
      data-testid="diagnostic-panel"
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
        alignItems: 'start',
        gap: 10,
      }}
    >
      {blocks.map(block => (
        <SystemBlockCard
          key={block.id}
          block={block}
          schema={schema}
          status={status}
          derived={derived}
          alerts={alerts}
          onDetailClick={onBlockClick ? () => onBlockClick(block.id) : undefined}
          isStale={isStale}
        />
      ))}
    </div>
  )
}
