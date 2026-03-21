'use client'
import { useEffect, useRef } from 'react'

interface TripMapProps {
  points: { lat: number; lng: number; speed: number }[]
  height?: string
}

const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

/** speed → color: green (0) → yellow (60) → red (120+) */
function speedColor(speed: number): string {
  const capped = Math.min(speed, 120)
  if (capped <= 60) {
    const t = capped / 60
    const r = Math.round(34 + t * (250 - 34))
    const g = Math.round(197 + t * (204 - 197))
    const b = Math.round(94 + t * (11 - 94))
    return `rgb(${r},${g},${b})`
  } else {
    const t = (capped - 60) / 60
    const r = Math.round(250 + t * (239 - 250))
    const g = Math.round(204 + t * (68 - 204))
    const b = Math.round(11 + t * (68 - 11))
    return `rgb(${r},${g},${b})`
  }
}

export default function TripMap({ points, height = '300px' }: TripMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !mapRef.current || points.length === 0) return

    import('leaflet').then((L) => {
      if (!mapInstanceRef.current) {
        mapInstanceRef.current = L.map(mapRef.current!, { zoomControl: true })
        mapInstanceRef.current.zoomControl.setPosition('bottomright')
        L.tileLayer(TILE_URL, {
          attribution: TILE_ATTR,
          maxZoom: 20,
          subdomains: 'abcd',
        }).addTo(mapInstanceRef.current)
      }

      const map = mapInstanceRef.current
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.eachLayer((layer: any) => {
        if (layer._url === undefined) map.removeLayer(layer)
      })

      const latlngs = points.map((p) => [p.lat, p.lng] as [number, number])

      // Speed-colored segments
      for (let i = 0; i < points.length - 1; i++) {
        L.polyline([latlngs[i], latlngs[i + 1]], {
          color: speedColor(points[i].speed),
          weight: 5,
          opacity: 0.9,
          lineCap: 'round',
        }).addTo(map)
      }

      if (points.length === 1) {
        L.polyline(latlngs, { color: '#3b82f6', weight: 5 }).addTo(map)
      }

      // Start marker
      const startIcon = L.divIcon({
        className: '',
        html: `<div style="
          width:28px;height:28px;border-radius:50%;
          background:#1D9E75;border:3px solid white;
          display:flex;align-items:center;justify-content:center;
          box-shadow:0 3px 10px rgba(29,158,117,0.6);
          font-size:13px;
        ">▶</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      })

      // End marker
      const endIcon = L.divIcon({
        className: '',
        html: `<div style="
          width:28px;height:28px;border-radius:50%;
          background:#ef4444;border:3px solid white;
          display:flex;align-items:center;justify-content:center;
          box-shadow:0 3px 10px rgba(239,68,68,0.6);
          font-size:13px;
        ">■</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      })

      L.marker(latlngs[0], { icon: startIcon })
        .bindPopup(`<div style="font-family:system-ui;font-size:12px"><b style="color:#1D9E75">Inicio</b><br/>${points[0].speed} km/h</div>`)
        .addTo(map)

      L.marker(latlngs[latlngs.length - 1], { icon: endIcon })
        .bindPopup(`<div style="font-family:system-ui;font-size:12px"><b style="color:#ef4444">Fin</b><br/>${points[points.length - 1].speed} km/h</div>`)
        .addTo(map)

      map.fitBounds(latlngs, { padding: [24, 24] })
    })

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points])

  return <div ref={mapRef} style={{ height, width: '100%', borderRadius: 'inherit' }} />
}
