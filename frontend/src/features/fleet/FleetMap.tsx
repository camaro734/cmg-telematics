import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useNavigate } from 'react-router-dom'
import { useFleetStore } from './useFleetStore'
import type { VehicleOut, VehicleStatus } from '../../lib/types'

function makeVehicleIcon(status: VehicleStatus): L.DivIcon {
  const moving = (status.speed_kmh ?? 0) > 0

  if (moving) {
    // En movimiento: triángulo azul apuntando en dirección de marcha
    return L.divIcon({
      html: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
        <polygon points="12,2 22,22 12,16 2,22" fill="#38BDF8" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>`,
      className: '',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -12],
    })
  }

  // Parado: círculo verde (ignición ON) o rojo (ignición OFF)
  const color = status.ignition ? '#22C55E' : '#EF4444'
  return L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
      <circle cx="9" cy="9" r="7" fill="${color}" stroke="white" stroke-width="2"/>
    </svg>`,
    className: '',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -9],
  })
}

interface FleetMapProps {
  vehicles: VehicleOut[]
  statuses: Map<string, VehicleStatus>
}

export default function FleetMap({ vehicles, statuses }: FleetMapProps) {
  const navigate = useNavigate()
  const { selectedId } = useFleetStore()
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  const containerRef = useRef<HTMLDivElement>(null)
  const initialFitDoneRef = useRef(false)

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
      const icon = makeVehicleIcon(status)

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

    // Fit bounds solo la primera vez que llegan posiciones válidas
    if (!initialFitDoneRef.current && markersRef.current.size > 0) {
      const group = L.featureGroup(Array.from(markersRef.current.values()))
      try {
        map.fitBounds(group.getBounds().pad(0.2))
        initialFitDoneRef.current = true
      } catch { /* ignore */ }
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
