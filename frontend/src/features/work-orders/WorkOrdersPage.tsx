import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import L from 'leaflet'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type {
  WorkOrderOut, WorkOrderStatus, WorkOrderPriority, DriverOut, VehicleOut,
  WorkOrderStopOut, WorkOrderStopCreate, WorkOrderStopStatus,
} from '../../lib/types'
import Shell from '../../shared/ui/Shell'
import WorkReportModal from './WorkReportModal'
import { useTenantContext } from '../../lib/useTenantContext'

// ── Map view ──────────────────────────────────────────────────────────────────

const C_PENDING     = '#38BDF8'  // info blue
const C_IN_PROGRESS = '#F97316'  // energy orange

function WorkOrdersMap({ orders }: { orders: WorkOrderOut[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<L.Map | null>(null)
  const layerRef     = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapRef.current = L.map(containerRef.current, {
      center: [40.416775, -3.70379], zoom: 6, zoomControl: false,
    })
    L.control.zoom({ position: 'topright' }).addTo(mapRef.current)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 19,
      attribution: '© OpenStreetMap © CARTO',
    }).addTo(mapRef.current)
    layerRef.current = L.layerGroup().addTo(mapRef.current)
    return () => { mapRef.current?.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !layerRef.current) return
    layerRef.current.clearLayers()
    const valid = orders.filter(o =>
      o.location_lat != null && o.location_lon != null &&
      (o.status === 'pending' || o.status === 'in_progress')
    )
    for (const o of valid) {
      const color = o.status === 'in_progress' ? C_IN_PROGRESS : C_PENDING
      const label = o.status === 'in_progress' ? 'En curso' : 'Pendiente'
      L.circleMarker([o.location_lat!, o.location_lon!], {
        radius: 10, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.9,
      })
        .bindPopup(`
          <div style="font-family:sans-serif;min-width:180px;padding:2px 0">
            <div style="font-weight:600;font-size:13px;margin-bottom:6px">${o.title}</div>
            ${o.location_address ? `<div style="font-size:11px;color:#777;margin-bottom:4px">📍 ${o.location_address}</div>` : ''}
            ${o.vehicle_name    ? `<div style="font-size:12px;color:#999">Vehículo: ${o.vehicle_name}</div>` : ''}
            ${o.driver_name     ? `<div style="font-size:12px;color:#999">Conductor: ${o.driver_name}</div>` : ''}
            <div style="margin-top:8px">
              <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:${color}22;color:${color}">${label}</span>
            </div>
          </div>
        `)
        .addTo(layerRef.current!)
    }
    if (valid.length > 0) {
      try {
        const group = L.featureGroup(layerRef.current.getLayers())
        map.fitBounds(group.getBounds().pad(0.25))
      } catch { /* ignore */ }
    }
  }, [orders])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: 'calc(100vh - 200px)', minHeight: 400, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bg-border)' }}
    />
  )
}

// ── Stop location picker (Leaflet map, click to set lat/lon) ──────────────────
function StopLocationPicker({
  lat, lon, onPick,
}: { lat: number | null; lon: number | null; onPick: (lat: number, lon: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef    = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const center: [number, number] = lat && lon ? [lat, lon] : [39.47, -0.376]
    const map = L.map(containerRef.current, { center, zoom: lat ? 14 : 6, zoomControl: true })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap © CARTO',
    }).addTo(map)
    mapRef.current = map
    if (lat && lon) {
      markerRef.current = L.marker([lat, lon]).addTo(map)
    }
    map.on('click', (e: L.LeafletMouseEvent) => {
      onPick(e.latlng.lat, e.latlng.lng)
      if (markerRef.current) markerRef.current.setLatLng(e.latlng)
      else markerRef.current = L.marker(e.latlng).addTo(map)
    })
    return () => { map.remove(); mapRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <div ref={containerRef} style={{ width: '100%', height: 220, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--bg-border)' }} />
      <p style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
        Haz clic en el mapa para fijar la ubicación de la parada
        {lat && lon ? ` · ${lat.toFixed(5)}, ${lon.toFixed(5)}` : ''}
      </p>
    </div>
  )
}

// ── Stop status badge ──────────────────────────────────────────────────────────
const STOP_STATUS_LABELS: Record<WorkOrderStopStatus, string> = {
  pending: 'Pendiente', arrived: 'Llegado', in_progress: 'En trabajo', done: 'Completado', skipped: 'Omitido',
}
const STOP_STATUS_COLORS: Record<WorkOrderStopStatus, string> = {
  pending: 'var(--text-muted)', arrived: 'var(--accent-info)',
  in_progress: 'var(--accent-energy)', done: 'var(--accent-ok)', skipped: 'var(--accent-warn)',
}

// ── Panel de paradas de una orden ─────────────────────────────────────────────
function StopsPanel({ order, onClose }: { order: WorkOrderOut; onClose: () => void }) {
  const qc = useQueryClient()
  const [addingStop, setAddingStop] = useState(false)
  const [newStop, setNewStop] = useState<WorkOrderStopCreate>({ title: '', order_index: 0 })
  const [pickedLat, setPickedLat] = useState<number | null>(null)
  const [pickedLon, setPickedLon] = useState<number | null>(null)
  const [stopError, setStopError] = useState('')

  const { data: stops = [], isLoading } = useQuery({
    queryKey: ['work-order-stops', order.id],
    queryFn: () => apiClient.get<WorkOrderStopOut[]>(`/api/v1/work-orders/${order.id}/stops`),
    refetchInterval: 15_000,
  })

  const { mutate: createStop, isPending: creating } = useMutation({
    mutationFn: () => apiClient.post<WorkOrderStopOut>(`/api/v1/work-orders/${order.id}/stops`, {
      ...newStop, lat: pickedLat, lon: pickedLon, order_index: stops.length,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-order-stops', order.id] })
      setAddingStop(false)
      setNewStop({ title: '', order_index: 0 })
      setPickedLat(null); setPickedLon(null)
      setStopError('')
    },
    onError: (e) => setStopError((e as Error).message),
  })

  const { mutate: patchStopStatus } = useMutation({
    mutationFn: ({ stopId, status }: { stopId: string; status: WorkOrderStopStatus }) =>
      apiClient.patch<WorkOrderStopOut>(`/api/v1/work-orders/${order.id}/stops/${stopId}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-order-stops', order.id] }),
  })

  const { mutate: deleteStop } = useMutation({
    mutationFn: (stopId: string) => apiClient.delete(`/api/v1/work-orders/${order.id}/stops/${stopId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-order-stops', order.id] }),
  })

  const up = (k: keyof WorkOrderStopCreate, v: string) =>
    setNewStop(f => ({ ...f, [k]: v || null }))

  const panelStyle: React.CSSProperties = {
    position: 'fixed', top: 0, right: 0, width: 420, height: '100vh',
    background: 'var(--bg-surface)', borderLeft: '1px solid var(--bg-border)',
    display: 'flex', flexDirection: 'column', zIndex: 2000, overflowY: 'auto',
  }

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bg-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Paradas de la ruta
          </div>
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            {order.title}
          </div>
          {order.vehicle_name && (
            <div style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              🚚 {order.vehicle_name}{order.driver_name ? ` · ${order.driver_name}` : ''}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)', lineHeight: 1, padding: 4 }}
        >
          ×
        </button>
      </div>

      {/* Lista de paradas */}
      <div style={{ padding: '12px 20px', flex: 1 }}>
        {isLoading && <div style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)' }}>Cargando paradas…</div>}

        {stops.map((stop, idx) => {
          const color = STOP_STATUS_COLORS[stop.status]
          const nextTransitions: WorkOrderStopStatus[] = stop.status === 'pending'
            ? ['arrived'] : stop.status === 'arrived'
            ? ['in_progress'] : stop.status === 'in_progress'
            ? ['done', 'skipped'] : []

          return (
            <div key={stop.id} style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
              borderRadius: 8, padding: '12px 14px', marginBottom: 10,
              borderLeft: `3px solid ${color}`,
            }}>
              {/* Número + título */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', background: color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-data)', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
                }}>
                  {idx + 1}
                </div>
                <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
                  {stop.title}
                </span>
                <span style={{ fontFamily: 'var(--font-ui)', fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {STOP_STATUS_LABELS[stop.status]}
                </span>
              </div>

              {/* Dirección */}
              {stop.address && (
                <div style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                  📍 {stop.address}
                  {stop.lat && stop.lon && (
                    <a
                      href={`https://maps.google.com/maps?q=${stop.lat},${stop.lon}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ marginLeft: 8, color: 'var(--accent-info)', fontSize: 11 }}
                    >
                      Ver mapa ↗
                    </a>
                  )}
                </div>
              )}
              {stop.client_name && (
                <div style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                  👤 Cliente: {stop.client_name}
                </div>
              )}

              {/* Telemetría del trabajo si está completado */}
              {stop.status === 'done' && (stop.pto_minutes || stop.rpm_avg || stop.fuel_l) && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--bg-border)' }}>
                  {stop.pto_minutes != null && (
                    <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--accent-energy)' }}>
                      ⏱ {stop.pto_minutes.toFixed(0)} min PTO
                    </span>
                  )}
                  {stop.pump_minutes != null && (
                    <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--accent-info)' }}>
                      💧 {stop.pump_minutes.toFixed(0)} min bomba
                    </span>
                  )}
                  {stop.rpm_avg != null && (
                    <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-muted)' }}>
                      ⚙ {stop.rpm_avg.toFixed(0)} RPM
                    </span>
                  )}
                  {stop.fuel_l != null && (
                    <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--accent-warn)' }}>
                      ⛽ {stop.fuel_l.toFixed(1)} L
                    </span>
                  )}
                  {stop.pressure_min != null && (
                    <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--accent-crit)' }}>
                      🔽 {stop.pressure_min.toFixed(0)} mbar
                    </span>
                  )}
                </div>
              )}

              {/* Tiempos */}
              {stop.started_at && (
                <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  {stop.started_at ? `Inicio: ${new Date(stop.started_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : ''}
                  {stop.completed_at ? ` · Fin: ${new Date(stop.completed_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : ''}
                </div>
              )}

              {/* Acciones */}
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {nextTransitions.map(ns => (
                  <button
                    key={ns}
                    onClick={() => patchStopStatus({ stopId: stop.id, status: ns })}
                    style={{
                      fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600,
                      padding: '3px 10px', borderRadius: 6,
                      border: `1px solid ${STOP_STATUS_COLORS[ns]}`,
                      background: 'transparent', color: STOP_STATUS_COLORS[ns], cursor: 'pointer',
                    }}
                  >
                    → {STOP_STATUS_LABELS[ns]}
                  </button>
                ))}
                {order.status !== 'done' && order.status !== 'cancelled' && stop.status === 'pending' && (
                  <button
                    onClick={() => { if (confirm('¿Eliminar esta parada?')) deleteStop(stop.id) }}
                    style={{
                      fontFamily: 'var(--font-ui)', fontSize: 11, padding: '3px 10px', borderRadius: 6,
                      border: '1px solid var(--bg-border)', background: 'transparent',
                      color: 'var(--accent-crit)', cursor: 'pointer',
                    }}
                  >
                    Eliminar
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {!isLoading && stops.length === 0 && !addingStop && (
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>
            Sin paradas. Añade la primera parada de la ruta.
          </div>
        )}

        {/* Formulario nueva parada */}
        {addingStop && (
          <div style={{
            background: 'var(--bg-base)', border: '1px solid var(--accent-energy)',
            borderRadius: 8, padding: 14, marginTop: 8,
          }}>
            <div style={{ fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 700, color: 'var(--accent-energy)', marginBottom: 10 }}>
              Nueva parada
            </div>
            {[
              { k: 'title', label: 'Título *', placeholder: 'Ej: Descarga en almacén' },
              { k: 'client_name', label: 'Cliente', placeholder: 'Nombre del cliente o empresa' },
              { k: 'address', label: 'Dirección', placeholder: 'Calle, número, localidad' },
            ].map(({ k, label, placeholder }) => (
              <div key={k} style={{ marginBottom: 8 }}>
                <div style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>{label}</div>
                <input
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
                    borderRadius: 5, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
                    fontSize: 13, padding: '6px 9px',
                  }}
                  value={(newStop as unknown as Record<string, string>)[k] ?? ''}
                  onChange={e => up(k as keyof WorkOrderStopCreate, e.target.value)}
                  placeholder={placeholder}
                />
              </div>
            ))}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Notas</div>
              <textarea
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
                  borderRadius: 5, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
                  fontSize: 13, padding: '6px 9px', resize: 'vertical', minHeight: 52,
                }}
                value={newStop.notes ?? ''}
                onChange={e => up('notes', e.target.value)}
                placeholder="Instrucciones adicionales para el conductor…"
              />
            </div>
            <StopLocationPicker
              lat={pickedLat}
              lon={pickedLon}
              onPick={(la, lo) => { setPickedLat(la); setPickedLon(lo) }}
            />
            {stopError && (
              <div style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--accent-crit)', marginTop: 6 }}>{stopError}</div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setAddingStop(false); setStopError('') }}
                style={{ fontFamily: 'var(--font-ui)', fontSize: 12, padding: '5px 14px', borderRadius: 6, border: '1px solid var(--bg-border)', background: 'var(--bg-elevated)', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                disabled={creating || !newStop.title?.trim()}
                onClick={() => createStop()}
                style={{
                  fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 700,
                  padding: '5px 14px', borderRadius: 6, border: 'none',
                  background: 'var(--accent-energy)', color: '#fff', cursor: 'pointer',
                  opacity: creating || !newStop.title?.trim() ? 0.6 : 1,
                }}
              >
                {creating ? 'Guardando…' : 'Añadir parada'}
              </button>
            </div>
          </div>
        )}

        {/* Botón añadir parada */}
        {!addingStop && order.status !== 'done' && order.status !== 'cancelled' && (
          <button
            onClick={() => setAddingStop(true)}
            style={{
              width: '100%', marginTop: 8,
              fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600,
              padding: '9px 0', borderRadius: 8,
              border: '1px dashed var(--accent-energy)', background: 'transparent',
              color: 'var(--accent-energy)', cursor: 'pointer',
            }}
          >
            + Añadir parada
          </button>
        )}
      </div>
    </div>
  )
}

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  pending: 'Pendiente', in_progress: 'En curso', done: 'Completada', cancelled: 'Cancelada',
}
const STATUS_COLORS: Record<WorkOrderStatus, string> = {
  pending: 'var(--accent-info)', in_progress: 'var(--accent-energy)',
  done: 'var(--accent-ok)', cancelled: 'var(--accent-off)',
}
const PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente',
}
const PRIORITY_COLORS: Record<WorkOrderPriority, string> = {
  low: 'var(--text-muted)', normal: 'var(--text-muted)',
  high: 'var(--accent-warn)', urgent: 'var(--accent-crit)',
}

const ALL_STATUSES: WorkOrderStatus[] = ['pending', 'in_progress', 'done', 'cancelled']

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 } as const,
  title: { fontFamily: 'var(--font-ui)', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 } as const,
  btn: { fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent-energy)', color: '#fff' } as const,
  btnSm: { fontFamily: 'var(--font-ui)', fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--bg-border)', background: 'var(--bg-elevated)', color: 'var(--text-muted)', cursor: 'pointer' } as const,
  filters: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' as const },
  chip: (active: boolean) => ({
    fontFamily: 'var(--font-ui)', fontSize: 12, padding: '4px 12px', borderRadius: 99, cursor: 'pointer', border: 'none',
    background: active ? 'var(--accent-energy)' : 'var(--bg-elevated)',
    color: active ? '#fff' : 'var(--text-muted)',
  }),
  card: { background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 10, padding: '14px 18px', display: 'flex', flexDirection: 'column' as const, gap: 8 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--bg-surface)', borderRadius: 12, padding: 28, width: 500, display: 'flex', flexDirection: 'column' as const, gap: 14, maxHeight: '90vh', overflowY: 'auto' as const },
  field: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  input: { background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', borderRadius: 6, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)', fontSize: 13, padding: '8px 10px' } as const,
  select: { background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', borderRadius: 6, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)', fontSize: 13, padding: '8px 10px' } as const,
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: WorkOrderStatus }) {
  return (
    <span style={{
      fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600,
      padding: '2px 8px', borderRadius: 99,
      background: `color-mix(in srgb, ${STATUS_COLORS[status]} 20%, transparent)`,
      color: STATUS_COLORS[status],
    }}>
      {STATUS_LABELS[status]}
    </span>
  )
}

// ── Modal crear/editar ────────────────────────────────────────────────────────
interface ModalProps {
  initial?: WorkOrderOut | null
  vehicles: VehicleOut[]
  drivers: DriverOut[]
  onClose: () => void
  onSaved: () => void
}

function WorkOrderModal({ initial, vehicles, drivers, onClose, onSaved }: ModalProps) {
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    vehicle_id: initial?.vehicle_id ?? '',
    driver_id: initial?.driver_id ?? '',
    priority: (initial?.priority ?? 'normal') as WorkOrderPriority,
    scheduled_at: initial?.scheduled_at?.slice(0, 16) ?? '',
    location_address: initial?.location_address ?? '',
    notes: initial?.notes ?? '',
  })
  const [error, setError] = useState('')

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        vehicle_id: form.vehicle_id || null,
        driver_id: form.driver_id || null,
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
        description: form.description || null,
        location_address: form.location_address || null,
        notes: form.notes || null,
      }
      return initial
        ? apiClient.put<WorkOrderOut>(`/api/v1/work-orders/${initial.id}`, payload)
        : apiClient.post<WorkOrderOut>('/api/v1/work-orders', payload)
    },
    onSuccess: () => { onSaved(); onClose() },
    onError: (e) => setError((e as Error).message),
  })

  const u = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <h2 style={{ ...S.title, fontSize: 16, margin: 0 }}>
          {initial ? 'Editar orden' : 'Nueva orden de trabajo'}
        </h2>

        <div style={S.field}>
          <span style={S.label}>Título *</span>
          <input style={S.input} value={form.title} onChange={e => u('title', e.target.value)} placeholder="Ej: Limpieza alcantarilla Calle Mayor 5"/>
        </div>
        <div style={S.field}>
          <span style={S.label}>Descripción</span>
          <textarea style={{ ...S.input, resize: 'vertical', minHeight: 56 }} value={form.description} onChange={e => u('description', e.target.value)}/>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={S.field}>
            <span style={S.label}>Vehículo</span>
            <select style={S.select} value={form.vehicle_id} onChange={e => u('vehicle_id', e.target.value)}>
              <option value="">— Sin asignar —</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div style={S.field}>
            <span style={S.label}>Conductor</span>
            <select style={S.select} value={form.driver_id} onChange={e => u('driver_id', e.target.value)}>
              <option value="">— Sin asignar —</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={S.field}>
            <span style={S.label}>Prioridad</span>
            <select style={S.select} value={form.priority} onChange={e => u('priority', e.target.value as WorkOrderPriority)}>
              {(Object.entries(PRIORITY_LABELS) as [WorkOrderPriority, string][]).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </div>
          <div style={S.field}>
            <span style={S.label}>Fecha programada</span>
            <input style={S.input} type="datetime-local" value={form.scheduled_at} onChange={e => u('scheduled_at', e.target.value)}/>
          </div>
        </div>
        <div style={S.field}>
          <span style={S.label}>Dirección / Ubicación</span>
          <input style={S.input} value={form.location_address} onChange={e => u('location_address', e.target.value)} placeholder="Calle, número, localidad"/>
        </div>
        <div style={S.field}>
          <span style={S.label}>Notas internas</span>
          <textarea style={{ ...S.input, resize: 'vertical', minHeight: 48 }} value={form.notes} onChange={e => u('notes', e.target.value)}/>
        </div>

        {error && <span style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--accent-crit)' }}>{error}</span>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button style={S.btnSm} onClick={onClose}>Cancelar</button>
          <button style={{ ...S.btn, opacity: isPending || !form.title.trim() ? 0.6 : 1 }} disabled={isPending || !form.title.trim()} onClick={() => mutate()}>
            {isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function WorkOrdersPage() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<WorkOrderStatus | 'all'>('all')
  const [view, setView] = useState<'list' | 'map'>('list')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<WorkOrderOut | null>(null)
  const [reportOrder, setReportOrder] = useState<WorkOrderOut | null>(null)
  const [stopsOrder, setStopsOrder] = useState<WorkOrderOut | null>(null)

  const { activeTenantId } = useTenantContext()

  const ordersUrl = (() => {
    const params: string[] = []
    if (filter !== 'all') params.push(`status=${filter}`)
    if (activeTenantId) params.push(`tenant_id=${activeTenantId}`)
    return `/api/v1/work-orders${params.length ? `?${params.join('&')}` : ''}`
  })()

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['work-orders', filter, activeTenantId],
    queryFn: () => apiClient.get<WorkOrderOut[]>(ordersUrl),
  })
  const { data: vehicles = [] } = useQuery({
    queryKey: [...keys.vehicles(), activeTenantId],
    queryFn: () => apiClient.get<VehicleOut[]>(`/api/v1/vehicles${activeTenantId ? `?tenant_id=${activeTenantId}` : ''}`),
  })
  const { data: drivers = [] } = useQuery({
    queryKey: [...keys.drivers(), activeTenantId],
    queryFn: () => apiClient.get<DriverOut[]>(`/api/v1/drivers${activeTenantId ? `?tenant_id=${activeTenantId}` : ''}`),
  })

  const { mutate: changeStatus } = useMutation({
    mutationFn: ({ id, status }: { id: string; status: WorkOrderStatus }) =>
      apiClient.patch<WorkOrderOut>(`/api/v1/work-orders/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-orders'] }),
  })

  const { mutate: deleteOrder } = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/work-orders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-orders'] }),
  })

  const handleSaved = () => qc.invalidateQueries({ queryKey: ['work-orders'] })

  return (
    <>
    <Shell title="Órdenes de trabajo">
      <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
      <div style={S.header}>
        <h1 style={S.title}>Órdenes de trabajo</h1>
        <button style={S.btn} onClick={() => { setEditing(null); setShowModal(true) }}>
          + Nueva orden
        </button>
      </div>

      {/* Filtros de estado + toggle vista */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={S.chip(filter === 'all')} onClick={() => setFilter('all')}>Todas</button>
          {ALL_STATUSES.map(s => (
            <button key={s} style={S.chip(filter === s)} onClick={() => setFilter(s)}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            style={{ ...S.chip(view === 'list'), borderRadius: '6px 0 0 6px' }}
            onClick={() => setView('list')}
          >
            ☰ Lista
          </button>
          <button
            style={{ ...S.chip(view === 'map'), borderRadius: '0 6px 6px 0' }}
            onClick={() => setView('map')}
          >
            ◉ Mapa
          </button>
        </div>
      </div>

      {isLoading && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Cargando…</div>}

      {!isLoading && orders.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          No hay órdenes de trabajo{filter !== 'all' ? ` con estado "${STATUS_LABELS[filter as WorkOrderStatus]}"` : ''}.
        </div>
      )}

      {view === 'map' && <WorkOrdersMap orders={orders}/>}

      <div style={{ display: view === 'list' ? 'flex' : 'none', flexDirection: 'column', gap: 8 }}>
        {orders.map(o => (
          <div key={o.id} style={S.card}>
            <div style={S.row}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <StatusBadge status={o.status}/>
                <span style={{
                  fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600,
                  color: PRIORITY_COLORS[o.priority],
                }}>
                  {PRIORITY_LABELS[o.priority]}
                </span>
                <span style={{ fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {o.title}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {/* Botones de transición de estado */}
                {o.status === 'pending' && (
                  <button style={{ ...S.btnSm, color: 'var(--accent-energy)', borderColor: 'var(--accent-energy)' }}
                    onClick={() => changeStatus({ id: o.id, status: 'in_progress' })}>
                    Iniciar
                  </button>
                )}
                {o.status === 'in_progress' && (
                  <button style={{ ...S.btnSm, color: 'var(--accent-ok)', borderColor: 'var(--accent-ok)' }}
                    onClick={() => changeStatus({ id: o.id, status: 'done' })}>
                    Completar
                  </button>
                )}
                {(o.status === 'pending' || o.status === 'in_progress') && (
                  <button style={S.btnSm} onClick={() => changeStatus({ id: o.id, status: 'cancelled' })}>
                    Cancelar
                  </button>
                )}
                {(o.status === 'in_progress' || o.status === 'done') && (
                  <button
                    style={{ ...S.btnSm, color: 'var(--accent-info)', borderColor: 'var(--accent-info)' }}
                    onClick={() => setReportOrder(o)}
                  >
                    Informe
                  </button>
                )}
                <button
                  style={{ ...S.btnSm, borderColor: 'var(--accent-energy)', color: 'var(--accent-energy)' }}
                  onClick={() => setStopsOrder(o)}
                >
                  Ruta
                </button>
                <button style={S.btnSm} onClick={() => { setEditing(o); setShowModal(true) }}>Editar</button>
                {(o.status === 'pending' || o.status === 'cancelled') && (
                  <button style={{ ...S.btnSm, color: 'var(--accent-crit)' }}
                    onClick={() => { if (confirm('¿Eliminar esta orden?')) deleteOrder(o.id) }}>
                    Eliminar
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {o.vehicle_name && <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)' }}>Vehículo: <b style={{ color: 'var(--text-primary)' }}>{o.vehicle_name}</b></span>}
              {o.driver_name  && <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)' }}>Conductor: <b style={{ color: 'var(--text-primary)' }}>{o.driver_name}</b></span>}
              {o.scheduled_at && <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)' }}>Programada: {new Date(o.scheduled_at).toLocaleString('es-ES')}</span>}
              {o.location_address && <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)' }}>{o.location_address}</span>}
            </div>

            {o.description && (
              <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)' }}>{o.description}</span>
            )}
          </div>
        ))}
      </div>{/* end list view */}

      {showModal && (
        <WorkOrderModal
          initial={editing}
          vehicles={vehicles}
          drivers={drivers}
          onClose={() => setShowModal(false)}
          onSaved={handleSaved}
        />
      )}

      {reportOrder && (
        <WorkReportModal
          order={reportOrder}
          onClose={() => setReportOrder(null)}
        />
      )}
      </div>
    </Shell>

    {stopsOrder && (
      <StopsPanel order={stopsOrder} onClose={() => setStopsOrder(null)} />
    )}
    </>
  )
}
