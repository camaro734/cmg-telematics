import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useNavigate } from 'react-router-dom'
import { useFleetStore } from './useFleetStore'
import type { VehicleOut, VehicleStatus, VehicleTypeOut } from '../../lib/types'

// Fix Leaflet default marker icons with Vite
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)['_getIconUrl']
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })

// Returns the truck SVG paths string based on vehicle type slug
function truckPaths(slug: string): string {
  const s = slug.toLowerCase()
  // Shared: cab + chassis
  const cab = `
    <path d="M1,26 L1,15 L10,8 L20,8 L20,26 Z"/>
    <rect x="2" y="11" width="9" height="7" rx="1"/>
    <line x1="1" y1="26" x2="62" y2="26"/>
    <circle cx="11" cy="29" r="3"/>
  `
  if (s.includes('cistern') || s.includes('tanque') || s.includes('tank')) {
    return cab + `
      <rect x="20" y="10" width="41" height="14" rx="7"/>
      <line x1="31" y1="10" x2="31" y2="24"/>
      <line x1="41" y1="10" x2="41" y2="24"/>
      <line x1="51" y1="10" x2="51" y2="24"/>
      <path d="M38,10 L38,7 L44,7 L44,10"/>
      <circle cx="49" cy="29" r="3"/>
      <circle cx="57" cy="29" r="3"/>
    `
  }
  if (s.includes('vacuum') || s.includes('vac') || s.includes('aspirad') || s.includes('barred') || s.includes('vaciado')) {
    return cab + `
      <rect x="20" y="10" width="33" height="14" rx="7"/>
      <rect x="53" y="12" width="9" height="11" rx="1.5"/>
      <path d="M53,22 Q50,26 47,26"/>
      <line x1="62" y1="18" x2="62" y2="26"/>
      <circle cx="44" cy="29" r="3"/>
      <circle cx="52" cy="29" r="3"/>
    `
  }
  if (s.includes('crane') || s.includes('grua') || s.includes('elevad') || s.includes('brazo')) {
    return cab + `
      <rect x="20" y="19" width="42" height="7" rx="1"/>
      <rect x="36" y="12" width="8" height="7" rx="1"/>
      <line x1="40" y1="12" x2="59" y2="2"/>
      <line x1="59" y1="2" x2="62" y2="9"/>
      <path d="M62,9 Q63,12 61,12"/>
      <circle cx="49" cy="29" r="3"/>
      <circle cx="57" cy="29" r="3"/>
    `
  }
  // Generic box truck
  return cab + `
    <rect x="20" y="8" width="42" height="18" rx="1.5"/>
    <circle cx="49" cy="29" r="3"/>
    <circle cx="57" cy="29" r="3"/>
  `
}

function makeTruckIcon(pinColor: string, slug: string) {
  const paths = truckPaths(slug)
  // Pin with embedded truck silhouette (40×54 canvas, truck scaled in upper circle)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="54" viewBox="0 0 40 54">
    <path d="M20 0C9 0 0 9 0 20c0 14 20 34 20 34s20-20 20-34C40 9 31 0 20 0z" fill="${pinColor}"/>
    <circle cx="20" cy="18" r="16" fill="rgba(0,0,0,0.25)"/>
    <g transform="translate(4,9) scale(0.50)" stroke="white" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      ${paths}
    </g>
  </svg>`
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [40, 54],
    iconAnchor: [20, 54],
    popupAnchor: [0, -54],
  })
}

interface FleetMapProps {
  vehicles: VehicleOut[]
  statuses: Map<string, VehicleStatus>
  vehicleTypes?: VehicleTypeOut[]
}

export default function FleetMap({ vehicles, statuses, vehicleTypes = [] }: FleetMapProps) {
  const navigate = useNavigate()
  const { selectedId } = useFleetStore()
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  const containerRef = useRef<HTMLDivElement>(null)
  const typeById = new Map(vehicleTypes.map(t => [t.id, t]))

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapRef.current = L.map(containerRef.current, {
      center: [40.416775, -3.70379], // Madrid default
      zoom: 6,
      zoomControl: false,
    })
    L.control.zoom({ position: 'topright' }).addTo(mapRef.current)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(mapRef.current)

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // Update markers when statuses change
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const validVehicles = vehicles.filter(v => {
      const s = statuses.get(v.id)
      return s?.lat != null && s?.lon != null
    })

    // Remove old markers not in current list
    for (const [id, marker] of markersRef.current) {
      if (!validVehicles.find(v => v.id === id)) {
        marker.remove()
        markersRef.current.delete(id)
      }
    }

    // Add/update markers
    for (const vehicle of validVehicles) {
      const status = statuses.get(vehicle.id)!
      const lat = status.lat!
      const lon = status.lon!
      const pinColor = status.pto_active ? '#F97316' : status.online ? '#22C55E' : '#78716C'
      const slug = typeById.get(vehicle.vehicle_type_id)?.slug ?? ''
      const icon = makeTruckIcon(pinColor, slug)

      if (markersRef.current.has(vehicle.id)) {
        const marker = markersRef.current.get(vehicle.id)!
        marker.setLatLng([lat, lon])
        marker.setIcon(icon)
      } else {
        const marker = L.marker([lat, lon], { icon })
          .addTo(map)
          .bindPopup(`
            <div style="font-family:sans-serif;min-width:140px">
              <strong>${vehicle.name}</strong><br/>
              ${vehicle.license_plate ?? ''}<br/>
              ${status.speed_kmh != null ? `${Math.round(status.speed_kmh)} km/h<br/>` : ''}
              <a href="/vehicles/${vehicle.id}" style="color:#F97316;font-size:12px">Ver detalle →</a>
            </div>
          `)
        markersRef.current.set(vehicle.id, marker)
      }
    }

    // Fit bounds on first load (only when we have markers and map hasn't been moved)
    if (validVehicles.length > 0 && markersRef.current.size > 0) {
      const group = L.featureGroup(Array.from(markersRef.current.values()))
      try { map.fitBounds(group.getBounds().pad(0.2)) } catch { /* ignore */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses, vehicles])

  // Fly to selected vehicle
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedId) return
    const status = statuses.get(selectedId)
    if (status?.lat != null && status?.lon != null) {
      map.flyTo([status.lat, status.lon], 14, { duration: 0.8 })
    }
  }, [selectedId, statuses])

  // Handle popup link clicks (SPA navigation)
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'A' && target.getAttribute('href')?.startsWith('/vehicles/')) {
        e.preventDefault()
        navigate(target.getAttribute('href')!)
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [navigate])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', background: 'var(--bg-base)' }}
    />
  )
}
