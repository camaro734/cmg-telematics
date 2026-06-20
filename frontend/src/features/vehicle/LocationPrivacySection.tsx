import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { toast } from '../../shared/ui/Toast'
import { useConfirm } from '../../shared/ui/ConfirmDialog'

interface GrantStatus {
  current_level: number
  can_grant: boolean
  has_granted: boolean
}

const LEVEL_LABELS = [
  'Privada — solo el propietario',
  'Nivel 1 — visible para el proveedor directo',
  'Nivel 2 — visible para proveedor y administración',
]
const LEVEL_COLORS = ['var(--fg-muted)', 'var(--accent-warn)', 'var(--accent-crit)']

export default function LocationPrivacySection({ vehicleId }: { vehicleId: string }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['locationGrantStatus', vehicleId],
    queryFn: () => apiClient.get<GrantStatus>(`/api/v1/vehicles/${vehicleId}/location-grant/status`),
    staleTime: 30_000,
  })

  if (isLoading || !data) return null
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

  async function handleToggle() {
    if (has_granted) {
      doRevoke()
      return
    }
    const ok = await confirm({
      title: 'Dar acceso a tu ubicación',
      message:
        'Vas a permitir que tu proveedor vea la ubicación de este vehículo, ' +
        'incluyendo su posición en tiempo real, histórico de rutas y paradas. ¿Continuar?',
      kind: 'warning',
      confirmLabel: 'Confirmar',
      cancelLabel: 'Cancelar',
    })
    if (ok) doGrant()
  }

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderTop: '2px solid var(--cmg-teal)',
      borderRadius: 8,
      padding: '12px 14px',
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
      <div style={{ marginBottom: 12 }}>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: LEVEL_COLORS[lvl],
          fontFamily: 'var(--font-mono)',
        }}>
          ● {LEVEL_LABELS[lvl]}
        </span>
      </div>

      {/* Toggle */}
      {can_grant && (
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 8, marginBottom: 10,
        }}>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)' }}>
            Dar acceso a mi ubicación
          </span>
          <button
            onClick={handleToggle}
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
      )}

      {/* Nota informativa */}
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
