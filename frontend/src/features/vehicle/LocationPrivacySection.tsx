import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { toast } from '../../shared/ui/Toast'

interface GrantStatus {
  current_level: number
  can_grant: boolean
  has_granted: boolean
}

const LEVEL_LABELS = [
  'Privada — solo el propietario',
  'Acceso nivel 1 — visible para el proveedor directo',
  'Acceso nivel 2 — visible para proveedor y administración',
]
const LEVEL_ICONS  = ['🔒', '👁', '👁']
const LEVEL_COLORS = ['var(--fg-muted)', 'var(--accent-warn)', 'var(--accent-crit)']

export default function LocationPrivacySection({ vehicleId }: { vehicleId: string }) {
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['locationGrantStatus', vehicleId],
    queryFn: () => apiClient.get<GrantStatus>(`/api/v1/vehicles/${vehicleId}/location-grant/status`),
    staleTime: 30_000,
  })

  if (isLoading || !data) return null
  // Solo se muestra cuando el usuario tiene control (puede conceder o ya concedió)
  if (!data.can_grant && !data.has_granted) return null

  const { current_level, can_grant, has_granted } = data
  const lvl = Math.min(current_level, 2)

  async function doRevoke() {
    setBusy(true)
    try {
      await apiClient.delete(`/api/v1/vehicles/${vehicleId}/location-grant`)
      await qc.invalidateQueries({ queryKey: ['locationGrantStatus', vehicleId] })
      toast.success('Acceso de ubicación revocado')
    } catch {
      toast.error('Error al revocar el acceso')
    } finally {
      setBusy(false)
    }
  }

  async function doGrant() {
    setBusy(true)
    setConfirming(false)
    try {
      await apiClient.post(`/api/v1/vehicles/${vehicleId}/location-grant`, {})
      await qc.invalidateQueries({ queryKey: ['locationGrantStatus', vehicleId] })
      toast.success('Acceso de ubicación concedido')
    } catch {
      toast.error('Error al conceder el acceso')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '12px 14px',
    }}>
      {/* Cabecera */}
      <div style={{
        fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700,
        color: 'var(--fg-muted)', letterSpacing: '0.07em',
        textTransform: 'uppercase', marginBottom: 10,
      }}>
        Privacidad de ubicación
      </div>

      {/* Indicador de nivel actual */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 16 }}>{LEVEL_ICONS[lvl]}</span>
        <span style={{
          fontSize: 13, fontWeight: 600,
          color: LEVEL_COLORS[lvl],
          fontFamily: 'var(--font-sans)',
        }}>
          {LEVEL_LABELS[lvl]}
        </span>
      </div>

      {/* Toggle + confirmación */}
      {can_grant && (
        confirming ? (
          <div style={{
            background: 'rgba(234,179,8,0.07)', border: '1px solid rgba(234,179,8,0.3)',
            borderRadius: 8, padding: '10px 12px', marginBottom: 8,
          }}>
            <div style={{
              fontSize: 13, color: 'var(--fg-primary)',
              fontFamily: 'var(--font-sans)', marginBottom: 10, lineHeight: 1.5,
            }}>
              Vas a dar acceso a tu ubicación a tu proveedor directo.
              Los datos técnicos (motor, temperatura, alarmas) son siempre
              visibles para soporte independientemente de esta configuración.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={doGrant}
                disabled={busy}
                style={{
                  background: 'var(--cmg-teal)', border: 'none', borderRadius: 6,
                  padding: '7px 16px', fontSize: 12, fontWeight: 700,
                  color: '#fff', cursor: 'pointer', opacity: busy ? 0.6 : 1,
                }}
              >
                {busy ? '…' : 'Confirmar'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                style={{
                  background: 'transparent', border: '1px solid var(--border)',
                  borderRadius: 6, padding: '7px 12px', fontSize: 12,
                  fontWeight: 600, color: 'var(--fg-muted)', cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)' }}>
              Dar acceso a mi ubicación
            </span>
            {/* Toggle switch */}
            <button
              onClick={() => has_granted ? doRevoke() : setConfirming(true)}
              disabled={busy}
              aria-label={has_granted ? 'Revocar acceso de ubicación' : 'Conceder acceso de ubicación'}
              style={{
                flexShrink: 0,
                width: 44, height: 24, borderRadius: 12, border: 'none',
                cursor: busy ? 'wait' : 'pointer',
                background: has_granted ? 'var(--cmg-teal)' : 'var(--bg-elevated)',
                position: 'relative', transition: 'background 0.2s',
                outline: `1px solid ${has_granted ? 'var(--cmg-teal)' : 'var(--border)'}`,
                opacity: busy ? 0.6 : 1,
              }}
            >
              <span style={{
                position: 'absolute', top: 3,
                left: has_granted ? 23 : 3,
                width: 18, height: 18, borderRadius: '50%',
                background: '#fff', transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
              }} />
            </button>
          </div>
        )
      )}

      {/* Texto informativo */}
      <div style={{
        fontSize: 11, color: 'var(--fg-dim)',
        fontFamily: 'var(--font-sans)', lineHeight: 1.5,
      }}>
        Los datos técnicos (motor, temperatura, alarmas) son siempre visibles
        para el soporte técnico independientemente de esta configuración.
      </div>
    </div>
  )
}
