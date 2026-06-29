import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { toast } from '../../shared/ui/Toast'
import { Select } from '../../shared/ui/Select'
import Shell from '../../shared/ui/Shell'
import { useTenantContext } from '../../lib/useTenantContext'
import { AddressAutocomplete } from './AddressAutocomplete'
import type { WorkOrderOut, VehicleOut, DriverOut } from '../../lib/types'

// ── Estilos con TOKENS del sistema (fuente grande y clara; sin px inline sueltos) ──
const S = {
  page:    { maxWidth: 640, margin: '0 auto', padding: 'var(--space-6) var(--space-4) var(--space-12)' } as const,
  title:   { fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--fg-primary)', margin: '0 0 var(--space-2)' } as const,
  sub:     { fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', color: 'var(--fg-muted)', margin: '0 0 var(--space-7)' } as const,
  form:    { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-6)' },
  field:   { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-2)' },
  label:   { fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--fg-secondary)' } as const,
  input:   {
    fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-lg)', color: 'var(--fg-primary)',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: 'var(--space-3) var(--space-4)', width: '100%', boxSizing: 'border-box' as const, outline: 'none',
  } as const,
  selectBig: { fontSize: 'var(--fs-lg)', padding: 'var(--space-3) var(--space-4)', borderRadius: 8 } as const,
  row2:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' },
  footer:  { display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-8)' },
  btn:     { fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', fontWeight: 600, padding: 'var(--space-3) var(--space-6)', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--cmg-teal)', color: '#fff' } as const,
  btnGhost:{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', fontWeight: 600, padding: 'var(--space-3) var(--space-6)', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--bg-elevated)', color: 'var(--fg-muted)' } as const,
}

export default function NewWorkOrderPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { activeTenantId } = useTenantContext()

  const [clientName, setClientName] = useState('')
  const [vehicleId, setVehicleId]   = useState('')
  const [driverId, setDriverId]     = useState('')
  // Dirección del servicio = dirección de la parada 1 (se geolocaliza con Valhalla).
  const [address, setAddress] = useState('')
  const [lat, setLat] = useState<number | null>(null)
  const [lon, setLon] = useState<number | null>(null)

  // Mismas queries que el listado: el backend filtra por el tenant del jefe de flota.
  const { data: vehicles = [] } = useQuery({
    queryKey: [...keys.vehicles(), activeTenantId],
    queryFn: () => apiClient.get<VehicleOut[]>(`/api/v1/vehicles${activeTenantId ? `?tenant_id=${activeTenantId}` : ''}`),
  })
  const { data: drivers = [] } = useQuery({
    queryKey: [...keys.drivers(), activeTenantId],
    queryFn: () => apiClient.get<DriverOut[]>(`/api/v1/drivers${activeTenantId ? `?tenant_id=${activeTenantId}` : ''}`),
  })

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      // El título se autocompleta del cliente para no bloquear el guardado.
      const title = clientName.trim() || 'Orden de trabajo'
      const payload = {
        title,
        vehicle_id: vehicleId || null,
        driver_id: driverId || null,
        final_client_name: clientName.trim() || null,
        final_client_address: address.trim() || null,
      }
      return apiClient.post<WorkOrderOut>('/api/v1/work-orders', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.workOrders() })
      toast.success('Orden creada')
      navigate('/work-orders')
    },
    onError: (e) => toast.error((e as Error).message || 'No se pudo crear la orden'),
  })

  return (
    <Shell title="Nueva orden de trabajo">
      <div style={S.page}>
        <h1 style={S.title}>Nueva orden de trabajo</h1>
        <p style={S.sub}>Rellena lo mínimo para crear el parte. El resto puede completarse después.</p>

        <div style={S.form}>
          <div style={S.field}>
            <label style={S.label} htmlFor="wo-client">Cliente del servicio</label>
            <input
              id="wo-client" style={S.input} value={clientName}
              placeholder="Nombre o razón social"
              onChange={e => setClientName(e.target.value)}
            />
          </div>

          <div style={S.field}>
            <label style={S.label}>Dirección del servicio</label>
            <AddressAutocomplete
              value={address}
              onChange={setAddress}
              onSelect={(r) => {
                setAddress(r.label)
                setLat(r.lat)
                setLon(r.lon)
              }}
              placeholder="Busca la dirección y selecciónala"
            />
            {lat != null && lon != null && (
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)', color: 'var(--ok)' }}>
                ✓ Ubicación fijada · {lat.toFixed(5)}, {lon.toFixed(5)}
              </span>
            )}
          </div>

          <div style={S.row2}>
            <Select label="Vehículo" style={S.selectBig} value={vehicleId} onChange={e => setVehicleId(e.target.value)}>
              <option value="">— Sin asignar —</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
            <Select label="Chofer" style={S.selectBig} value={driverId} onChange={e => setDriverId(e.target.value)}>
              <option value="">— Sin asignar —</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </Select>
          </div>
        </div>

        <div style={S.footer}>
          <button type="button" style={S.btnGhost} onClick={() => navigate('/work-orders')}>Cancelar</button>
          <button type="button" style={{ ...S.btn, opacity: isPending ? 0.6 : 1 }} disabled={isPending} onClick={() => save()}>
            {isPending ? 'Guardando…' : 'Crear orden'}
          </button>
        </div>
      </div>
    </Shell>
  )
}
