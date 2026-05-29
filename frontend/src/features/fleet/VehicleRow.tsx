import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import StatusBadge from '../../shared/ui/StatusBadge'
import type { VehicleOut, VehicleStatus } from '../../lib/types'
import { useAuthStore } from '../auth/useAuthStore'
import VehicleDeviceSection from './VehicleDeviceSection'

function relativeTime(isoString: string): string {
  const diff = (Date.now() - new Date(isoString).getTime()) / 1000
  if (diff < 60) return 'hace un momento'
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`
  return `hace ${Math.floor(diff / 86400)} días`
}

interface VehicleRowProps {
  vehicle: VehicleOut
  status: VehicleStatus | undefined
  selected: boolean
  onSelect: () => void
}

export default function VehicleRow({ vehicle, status, selected, onSelect }: VehicleRowProps) {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const [showDevice, setShowDevice] = useState(false)

  const online = status?.online ?? false
  const pto = status?.pto_active === true

  function handleClick() {
    onSelect()
    navigate(`/vehicles/${vehicle.id}`)
  }

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Fila principal */}
      <div
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          borderLeft: `3px solid ${pto ? 'var(--cmg-teal)' : online ? 'var(--ok)' : 'var(--border)'}`,
          background: selected ? 'var(--bg-card)' : 'transparent',
          cursor: 'pointer',
          transition: 'background 0.1s',
        }}
      >
        {/* Status dot */}
        <span style={{
          width: 8, height: 8,
          borderRadius: '50%',
          background: pto ? 'var(--cmg-teal)' : online ? 'var(--ok)' : 'var(--offline)',
          flexShrink: 0,
        }} />

        {/* Name + plate */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 500,
            fontSize: 13,
            color: online ? 'var(--fg-primary)' : 'var(--fg-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {vehicle.name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
            {vehicle.license_plate ?? '—'}
          </div>
        </div>

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}>
            {online && status?.speed_kmh != null ? (
              <>
                <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)' }}>
                  {Math.round(status.speed_kmh)} km/h
                </div>
                {pto && <StatusBadge variant="pto" />}
              </>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                {status?.last_seen ? relativeTime(status.last_seen) : 'Sin señal'}
              </div>
            )}
          </div>

          {/* Botón GPS — solo visible para admins */}
          {isAdmin && (
            <button
              onClick={e => { e.stopPropagation(); setShowDevice(v => !v) }}
              title="Gestionar dispositivo GPS"
              style={{
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                padding: '2px 6px',
                background: showDevice ? 'var(--info)' : 'var(--bg-elevated)',
                color: showDevice ? '#fff' : 'var(--info)',
                border: `1px solid var(--info)`,
                borderRadius: 4,
                cursor: 'pointer',
                lineHeight: 1.4,
                flexShrink: 0,
              }}
            >
              GPS
            </button>
          )}
        </div>
      </div>

      {/* Sección de dispositivo GPS expandible */}
      {showDevice && isAdmin && (
        <VehicleDeviceSection
          vehicleId={vehicle.id}
          tenantId={vehicle.tenant_id}
          isAdmin={isAdmin}
        />
      )}
    </div>
  )
}
