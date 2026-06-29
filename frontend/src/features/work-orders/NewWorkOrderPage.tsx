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
import { StopLocationPicker } from './StopLocationPicker'
import type { WorkOrderOut, VehicleOut, DriverOut, WorkOrderPriority } from '../../lib/types'

const PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente',
}

type ExtraStop = {
  _id: string
  title: string
  client_name: string
  address: string
  lat: number | null
  lon: number | null
  arrival_radius_m: number
  notes: string
  mapOpen: boolean
}

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
  textarea:{
    fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', color: 'var(--fg-primary)',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: 'var(--space-3) var(--space-4)', width: '100%', boxSizing: 'border-box' as const,
    outline: 'none', resize: 'vertical' as const, minHeight: 64,
  } as const,
  selectBig: { fontSize: 'var(--fs-lg)', padding: 'var(--space-3) var(--space-4)', borderRadius: 8 } as const,
  row2:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' },
  sectionHd:{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--fg-primary)', margin: '0 0 var(--space-3)' } as const,
  ok:      { fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)', color: 'var(--ok)' } as const,
  stopCard:{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderLeft: '3px solid var(--cmg-teal)', borderRadius: 8, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-3)' },
  addBtn:  { fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)', fontWeight: 600, padding: 'var(--space-2) var(--space-4)', borderRadius: 8, cursor: 'pointer', background: 'color-mix(in srgb, var(--cmg-teal) 15%, transparent)', color: 'var(--cmg-teal)', border: '1px solid var(--cmg-teal)' } as const,
  moreBtn: { fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', fontWeight: 600, padding: 'var(--space-2) 0', background: 'none', border: 'none', color: 'var(--fg-secondary)', cursor: 'pointer', textAlign: 'left' as const } as const,
  footer:  { display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-8)' },
  btn:     { fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', fontWeight: 600, padding: 'var(--space-3) var(--space-6)', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--cmg-teal)', color: '#fff' } as const,
  btnGhost:{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-md)', fontWeight: 600, padding: 'var(--space-3) var(--space-6)', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--bg-elevated)', color: 'var(--fg-muted)' } as const,
  delBtn:  { background: 'transparent', border: 'none', color: 'var(--danger)', fontSize: 'var(--fs-xl)', cursor: 'pointer', lineHeight: 1, padding: '0 4px' } as const,
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

  // Paradas adicionales (la parada 1 es la dirección de arriba).
  const [extraStops, setExtraStops] = useState<ExtraStop[]>([])

  // "Más opciones" — plegado por defecto.
  const [showMore, setShowMore] = useState(false)
  const [priority, setPriority] = useState<WorkOrderPriority>('normal')
  const [scheduledAt, setScheduledAt] = useState('')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')

  // Mismas queries que el listado: el backend filtra por el tenant del jefe de flota.
  const { data: vehicles = [] } = useQuery({
    queryKey: [...keys.vehicles(), activeTenantId],
    queryFn: () => apiClient.get<VehicleOut[]>(`/api/v1/vehicles${activeTenantId ? `?tenant_id=${activeTenantId}` : ''}`),
  })
  const { data: drivers = [] } = useQuery({
    queryKey: [...keys.drivers(), activeTenantId],
    queryFn: () => apiClient.get<DriverOut[]>(`/api/v1/drivers${activeTenantId ? `?tenant_id=${activeTenantId}` : ''}`),
  })

  function addStop() {
    setExtraStops(s => [...s, {
      _id: Math.random().toString(36).slice(2),
      title: '', client_name: '', address: '', lat: null, lon: null,
      arrival_radius_m: 50, notes: '', mapOpen: true,
    }])
  }
  function updateStop(_id: string, patch: Partial<ExtraStop>) {
    setExtraStops(s => s.map(d => d._id === _id ? { ...d, ...patch } : d))
  }
  function removeStop(_id: string) {
    setExtraStops(s => s.filter(d => d._id !== _id))
  }

  const stopHasContent = (s: ExtraStop) => !!(s.title.trim() || s.address.trim() || s.lat != null)
  const hasPrimaryStop = !!(address.trim() || lat != null)

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      // El título se autocompleta (cliente → dirección) para no bloquear el guardado.
      const title = clientName.trim() || address.trim() || 'Orden de trabajo'
      const order = await apiClient.post<WorkOrderOut>('/api/v1/work-orders', {
        title,
        vehicle_id: vehicleId || null,
        driver_id: driverId || null,
        priority,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        description: description.trim() || null,
        notes: notes.trim() || null,
        final_client_name: clientName.trim() || null,
        final_client_address: address.trim() || null,
      })

      // Parada 1 = dirección del servicio (si se indicó algo).
      let idx = 0
      if (hasPrimaryStop) {
        await apiClient.post(`/api/v1/work-orders/${order.id}/stops`, {
          order_index: idx++, title: address.trim() || clientName.trim() || 'Parada 1',
          client_name: clientName.trim() || null, address: address.trim() || null,
          lat, lon, arrival_radius_m: 50, notes: null,
        })
      }
      // Paradas adicionales con contenido.
      for (const s of extraStops) {
        if (!stopHasContent(s)) continue
        await apiClient.post(`/api/v1/work-orders/${order.id}/stops`, {
          order_index: idx++,
          title: s.title.trim() || s.address.trim() || s.client_name.trim() || `Parada ${idx}`,
          client_name: s.client_name.trim() || null, address: s.address.trim() || null,
          lat: s.lat, lon: s.lon, arrival_radius_m: s.arrival_radius_m, notes: s.notes.trim() || null,
        })
      }
      return order
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
          {/* 1 · Cliente del servicio */}
          <div style={S.field}>
            <label style={S.label} htmlFor="wo-client">Cliente del servicio</label>
            <input
              id="wo-client" style={S.input} value={clientName}
              placeholder="Nombre o razón social"
              onChange={e => setClientName(e.target.value)}
            />
          </div>

          {/* 2 · Dirección (Valhalla) = parada 1 */}
          <div style={S.field}>
            <label style={S.label}>Dirección del servicio</label>
            <AddressAutocomplete
              value={address}
              onChange={setAddress}
              onSelect={(r) => { setAddress(r.label); setLat(r.lat); setLon(r.lon) }}
              placeholder="Busca la dirección y selecciónala"
            />
            {lat != null && lon != null && (
              <span style={S.ok}>✓ Ubicación fijada · {lat.toFixed(5)}, {lon.toFixed(5)}</span>
            )}
          </div>

          {/* 3 · Vehículo + Chofer */}
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

          {/* 4 · Paradas adicionales */}
          <div>
            <h2 style={S.sectionHd}>Paradas adicionales</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {extraStops.map((stop, i) => (
                <div key={stop._id} style={S.stopCard}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--cmg-teal)' }}>
                      {i + 2}
                    </span>
                    <input style={{ ...S.input, fontSize: 'var(--fs-md)', flex: 1 }} placeholder="Título de la parada"
                      value={stop.title} onChange={e => updateStop(stop._id, { title: e.target.value })} />
                    <button type="button" style={S.delBtn} title="Eliminar parada" onClick={() => removeStop(stop._id)}>×</button>
                  </div>
                  <input style={{ ...S.input, fontSize: 'var(--fs-md)' }} placeholder="Cliente / empresa"
                    value={stop.client_name} onChange={e => updateStop(stop._id, { client_name: e.target.value })} />
                  <button type="button" style={{ ...S.addBtn, alignSelf: 'flex-start' }}
                    onClick={() => updateStop(stop._id, { mapOpen: !stop.mapOpen })}>
                    {stop.mapOpen ? '▲ Cerrar mapa' : stop.lat != null ? `✓ ${stop.lat.toFixed(4)}, ${stop.lon?.toFixed(4)}` : '📍 Fijar ubicación en mapa'}
                  </button>
                  {stop.mapOpen && (
                    <StopLocationPicker
                      lat={stop.lat} lon={stop.lon} searchQuery={stop.address}
                      arrivalRadiusM={stop.arrival_radius_m}
                      onPick={(la, lo) => updateStop(stop._id, { lat: la, lon: lo })}
                      onAddressChange={(addr) => updateStop(stop._id, { address: addr })}
                    />
                  )}
                </div>
              ))}
            </div>
            <button type="button" style={{ ...S.addBtn, marginTop: 'var(--space-3)' }} onClick={addStop}>
              + Añadir parada
            </button>
          </div>

          {/* 5 · Más opciones (plegado) */}
          <div>
            <button type="button" style={S.moreBtn} onClick={() => setShowMore(v => !v)}>
              {showMore ? '▲ Menos opciones' : '▼ Más opciones'}
            </button>
            {showMore && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-3)' }}>
                <div style={S.row2}>
                  <Select label="Prioridad" style={S.selectBig} value={priority} onChange={e => setPriority(e.target.value as WorkOrderPriority)}>
                    {(Object.entries(PRIORITY_LABELS) as [WorkOrderPriority, string][]).map(([k, l]) => (
                      <option key={k} value={k}>{l}</option>
                    ))}
                  </Select>
                  <div style={S.field}>
                    <label style={S.label} htmlFor="wo-sched">Fecha programada</label>
                    <input id="wo-sched" type="datetime-local" style={S.input}
                      value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
                  </div>
                </div>
                <div style={S.field}>
                  <label style={S.label} htmlFor="wo-desc">Descripción</label>
                  <textarea id="wo-desc" style={S.textarea} value={description} onChange={e => setDescription(e.target.value)} />
                </div>
                <div style={S.field}>
                  <label style={S.label} htmlFor="wo-notes">Notas internas</label>
                  <textarea id="wo-notes" style={S.textarea} value={notes} onChange={e => setNotes(e.target.value)} />
                </div>
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', margin: 0 }}>
                  El auto-cierre por señal/geocerca se configura editando la orden desde el listado.
                </p>
              </div>
            )}
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
