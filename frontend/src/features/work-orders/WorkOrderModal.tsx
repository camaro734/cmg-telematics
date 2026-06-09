import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type {
  WorkOrderOut, WorkOrderPriority, DriverOut, VehicleOut,
  AutoCloseConfig, AutoCloseSignal,
} from '../../lib/types'
import { Input } from '../../shared/ui/Input'
import { Select } from '../../shared/ui/Select'
import { StopLocationPicker } from './StopLocationPicker'

const PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente',
}

const S = {
  btn:    { fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600, padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--cmg-teal)', color: '#fff' } as const,
  btnSm:  { fontFamily: 'var(--font-sans)', fontSize: 12, padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--fg-muted)', cursor: 'pointer' } as const,
  field:  { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  input:  { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)', fontSize: 13, padding: '8px 10px' } as const,
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:   { background: 'var(--bg-surface)', borderRadius: 12, width: 'min(640px, 95vw)', display: 'flex', flexDirection: 'column' as const, maxHeight: '90vh', overflow: 'hidden' },
  header:  { flexShrink: 0, padding: '20px 28px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } as const,
  body:    { flex: 1, overflowY: 'auto' as const, padding: '20px 28px', display: 'flex', flexDirection: 'column' as const, gap: 18 },
  footer:  { flexShrink: 0, padding: '14px 28px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 } as const,
}

function SectionHeader({ icon, title, detail }: { icon: string; title: string; detail?: string }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: detail ? 3 : 10 }}>
        <span style={{ fontSize: 14, lineHeight: 1, userSelect: 'none' as const }}>{icon}</span>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700, color: 'var(--fg-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
          {title}
        </span>
      </div>
      {detail && (
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--fg-muted)', margin: '0 0 10px', paddingLeft: 21 }}>
          {detail}
        </p>
      )}
      <div style={{ borderBottom: '1px solid var(--border-soft)', marginBottom: 14 }} />
    </div>
  )
}

export interface ModalProps {
  initial?: WorkOrderOut | null
  vehicles: VehicleOut[]
  drivers: DriverOut[]
  onClose: () => void
  onSaved: () => void
}

type DraftStop = {
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

export function WorkOrderModal({ initial, vehicles, drivers, onClose, onSaved }: ModalProps) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    vehicle_id: initial?.vehicle_id ?? '',
    driver_id: initial?.driver_id ?? '',
    priority: (initial?.priority ?? 'normal') as WorkOrderPriority,
    scheduled_at: initial?.scheduled_at?.slice(0, 16) ?? '',
    notes: initial?.notes ?? '',
    final_client_name: initial?.final_client_name ?? '',
    final_client_address: initial?.final_client_address ?? '',
  })
  const [draftStops, setDraftStops] = useState<DraftStop[]>([])
  const [error, setError] = useState('')
  const [autoClose, setAutoClose] = useState<AutoCloseConfig>(() => {
    const cfg = initial?.auto_close_config
    if (cfg?.enabled) return cfg
    return { enabled: false, service_signal_key: '', signal_op: '==', signal_value: true, min_active_seconds: 60, min_inactive_seconds: 300, exit_margin_m: 25 }
  })

  function addStop() {
    setDraftStops(ds => [...ds, {
      _id: Math.random().toString(36).slice(2),
      title: '', client_name: '', address: '',
      lat: null, lon: null, arrival_radius_m: 50, notes: '', mapOpen: true,
    }])
  }
  function updateStop(_id: string, field: keyof DraftStop, value: unknown) {
    setDraftStops(ds => ds.map(d => d._id === _id ? { ...d, [field]: value } : d))
  }
  function removeStop(_id: string) {
    setDraftStops(ds => ds.filter(d => d._id !== _id))
  }

  const validStops = draftStops.filter(s => s.title.trim())
  const signalRequired = autoClose.enabled && !autoClose.service_signal_key

  const { data: signals = [] } = useQuery<AutoCloseSignal[]>({
    queryKey: ['work-order-vehicle-signals', form.vehicle_id],
    queryFn: () => apiClient.get<AutoCloseSignal[]>(`/api/v1/work-orders/vehicle-signals/${form.vehicle_id}`),
    enabled: !!form.vehicle_id,
  })
  const selectedSignal = signals.find(s => s.key === autoClose.service_signal_key)

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        vehicle_id: form.vehicle_id || null,
        driver_id: form.driver_id || null,
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
        description: form.description || null,
        notes: form.notes || null,
        final_client_name: form.final_client_name.trim() || null,
        final_client_address: form.final_client_address.trim() || null,
        auto_close_config: autoClose.enabled && autoClose.service_signal_key ? autoClose : null,
      }
      const order = initial
        ? await apiClient.put<WorkOrderOut>(`/api/v1/work-orders/${initial.id}`, payload)
        : await apiClient.post<WorkOrderOut>('/api/v1/work-orders', payload)
      for (let i = 0; i < draftStops.length; i++) {
        const s = draftStops[i]
        if (!s.title.trim()) continue
        await apiClient.post(`/api/v1/work-orders/${order.id}/stops`, {
          order_index: i, title: s.title,
          client_name: s.client_name || null, address: s.address || null,
          lat: s.lat, lon: s.lon, arrival_radius_m: s.arrival_radius_m,
          notes: s.notes || null,
        })
      }
      return order
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.workOrders() }); onSaved(); onClose() },
    onError: (e) => setError((e as Error).message),
  })

  const u = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const canSave = !isPending && form.title.trim() && !signalRequired
  const saveLabel = isPending
    ? 'Guardando…'
    : initial
      ? 'Guardar cambios'
      : validStops.length > 0
        ? `Crear orden + ${validStops.length} parada${validStops.length > 1 ? 's' : ''}`
        : 'Crear orden'

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={S.header}>
          <h2 style={{ fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 700, color: 'var(--fg-primary)', margin: 0 }}>
            {initial ? 'Editar orden de trabajo' : 'Nueva orden de trabajo'}
          </h2>
          <button onClick={onClose} type="button" aria-label="Cerrar"
            style={{ background: 'transparent', border: 'none', color: 'var(--fg-muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>
            ×
          </button>
        </div>

        {/* Body */}
        <div style={S.body}>

          {/* ── Datos generales ── */}
          <section>
            <SectionHeader icon="📋" title="Datos generales" detail="Título, vehículo, conductor y programación del servicio." />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Input label="Título *" value={form.title} onChange={e => u('title', e.target.value)} placeholder="Ej: Limpieza alcantarilla Calle Mayor 5" />
              <div style={S.field}>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Descripción</span>
                <textarea style={{ ...S.input, resize: 'vertical', minHeight: 52 }} value={form.description} onChange={e => u('description', e.target.value)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Select label="Vehículo" value={form.vehicle_id} onChange={e => u('vehicle_id', e.target.value)}>
                  <option value="">— Sin asignar —</option>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </Select>
                <Select label="Conductor" value={form.driver_id} onChange={e => u('driver_id', e.target.value)}>
                  <option value="">— Sin asignar —</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                </Select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Select label="Prioridad" value={form.priority} onChange={e => u('priority', e.target.value as WorkOrderPriority)}>
                  {(Object.entries(PRIORITY_LABELS) as [WorkOrderPriority, string][]).map(([k, l]) => (
                    <option key={k} value={k}>{l}</option>
                  ))}
                </Select>
                <Input label="Fecha programada" type="datetime-local" value={form.scheduled_at} onChange={e => u('scheduled_at', e.target.value)} />
              </div>
              <div style={S.field}>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Notas internas</span>
                <textarea style={{ ...S.input, resize: 'vertical', minHeight: 40 }} value={form.notes} onChange={e => u('notes', e.target.value)} />
              </div>
            </div>
          </section>

          {/* ── Cliente final ── */}
          <section>
            <SectionHeader icon="👤" title="Cliente final (opcional)" detail="Aparecerá en el bloque «Cliente» del PDF del parte de servicio." />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Input label="Nombre / Razón social" value={form.final_client_name} maxLength={200}
                placeholder="Comunidad El Pinar" onChange={e => u('final_client_name', e.target.value)} />
              <Input label="Dirección" value={form.final_client_address} maxLength={300}
                placeholder="C/ Mayor 12, Valencia" onChange={e => u('final_client_address', e.target.value)} />
            </div>
          </section>

          {/* ── Auto-cierre de servicio ── */}
          <section>
            <SectionHeader icon="⚡" title="Auto-cierre de servicio" detail="Cierra la parada automáticamente al cumplir geocerca + señal activa." />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-primary)' }}>Activar auto-cierre</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={autoClose.enabled}
                  onChange={e => setAutoClose(a => ({ ...a, enabled: e.target.checked }))} />
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--fg-muted)' }}>
                  {autoClose.enabled ? 'Activado' : 'Desactivado'}
                </span>
              </label>
            </div>

            {autoClose.enabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {!form.vehicle_id && (
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--warn)', margin: 0 }}>
                    ⚠ Selecciona un vehículo para ver las señales disponibles.
                  </p>
                )}

                <Select
                  label="Señal de servicio *"
                  value={autoClose.service_signal_key}
                  error={signalRequired ? 'Requerida para activar el auto-cierre' : undefined}
                  onChange={e => {
                    const key = e.target.value
                    const sig = signals.find(s => s.key === key)
                    setAutoClose(a => ({
                      ...a,
                      service_signal_key: key,
                      signal_op: sig?.signal_type === 'bool' ? '==' : '>',
                      signal_value: sig?.signal_type === 'bool' ? true : 0,
                    }))
                  }}
                >
                  <option value="">— Selecciona señal —</option>
                  {signals.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </Select>

                {autoClose.service_signal_key && (
                  <div style={{ display: 'grid', gridTemplateColumns: selectedSignal?.signal_type === 'bool' ? '1fr' : '160px 1fr', gap: 8 }}>
                    {selectedSignal?.signal_type !== 'bool' && (
                      <Select label="Operador" value={autoClose.signal_op}
                        onChange={e => setAutoClose(a => ({ ...a, signal_op: e.target.value }))}>
                        <option value=">">&gt; mayor que</option>
                        <option value=">=">&ge; mayor o igual</option>
                        <option value="<">&lt; menor que</option>
                        <option value="<=">&le; menor o igual</option>
                        <option value="==">= igual a</option>
                      </Select>
                    )}
                    <div>
                      {selectedSignal?.signal_type === 'bool' ? (
                        <Select label="Valor"
                          value={autoClose.signal_value === true || autoClose.signal_value === 1 ? 'true' : 'false'}
                          onChange={e => setAutoClose(a => ({ ...a, signal_value: e.target.value === 'true', signal_op: '==' }))}>
                          <option value="true">Activo (true)</option>
                          <option value="false">Inactivo (false)</option>
                        </Select>
                      ) : (
                        <Input label="Valor" type="number"
                          value={String(autoClose.signal_value)}
                          onChange={e => setAutoClose(a => ({ ...a, signal_value: parseFloat(e.target.value) || 0 }))} />
                      )}
                    </div>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <Input label="Mín. señal activa (s)" type="number" min={5} step={5}
                    value={String(autoClose.min_active_seconds)}
                    onChange={e => setAutoClose(a => ({ ...a, min_active_seconds: parseInt(e.target.value) || 60 }))} />
                  <Input label="Mín. señal apagada (s)" type="number" min={5} step={5}
                    value={String(autoClose.min_inactive_seconds)}
                    onChange={e => setAutoClose(a => ({ ...a, min_inactive_seconds: parseInt(e.target.value) || 300 }))} />
                  <Input label="Margen geocerca (m)" type="number" min={0} step={5}
                    value={String(autoClose.exit_margin_m)}
                    onChange={e => setAutoClose(a => ({ ...a, exit_margin_m: parseInt(e.target.value) || 25 }))} />
                </div>

                {draftStops.some(s => !s.lat) && (
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--warn)', margin: 0 }}>
                    ⚠ Una o más paradas no tienen ubicación fijada — el auto-cierre no actuará en ellas.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* ── Paradas programadas ── */}
          <section>
            <SectionHeader
              icon="📍"
              title="Paradas programadas"
              detail={
                initial
                  ? 'Las paradas existentes se gestionan desde el panel de paradas de la orden. Aquí puedes añadir nuevas.'
                  : 'Puntos de trabajo con ubicación en mapa y datos del cliente final.'
              }
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--cmg-teal)' }}>
                {draftStops.length > 0 ? `${draftStops.length} parada${draftStops.length > 1 ? 's' : ''}` : 'Sin paradas nuevas'}
              </span>
              <button
                style={{ ...S.btnSm, background: 'color-mix(in srgb, var(--cmg-teal) 15%, transparent)', color: 'var(--cmg-teal)', border: '1px solid var(--cmg-teal)' }}
                onClick={addStop} type="button"
              >
                + Añadir parada
              </button>
            </div>

            {draftStops.length === 0 && !initial && (
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--fg-muted)', margin: 0 }}>
                Sin paradas — el conductor recibirá las instrucciones generales.
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {draftStops.map((stop, idx) => (
                <div key={stop._id} style={{
                  background: 'var(--bg-base)', borderRadius: 8, padding: 12,
                  border: '1px solid var(--border)', borderLeft: '3px solid var(--cmg-teal)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--cmg-teal)',
                      background: 'rgba(249,115,22,0.15)', borderRadius: '50%', width: 22, height: 22,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {idx + 1}
                    </span>
                    <Input size="sm" style={{ flex: 1 }} placeholder="Título de la parada *"
                      value={stop.title} onChange={e => updateStop(stop._id, 'title', e.target.value)} />
                    <button
                      style={{ background: 'transparent', border: 'none', color: 'var(--danger)', fontSize: 18, cursor: 'pointer', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                      onClick={() => removeStop(stop._id)} title="Eliminar parada" type="button"
                    >×</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <Input size="sm" placeholder="Cliente / empresa" value={stop.client_name}
                      onChange={e => updateStop(stop._id, 'client_name', e.target.value)} />
                    <Input size="sm" placeholder="Dirección" value={stop.address}
                      onChange={e => updateStop(stop._id, 'address', e.target.value)} />
                  </div>
                  <Input size="sm" placeholder="Instrucciones para el conductor" value={stop.notes}
                    onChange={e => updateStop(stop._id, 'notes', e.target.value)} style={{ marginBottom: 8 }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      style={{
                        ...S.btnSm, fontSize: 11,
                        color: stop.mapOpen ? 'var(--info)' : (stop.lat ? 'var(--ok)' : 'var(--fg-muted)'),
                        borderColor: stop.mapOpen ? 'var(--info)' : (stop.lat ? 'var(--ok)' : undefined),
                      }}
                      onClick={() => updateStop(stop._id, 'mapOpen', !stop.mapOpen)} type="button"
                    >
                      {stop.mapOpen ? '▲ Cerrar mapa' : stop.lat
                        ? `✓ Ubicación fijada · ${stop.lat.toFixed(4)}, ${stop.lon?.toFixed(4)}`
                        : '📍 Fijar ubicación en mapa'}
                    </button>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                      Radio llegada:
                      <input type="number" min={10} max={2000} step={10} value={stop.arrival_radius_m}
                        onChange={e => updateStop(stop._id, 'arrival_radius_m', Math.max(10, parseInt(e.target.value) || 50))}
                        style={{ ...S.input, width: 64, padding: '3px 6px', fontSize: 12, textAlign: 'center' }} />
                      <span>m</span>
                    </label>
                  </div>
                  {stop.mapOpen && (
                    <div style={{ marginTop: 8 }}>
                      <StopLocationPicker lat={stop.lat} lon={stop.lon} searchQuery={stop.address}
                        onPick={(la, lo) => { updateStop(stop._id, 'lat', la); updateStop(stop._id, 'lon', lo) }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

        </div>

        {/* Footer */}
        <div style={S.footer}>
          {error && <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--danger)', flex: 1 }}>{error}</span>}
          <button style={S.btnSm} onClick={onClose} type="button">Cancelar</button>
          <button
            style={{ ...S.btn, opacity: canSave ? 1 : 0.55 }}
            disabled={!canSave}
            onClick={() => mutate()}
            type="button"
          >
            {saveLabel}
          </button>
        </div>

      </div>
    </div>
  )
}
