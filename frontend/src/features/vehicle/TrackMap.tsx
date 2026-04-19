import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { TrackPoint, VehicleStatus } from '../../lib/types'

interface TrackMapProps {
  track: TrackPoint[]
  status: VehicleStatus | undefined
}

export default function TrackMap({ track, status }: TrackMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapRef.current = L.map(containerRef.current, {
      center: [40.416775, -3.70379],
      zoom: 12,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(mapRef.current)
    return () => { mapRef.current?.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clear existing layers except tile layer
    map.eachLayer(layer => {
      if (!(layer instanceof L.TileLayer)) map.removeLayer(layer)
    })

    const validPoints = track.filter(p => p.lat != null && p.lon != null)

    if (validPoints.length > 0) {
      const latlngs = validPoints.map(p => [p.lat!, p.lon!] as [number, number])

      // Track polyline in orange
      L.polyline(latlngs, {
        color: '#F97316',
        weight: 3,
        opacity: 0.8,
      }).addTo(map)

      // Start marker (green)
      L.circleMarker(latlngs[0], {
        radius: 5, fillColor: '#22C55E', color: '#fff',
        weight: 2, fillOpacity: 1,
      }).bindTooltip('Inicio').addTo(map)
    }

    // Current position marker
    if (status?.lat != null && status?.lon != null) {
      L.circleMarker([status.lat, status.lon], {
        radius: 8,
        fillColor: status.online ? '#F97316' : '#78716C',
        color: '#fff',
        weight: 2,
        fillOpacity: 1,
      }).bindTooltip('Posición actual').addTo(map)
    }

    // Fit bounds
    const allPoints: [number, number][] = validPoints.map(p => [p.lat!, p.lon!])
    if (status?.lat != null && status?.lon != null) {
      allPoints.push([status.lat, status.lon])
    }
    if (allPoints.length > 0) {
      try {
        map.fitBounds(L.latLngBounds(allPoints).pad(0.2))
      } catch { /* ignore */ }
    }
  }, [track, status])

  if (track.length === 0 && (status?.lat == null)) {
    return (
      <div style={{
        height: 340,
        background: 'var(--bg-elevated)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: 13,
        borderRadius: 8,
      }}>
        Sin actividad registrada hoy
      </div>
    )
  }

  return <div ref={containerRef} style={{ width: '100%', height: 340, borderRadius: 8, overflow: 'hidden' }} />
}
