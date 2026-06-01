import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import L from 'leaflet'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type {
  WorkOrderOut, WorkOrderStatus, WorkOrderPriority, DriverOut, VehicleOut,
  WorkOrderStopOut, WorkOrderStopCreate, WorkOrderStopStatus, VehicleStatus,
} from '../../lib/types'
import Shell from '../../shared/ui/Shell'
import { SkeletonRow } from '../../shared/ui/SkeletonCard'
import WorkReportModal from './WorkReportModal'
import { useTenantContext } from '../../lib/useTenantContext'
import { useAuthStore } from '../auth/useAuthStore'
import { toast } from '../../shared/ui/Toast'
import { useConfirm } from '../../shared/ui/ConfirmDialog'
import { Input } from '../../shared/ui/Input'

async function downloadOrderPdf(order: WorkOrderOut) {
  const token = useAuthStore.getState().accessToken
  try {
    const res = await fetch(`/api/v1/work-orders/${order.id}/report/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) {
      toast.error(`No se pudo descargar el PDF (${res.status})`)
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${order.doc_number ?? `parte_${order.title.slice(0, 30)}`}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (e) {
    toast.error((e as Error).message ?? 'Error de red')
  }
}

// ── Map view ──────────────────────────────────────────────────────────────────

const C_PENDING     = 'var(--info)'
const C_IN_PROGRESS = 'var(--energy-orange)'  // energy orange

function WorkOrdersMap({ orders }: { orders: WorkOrderOut[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<L.Map | null>(null)
  const layerRef     = useRef<L.LayerGroup | null>(null)

  // Fetch live vehicle positions for in_progress orders
  const vehicleIds = [...new Set(
    orders.filter(o => o.status === 'in_progress' && o.vehicle_id).map(o => o.vehicle_id!)
  )]
  const { data: statuses = [] } = useQuery<VehicleStatus[]>({
    queryKey: ['vehicle-statuses-map', vehicleIds.join(',')],
    queryFn: () => vehicleIds.length
      ? apiClient.get<VehicleStatus[]>(`/api/v1/vehicles/statuses?ids=${vehicleIds.join(',')}`)
      : Promise.resolve([]),
    refetchInterval: 15_000,
    enabled: vehicleIds.length > 0,
  })
  const statusMap = Object.fromEntries(statuses.map(s => [s.vehicle_id, s]))

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

    // Order destination markers
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

    // Live vehicle position markers
    for (const o of orders.filter(o => o.status === 'in_progress' && o.vehicle_id)) {
      const st = statusMap[o.vehicle_id!]
      if (!st?.lat || !st?.lon) continue
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:var(--energy-orange);border:2px solid #fff;border-radius:50%;width:16px;height:16px;box-shadow:0 0 6px rgba(249,115,22,0.53)"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      })
      L.marker([st.lat, st.lon], { icon })
        .bindPopup(`
          <div style="font-family:sans-serif;min-width:150px;padding:2px 0">
            <div style="font-weight:600;font-size:12px;margin-bottom:4px">🚚 ${o.vehicle_name ?? 'Vehículo'}</div>
            ${o.driver_name ? `<div style="font-size:11px;color:#999">${o.driver_name}</div>` : ''}
            <div style="font-size:11px;color:#999;margin-top:4px">${st.speed_kmh != null ? `${st.speed_kmh.toFixed(0)} km/h` : 'Parado'}</div>
            <div style="margin-top:6px;font-size:10px;color:var(--energy-orange);font-weight:700">📋 ${o.title}</div>
          </div>
        `)
        .addTo(layerRef.current!)
    }

    if (valid.length > 0 || statuses.some(s => s.lat && s.lon)) {
      try {
        const group = L.featureGroup(layerRef.current.getLayers())
        if (group.getLayers().length > 0) map.fitBounds(group.getBounds().pad(0.25))
      } catch { /* ignore */ }
    }
  }, [orders, statuses])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: 'calc(100vh - 200px)', minHeight: 400, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}
    />
  )
}

// ── Stop location picker (Leaflet map, click to set lat/lon) ──────────────────
type NominatimPlace = { lat: string; lon: string; display_name: string }

// Chincheta naranja SVG — evita el icono PNG por defecto de Leaflet que Vite no resuelve
function makeStopIcon(label?: string) {
  return L.divIcon({
    html: `<div style="position:relative;width:28px;height:36px">
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36" style="display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.45))">
        <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.268 21.732 0 14 0z" fill="var(--energy-orange)"/>
        <circle cx="14" cy="14" r="6" fill="white"/>
        ${label ? `<text x="14" y="18" text-anchor="middle" font-size="8" font-weight="700" fill="var(--energy-orange)" font-family="monospace">${label}</text>` : ''}
      </svg>
    </div>`,
    className: '',
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -38],
  })
}

function StopLocationPicker({
  lat, lon, searchQuery, onPick,
}: { lat: number | null; lon: number | null; searchQuery?: string; onPick: (lat: number, lon: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef    = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const [query,       setQuery]       = useState(searchQuery ?? '')
  const [places,      setPlaces]      = useState<NominatimPlace[]>([])
  const [searching,   setSearching]   = useState(false)
  const [showDrop,    setShowDrop]    = useState(false)
  const [noResults,   setNoResults]   = useState(false)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const center: [number, number] = lat && lon ? [lat, lon] : [39.47, -0.376]
    const map = L.map(containerRef.current, { center, zoom: lat ? 14 : 6, zoomControl: true })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap © CARTO',
    }).addTo(map)
    mapRef.current = map
    if (lat && lon) {
      markerRef.current = L.marker([lat, lon], { icon: makeStopIcon() }).addTo(map)
    }
    map.on('click', (e: L.LeafletMouseEvent) => {
      onPick(e.latlng.lat, e.latlng.lng)
      if (markerRef.current) markerRef.current.setLatLng(e.latlng)
      else markerRef.current = L.marker(e.latlng, { icon: makeStopIcon() }).addTo(map)
      setShowDrop(false)
    })
    return () => { map.remove(); mapRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function geocode() {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setPlaces([])
    setNoResults(false)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&accept-language=es`,
        { headers: { 'Accept': 'application/json' } }
      )
      const data: NominatimPlace[] = await res.json()
      if (data.length === 0) { setNoResults(true); setShowDrop(true) }
      else { setPlaces(data); setShowDrop(true) }
    } catch {
      setNoResults(true); setShowDrop(true)
    }
    setSearching(false)
  }

  function pickPlace(p: NominatimPlace) {
    const la = parseFloat(p.lat), lo = parseFloat(p.lon)
    setShowDrop(false)
    setPlaces([])
    onPick(la, lo)
    if (mapRef.current) {
      mapRef.current.setView([la, lo], 16)
      if (markerRef.current) markerRef.current.setLatLng([la, lo])
      else markerRef.current = L.marker([la, lo], { icon: makeStopIcon() }).addTo(mapRef.current)
    }
  }

  const inputStyle: React.CSSProperties = {
    flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 5, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)',
    fontSize: 12, padding: '6px 9px',
  }

  return (
    <div>
      {/* Buscador de dirección */}
      <div style={{ position: 'relative', marginBottom: 6 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            style={inputStyle}
            placeholder="Buscar dirección, lugar o coordenadas…"
            value={query}
            onChange={e => { setQuery(e.target.value); setShowDrop(false) }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); geocode() } }}
            onFocus={() => places.length > 0 && setShowDrop(true)}
          />
          <button
            type="button"
            onClick={geocode}
            disabled={searching || !query.trim()}
            style={{ background: 'var(--cmg-teal)', color: '#fff', border: 'none', borderRadius: 5, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0, opacity: searching || !query.trim() ? 0.6 : 1 }}
          >
            {searching ? '…' : 'Buscar'}
          </button>
        </div>

        {/* Dropdown resultados */}
        {showDrop && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 600, boxShadow: '0 6px 20px rgba(0,0,0,0.5)', maxHeight: 210, overflowY: 'auto', marginTop: 2 }}>
            {noResults ? (
              <div style={{ padding: '10px 12px', fontSize: 12, fontFamily: 'var(--font-sans)', color: 'var(--fg-muted)' }}>
                Sin resultados — prueba con otra dirección o haz clic en el mapa
              </div>
            ) : places.map((p, i) => (
              <div
                key={i}
                onClick={() => pickPlace(p)}
                style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'var(--font-sans)', cursor: 'pointer', borderBottom: i < places.length - 1 ? '1px solid var(--border)' : 'none', color: 'var(--fg-primary)', lineHeight: 1.4 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {p.display_name}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mapa */}
      <div ref={containerRef} style={{ width: '100%', height: 220, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }} />
      <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--fg-muted)', marginTop: 4, marginBottom: 0 }}>
        Busca una dirección arriba o haz clic en el mapa para fijar la ubicación
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
  pending: 'var(--fg-muted)', arrived: 'var(--info)',
  in_progress: 'var(--cmg-teal)', done: 'var(--ok)', skipped: 'var(--warn)',
}

// ── Panel de paradas de una orden ─────────────────────────────────────────────
function StopsPanel({ order, onClose, onReportStop }: { order: WorkOrderOut; onClose: () => void; onReportStop: (stop: WorkOrderStopOut) => void }) {
  const qc = useQueryClient()
  const confirmAsk = useConfirm()
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
    background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', zIndex: 2000, overflowY: 'auto',
  }

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Paradas de la ruta
          </div>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 700, color: 'var(--fg-primary)' }}>
            {order.title}
          </div>
          {order.vehicle_name && (
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
              🚚 {order.vehicle_name}{order.driver_name ? ` · ${order.driver_name}` : ''}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--fg-muted)', lineHeight: 1, padding: 4 }}
        >
          ×
        </button>
      </div>

      {/* Lista de paradas */}
      <div style={{ padding: '12px 20px', flex: 1 }}>
        {isLoading && <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-muted)' }}>Cargando paradas…</div>}

        {stops.map((stop, idx) => {
          const color = STOP_STATUS_COLORS[stop.status]
          const nextTransitions: WorkOrderStopStatus[] = stop.status === 'pending'
            ? ['arrived'] : stop.status === 'arrived'
            ? ['in_progress'] : stop.status === 'in_progress'
            ? ['done', 'skipped'] : []

          return (
            <div key={stop.id} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '12px 14px', marginBottom: 10,
              borderLeft: `3px solid ${color}`,
            }}>
              {/* Número + título */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', background: color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
                }}>
                  {idx + 1}
                </div>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600, color: 'var(--fg-primary)', flex: 1 }}>
                  {stop.title}
                </span>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {STOP_STATUS_LABELS[stop.status]}
                </span>
              </div>

              {/* Dirección */}
              {stop.address && (
                <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 4 }}>
                  📍 {stop.address}
                  {stop.lat && stop.lon && (
                    <a
                      href={`https://maps.google.com/maps?q=${stop.lat},${stop.lon}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ marginLeft: 8, color: 'var(--info)', fontSize: 11 }}
                    >
                      Ver mapa ↗
                    </a>
                  )}
                </div>
              )}
              {stop.client_name && (
                <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 4 }}>
                  👤 Cliente: {stop.client_name}
                </div>
              )}

              {/* Telemetría del trabajo si está completado */}
              {stop.status === 'done' && (stop.pto_minutes || stop.rpm_avg || stop.fuel_l) && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                  {stop.pto_minutes != null && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--cmg-teal)' }}>
                      ⏱ {stop.pto_minutes.toFixed(0)} min PTO
                    </span>
                  )}
                  {stop.pump_minutes != null && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--info)' }}>
                      💧 {stop.pump_minutes.toFixed(0)} min bomba
                    </span>
                  )}
                  {stop.rpm_avg != null && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' }}>
                      ⚙ {stop.rpm_avg.toFixed(0)} RPM
                    </span>
                  )}
                  {stop.fuel_l != null && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--warn)' }}>
                      ⛽ {stop.fuel_l.toFixed(1)} L
                    </span>
                  )}
                  {stop.pressure_min != null && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--danger)' }}>
                      🔽 {stop.pressure_min.toFixed(0)} mbar
                    </span>
                  )}
                </div>
              )}

              {/* Tiempos */}
              {stop.started_at && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
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
                      fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600,
                      padding: '3px 10px', borderRadius: 6,
                      border: `1px solid ${STOP_STATUS_COLORS[ns]}`,
                      background: 'transparent', color: STOP_STATUS_COLORS[ns], cursor: 'pointer',
                    }}
                  >
                    → {STOP_STATUS_LABELS[ns]}
                  </button>
                ))}
                {stop.status === 'done' && (
                  <button
                    onClick={() => onReportStop(stop)}
                    style={{
                      fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 6,
                      border: '1px solid var(--cmg-teal)', background: 'transparent',
                      color: 'var(--cmg-teal)', cursor: 'pointer',
                    }}
                  >
                    Informe
                  </button>
                )}
                {order.status !== 'done' && order.status !== 'cancelled' && stop.status === 'pending' && (
                  <button
                    onClick={async () => { if (await confirmAsk({ title: 'Eliminar parada', message: '¿Eliminar esta parada?', confirmLabel: 'Eliminar', kind: 'danger' })) deleteStop(stop.id) }}
                    style={{
                      fontFamily: 'var(--font-sans)', fontSize: 11, padding: '3px 10px', borderRadius: 6,
                      border: '1px solid var(--border)', background: 'transparent',
                      color: 'var(--danger)', cursor: 'pointer',
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
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-muted)', textAlign: 'center', padding: '24px 0' }}>
            Sin paradas. Añade la primera parada de la ruta.
          </div>
        )}

        {/* Formulario nueva parada */}
        {addingStop && (
          <div style={{
            background: 'var(--bg-base)', border: '1px solid var(--cmg-teal)',
            borderRadius: 8, padding: 14, marginTop: 8,
          }}>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: 'var(--cmg-teal)', marginBottom: 10 }}>
              Nueva parada
            </div>
            {[
              { k: 'title', label: 'Título *', placeholder: 'Ej: Descarga en almacén' },
              { k: 'client_name', label: 'Cliente', placeholder: 'Nombre del cliente o empresa' },
              { k: 'address', label: 'Dirección', placeholder: 'Calle, número, localidad' },
            ].map(({ k, label, placeholder }) => (
              <div key={k} style={{ marginBottom: 8 }}>
                <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--fg-muted)', marginBottom: 3 }}>{label}</div>
                <input
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    borderRadius: 5, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)',
                    fontSize: 13, padding: '6px 9px',
                  }}
                  value={(newStop as unknown as Record<string, string>)[k] ?? ''}
                  onChange={e => up(k as keyof WorkOrderStopCreate, e.target.value)}
                  placeholder={placeholder}
                />
              </div>
            ))}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--fg-muted)', marginBottom: 3 }}>Notas</div>
              <textarea
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 5, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)',
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
              searchQuery={newStop.address ?? ''}
              onPick={(la, lo) => { setPickedLat(la); setPickedLon(lo) }}
            />
            {stopError && (
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>{stopError}</div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setAddingStop(false); setStopError('') }}
                style={{ fontFamily: 'var(--font-sans)', fontSize: 12, padding: '5px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--fg-muted)', cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                disabled={creating || !newStop.title?.trim()}
                onClick={() => createStop()}
                style={{
                  fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700,
                  padding: '5px 14px', borderRadius: 6, border: 'none',
                  background: 'var(--cmg-teal)', color: '#fff', cursor: 'pointer',
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
              fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600,
              padding: '9px 0', borderRadius: 8,
              border: '1px dashed var(--cmg-teal)', background: 'transparent',
              color: 'var(--cmg-teal)', cursor: 'pointer',
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
  pending: 'var(--info)', in_progress: 'var(--cmg-teal)',
  done: 'var(--ok)', cancelled: 'var(--offline)',
}
const PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente',
}
const PRIORITY_COLORS: Record<WorkOrderPriority, string> = {
  low: 'var(--fg-muted)', normal: 'var(--fg-muted)',
  high: 'var(--warn)', urgent: 'var(--danger)',
}

const ALL_STATUSES: WorkOrderStatus[] = ['pending', 'in_progress', 'done', 'cancelled']

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 } as const,
  title: { fontFamily: 'var(--font-sans)', fontSize: 20, fontWeight: 700, color: 'var(--fg-primary)', margin: 0 } as const,
  btn: { fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--cmg-teal)', color: '#fff' } as const,
  btnSm: { fontFamily: 'var(--font-sans)', fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--fg-muted)', cursor: 'pointer' } as const,
  filters: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' as const },
  chip: (active: boolean) => ({
    fontFamily: 'var(--font-sans)', fontSize: 12, padding: '4px 12px', borderRadius: 99, cursor: 'pointer', border: 'none',
    background: active ? 'var(--cmg-teal)' : 'var(--bg-elevated)',
    color: active ? '#fff' : 'var(--fg-muted)',
  }),
  card: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', display: 'flex', flexDirection: 'column' as const, gap: 8 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--bg-surface)', borderRadius: 12, padding: 28, width: 500, display: 'flex', flexDirection: 'column' as const, gap: 14, maxHeight: '90vh', overflowY: 'auto' as const },
  field: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  input: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)', fontSize: 13, padding: '8px 10px' } as const,
  select: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)', fontSize: 13, padding: '8px 10px' } as const,
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: WorkOrderStatus }) {
  return (
    <span style={{
      fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600,
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

function WorkOrderModal({ initial, vehicles, drivers, onClose, onSaved }: ModalProps) {
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
      }
      const order = initial
        ? await apiClient.put<WorkOrderOut>(`/api/v1/work-orders/${initial.id}`, payload)
        : await apiClient.post<WorkOrderOut>('/api/v1/work-orders', payload)
      for (let i = 0; i < draftStops.length; i++) {
        const s = draftStops[i]
        if (!s.title.trim()) continue
        await apiClient.post(`/api/v1/work-orders/${order.id}/stops`, {
          order_index: i,
          title: s.title,
          client_name: s.client_name || null,
          address: s.address || null,
          lat: s.lat,
          lon: s.lon,
          arrival_radius_m: s.arrival_radius_m,
          notes: s.notes || null,
        })
      }
      return order
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.workOrders() })
      onSaved()
      onClose()
    },
    onError: (e) => setError((e as Error).message),
  })

  const u = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const saveLabel = isPending
    ? 'Guardando…'
    : initial
      ? 'Guardar cambios'
      : validStops.length > 0
        ? `Crear orden + ${validStops.length} parada${validStops.length > 1 ? 's' : ''}`
        : 'Crear orden'

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, width: 'min(700px, 95vw)' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ ...S.title, fontSize: 16, margin: 0 }}>
          {initial ? 'Editar orden' : 'Nueva orden de trabajo'}
        </h2>

        {/* ── Datos generales ── */}
        <div style={S.field}>
          <span style={S.label}>Título *</span>
          <Input value={form.title} onChange={e => u('title', e.target.value)} placeholder="Ej: Limpieza alcantarilla Calle Mayor 5" />
        </div>
        <div style={S.field}>
          <span style={S.label}>Descripción</span>
          <textarea style={{ ...S.input, resize: 'vertical', minHeight: 48 }} value={form.description} onChange={e => u('description', e.target.value)}/>
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
            <Input type="datetime-local" value={form.scheduled_at} onChange={e => u('scheduled_at', e.target.value)} />
          </div>
        </div>
        <div style={S.field}>
          <span style={S.label}>Notas internas</span>
          <textarea style={{ ...S.input, resize: 'vertical', minHeight: 40 }} value={form.notes} onChange={e => u('notes', e.target.value)}/>
        </div>

        {/* ── Datos del cliente final (aparecerán en el PDF del parte) ── */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: 'var(--fg-primary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Cliente final del servicio (opcional)
          </span>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--fg-muted)', margin: '4px 0 8px' }}>
            Aparecerá en el bloque "Cliente" del PDF del parte de servicio.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={S.field}>
              <span style={S.label}>Nombre / Razón social</span>
              <Input
                value={form.final_client_name}
                maxLength={200}
                placeholder="Comunidad El Pinar"
                onChange={e => u('final_client_name', e.target.value)}
              />
            </div>
            <div style={S.field}>
              <span style={S.label}>Dirección</span>
              <Input
                value={form.final_client_address}
                maxLength={300}
                placeholder="C/ Mayor 12, Valencia"
                onChange={e => u('final_client_address', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* ── Paradas programadas ── */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: 'var(--fg-primary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Paradas programadas
              </span>
              {draftStops.length > 0 && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--cmg-teal)', marginLeft: 6 }}>
                  {draftStops.length}
                </span>
              )}
            </div>
            <button
              style={{ ...S.btnSm, background: 'color-mix(in srgb, var(--cmg-teal) 15%, transparent)', color: 'var(--cmg-teal)', border: '1px solid var(--cmg-teal)', fontSize: 12 }}
              onClick={addStop}
              type="button"
            >
              + Añadir parada
            </button>
          </div>

          {draftStops.length === 0 && (
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--fg-muted)', margin: '0 0 4px' }}>
              Sin paradas — el conductor recibirá las instrucciones generales. Añade paradas para definir los puntos de trabajo con ubicación en el mapa.
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {draftStops.map((stop, idx) => (
              <div key={stop._id} style={{
                background: 'var(--bg-base)', borderRadius: 8, padding: 12,
                border: '1px solid var(--border)', borderLeft: '3px solid var(--cmg-teal)',
              }}>
                {/* Row 1: número + título + eliminar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                    color: 'var(--cmg-teal)', background: 'rgba(249,115,22,0.15)',
                    borderRadius: '50%', width: 22, height: 22,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    {idx + 1}
                  </span>
                  <Input
                    size="sm"
                    style={{ flex: 1 }}
                    placeholder="Título de la parada *"
                    value={stop.title}
                    onChange={e => updateStop(stop._id, 'title', e.target.value)}
                  />
                  <button
                    style={{ background: 'transparent', border: 'none', color: 'var(--danger)', fontSize: 18, cursor: 'pointer', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                    onClick={() => removeStop(stop._id)}
                    title="Eliminar parada"
                    type="button"
                  >
                    ×
                  </button>
                </div>

                {/* Row 2: cliente + dirección */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <Input size="sm" placeholder="Cliente / empresa" value={stop.client_name}
                    onChange={e => updateStop(stop._id, 'client_name', e.target.value)} />
                  <Input size="sm" placeholder="Dirección" value={stop.address}
                    onChange={e => updateStop(stop._id, 'address', e.target.value)} />
                </div>

                {/* Row 3: notas */}
                <Input size="sm" placeholder="Instrucciones para el conductor" value={stop.notes}
                  onChange={e => updateStop(stop._id, 'notes', e.target.value)}
                  style={{ marginBottom: 8 }} />

                {/* Toggle mapa + radio de llegada */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    style={{
                      ...S.btnSm, fontSize: 11,
                      color: stop.mapOpen ? 'var(--info)' : (stop.lat ? 'var(--ok)' : 'var(--fg-muted)'),
                      borderColor: stop.mapOpen ? 'var(--info)' : (stop.lat ? 'var(--ok)' : undefined),
                    }}
                    onClick={() => updateStop(stop._id, 'mapOpen', !stop.mapOpen)}
                    type="button"
                  >
                    {stop.mapOpen
                      ? '▲ Cerrar mapa'
                      : stop.lat
                        ? `✓ Ubicación fijada · ${stop.lat.toFixed(4)}, ${stop.lon?.toFixed(4)}`
                        : '📍 Fijar ubicación en mapa'}
                  </button>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                    Radio llegada:
                    <input
                      type="number"
                      min={10} max={2000} step={10}
                      value={stop.arrival_radius_m}
                      onChange={e => updateStop(stop._id, 'arrival_radius_m', Math.max(10, parseInt(e.target.value) || 50))}
                      style={{ ...S.input, width: 64, padding: '3px 6px', fontSize: 12, textAlign: 'center' }}
                    />
                    <span>m</span>
                  </label>
                </div>

                {stop.mapOpen && (
                  <div style={{ marginTop: 8 }}>
                    <StopLocationPicker
                      lat={stop.lat}
                      lon={stop.lon}
                      searchQuery={stop.address}
                      onPick={(la, lo) => {
                        updateStop(stop._id, 'lat', la)
                        updateStop(stop._id, 'lon', lo)
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {error && <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--danger)' }}>{error}</span>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button style={S.btnSm} onClick={onClose} type="button">Cancelar</button>
          <button
            style={{ ...S.btn, opacity: isPending || !form.title.trim() ? 0.6 : 1 }}
            disabled={isPending || !form.title.trim()}
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

// ── Página principal ──────────────────────────────────────────────────────────
export default function WorkOrdersPage() {
  const qc = useQueryClient()
  const confirmAsk = useConfirm()
  const isAdmin = useAuthStore(s => s.user?.role === 'admin')
  const [filter, setFilter] = useState<WorkOrderStatus | 'all'>('all')
  const [view, setView] = useState<'list' | 'map'>('list')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<WorkOrderOut | null>(null)
  const [reportOrder, setReportOrder] = useState<WorkOrderOut | null>(null)
  const [reportStop, setReportStop] = useState<WorkOrderStopOut | null>(null)
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
        {isAdmin && <button style={S.btn} onClick={() => { setEditing(null); setShowModal(true) }}>
          + Nueva orden
        </button>}
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

      {isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[0,1,2,3].map(i => <SkeletonRow key={i} height={64} />)}
        </div>
      )}

      {!isLoading && orders.length === 0 && (
        <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
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
                  fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600,
                  color: PRIORITY_COLORS[o.priority],
                }}>
                  {PRIORITY_LABELS[o.priority]}
                </span>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 600, color: 'var(--fg-primary)' }}>
                  {o.title}
                </span>
                {o.status === 'done' && o.doc_number && (
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--info)',
                    background: 'rgba(56,189,248,0.1)', padding: '2px 6px', borderRadius: 4,
                  }}>
                    {o.doc_number}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {/* Botones de transición de estado */}
                {o.status === 'pending' && (
                  <button style={{ ...S.btnSm, color: 'var(--cmg-teal)', borderColor: 'var(--cmg-teal)' }}
                    onClick={() => changeStatus({ id: o.id, status: 'in_progress' })}>
                    Iniciar
                  </button>
                )}
                {o.status === 'in_progress' && (
                  <button style={{ ...S.btnSm, color: 'var(--ok)', borderColor: 'var(--ok)' }}
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
                    style={{ ...S.btnSm, color: 'var(--info)', borderColor: 'var(--info)' }}
                    onClick={() => setReportOrder(o)}
                  >
                    Informe
                  </button>
                )}
                {o.status === 'done' && (
                  <button
                    style={{ ...S.btnSm, color: 'var(--cmg-teal)', borderColor: 'var(--cmg-teal)' }}
                    onClick={() => downloadOrderPdf(o)}
                    title="Descargar parte de servicio en PDF"
                  >
                    ⤓ PDF
                  </button>
                )}
                <button
                  style={{ ...S.btnSm, borderColor: 'var(--cmg-teal)', color: 'var(--cmg-teal)' }}
                  onClick={() => setStopsOrder(o)}
                >
                  Ruta
                </button>
                {isAdmin && <button style={S.btnSm} onClick={() => { setEditing(o); setShowModal(true) }}>Editar</button>}
                {isAdmin && o.status !== 'in_progress' && (
                  <button style={{ ...S.btnSm, color: 'var(--danger)' }}
                    onClick={async () => { if (await confirmAsk({ title: 'Eliminar orden', message: '¿Eliminar esta orden? Esta acción no se puede deshacer.', confirmLabel: 'Eliminar', kind: 'danger' })) deleteOrder(o.id) }}>
                    Eliminar
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {o.vehicle_name && <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-muted)' }}>Vehículo: <b style={{ color: 'var(--fg-primary)' }}>{o.vehicle_name}</b></span>}
              {o.driver_name  && <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-muted)' }}>Conductor: <b style={{ color: 'var(--fg-primary)' }}>{o.driver_name}</b></span>}
              {o.scheduled_at && <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-muted)' }}>Programada: {new Date(o.scheduled_at).toLocaleString('es-ES')}</span>}
              {o.location_address && <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-muted)' }}>{o.location_address}</span>}
            </div>

            {o.description && (
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-muted)' }}>{o.description}</span>
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
          stop={reportStop}
          onClose={() => { setReportOrder(null); setReportStop(null) }}
        />
      )}
      </div>
    </Shell>

    {stopsOrder && (
      <StopsPanel
        order={stopsOrder}
        onClose={() => setStopsOrder(null)}
        onReportStop={(stop) => {
          setReportStop(stop)
          setReportOrder(stopsOrder)
        }}
      />
    )}
    </>
  )
}
