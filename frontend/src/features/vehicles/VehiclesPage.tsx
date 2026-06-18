import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleOut, VehicleTypeOut, TenantOut, DeviceOut, VehicleReassignOut } from '../../lib/types'
import { useTenantContext } from '../../lib/useTenantContext'
import { useAuthStore } from '../auth/useAuthStore'
import { Input } from '../../shared/ui/Input'
import { Select } from '../../shared/ui/Select'
import { isFresh } from '../../lib/staleStatus'
import { useConfirm } from '../../shared/ui/ConfirmDialog'
import { useMyProfile } from '../../lib/useMyProfile'



const thStyle = {
  textAlign: 'left' as const,
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--fg-muted)',
  padding: '8px 12px',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap' as const,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.04em',
} as const

const tdStyle = {
  padding: '10px 12px',
  fontSize: 13,
  color: 'var(--fg-primary)',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap' as const,
} as const

// ─── Tipos internos del formulario ──────────────────────────────────────────

interface FormState {
  license_plate: string
  vin: string
  driver_name: string
  vehicle_type_id: string
  name: string
  year: string
  tenant_id: string
  device_id: string
}

const EMPTY_FORM: FormState = {
  license_plate: '',
  vin: '',
  driver_name: '',
  vehicle_type_id: '',
  name: '',
  year: '',
  tenant_id: '',
  device_id: '',
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function VehiclesPage() {
  const queryClient = useQueryClient()
  const confirmAsk = useConfirm()
  const { activeTenantId } = useTenantContext()
  const isAdmin = useAuthStore(s => s.user?.role === 'admin')
  const userTier = useAuthStore(s => s.user?.tenant_tier)
  const userTenantId = useAuthStore(s => s.user?.tenant_id)

  // Flag de permiso: el fabricante puede entregar/traspasar vehículos solo si está habilitado
  const { data: profile } = useMyProfile()
  const mfrCanTransfer = profile?.manufacturer_can_transfer_vehicles ?? false

  const [showInactive, setShowInactive] = useState(false)

  const [modal, setModal] = useState<'closed' | 'create' | 'edit'>('closed')
  const [editingVehicle, setEditingVehicle] = useState<VehicleOut | null>(null)
  const [editingDevice, setEditingDevice] = useState<DeviceOut | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [reassignVehicle, setReassignVehicle] = useState<VehicleOut | null>(null)
  const [reassignTarget, setReassignTarget] = useState('')
  const [reassigning, setReassigning] = useState(false)
  const [reassignResult, setReassignResult] = useState<VehicleReassignOut | null>(null)
  const [reassignError, setReassignError] = useState<string | null>(null)

  // ── Datos ────────────────────────────────────────────────────────────────

  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery<VehicleOut[]>({
    queryKey: [...keys.vehicles(), activeTenantId, showInactive],
    queryFn: () => {
      const params = new URLSearchParams()
      if (activeTenantId) params.set('tenant_id', activeTenantId)
      if (showInactive) params.set('include_inactive', 'true')
      const qs = params.toString()
      return apiClient.get<VehicleOut[]>(`/api/v1/vehicles${qs ? `?${qs}` : ''}`)
    },
    staleTime: 30_000,
  })

  const { data: vehicleTypes = [] } = useQuery<VehicleTypeOut[]>({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: 5 * 60_000,
  })

  const { data: tenants = [] } = useQuery<TenantOut[]>({
    queryKey: keys.tenants(),
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants'),
    staleTime: 60_000,
  })

  const { data: devices = [] } = useQuery<DeviceOut[]>({
    queryKey: keys.devices(),
    queryFn: () => apiClient.get<DeviceOut[]>('/api/v1/devices'),
    staleTime: 30_000,
  })

  // Lookups rápidos
  const typeMap = new Map(vehicleTypes.map(t => [t.id, t.name]))
  const tenantMap = new Map(tenants.map(t => [t.id, t.name]))
  const deviceByVehicle = new Map(devices.filter(d => d.vehicle_id).map(d => [d.vehicle_id!, d]))
  const clientTenants = tenants.filter(t => t.tier !== 'cmg')

  // Dispositivos disponibles para montar: sin vehículo y compatibles con el tenant del
  // vehículo (mismo tenant, o sin dueño → adoptará el tenant del vehículo al montarse).
  const deviceTargetTenant = modal === 'edit'
    ? (editingVehicle?.tenant_id ?? null)
    : (form.tenant_id || userTenantId || null)
  // El fabricante del vehículo objetivo también puede montar SUS dispositivos (mfr_cross):
  // device.tenant_id == vehicle.manufacturer_tenant_id. Lo deducimos del parent_manufacturer
  // del cliente destino (o, si el usuario es fabricante, de su propio tenant).
  const deviceTargetManufacturer = modal === 'edit'
    ? (editingVehicle?.manufacturer_tenant_id ?? null)
    : (tenants.find(t => t.id === deviceTargetTenant)?.parent_manufacturer_id
        ?? (userTier === 'manufacturer' ? (userTenantId ?? null) : null))
  const availableDevices = devices.filter(d =>
    !d.vehicle_id && !d.out_of_service && (
      !d.tenant_id ||
      d.tenant_id === deviceTargetTenant ||
      (deviceTargetManufacturer != null && d.tenant_id === deviceTargetManufacturer)
    ),
  )

  const reassignableTargets = userTier === 'cmg'
    ? tenants.filter(t => t.tier !== 'cmg')
    : tenants.filter(t => t.id === userTenantId || t.parent_manufacturer_id === userTenantId)

  // ── Abrir/cerrar modales ─────────────────────────────────────────────────

  function openCreate() {
    setForm(EMPTY_FORM)
    setError(null)
    setModal('create')
  }

  function openEdit(v: VehicleOut) {
    const dev = deviceByVehicle.get(v.id) ?? null
    setEditingVehicle(v)
    setEditingDevice(dev)
    setForm({
      license_plate: v.license_plate ?? '',
      vin: v.vin ?? '',
      driver_name: v.driver_name ?? '',
      vehicle_type_id: v.vehicle_type_id,
      name: v.name,
      year: v.year?.toString() ?? '',
      tenant_id: '',
      device_id: '',
    })
    setError(null)
    setModal('edit')
  }

  function closeModal() {
    setModal('closed')
    setEditingVehicle(null)
    setEditingDevice(null)
    setForm(EMPTY_FORM)
    setError(null)
  }

  function setField(key: keyof FormState, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function openReassign(v: VehicleOut) {
    setReassignVehicle(v)
    setReassignTarget('')
    setReassignResult(null)
    setReassignError(null)
  }

  function closeReassign() {
    setReassignVehicle(null)
    setReassignTarget('')
    setReassignResult(null)
    setReassignError(null)
  }

  async function handleReassign() {
    if (!reassignVehicle || !reassignTarget) return
    setReassigning(true)
    setReassignError(null)
    try {
      const result = await apiClient.post<VehicleReassignOut>(
        `/api/v1/vehicles/${reassignVehicle.id}/reassign`,
        { target_tenant_id: reassignTarget },
      )
      setReassignResult(result)
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const m = msg.match(/^\d{3}:\s*(\{.*\})$/)
      let detail: string | null = null
      if (m) {
        try { detail = JSON.parse(m[1]).detail } catch { /* ignora */ }
      }
      if (detail) setReassignError(detail)
      else if (msg.includes('409')) setReassignError('Este vehículo tiene órdenes de trabajo abiertas. Ciérralas o cancélalas antes de reasignar.')
      else setReassignError('Error al reasignar. Inténtalo de nuevo.')
    } finally {
      setReassigning(false)
    }
  }

  // ── Baja / reactivación ───────────────────────────────────────────────────

  async function handleDecommission(v: VehicleOut) {
    const ok = await confirmAsk({
      title: 'Dar de baja vehículo',
      message: `¿Dar de baja "${v.name}"? Dejará de aparecer en la flota. No se borra: podrás reactivarlo y conserva su histórico y dispositivo.`,
      confirmLabel: 'Dar de baja',
      kind: 'danger',
    })
    if (!ok) return
    try {
      await apiClient.delete(`/api/v1/vehicles/${v.id}`)
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const m = msg.match(/^\d{3}:\s*(\{.*\})$/)
      let detail: string | null = null
      if (m) { try { detail = JSON.parse(m[1]).detail } catch { /* ignora */ } }
      await confirmAsk({
        title: 'No se pudo dar de baja',
        message: detail ?? (msg.includes('409')
          ? 'Este vehículo tiene órdenes de trabajo abiertas. Ciérralas o cancélalas antes de darlo de baja.'
          : 'Error al dar de baja. Inténtalo de nuevo.'),
        confirmLabel: 'Entendido',
        kind: 'warning',
      })
    }
  }

  async function handleReactivate(v: VehicleOut) {
    try {
      await apiClient.post(`/api/v1/vehicles/${v.id}/reactivate`, {})
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    } catch {
      await confirmAsk({
        title: 'No se pudo reactivar',
        message: 'Error al reactivar el vehículo. Inténtalo de nuevo.',
        confirmLabel: 'Entendido',
        kind: 'warning',
      })
    }
  }

  // ── Guardar ──────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)

    try {
      if (modal === 'create') {
        await handleCreate()
      } else {
        await handleEdit()
      }
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      closeModal()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // Intenta extraer el detail del backend si viene en formato "409: {"detail":"..."}"
      const m = msg.match(/^\d{3}:\s*(\{.*\})$/)
      let backendDetail: string | null = null
      if (m) {
        try {
          const parsed = JSON.parse(m[1])
          if (typeof parsed.detail === 'string') backendDetail = parsed.detail
        } catch { /* ignora JSON malformado */ }
      }
      if (backendDetail) setError(backendDetail)
      else if (msg.includes('409')) setError('Esa matrícula, VIN o IMEI ya está registrado')
      else if (msg.startsWith('El IMEI ')) setError(msg)
      else setError('Error al guardar. Inténtalo de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreate() {
    const effectiveName = form.name.trim() || form.license_plate.trim()

    const vehicle = await apiClient.post<VehicleOut>('/api/v1/vehicles', {
      vehicle_type_id: form.vehicle_type_id,
      name: effectiveName,
      license_plate: form.license_plate.trim() || null,
      vin: form.vin.trim() || null,
      driver_name: form.driver_name.trim() || null,
      year: form.year ? parseInt(form.year) : null,
      tenant_id: form.tenant_id || null,
    })

    // Vincular el dispositivo elegido (si lo hay) al vehículo recién creado.
    if (form.device_id) {
      await apiClient.patch(`/api/v1/devices/${form.device_id}/vehicle`, { vehicle_id: vehicle.id })
    }
  }

  async function handleEdit() {
    if (!editingVehicle) return
    const effectiveName = form.name.trim() || form.license_plate.trim()
    const vehicle = await apiClient.patch<VehicleOut>(`/api/v1/vehicles/${editingVehicle.id}`, {
      vehicle_type_id: form.vehicle_type_id || undefined,
      name: effectiveName || undefined,
      license_plate: form.license_plate.trim() || null,
      vin: form.vin.trim() || null,
      driver_name: form.driver_name.trim() || null,
      year: form.year ? parseInt(form.year) : null,
    })
    // Si no tenía dispositivo y se ha elegido uno, vincularlo.
    if (!editingDevice && form.device_id) {
      await apiClient.patch(`/api/v1/devices/${form.device_id}/vehicle`, { vehicle_id: vehicle.id })
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Shell title="Vehículos">
      <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>

        {/* Cabecera */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg-muted)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Mostrar vehículos dados de baja
          </label>
          {isAdmin && <button
            onClick={openCreate}
            style={{
              background: 'var(--cmg-teal)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Nuevo vehículo
          </button>}
        </div>

        {/* Tabla */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}>
          {vehiclesLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
              Cargando vehículos…
            </div>
          ) : vehicles.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
              No hay vehículos registrados. Pulsa <strong>+ Nuevo vehículo</strong> para empezar.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)' }}>
                    <th style={thStyle}>Matrícula</th>
                    <th style={thStyle}>VIN</th>
                    <th style={thStyle}>Tipo</th>
                    <th style={thStyle}>Cliente</th>
                    <th style={thStyle}>Dispositivo GPS</th>
                    <th style={thStyle}>Última señal</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.map(v => {
                    const dev = deviceByVehicle.get(v.id)
                    // Estado real por frescor del último dato (regla unificada isFresh),
                    // no por el flag crudo `dev.online`: el FMC650 cierra el TCP tras cada
                    // batch y ese flag queda obsoleto (false aunque transmita, o true colgado).
                    const devOnline = dev ? isFresh(dev.last_seen) : false
                    return (
                      <tr
                        key={v.id}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        style={{ transition: 'background 0.1s' }}
                      >
                        <td style={{ ...tdStyle, fontWeight: 600 }}>
                          {v.license_plate ?? <span style={{ color: 'var(--fg-muted)' }}>—</span>}
                        </td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                          {v.vin ?? <span style={{ color: 'var(--fg-muted)' }}>—</span>}
                        </td>
                        <td style={tdStyle}>
                          {typeMap.get(v.vehicle_type_id) ?? '—'}
                        </td>
                        <td style={tdStyle}>
                          {tenantMap.get(v.tenant_id) ?? '—'}
                        </td>
                        <td style={tdStyle}>
                          {dev ? (
                            dev.out_of_service ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: 'var(--accent-off)' }} />
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-off)' }}>
                                  {dev.imei} · desmontado
                                </span>
                              </span>
                            ) : (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <span style={{
                                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                                  background: devOnline ? 'var(--ok)' : 'var(--offline)',
                                }} />
                                <span style={{
                                  fontFamily: 'var(--font-mono)', fontSize: 12,
                                  color: devOnline ? 'var(--ok)' : 'var(--fg-muted)',
                                }}>
                                  {dev.imei}
                                </span>
                              </span>
                            )
                          ) : (
                            <span style={{ color: 'var(--warn)', fontSize: 12 }}>Sin dispositivo</span>
                          )}
                        </td>
                        <td style={{ ...tdStyle, color: 'var(--fg-muted)', fontSize: 12 }}>
                          {dev?.last_seen ? formatLastSeen(dev.last_seen) : '—'}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                          {!v.active ? (
                            <>
                              <span style={{
                                display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11,
                                background: 'rgba(120,113,108,0.15)', color: 'var(--offline)',
                              }}>
                                De baja
                              </span>
                              {isAdmin && (
                                <button
                                  onClick={() => handleReactivate(v)}
                                  style={{
                                    background: 'transparent',
                                    color: 'var(--ok)',
                                    border: '1px solid var(--ok)',
                                    borderRadius: 4,
                                    padding: '4px 10px',
                                    fontSize: 12,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Reactivar
                                </button>
                              )}
                            </>
                          ) : (
                            <>
                              {isAdmin && <button
                                onClick={() => openEdit(v)}
                                style={{
                                  background: 'var(--border)',
                                  color: 'var(--fg-primary)',
                                  border: 'none',
                                  borderRadius: 4,
                                  padding: '4px 10px',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                }}
                              >
                                Editar
                              </button>}
                              {isAdmin && (userTier === 'cmg' || (userTier === 'manufacturer' && mfrCanTransfer && (v.manufacturer_tenant_id === userTenantId || v.tenant_id === userTenantId))) && (
                                <button
                                  onClick={() => openReassign(v)}
                                  style={{
                                    background: 'transparent',
                                    color: 'var(--accent-info)',
                                    border: '1px solid var(--accent-info)',
                                    borderRadius: 4,
                                    padding: '4px 10px',
                                    fontSize: 12,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Entregar / Traspasar
                                </button>
                              )}
                              {isAdmin && (
                                <button
                                  onClick={() => handleDecommission(v)}
                                  style={{
                                    background: 'transparent',
                                    color: 'var(--danger)',
                                    border: '1px solid var(--danger)',
                                    borderRadius: 4,
                                    padding: '4px 10px',
                                    fontSize: 12,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Dar de baja
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!vehiclesLoading && vehicles.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg-muted)' }}>
            {vehicles.length} vehículo{vehicles.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* ── Modal ─────────────────────────────────────────────────────────── */}
      {modal !== 'closed' && (
        <div
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1100,
          }}
        >
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 28,
            width: 460,
            maxWidth: '92vw',
            maxHeight: '90vh',
            overflowY: 'auto',
          }}>
            {/* Cabecera modal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--fg-primary)' }}>
                {modal === 'create' ? 'Nuevo vehículo' : 'Editar vehículo'}
              </h2>
              <button
                onClick={closeModal}
                style={{ background: 'none', border: 'none', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 18, padding: 4 }}
              >✕</button>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Matrícula */}
              <Input
                label="Matrícula *"
                type="text"
                value={form.license_plate}
                onChange={e => setField('license_plate', e.target.value.toUpperCase())}
                placeholder="Ej. 1234-ABC"
                required
              />

              <Input
                label="VIN *"
                type="text"
                value={form.vin}
                onChange={e => setField('vin', e.target.value.toUpperCase())}
                placeholder="17 caracteres"
                maxLength={17}
                required
                mono
              />

              <Input
                label="Conductor (nombre)"
                type="text"
                value={form.driver_name}
                onChange={e => setField('driver_name', e.target.value)}
                placeholder="Nombre del conductor habitual"
              />

              <Select label="Tipo de vehículo *" value={form.vehicle_type_id}
                onChange={e => setField('vehicle_type_id', e.target.value)} required>
                <option value="">— Selecciona un tipo —</option>
                {vehicleTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>

              {/* Separador opcionales */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Opcional
                </div>

                <Input
                  label="Nombre descriptivo"
                  type="text"
                  value={form.name}
                  onChange={e => setField('name', e.target.value)}
                  placeholder={form.license_plate || 'Si vacío, se usa la matrícula'}
                />

                <Input
                  label="Año"
                  type="number"
                  value={form.year}
                  onChange={e => setField('year', e.target.value)}
                  placeholder="Ej. 2022"
                  min={1990}
                  max={new Date().getFullYear() + 1}
                />

                {/* Cliente — visible para cmg y manufacturer */}
                {(userTier === 'cmg' || userTier === 'manufacturer') && (
                  <div>
                    <Select label="Cliente" value={form.tenant_id}
                      onChange={e => setField('tenant_id', e.target.value)}
                      disabled={modal === 'edit'}
                      helperText={modal === 'edit' ? 'El cliente no se puede cambiar una vez asignado.' : undefined}>
                      <option value="">
                        {userTier === 'manufacturer' ? '— Mi flota —' : '— CMG (sin cliente) —'}
                      </option>
                      {clientTenants.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>

              {/* Sección dispositivo GPS */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Dispositivo GPS
                </div>

                {modal === 'edit' && editingDevice ? (
                  /* Ya tiene dispositivo — mostrar info */
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: editingDevice.online ? 'var(--ok)' : 'var(--offline)',
                    }} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--fg-primary)' }}>
                      {editingDevice.imei}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                      {editingDevice.online ? 'Online' : 'Offline'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--fg-muted)', marginLeft: 4 }}>
                      — Para cambiar el dispositivo usa la página de Dispositivos
                    </span>
                  </div>
                ) : availableDevices.length > 0 ? (
                  /* Sin dispositivo — elegir uno de los disponibles (sin asignar) */
                  <Select
                    label="Dispositivo disponible"
                    value={form.device_id}
                    onChange={e => setField('device_id', e.target.value)}
                    helperText="Solo se listan dispositivos sin asignar. Se vinculará al guardar."
                  >
                    <option value="">— Sin dispositivo —</option>
                    {availableDevices.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.imei}{d.model ? ` · ${d.model}` : ''}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
                    No hay dispositivos disponibles para este cliente. Regístralos o libéralos desde la página de Dispositivos.
                  </div>
                )}
              </div>

              {/* Error */}
              {error && (
                <div style={{
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid var(--danger)',
                  color: 'var(--danger)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: 13,
                }}>
                  {error}
                </div>
              )}

              {/* Botones */}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button
                  type="button"
                  onClick={closeModal}
                  style={{
                    background: 'var(--bg-elevated)', color: 'var(--fg-muted)',
                    border: '1px solid var(--border)', borderRadius: 6,
                    padding: '8px 16px', fontSize: 13, cursor: 'pointer',
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    background: saving ? 'var(--bg-elevated)' : 'var(--cmg-teal)',
                    color: saving ? 'var(--fg-muted)' : '#fff',
                    border: 'none', borderRadius: 6,
                    padding: '8px 20px', fontSize: 13, fontWeight: 600,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  {saving ? 'Guardando…' : modal === 'create' ? 'Crear vehículo' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ── Modal: Reasignar vehículo ──────────────────────────────────────── */}
      {reassignVehicle && (
        <div
          onClick={e => { if (e.target === e.currentTarget) closeReassign() }}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1100,
          }}
        >
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 28,
            width: 460,
            maxWidth: '92vw',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                Entregar / Traspasar vehículo
              </h2>
              <button onClick={closeReassign} style={{ background: 'none', border: 'none', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 18, padding: 4 }}>✕</button>
            </div>

            <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 14 }}>
              Vehículo: <strong style={{ color: 'var(--fg-primary)' }}>{reassignVehicle.name}</strong>
              {reassignVehicle.license_plate && <span> · {reassignVehicle.license_plate}</span>}
            </div>

            {/* Aviso de impacto */}
            <div style={{
              background: 'rgba(234,179,8,0.08)',
              border: '1px solid rgba(234,179,8,0.4)',
              borderRadius: 6,
              padding: '10px 14px',
              fontSize: 12,
              color: 'var(--accent-warn)',
              marginBottom: 18,
              lineHeight: 1.5,
            }}>
              <strong>Atención:</strong> La telemetría histórica permanecerá asociada al cliente anterior — el nuevo cliente verá datos desde hoy.
              Las alertas específicas del cliente anterior sobre este vehículo se desactivarán y los permisos concedidos se revocarán.
            </div>

            {reassignResult ? (
              /* Estado: reasignación completada */
              <div>
                <div style={{
                  background: 'rgba(34,197,94,0.08)',
                  border: '1px solid var(--accent-ok)',
                  borderRadius: 6,
                  padding: '10px 14px',
                  fontSize: 13,
                  color: 'var(--accent-ok)',
                  marginBottom: 16,
                }}>
                  Vehículo reasignado correctamente a <strong>{tenantMap.get(reassignResult.to_tenant_id) ?? reassignResult.to_tenant_id}</strong>.
                  {reassignResult.alert_rules_deactivated > 0 && (
                    <div style={{ marginTop: 4, fontSize: 12, color: 'var(--fg-muted)' }}>
                      {reassignResult.alert_rules_deactivated} regla{reassignResult.alert_rules_deactivated !== 1 ? 's' : ''} desactivada{reassignResult.alert_rules_deactivated !== 1 ? 's' : ''} · {reassignResult.grants_revoked} permiso{reassignResult.grants_revoked !== 1 ? 's' : ''} revocado{reassignResult.grants_revoked !== 1 ? 's' : ''}
                    </div>
                  )}
                  {/* Cajita GPS movida al nuevo dueño */}
                  {reassignResult.device_moved && (
                    <span style={{ display: 'block', marginTop: 4 }}>
                      Cajita {reassignResult.device_imei} movida al nuevo dueño.
                    </span>
                  )}
                  {/* El fabricante retiene acceso técnico aunque traspase el vehículo */}
                  <span style={{ display: 'block', marginTop: 4, color: 'var(--fg-muted)' }}>
                    El fabricante conserva acceso técnico al vehículo.
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={closeReassign} style={{
                    background: 'var(--cmg-teal)', color: '#fff',
                    border: 'none', borderRadius: 6,
                    padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}>Cerrar</button>
                </div>
              </div>
            ) : (
              /* Estado: seleccionar destino */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Select
                  label="Cliente destino"
                  value={reassignTarget}
                  onChange={e => setReassignTarget(e.target.value)}
                >
                  <option value="">— Selecciona cliente —</option>
                  {userTier === 'manufacturer' && (
                    <option value={userTenantId ?? ''}>— Mi flota —</option>
                  )}
                  {reassignableTargets
                    .filter(t => t.id !== userTenantId)
                    .map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))
                  }
                </Select>

                {reassignError && (
                  <div style={{
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid var(--accent-crit)',
                    borderRadius: 6,
                    padding: '8px 12px',
                    fontSize: 12,
                    color: 'var(--accent-crit)',
                  }}>
                    {reassignError}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button
                    onClick={closeReassign}
                    style={{
                      background: 'var(--bg-elevated)', color: 'var(--fg-muted)',
                      border: '1px solid var(--border)', borderRadius: 6,
                      padding: '8px 16px', fontSize: 13, cursor: 'pointer',
                    }}
                  >Cancelar</button>
                  <button
                    onClick={handleReassign}
                    disabled={reassigning || !reassignTarget}
                    style={{
                      background: reassigning || !reassignTarget ? 'var(--bg-elevated)' : 'var(--accent-warn)',
                      color: reassigning || !reassignTarget ? 'var(--fg-muted)' : '#000',
                      border: 'none', borderRadius: 6,
                      padding: '8px 20px', fontSize: 13, fontWeight: 600,
                      cursor: reassigning || !reassignTarget ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {reassigning ? 'Reasignando…' : 'Confirmar reasignación'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Shell>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatLastSeen(iso: string): string {
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'ahora'
  if (diffMin < 60) return `hace ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `hace ${diffH}h`
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
