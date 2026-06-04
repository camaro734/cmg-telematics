import { useEffect } from 'react'
import { useFleetStore } from './useFleetStore'
import { getVehicleIconForSlug } from '../../shared/ui/icons'
import { useIsMobile } from '../../lib/useIsMobile'
import { statusStamp } from '../../lib/staleStatus'
import type { VehicleOut, VehicleTypeOut, VehicleStatus } from '../../lib/types'

export type VehicleState = 'moving' | 'idle' | 'offline' | 'parked' | 'alert'

const CARD_PULSE_CSS = `
@keyframes cmg-card-pulse {
  0%   { transform: scale(0.8); opacity: 0.8; }
  100% { transform: scale(2.8); opacity: 0; }
}
.cmg-card-pulse-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  animation: cmg-card-pulse 1.5s ease-out infinite;
}
.cmg-card-pulse-dot {
  position: absolute;
  inset: 2px;
  border-radius: 50%;
  border: 1.5px solid rgba(255,255,255,0.25);
}
`

function injectCardPulseCSS() {
  if (typeof document === 'undefined') return
  if (document.getElementById('cmg-card-pulse-css')) return
  const style = document.createElement('style')
  style.id = 'cmg-card-pulse-css'
  style.textContent = CARD_PULSE_CSS
  document.head.appendChild(style)
}

const STATE_COLORS: Record<VehicleState, { dot: string; ring: string; border: string }> = {
  moving:  { dot: 'var(--ok)',   ring: 'rgba(34,197,94,0.45)',  border: 'var(--ok)' },
  idle:    { dot: 'var(--warn)', ring: 'rgba(234,179,8,0.4)',   border: 'var(--warn)' },
  parked:  { dot: 'var(--info)', ring: 'rgba(56,189,248,0.3)',  border: 'var(--info)' },
  offline: { dot: 'var(--border)',   ring: '',                       border: 'var(--border)' },
  alert:   { dot: 'var(--danger)', ring: 'rgba(239,68,68,0.5)',   border: 'var(--danger)' },
}

function StateDot({ state }: { state: VehicleState }) {
  const { dot, ring } = STATE_COLORS[state]
  const pulse = state !== 'offline'
  return (
    <div style={{ position: 'relative', width: 12, height: 12, flexShrink: 0 }}>
      {pulse && ring && (
        <div className="cmg-card-pulse-ring" style={{ background: ring }} />
      )}
      <div className="cmg-card-pulse-dot" style={{ background: dot }} />
    </div>
  )
}

function stateLabel(state: VehicleState, status: VehicleStatus | undefined): { text: string; color: string; icon?: string } {
  if (!status) return { text: 'Sin señal', color: 'var(--accent-off)', icon: 'ti-antenna-bars-off' }
  switch (state) {
    case 'moving':
      return { text: `${Math.round(status.speed_kmh ?? 0)} km/h`, color: 'var(--ok)', icon: 'ti-antenna-bars-5' }
    case 'idle':
      return { text: 'Parado · motor ON', color: 'var(--warn)', icon: 'ti-antenna-bars-5' }
    case 'parked':
      return { text: 'Parado', color: 'var(--info)', icon: 'ti-antenna-bars-5' }
    case 'alert':
      return { text: '⚠ Alerta', color: 'var(--danger)' }
    case 'offline': {
      const { text, color } = statusStamp(status)
      return { text, color }
    }
  }
}

interface Props {
  vehicle: VehicleOut
  vehicleType: VehicleTypeOut | undefined
  status: VehicleStatus | undefined
  isSelected: boolean
  vehicleState: VehicleState
}

export default function VehicleCard({ vehicle, vehicleType, status, isSelected, vehicleState }: Props) {
  useEffect(() => { injectCardPulseCSS() }, [])

  const setSelected = useFleetStore(s => s.setSelected)
  const isMobile = useIsMobile()

  const { border } = STATE_COLORS[vehicleState]
  const borderColor = isSelected ? 'var(--cmg-teal)' : border
  const online = vehicleState !== 'offline'

  const VehicleIcon = getVehicleIconForSlug(vehicleType?.slug ?? '')
  const { text: labelText, color: labelColor, icon: signalIcon } = stateLabel(vehicleState, status)

  const iconEl = vehicleType?.icon_url ? (
    <img src={vehicleType.icon_url} alt={vehicleType.name}
      style={{ maxHeight: isMobile ? 40 : 80, maxWidth: isMobile ? 60 : '100%', objectFit: 'contain' }} />
  ) : (
    <VehicleIcon
      width={isMobile ? 48 : 96}
      height={isMobile ? 28 : 48}
      style={{ color: online ? 'var(--ok)' : 'var(--border)', opacity: online ? 1 : 0.6 }}
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
          <div style={{ fontSize: 14, fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {vehicle.license_plate ?? vehicle.name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
            {vehicleType?.name ?? '—'}
          </div>
        </div>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <StateDot state={vehicleState} />
          <span style={{ fontSize: 11, color: labelColor, fontWeight: 500, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 3 }}>
            {signalIcon && <i className={`ti ${signalIcon}`} style={{ fontSize: 12, flexShrink: 0 }} />}
            {labelText}
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
      <div style={{ position: 'absolute', top: 8, right: 8 }}>
        <StateDot state={vehicleState} />
      </div>

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
        fontFamily: 'var(--font-mono)',
        color: 'var(--fg-primary)',
        textAlign: 'center',
        lineHeight: 1.3,
        wordBreak: 'break-all',
        width: '100%',
      }}>
        {vehicle.license_plate ?? vehicle.name}
      </div>

      <div style={{
        marginTop: 4,
        fontSize: 10,
        color: labelColor,
        textAlign: 'center',
        width: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        paddingBottom: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
      }}>
        {signalIcon && <i className={`ti ${signalIcon}`} style={{ fontSize: 11, flexShrink: 0 }} />}
        {labelText}
      </div>
    </div>
  )
}
