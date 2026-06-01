import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useConfirm } from '../../shared/ui/ConfirmDialog'
import { useAuthStore } from '../auth/useAuthStore'
import type { DeviceOut, TenantOut, DeviceCreate } from '../../lib/types'
import { Input } from '../../shared/ui/Input'

// Formatea last_seen como tiempo relativo (aprox) o fecha local
function formatLastSeen(last_seen: string | null): string {
  if (!last_seen) return '—'
  const then = new Date(last_seen)
  const diffMs = Date.now() - then.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'ahora'
  if (diffMin < 60) return `hace ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `hace ${diffH} h`
  return then.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function DevicesPage() {
  const queryClient = useQueryClient()
  const confirmAsk = useConfirm()
  const isAdmin = useAuthStore(s => s.user?.role === 'admin')

  // Filtro por tenant
  const [filterTenantId, setFilterTenantId] = useState('')

  // Estado del modal de creación
  const [showModal, setShowModal] = useState(false)
  const [newImei, setNewImei] = useState('')
  const [newModel, setNewModel] = useState('FMC650')
  const [newTenantId, setNewTenantId] = useState('')
  const [newSimPhone, setNewSimPhone] = useState('')
  const [modalError, setModalError] = useState<string | null>(null)

  // Carga de tenants (para filtro y modal)
  const { data: tenants = [] } = useQuery<TenantOut[]>({
    queryKey: keys.tenants(),
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants'),
    staleTime: 60_000,
  })

  // Carga de dispositivos — con o sin filtro de tenant
  const { data: devices = [], isLoading: devicesLoading } = useQuery<DeviceOut[]>({
    queryKey: filterTenantId ? keys.devicesByTenant(filterTenantId) : keys.devices(),
    queryFn: () =>
      filterTenantId
        ? apiClient.get<DeviceOut[]>(`/api/v1/devices?tenant_id=${filterTenantId}`)
        : apiClient.get<DeviceOut[]>('/api/v1/devices'),
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  })

  // Mutación para eliminar dispositivo
  const deleteMutation = useMutation({
    mutationFn: (deviceId: string) => apiClient.delete(`/api/v1/devices/${deviceId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
  })

  async function handleDelete(device: DeviceOut) {
    const ok = await confirmAsk({
      title: 'Eliminar dispositivo',
      message: `¿Eliminar el dispositivo ${device.imei}? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      kind: 'danger',
    })
    if (!ok) return
    deleteMutation.mutate(device.id)
  }

  // Mutación para crear dispositivo
  const createMutation = useMutation({
    mutationFn: (payload: DeviceCreate) => apiClient.post<DeviceOut>('/api/v1/devices', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      handleCloseModal()
    },
    onError: (err: Error) => {
      if (err.message.startsWith('409')) {
        setModalError('IMEI ya registrado')
      } else {
        setModalError('Error al crear el dispositivo. Inténtalo de nuevo.')
      }
    },
  })

  function handleCloseModal() {
    setShowModal(false)
    setNewImei('')
    setNewModel('FMC650')
    setNewTenantId('')
    setNewSimPhone('')
    setModalError(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setModalError(null)
    if (!newTenantId) {
      setModalError('Selecciona un cliente')
      return
    }
    createMutation.mutate({ imei: newImei, model: newModel, tenant_id: newTenantId, ...(newSimPhone ? { sim_phone: newSimPhone } : {}) } as any)
  }

  // Solo tenants no-CMG disponibles para asignar en el modal
  const clientTenants = tenants.filter(t => t.tier !== 'cmg')

  // Lookup rápido de tenant por id
  const tenantMap = new Map(tenants.map(t => [t.id, t.name]))

  // Estilos reutilizables
  const inputStyle = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    color: 'var(--fg-primary)',
    borderRadius: 6,
    padding: '7px 10px',
    fontSize: 13,
    width: '100%',
    boxSizing: 'border-box' as const,
  } as const

  const labelStyle = {
    display: 'block',
    fontSize: 11,
    color: 'var(--fg-muted)',
    marginBottom: 4,
  } as const

  const thStyle = {
    textAlign: 'left' as const,
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--fg-muted)',
    padding: '8px 12px',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap' as const,
  } as const

  const tdStyle = {
    padding: '10px 12px',
    fontSize: 13,
    color: 'var(--fg-primary)',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap' as const,
  } as const

  return (
    <Shell title="Dispositivos">
      <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
        {/* Cabecera: filtro + botón nuevo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1, maxWidth: 280 }}>
            <select
              value={filterTenantId}
              onChange={e => setFilterTenantId(e.target.value)}
              style={inputStyle}
            >
              <option value="">— Todos los clientes —</option>
              {clientTenants.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          {isAdmin && <button
            onClick={() => setShowModal(true)}
            style={{
              background: 'var(--cmg-teal)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            + Nuevo dispositivo
          </button>}
        </div>

        {/* Tabla de dispositivos */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}>
          {devicesLoading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
              Cargando dispositivos…
            </div>
          ) : devices.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
              No hay dispositivos{filterTenantId ? ' para este cliente' : ''}.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)' }}>
                    <th style={thStyle}>IMEI</th>
                    <th style={thStyle}>Modelo</th>
                    <th style={thStyle}>Tenant</th>
                    <th style={thStyle}>Vehículo</th>
                    <th style={thStyle}>Estado</th>
                    <th style={thStyle}>Última señal</th>
                    <th style={thStyle}>Teléfono SIM</th>
                    <th style={thStyle}>Firmware</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map(device => (
                    <tr key={device.id} style={{ transition: 'background 0.1s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>
                        {device.imei}
                      </td>
                      <td style={tdStyle}>{device.model}</td>
                      <td style={tdStyle}>
                        {device.tenant_id ? (tenantMap.get(device.tenant_id) ?? device.tenant_id) : '—'}
                      </td>
                      <td style={{ ...tdStyle, color: device.vehicle_id ? 'var(--fg-primary)' : 'var(--fg-muted)' }}>
                        {device.vehicle_id ?? '—'}
                      </td>
                      <td style={tdStyle}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: device.online ? 'var(--ok)' : 'var(--offline)',
                            flexShrink: 0,
                          }} />
                          <span style={{ color: device.online ? 'var(--ok)' : 'var(--offline)' }}>
                            {device.online ? 'Online' : 'Offline'}
                          </span>
                        </span>
                      </td>
                      <td style={{ ...tdStyle, color: device.last_seen ? 'var(--fg-primary)' : 'var(--fg-muted)' }}>
                        {formatLastSeen(device.last_seen)}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 12, color: device.sim_phone ? 'var(--fg-primary)' : 'var(--fg-muted)' }}>
                        {device.sim_phone ?? '—'}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: device.firmware_ver ? 'var(--fg-primary)' : 'var(--fg-muted)', fontSize: 12 }}>
                        {device.firmware_ver ?? '—'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {isAdmin && <button
                          onClick={() => handleDelete(device)}
                          disabled={deleteMutation.isPending}
                          style={{
                            background: 'none',
                            border: '1px solid var(--danger)',
                            color: 'var(--danger)',
                            borderRadius: 4,
                            padding: '3px 10px',
                            fontSize: 11,
                            cursor: 'pointer',
                            opacity: deleteMutation.isPending ? 0.5 : 1,
                          }}
                        >
                          Eliminar
                        </button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Contador */}
        {!devicesLoading && devices.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg-muted)' }}>
            {devices.length} dispositivo{devices.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Modal — Nuevo dispositivo */}
      {showModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={e => { if (e.target === e.currentTarget) handleCloseModal() }}
        >
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 28,
            width: 420,
            maxWidth: '90vw',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--fg-primary)' }}>
                Nuevo dispositivo
              </h2>
              <button
                onClick={handleCloseModal}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--fg-muted)',
                  cursor: 'pointer',
                  fontSize: 18,
                  lineHeight: 1,
                  padding: 4,
                }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* IMEI */}
              <Input
                label="IMEI"
                type="text"
                value={newImei}
                onChange={e => setNewImei(e.target.value)}
                placeholder="14 o 15 dígitos"
                pattern="\d{14,15}"
                required
                title="El IMEI debe tener 14 o 15 dígitos numéricos"
                mono
              />

              <Input
                label="Modelo"
                type="text"
                value={newModel}
                onChange={e => setNewModel(e.target.value)}
                required
              />

              <Input
                label="Teléfono SIM"
                type="tel"
                value={newSimPhone}
                onChange={e => setNewSimPhone(e.target.value)}
                placeholder="+34 6XX XXX XXX"
                maxLength={20}
                helperText="Opcional"
              />

              {/* Tenant */}
              <div>
                <label style={labelStyle}>Cliente</label>
                <select
                  value={newTenantId}
                  onChange={e => setNewTenantId(e.target.value)}
                  required
                  style={inputStyle}
                >
                  <option value="">— Selecciona un cliente —</option>
                  {clientTenants.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              {/* Error inline */}
              {modalError && (
                <div style={{
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid var(--danger)',
                  color: 'var(--danger)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: 13,
                }}>
                  {modalError}
                </div>
              )}

              {/* Botones */}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  style={{
                    background: 'var(--bg-elevated)',
                    color: 'var(--fg-muted)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '8px 16px',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  style={{
                    background: createMutation.isPending ? 'var(--bg-elevated)' : 'var(--cmg-teal)',
                    color: createMutation.isPending ? 'var(--fg-muted)' : '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '8px 20px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: createMutation.isPending ? 'not-allowed' : 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  {createMutation.isPending ? 'Creando…' : 'Crear dispositivo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Shell>
  )
}
