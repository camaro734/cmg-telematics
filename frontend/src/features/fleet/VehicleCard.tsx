import { useFleetStore } from './useFleetStore'
import type { VehicleOut, VehicleTypeOut, VehicleStatus } from '../../lib/types'

interface Props {
  vehicle: VehicleOut
  vehicleType: VehicleTypeOut | undefined
  status: VehicleStatus | undefined
  isSelected: boolean
}

function TruckSvg() {
  return (
    <svg width="64" height="52" viewBox="0 0 64 52" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="10" width="38" height="24" rx="3" fill="var(--bg-elevated)" stroke="var(--bg-border)" strokeWidth="1.5"/>
      <rect x="40" y="16" width="20" height="18" rx="3" fill="var(--bg-elevated)" stroke="var(--bg-border)" strokeWidth="1.5"/>
      <rect x="43" y="17" width="10" height="9" rx="1.5" fill="var(--accent-info)" opacity="0.3"/>
      <rect x="2" y="34" width="58" height="4" rx="1" fill="var(--bg-border)"/>
      <circle cx="13" cy="42" r="5" fill="var(--bg-elevated)" stroke="var(--bg-border)" strokeWidth="2"/>
      <circle cx="49" cy="42" r="5" fill="var(--bg-elevated)" stroke="var(--bg-border)" strokeWidth="2"/>
    </svg>
  )
}

export default function VehicleCard({ vehicle, vehicleType, status, isSelected }: Props) {
  const setSelected = useFleetStore(s => s.setSelected)
  const online = status?.online ?? false

  const borderColor = isSelected
    ? 'var(--accent-energy)'
    : online ? 'var(--accent-ok)' : 'var(--bg-border)'

  return (
    <div
      onClick={() => setSelected(isSelected ? null : vehicle.id)}
      title={vehicle.license_plate ?? vehicle.name}
      style={{
        minWidth: 160,
        minHeight: 140,
        padding: '10px 8px 8px',
        background: 'var(--bg-surface)',
        border: `2px solid ${borderColor}`,
        borderRadius: 8,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
        transition: 'border-color 0.15s',
        userSelect: 'none',
      }}
    >
      <div style={{
        height: 80,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {vehicleType?.icon_url
          ? <img
              src={vehicleType.icon_url}
              alt={vehicleType.name}
              style={{ maxHeight: 80, maxWidth: '100%', objectFit: 'contain' }}
            />
          : <TruckSvg />
        }
      </div>

      <div style={{
        marginTop: 6,
        fontSize: 12,
        fontFamily: 'var(--font-data)',
        color: 'var(--text-default)',
        textAlign: 'center',
        lineHeight: 1.3,
        wordBreak: 'break-all',
        width: '100%',
      }}>
        {vehicle.license_plate ?? vehicle.name}
      </div>

      <div style={{
        position: 'absolute',
        bottom: 7,
        right: 7,
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: online ? 'var(--accent-ok)' : 'var(--bg-border)',
      }} />
    </div>
  )
}
