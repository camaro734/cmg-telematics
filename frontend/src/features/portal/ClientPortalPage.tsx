import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { PortalSignModal } from './PortalSignModal'

// ── API (sin auth) ────────────────────────────────────────────────────────────

async function portalFetch<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

interface PortalTenant {
  tenant_id: string
  name: string
  brand_name: string | null
  logo_url: string | null
  brand_tokens: Record<string, string> | null
}

interface PortalVehicle {
  id: string
  name: string
  online: boolean
  lat: number | null
  lon: number | null
  speed_kmh: number | null
  ignition: boolean | null
  last_seen: string | null
}

interface PortalOrder {
  id: string
  title: string
  status: string
  priority: string
  vehicle_name: string | null
  driver_name: string | null
  scheduled_at: string | null
  completed_at: string | null
  location_address: string | null
  report_number: string | null
}

interface PortalStop {
  id: string
  order_index: number
  title: string
  address: string | null
  status: string
  completed_at: string | null
  pto_minutes: number | null
  pump_minutes: number | null
  fuel_l: number | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente', in_progress: 'En curso', done: 'Completada', cancelled: 'Cancelada',
}
const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--info)', in_progress: 'var(--energy-orange)', done: 'var(--ok)', cancelled: 'var(--offline)',
}
const STOP_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente', arrived: 'Llegado', in_progress: 'En curso',
  done: 'Completada', skipped: 'Saltada',
}
const STOP_STATUS_COLOR: Record<string, string> = {
  pending: 'var(--fg-muted)', arrived: 'var(--accent-info)',
  in_progress: 'var(--energy-orange)', done: 'var(--ok)', skipped: 'var(--offline)',
}

// ── Map component ─────────────────────────────────────────────────────────────

function PortalMap({ vehicles }: { vehicles: PortalVehicle[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<Record<string, L.CircleMarker>>({})

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapRef.current = L.map(containerRef.current, { center: [40.4, -3.7], zoom: 6, zoomControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapRef.current)
    return () => { mapRef.current?.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    if (!mapRef.current) return
    const map = mapRef.current
    Object.keys(markersRef.current).forEach(id => {
      if (!vehicles.find(v => v.id === id)) { markersRef.current[id].remove(); delete markersRef.current[id] }
    })
    const positioned = vehicles.filter(v => v.lat != null && v.lon != null)
    positioned.forEach(v => {
      const color = v.online ? '#22C55E' : '#64748B' /* Leaflet no acepta var(), hex coherente con --offline */
      const popup = `<b>${v.name}</b><br/>${v.online ? `${v.speed_kmh ?? 0} km/h` : 'Offline'}`
      if (markersRef.current[v.id]) {
        markersRef.current[v.id].setLatLng([v.lat!, v.lon!]).setStyle({ color, fillColor: color }).bindPopup(popup)
      } else {
        markersRef.current[v.id] = L.circleMarker([v.lat!, v.lon!], { radius: 8, color, fillColor: color, fillOpacity: 0.85, weight: 2 }).bindPopup(popup).addTo(map)
      }
    })
    if (positioned.length > 0) {
      map.fitBounds(positioned.map(v => [v.lat!, v.lon!] as [number, number]), { padding: [40, 40], maxZoom: 14 })
    }
  }, [vehicles])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }}/>
}

// ── Stop list row ─────────────────────────────────────────────────────────────

function StopRow({ stop }: { stop: PortalStop }) {
  const color = STOP_STATUS_COLOR[stop.status] ?? 'var(--fg-muted)'
  return (
    <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', fontSize: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }}/>
        <span style={{ fontWeight: 600, color: 'var(--fg-primary)', flex: 1 }}>{stop.title}</span>
        <span style={{ color }}>{STOP_STATUS_LABEL[stop.status] ?? stop.status}</span>
      </div>
      {stop.address && <div style={{ color: 'var(--fg-muted)', paddingLeft: 12 }}>{stop.address}</div>}
      {stop.status === 'done' && (
        <div style={{ paddingLeft: 12, color: 'var(--fg-muted)', display: 'flex', gap: 10, marginTop: 2 }}>
          {stop.pto_minutes != null && <span>PTO {stop.pto_minutes.toFixed(0)} min</span>}
          {stop.pump_minutes != null && <span>Bomba {stop.pump_minutes.toFixed(0)} min</span>}
          {stop.fuel_l != null && <span>Comb. {stop.fuel_l.toFixed(1)} L</span>}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ClientPortalPage() {
  const { token } = useParams<{ token: string }>()
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)
  const [signingOrderId, setSigningOrderId] = useState<string | null>(null)
  // Guarda report_numbers conseguidos localmente para no esperar al refetch
  const [localReports, setLocalReports] = useState<Record<string, string>>({})

  const { data: tenant, isLoading: loadingTenant, isError } = useQuery({
    queryKey: ['portal', token, 'info'],
    queryFn: () => portalFetch<PortalTenant>(`/api/v1/portal/${token}`),
    retry: false,
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: ['portal', token, 'vehicles'],
    queryFn: () => portalFetch<PortalVehicle[]>(`/api/v1/portal/${token}/vehicles`),
    enabled: !!tenant,
    refetchInterval: 30_000,
  })

  const { data: orders = [] } = useQuery({
    queryKey: ['portal', token, 'orders'],
    queryFn: () => portalFetch<PortalOrder[]>(`/api/v1/portal/${token}/orders`),
    enabled: !!tenant,
    refetchInterval: 60_000,
  })

  const { data: expandedStops = [] } = useQuery({
    queryKey: ['portal', token, 'stops', expandedOrderId],
    queryFn: () => portalFetch<PortalStop[]>(`/api/v1/portal/${token}/orders/${expandedOrderId}/stops`),
    enabled: !!expandedOrderId,
  })

  useEffect(() => {
    if (!tenant?.brand_tokens) return
    const root = document.documentElement
    Object.entries(tenant.brand_tokens).forEach(([k, v]) => root.style.setProperty(k, v))
    return () => {
      if (!tenant.brand_tokens) return
      Object.keys(tenant.brand_tokens).forEach(k => root.style.removeProperty(k))
    }
  }, [tenant])

  useEffect(() => {
    document.title = tenant ? `${tenant.brand_name ?? tenant.name} — Portal` : 'Portal'
  }, [tenant])

  const online = vehicles.filter(v => v.online).length
  const signingOrder = signingOrderId ? orders.find(o => o.id === signingOrderId) : null

  if (loadingTenant) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--offline)', fontFamily: 'Inter, sans-serif' }}>
        Cargando…
      </div>
    )
  }

  if (isError || !tenant) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, fontFamily: 'Inter, sans-serif' }}>
        <div style={{ fontSize: 48 }}>🔒</div>
        <div style={{ color: 'var(--fg-primary)', fontSize: 18, fontWeight: 600 }}>Portal no disponible</div>
        <div style={{ color: 'var(--offline)', fontSize: 14 }}>El enlace es incorrecto o ha expirado.</div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        {tenant.logo_url && <img src={tenant.logo_url} alt="logo" style={{ height: 36, objectFit: 'contain' }}/>}
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-primary)' }}>{tenant.brand_name ?? tenant.name}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Portal de seguimiento</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 20 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ok)' }}>{online}</div>
            <div style={{ fontSize: 10, color: 'var(--offline)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>En ruta</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-primary)' }}>{vehicles.length}</div>
            <div style={{ fontSize: 10, color: 'var(--offline)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vehículos</div>
          </div>
        </div>
      </header>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Map */}
        <div style={{ flex: 1, position: 'relative' }}>
          <PortalMap vehicles={vehicles}/>
          <div style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 1000, background: 'rgba(28,25,23,0.85)', backdropFilter: 'blur(6px)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', display: 'flex', gap: 16 }}>
            <span style={{ fontSize: 11, color: 'var(--ok)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)', display: 'inline-block' }}/>Online
            </span>
            <span style={{ fontSize: 11, color: 'var(--offline)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--offline)', display: 'inline-block' }}/>Offline
            </span>
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ width: 340, background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Vehicles */}
          <div style={{ borderBottom: '1px solid var(--border)', padding: '12px 16px', flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--offline)', marginBottom: 10 }}>Vehículos</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
              {vehicles.map(v => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', background: 'var(--bg-base)', borderRadius: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: v.online ? 'var(--ok)' : 'var(--offline)', flexShrink: 0 }}/>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--fg-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
                  {v.online && v.speed_kmh != null && (
                    <span style={{ fontSize: 11, color: 'var(--cmg-teal)', fontWeight: 600, flexShrink: 0 }}>{Math.round(v.speed_kmh)} km/h</span>
                  )}
                </div>
              ))}
              {vehicles.length === 0 && <div style={{ fontSize: 13, color: 'var(--offline)', padding: '8px 0' }}>Sin vehículos asignados</div>}
            </div>
          </div>

          {/* Orders */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--offline)', marginBottom: 10 }}>Órdenes recientes</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {orders.map(o => {
                const isExpanded = expandedOrderId === o.id
                const effectiveReportNumber = localReports[o.id] ?? o.report_number
                const canSign = o.status === 'done' && !effectiveReportNumber
                return (
                  <div key={o.id} style={{ background: 'var(--bg-base)', borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
                    {/* Order header row */}
                    <div
                      style={{ padding: '10px 12px', cursor: 'pointer' }}
                      onClick={() => setExpandedOrderId(isExpanded ? null : o.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
                          background: `color-mix(in srgb, ${STATUS_COLOR[o.status]} 20%, transparent)`,
                          color: STATUS_COLOR[o.status],
                        }}>
                          {STATUS_LABEL[o.status] ?? o.status}
                        </span>
                        {effectiveReportNumber && (
                          <span style={{ fontSize: 10, color: 'var(--ok)', fontWeight: 600 }}>✓ {effectiveReportNumber}</span>
                        )}
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-muted)' }}>{isExpanded ? '▲' : '▼'}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)', marginBottom: 2 }}>{o.title}</div>
                      {o.vehicle_name && <div style={{ fontSize: 11, color: 'var(--offline)' }}>Vehículo: {o.vehicle_name}</div>}
                      {o.location_address && <div style={{ fontSize: 11, color: 'var(--offline)' }}>{o.location_address}</div>}
                      {o.completed_at && <div style={{ fontSize: 11, color: 'var(--offline)' }}>Completada: {new Date(o.completed_at).toLocaleString('es-ES')}</div>}
                    </div>

                    {/* Expanded: stops */}
                    {isExpanded && (
                      <div style={{ borderTop: '1px solid var(--border)' }}>
                        {expandedStops.length === 0
                          ? <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--fg-muted)' }}>Sin paradas</div>
                          : expandedStops.map(s => <StopRow key={s.id} stop={s}/>)
                        }
                        {canSign && (
                          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
                            <button
                              onClick={() => setSigningOrderId(o.id)}
                              style={{
                                width: '100%', padding: '8px 0', borderRadius: 6, border: 'none',
                                background: 'var(--cmg-teal)', color: '#fff',
                                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                              }}
                            >
                              Firmar parte de servicio
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {orders.length === 0 && <div style={{ fontSize: 13, color: 'var(--offline)' }}>Sin órdenes recientes</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Sign modal */}
      {signingOrderId && signingOrder && (
        <PortalSignModal
          orderTitle={signingOrder.title}
          token={token!}
          orderId={signingOrderId}
          onClose={() => setSigningOrderId(null)}
          onSigned={(reportNumber) => {
            setLocalReports(prev => ({ ...prev, [signingOrderId]: reportNumber }))
            setSigningOrderId(null)
          }}
        />
      )}
    </div>
  )
}
