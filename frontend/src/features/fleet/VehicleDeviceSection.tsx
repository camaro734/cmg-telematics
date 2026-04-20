import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { keys } from '../../lib/queryKeys'
import { apiClient } from '../../lib/apiClient'
import type { DeviceOut } from '../../lib/types'

interface Props {
  vehicleId: string
  tenantId: string
  isAdmin: boolean
}

// Formatea una fecha ISO a "DD/MM/YYYY HH:MM" en zona local
function formatLastSeen(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function VehicleDeviceSection({ vehicleId, tenantId, isAdmin }: Props) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'idle' | 'selecting'>('idle')
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')

  // Carga todos los dispositivos del tenant
  const { data: devices, isLoading } = useQuery<DeviceOut[]>({
    queryKey: keys.devicesByTenant(tenantId),
    queryFn: () => apiClient.get<DeviceOut[]>(`/api/v1/devices?tenant_id=${tenantId}`),
  })

  const assignedDevice = devices?.find(d => d.vehicle_id === vehicleId)
  const availableDevices = devices?.filter(d => !d.vehicle_id && d.active) ?? []

  // Mutación para asignar o cambiar dispositivo
  const assignMutation = useMutation({
    mutationFn: (deviceId: string) =>
      apiClient.patch<DeviceOut>(`/api/v1/devices/${deviceId}/vehicle`, { vehicle_id: vehicleId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.devicesByTenant(tenantId) })
      setMode('idle')
      setSelectedDeviceId('')
    },
  })

  // Mutación para desasignar dispositivo
  const unassignMutation = useMutation({
    mutationFn: (deviceId: string) =>
      apiClient.patch<DeviceOut>(`/api/v1/devices/${deviceId}/vehicle`, { vehicle_id: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.devicesByTenant(tenantId) })
    },
  })

  const isBusy = assignMutation.isPending || unassignMutation.isPending

  function handleConfirm() {
    if (!selectedDeviceId) return
    assignMutation.mutate(selectedDeviceId)
  }

  function handleCancel() {
    setMode('idle')
    setSelectedDeviceId('')
  }

  function handleStartAssign() {
    setSelectedDeviceId(availableDevices[0]?.id ?? '')
    setMode('selecting')
  }

  return (
    <div
      style={{
        borderTop: '1px solid var(--bg-border)',
        background: 'var(--bg-elevated)',
        padding: '10px 14px',
        fontSize: 12,
      }}
    >
      {/* Cabecera de sección */}
      <div style={{ color: 'var(--accent-off)', fontFamily: 'var(--font-ui)', marginBottom: 6, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        Dispositivo GPS
      </div>

      {isLoading ? (
        <span style={{ color: 'var(--accent-off)' }}>Cargando...</span>
      ) : assignedDevice ? (
        /* Dispositivo asignado */
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Indicador de estado */}
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            color: assignedDevice.online ? 'var(--accent-ok)' : 'var(--accent-off)',
          }}>
            <span style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: assignedDevice.online ? 'var(--accent-ok)' : 'var(--accent-off)',
              display: 'inline-block',
            }} />
            {assignedDevice.online ? 'Online' : 'Offline'}
          </span>

          {/* IMEI */}
          <span style={{ fontFamily: 'var(--font-data)', color: 'var(--text-primary)', letterSpacing: '0.02em' }}>
            {assignedDevice.imei}
          </span>

          {/* Última señal */}
          <span style={{ color: 'var(--accent-off)' }}>
            Última señal: {formatLastSeen(assignedDevice.last_seen)}
          </span>

          {/* Acciones admin */}
          {isAdmin && mode === 'idle' && (
            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
              <button
                onClick={handleStartAssign}
                disabled={isBusy || availableDevices.length === 0}
                style={btnStyle('secondary')}
                title={availableDevices.length === 0 ? 'No hay dispositivos disponibles' : undefined}
              >
                Cambiar
              </button>
              <button
                onClick={() => unassignMutation.mutate(assignedDevice.id)}
                disabled={isBusy}
                style={btnStyle('danger')}
              >
                Desasignar
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Sin dispositivo */
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'var(--accent-off)' }}>Sin dispositivo asignado</span>
          {isAdmin && mode === 'idle' && (
            <button
              onClick={handleStartAssign}
              disabled={isBusy || availableDevices.length === 0}
              style={btnStyle('primary')}
              title={availableDevices.length === 0 ? 'No hay dispositivos disponibles' : undefined}
            >
              + Asignar dispositivo
            </button>
          )}
        </div>
      )}

      {/* Panel de selección inline (Cambiar / Asignar) */}
      {isAdmin && mode === 'selecting' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <select
            value={selectedDeviceId}
            onChange={e => setSelectedDeviceId(e.target.value)}
            style={{
              background: 'var(--bg-base)',
              color: 'var(--text-primary)',
              border: '1px solid var(--bg-border)',
              borderRadius: 4,
              padding: '3px 6px',
              fontFamily: 'var(--font-data)',
              fontSize: 12,
            }}
          >
            {availableDevices.length === 0 ? (
              <option value="">Sin dispositivos disponibles</option>
            ) : (
              availableDevices.map(d => (
                <option key={d.id} value={d.id}>
                  {d.imei}
                </option>
              ))
            )}
          </select>
          <button
            onClick={handleConfirm}
            disabled={isBusy || !selectedDeviceId}
            style={btnStyle('primary')}
          >
            Confirmar
          </button>
          <button
            onClick={handleCancel}
            disabled={isBusy}
            style={btnStyle('secondary')}
          >
            Cancelar
          </button>
          {assignMutation.isError && (
            <span style={{ color: 'var(--accent-crit)', fontSize: 11 }}>
              Error al asignar dispositivo
            </span>
          )}
        </div>
      )}

      {unassignMutation.isError && (
        <div style={{ color: 'var(--accent-crit)', fontSize: 11, marginTop: 4 }}>
          Error al desasignar dispositivo
        </div>
      )}
    </div>
  )
}

// Estilos de botón reutilizables
function btnStyle(variant: 'primary' | 'secondary' | 'danger'): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '3px 10px',
    border: 'none',
    borderRadius: 4,
    fontSize: 11,
    fontFamily: 'var(--font-ui)',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  }
  if (variant === 'primary') {
    return { ...base, background: 'var(--accent-energy)', color: '#fff' }
  }
  if (variant === 'danger') {
    return { ...base, background: 'var(--bg-border)', color: 'var(--accent-crit)' }
  }
  // secondary
  return { ...base, background: 'var(--bg-border)', color: 'var(--text-primary)' }
}
