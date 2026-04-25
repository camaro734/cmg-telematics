import { useFleetStore } from './useFleetStore'
import { getVehicleIconForSlug } from '../../shared/ui/icons'
import { useIsMobile } from '../../lib/useIsMobile'
import type { VehicleOut, VehicleTypeOut, VehicleStatus } from '../../lib/types'

interface Props {
  vehicle: VehicleOut
  vehicleType: VehicleTypeOut | undefined
  status: VehicleStatus | undefined
  isSelected: boolean
}

export default function VehicleCard({ vehicle, vehicleType, status, isSelected }: Props) {
  const setSelected = useFleetStore(s => s.setSelected)
  const online = status?.online ?? false
  const isMobile = useIsMobile()

  const borderColor = isSelected
    ? 'var(--accent-energy)'
    : online ? 'var(--accent-ok)' : 'var(--bg-border)'

  const VehicleIcon = getVehicleIconForSlug(vehicleType?.slug ?? '')

  const iconEl = vehicleType?.icon_url ? (
    <img
      src={vehicleType.icon_url}
      alt={vehicleType.name}
      style={{ maxHeight: isMobile ? 40 : 80, maxWidth: isMobile ? 60 : '100%', objectFit: 'contain' }}
    />
  ) : (
    <VehicleIcon
      width={isMobile ? 48 : 96}
      height={isMobile ? 28 : 48}
      style={{ color: online ? 'var(--accent-ok)' : 'var(--bg-border)', opacity: online ? 1 : 0.6 }}
    />
  )

  if (isMobile) {
    return (
      <div
        onClick={() => setSelected(isSelected ? null : vehicle.id)}
        title={vehicle.license_plate ?? vehicle.name}
        style={{
          width: '100%',
          padding: '10px 12px',
          background: 'var(--bg-surface)',
          border: `2px solid ${borderColor}`,
          borderRadius: 8,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          position: 'relative',
          transition: 'border-color 0.15s',
          userSelect: 'none',
        }}
      >
        <div style={{ width: 56, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {iconEl}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontFamily: 'var(--font-data)', color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {vehicle.license_plate ?? vehicle.name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {vehicleType?.name ?? '—'}
          </div>
        </div>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 10,
            background: online ? 'color-mix(in srgb, var(--accent-ok) 20%, transparent)' : 'var(--bg-elevated)',
            color: online ? 'var(--accent-ok)' : 'var(--text-muted)',
            border: `1px solid ${online ? 'var(--accent-ok)' : 'var(--bg-border)'}`,
            fontWeight: 500,
          }}>
            {online ? 'Activo' : 'Inactivo'}
          </span>
        </div>
      </div>
    )
  }

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
        {iconEl}
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
