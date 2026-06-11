import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useConfirm } from '../../shared/ui/ConfirmDialog'
import { useAuthStore } from '../auth/useAuthStore'
import type { DeviceOut, TenantOut, DeviceCreate, DeviceTransfer } from '../../lib/types'
import { Input } from '../../shared/ui/Input'
import { Select } from '../../shared/ui/Select'

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
  const userTier = useAuthStore(s => s.user?.tenant_tier)
  const isCmg = userTier === 'cmg'

  const [filterTenantId, setFilterTenantId] = useState('')

  // Estado del modal de creación
  const [showModal, setShowModal] = useState(false)
  const [newImei, setNewImei] = useState('')
  const [newModel, setNewModel] = useState('FMC650')
  const [newOwnerTenantId, setNewOwnerTenantId] = useState('')
  const [newSimPhone, setNewSimPhone] = useState('')
  const [modalError, setModalError] = useState<string | null>(null)

  // Estado del modal de transferencia
  const [transferDevice, setTransferDevice] = useState<DeviceOut | null>(null)
  const [transferTargetId, setTransferTargetId] = useState('')
  const [transferError, setTransferError] = useState<string | null>(null)

  const { data: tenants = [] } = useQuery<TenantOut[]>({
    queryKey: keys.tenants(),
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants'),
    staleTime: 60_000,
  })

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

  const deleteMutation = useMutation({
    mutationFn: (deviceId: string) => apiClient.delete(`/api/v1/devices/${deviceId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['devices'] }) },
  })

  const createMutation = useMutation({
    mutationFn: (payload: DeviceCreate) => apiClient.post<DeviceOut>('/api/v1/devices', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      handleCloseModal()
    },
    onError: (err: Error) => {
      if (err.message.startsWith('409')) setModalError('IMEI ya registrado')
      else setModalError('Error al crear el dispositivo. Inténtalo de nuevo.')
    },
  })

  const transferMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: DeviceTransfer }) =>
      apiClient.patch<DeviceOut>(`/api/v1/devices/${id}/transfer`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      setTransferDevice(null)
      setTransferTargetId('')
      setTransferError(null)
    },
    onError: (err: Error) => {
      if (err.message.includes('409')) setTransferError('Desvincula primero el dispositivo del vehículo.')
      else if (err.message.includes('422')) setTransferError('Tenant de destino no válido.')
      else setTransferError('Error al transferir. Inténtalo de nuevo.')
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

  function handleCloseModal() {
    setShowModal(false)
    setNewImei('')
    setNewModel('FMC650')
    setNewOwnerTenantId('')
    setNewSimPhone('')
    setModalError(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setModalError(null)
    const payload: DeviceCreate = {
      imei: newImei,
      model: newModel,
      ...(newSimPhone ? { sim_phone: newSimPhone } : {}),
      ...(isCmg && newOwnerTenantId ? { tenant_id: newOwnerTenantId } : {}),
    }
    createMutation.mutate(payload)
  }

  function handleTransferSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!transferDevice || !transferTargetId) return
    setTransferError(null)
    transferMutation.mutate({ id: transferDevice.id, body: { target_tenant_id: transferTargetId } })
  }

  // Opciones de propietario en el alta (solo para CMG): CMG + fabricantes
  const ownerOptions = tenants.filter(t => t.tier === 'cmg' || t.tier === 'manufacturer')
  // Opciones de destino en la transferencia: CMG + fabricantes (excluyendo el tenant actual del device)
  const transferTargetOptions = (d: DeviceOut) =>
    tenants.filter(t => (t.tier === 'cmg' || t.tier === 'manufacturer') && t.id !== d.tenant_id)

  // Tenants no-CMG para el filtro de tabla (visible para CMG)
  const clientTenants = tenants.filter(t => t.tier !== 'cmg')
  const tenantMap = new Map(tenants.map(t => [t.id, t.name]))

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
          {isCmg && (
            <Select value={filterTenantId} onChange={e => setFilterTenantId(e.target.value)}
              style={{ flex: 1, maxWidth: 280 }}>
              <option value="">— Todos los clientes —</option>
              {clientTenants.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          )}
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
                    <th style={thStyle}>Propietario</th>
                    <th style={thStyle}>Vehículo</th>
                    <th style={thStyle}>Estado</th>
                    <th style={thStyle}>Última señal</th>
                    <th style={thStyle}>Teléfono SIM</th>
                    <th style={thStyle}>Firmware</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map(device => {
                    const linked = device.vehicle_id !== null
                    return (
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
                        <td style={{ ...tdStyle, color: linked ? 'var(--fg-primary)' : 'var(--fg-muted)' }}>
                          {linked ? '✓ vinculado' : '—'}
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
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            {isCmg && isAdmin && (
                              <span title={linked ? 'Desvincula el dispositivo del vehículo antes de transferirlo' : ''}>
                                <button
                                  onClick={() => { setTransferDevice(device); setTransferTargetId(''); setTransferError(null) }}
                                  disabled={linked}
                                  style={{
                                    background: 'transparent',
                                    border: '1px solid var(--accent-info)',
                                    color: linked ? 'var(--fg-muted)' : 'var(--accent-info)',
                                    borderColor: linked ? 'var(--border)' : 'var(--accent-info)',
                                    borderRadius: 4,
                                    padding: '3px 10px',
                                    fontSize: 11,
                                    cursor: linked ? 'not-allowed' : 'pointer',
                                    opacity: linked ? 0.5 : 1,
                                  }}
                                >
                                  Transferir
                                </button>
                              </span>
                            )}
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
                          </div>
                        </td>
                      </tr>
                    )
                  })}
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
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) handleCloseModal() }}
        >
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 28, width: 420, maxWidth: '90vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--fg-primary)' }}>Nuevo dispositivo</h2>
              <button onClick={handleCloseModal} style={{ background: 'none', border: 'none', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4 }}>✕</button>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Input label="IMEI" type="text" value={newImei} onChange={e => setNewImei(e.target.value)}
                placeholder="14 o 15 dígitos" pattern="\d{14,15}" required
                title="El IMEI debe tener 14 o 15 dígitos numéricos" mono />

              <Input label="Modelo" type="text" value={newModel} onChange={e => setNewModel(e.target.value)} required />

              <Input label="Teléfono SIM" type="tel" value={newSimPhone} onChange={e => setNewSimPhone(e.target.value)}
                placeholder="+34 6XX XXX XXX" maxLength={20} helperText="Opcional" />

              {/* Selector de propietario: solo para CMG admin */}
              {isCmg && (
                <Select label="Propietario" value={newOwnerTenantId} onChange={e => setNewOwnerTenantId(e.target.value)}>
                  <option value="">— CMG (por defecto) —</option>
                  {ownerOptions.filter(t => t.tier === 'manufacturer').map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </Select>
              )}

              {modalError && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}>
                  {modalError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" onClick={handleCloseModal}
                  style={{ background: 'var(--bg-elevated)', color: 'var(--fg-muted)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
                  Cancelar
                </button>
                <button type="submit" disabled={createMutation.isPending}
                  style={{ background: createMutation.isPending ? 'var(--bg-elevated)' : 'var(--cmg-teal)', color: createMutation.isPending ? 'var(--fg-muted)' : '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: createMutation.isPending ? 'not-allowed' : 'pointer', transition: 'background 0.15s' }}>
                  {createMutation.isPending ? 'Creando…' : 'Crear dispositivo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal — Transferir dispositivo (solo CMG) */}
      {transferDevice && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) { setTransferDevice(null); setTransferTargetId('') } }}
        >
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 28, width: 420, maxWidth: '90vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--fg-primary)' }}>Transferir dispositivo</h2>
              <button onClick={() => { setTransferDevice(null); setTransferTargetId('') }}
                style={{ background: 'none', border: 'none', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4 }}>✕</button>
            </div>

            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--fg-secondary)' }}>
              IMEI: <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)' }}>{transferDevice.imei}</strong>
              <br />
              Propietario actual: <strong>{tenantMap.get(transferDevice.tenant_id ?? '') ?? '—'}</strong>
            </p>

            <form onSubmit={handleTransferSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Select label="Transferir a" value={transferTargetId} onChange={e => setTransferTargetId(e.target.value)} required>
                <option value="">— Selecciona fabricante —</option>
                {transferTargetOptions(transferDevice).map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.tier === 'cmg' ? 'CMG' : 'fabricante'})</option>
                ))}
              </Select>

              {transferError && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}>
                  {transferError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" onClick={() => { setTransferDevice(null); setTransferTargetId('') }}
                  style={{ background: 'var(--bg-elevated)', color: 'var(--fg-muted)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
                  Cancelar
                </button>
                <button type="submit" disabled={transferMutation.isPending || !transferTargetId}
                  style={{ background: (transferMutation.isPending || !transferTargetId) ? 'var(--bg-elevated)' : 'var(--accent-warn)', color: (transferMutation.isPending || !transferTargetId) ? 'var(--fg-muted)' : '#000', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: (transferMutation.isPending || !transferTargetId) ? 'not-allowed' : 'pointer' }}>
                  {transferMutation.isPending ? 'Transfiriendo…' : 'Confirmar transferencia'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Shell>
  )
}
