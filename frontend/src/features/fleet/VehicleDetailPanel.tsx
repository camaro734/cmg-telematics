import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { isEffectivelyOnline, staleStamp } from '../../lib/staleStatus'
import type { VehicleStatus } from '../../lib/types'

interface VehicleDetailPanelProps {
  vehicleId: string | null
  plate?: string
  vehicleName?: string
  onClose: () => void
}

function KpiRow({ label, value, unit }: { label: string; value: React.ReactNode; unit?: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 0', borderBottom: '1px solid var(--border-soft)',
    }}>
      <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)' }}>
        {value}{unit && <span style={{ fontSize: 11, color: 'var(--fg-muted)', marginLeft: 3 }}>{unit}</span>}
      </span>
    </div>
  )
}

export function VehicleDetailPanel({ vehicleId, plate, vehicleName, onClose }: VehicleDetailPanelProps) {
  const navigate = useNavigate()

  const { data: status } = useQuery({
    queryKey: ['vehicles', vehicleId, 'status'],
    queryFn: () => apiClient.get<VehicleStatus>(`/api/v1/vehicles/${vehicleId}/status`),
    enabled: !!vehicleId,
    refetchInterval: 5_000,
  })

  const online = status ? isEffectivelyOnline(status) : false
  const stale = !online

  const moving = online && (status?.speed_kmh ?? 0) > 2

  const statusColor = !online ? 'var(--offline)'
    : moving ? 'var(--cmg-teal)'
    : 'var(--ok)'

  const statusLabel = !online ? 'Offline'
    : moving ? 'En movimiento'
    : 'En línea'

  const lastSeenText = status?.last_seen
    ? (() => {
        const diff = Date.now() - new Date(status.last_seen).getTime()
        const mins = Math.floor(diff / 60000)
        if (mins < 1) return 'ahora'
        if (mins < 60) return `hace ${mins} min`
        return `hace ${Math.floor(mins / 60)}h`
      })()
    : null

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0,
      width: 320, zIndex: 400,
      background: 'var(--bg-surface)',
      borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      transform: vehicleId ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 250ms cubic-bezier(0.32, 0.72, 0, 1)',
    }}>
      {vehicleId && (
        <>
          {/* Header */}
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border-soft)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)' }}>
                  {plate ?? '—'}
                </p>
                {vehicleName && (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-muted)' }}>{vehicleName}</p>
                )}
              </div>
              <button onClick={onClose}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg-dim)', fontSize: 18, padding: 2, lineHeight: 1 }}>
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
              <span style={{ fontSize: 12, color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
              {lastSeenText && (
                <span style={{ fontSize: 11, color: 'var(--fg-dim)' }}>· señal {lastSeenText}</span>
              )}
            </div>
          </div>

          {/* KPIs */}
          <div style={{ padding: '12px 16px', flex: 1, overflowY: 'auto' }}>
            {stale && status?.last_seen && (
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 10, padding: '5px 0 8px', borderBottom: '1px solid var(--border-soft)' }}>
                {staleStamp(status.device_last_seen ?? status.last_seen)}
              </div>
            )}
            <KpiRow label="Ignición" value={
              <span style={{ color: stale ? 'var(--fg-muted)' : (status?.ignition ? 'var(--ok)' : 'var(--offline)') }}>
                {status?.ignition ? 'ON' : 'OFF'}
              </span>
            } />
            {status?.speed_kmh != null && (
              <KpiRow label="Velocidad" value={status.speed_kmh.toFixed(0)} unit="km/h" />
            )}
            {status?.ext_voltage_mv != null && (
              <KpiRow label="Tensión batería" value={(status.ext_voltage_mv / 1000).toFixed(1)} unit="V" />
            )}
            {status?.pto_active != null && (
              <KpiRow label="PTO" value={
                <span style={{ color: stale ? 'var(--fg-muted)' : (status.pto_active ? 'var(--cmg-teal)' : 'var(--fg-dim)') }}>
                  {status.pto_active ? 'Activo' : 'Inactivo'}
                </span>
              } />
            )}
          </div>

          {/* CTA */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-soft)', flexShrink: 0 }}>
            <button
              onClick={() => navigate(`/vehicles/${vehicleId}`)}
              style={{
                width: '100%', padding: '9px 14px',
                background: 'var(--cmg-teal-soft)', color: 'var(--cmg-teal)',
                border: '1px solid var(--cmg-teal-line)', borderRadius: 8,
                fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              Ver detalle completo →
            </button>
          </div>
        </>
      )}
    </div>
  )
}
