import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

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
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente', in_progress: 'En curso', done: 'Completada', cancelled: 'Cancelada',
}
const STATUS_COLOR: Record<string, string> = {
  pending: '#38BDF8', in_progress: '#F97316', done: '#22C55E', cancelled: '#78716C',
}

// ── Map component ─────────────────────────────────────────────────────────────

function PortalMap({ vehicles }: { vehicles: PortalVehicle[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<Record<string, L.CircleMarker>>({})

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapRef.current = L.map(containerRef.current, {
      center: [40.4, -3.7],
      zoom: 6,
      zoomControl: true,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(mapRef.current)
    return () => { mapRef.current?.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    if (!mapRef.current) return
    const map = mapRef.current

    // Remove stale markers
    Object.keys(markersRef.current).forEach(id => {
      if (!vehicles.find(v => v.id === id)) {
        markersRef.current[id].remove()
        delete markersRef.current[id]
      }
    })

    const positioned = vehicles.filter(v => v.lat != null && v.lon != null)
    positioned.forEach(v => {
      const color = v.online ? '#22C55E' : '#78716C'
      const popup = `<b>${v.name}</b><br/>${v.online ? `${v.speed_kmh ?? 0} km/h` : 'Offline'}`
      if (markersRef.current[v.id]) {
        markersRef.current[v.id]
          .setLatLng([v.lat!, v.lon!])
          .setStyle({ color, fillColor: color })
          .bindPopup(popup)
      } else {
        markersRef.current[v.id] = L.circleMarker([v.lat!, v.lon!], {
          radius: 8, color, fillColor: color, fillOpacity: 0.85, weight: 2,
        }).bindPopup(popup).addTo(map)
      }
    })

    if (positioned.length > 0) {
      map.fitBounds(positioned.map(v => [v.lat!, v.lon!] as [number, number]), { padding: [40, 40], maxZoom: 14 })
    }
  }, [vehicles])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }}/>
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ClientPortalPage() {
  const { token } = useParams<{ token: string }>()

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

  // Apply brand tokens
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

  if (loadingTenant) {
    return (
      <div style={{ minHeight: '100vh', background: '#1C1917', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#78716C', fontFamily: 'Inter, sans-serif' }}>
        Cargando…
      </div>
    )
  }

  if (isError || !tenant) {
    return (
      <div style={{ minHeight: '100vh', background: '#1C1917', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, fontFamily: 'Inter, sans-serif' }}>
        <div style={{ fontSize: 48 }}>🔒</div>
        <div style={{ color: '#E7E5E4', fontSize: 18, fontWeight: 600 }}>Portal no disponible</div>
        <div style={{ color: '#78716C', fontSize: 14 }}>El enlace es incorrecto o ha expirado.</div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base, #1C1917)', fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{
        background: 'var(--bg-surface, #292524)',
        borderBottom: '1px solid var(--bg-border, #57534E)',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexShrink: 0,
      }}>
        {tenant.logo_url && (
          <img src={tenant.logo_url} alt="logo" style={{ height: 36, objectFit: 'contain' }}/>
        )}
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary, #E7E5E4)' }}>
            {tenant.brand_name ?? tenant.name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted, #78716C)' }}>
            Portal de seguimiento
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 20 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#22C55E' }}>{online}</div>
            <div style={{ fontSize: 10, color: '#78716C', textTransform: 'uppercase', letterSpacing: '0.05em' }}>En ruta</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary, #E7E5E4)' }}>{vehicles.length}</div>
            <div style={{ fontSize: 10, color: '#78716C', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vehículos</div>
          </div>
        </div>
      </header>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Map */}
        <div style={{ flex: 1, position: 'relative' }}>
          <PortalMap vehicles={vehicles}/>
          {/* Vehicle legend */}
          <div style={{
            position: 'absolute', bottom: 16, left: 16, zIndex: 1000,
            background: 'rgba(28,25,23,0.85)', backdropFilter: 'blur(6px)',
            border: '1px solid #57534E', borderRadius: 8, padding: '8px 14px',
            display: 'flex', gap: 16,
          }}>
            <span style={{ fontSize: 11, color: '#22C55E', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E', display: 'inline-block' }}/>
              Online
            </span>
            <span style={{ fontSize: 11, color: '#78716C', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#78716C', display: 'inline-block' }}/>
              Offline
            </span>
          </div>
        </div>

        {/* Sidebar */}
        <div style={{
          width: 340,
          background: 'var(--bg-surface, #292524)',
          borderLeft: '1px solid var(--bg-border, #57534E)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Vehicles list */}
          <div style={{ borderBottom: '1px solid #57534E', padding: '12px 16px', flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#78716C', marginBottom: 10 }}>
              Vehículos
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
              {vehicles.map(v => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', background: '#1C1917', borderRadius: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: v.online ? '#22C55E' : '#78716C', flexShrink: 0 }}/>
                  <span style={{ flex: 1, fontSize: 13, color: '#E7E5E4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
                  {v.online && v.speed_kmh != null && (
                    <span style={{ fontSize: 11, color: '#F97316', fontWeight: 600, flexShrink: 0 }}>{Math.round(v.speed_kmh)} km/h</span>
                  )}
                </div>
              ))}
              {vehicles.length === 0 && (
                <div style={{ fontSize: 13, color: '#78716C', padding: '8px 0' }}>Sin vehículos asignados</div>
              )}
            </div>
          </div>

          {/* Orders list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#78716C', marginBottom: 10 }}>
              Órdenes recientes
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {orders.map(o => (
                <div key={o.id} style={{ background: '#1C1917', borderRadius: 8, padding: '10px 12px', border: '1px solid #3C3330' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
                      background: `color-mix(in srgb, ${STATUS_COLOR[o.status]} 20%, transparent)`,
                      color: STATUS_COLOR[o.status],
                    }}>
                      {STATUS_LABEL[o.status] ?? o.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#E7E5E4', marginBottom: 4 }}>{o.title}</div>
                  {o.vehicle_name && (
                    <div style={{ fontSize: 11, color: '#78716C' }}>Vehículo: {o.vehicle_name}</div>
                  )}
                  {o.location_address && (
                    <div style={{ fontSize: 11, color: '#78716C' }}>{o.location_address}</div>
                  )}
                  {o.completed_at && (
                    <div style={{ fontSize: 11, color: '#78716C' }}>
                      Completada: {new Date(o.completed_at).toLocaleString('es-ES')}
                    </div>
                  )}
                </div>
              ))}
              {orders.length === 0 && (
                <div style={{ fontSize: 13, color: '#78716C' }}>Sin órdenes recientes</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
