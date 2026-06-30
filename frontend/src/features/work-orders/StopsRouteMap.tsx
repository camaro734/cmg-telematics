import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { CARTO_TILES_URL, CARTO_ATTRIBUTION } from '../../lib/mapConfig'

export type RouteStop = {
  _id: string
  lat: number
  lon: number
  arrival_radius_m: number
  title: string
  cardIndex: number
}

function makeNumericIcon(num: number) {
  // Pin grande con número legible (círculo blanco amplio + texto con peso).
  return L.divIcon({
    html: `<div style="position:relative;width:38px;height:50px">
      <svg xmlns="http://www.w3.org/2000/svg" width="38" height="50" viewBox="0 0 36 47" style="display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))">
        <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 29 18 29s18-15.5 18-29C36 8.06 27.94 0 18 0z" fill="var(--energy-orange)" stroke="white" stroke-width="1.5"/>
        <circle cx="18" cy="18" r="12.5" fill="white"/>
        <text x="18" y="24" text-anchor="middle" font-size="18" font-weight="800" fill="var(--energy-orange)" font-family="var(--font-sans), sans-serif">${num}</text>
      </svg>
    </div>`,
    className: '',
    iconSize: [38, 50],
    iconAnchor: [19, 50],
    popupAnchor: [0, -52],
  })
}

const GEOCIRCLE: L.CircleOptions = {
  color: '#1D9E75', fillColor: '#1D9E75', fillOpacity: 0.12, weight: 2,
}

export function StopsRouteMap({ stops, routeGeometry }: {
  stops: RouteStop[]
  // Polyline de la ruta por carretera (lista de [lat, lon]); si se omite, no se dibuja.
  routeGeometry?: [number, number][]
}) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const mapRef        = useRef<L.Map | null>(null)
  const layerGroupRef = useRef<L.LayerGroup | null>(null)

  // Crear el mapa una sola vez
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { zoomControl: true })
    L.tileLayer(CARTO_TILES_URL, {
      subdomains: 'abcd', maxZoom: 19, attribution: CARTO_ATTRIBUTION,
    }).addTo(map)
    layerGroupRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      layerGroupRef.current = null
    }
  }, [])

  // Redibujar marcadores y círculos cuando cambian las paradas
  useEffect(() => {
    const map   = mapRef.current
    const group = layerGroupRef.current
    if (!map || !group) return

    group.clearLayers()
    if (stops.length === 0) return

    const coords: [number, number][] = []
    for (const stop of stops) {
      const latlng: [number, number] = [stop.lat, stop.lon]
      coords.push(latlng)
      L.marker(latlng, { icon: makeNumericIcon(stop.cardIndex) })
        .bindTooltip(stop.title, { permanent: false, direction: 'top' })
        .addTo(group)
      L.circle(latlng, { ...GEOCIRCLE, radius: stop.arrival_radius_m }).addTo(group)
    }

    // Polyline de la ruta por carretera. Resuelve --cmg-teal en runtime (white-label).
    if (routeGeometry && routeGeometry.length > 1) {
      const teal = getComputedStyle(document.documentElement).getPropertyValue('--cmg-teal').trim() || '#1D9E75'
      L.polyline(routeGeometry, { color: teal, weight: 4, opacity: 0.85 }).addTo(group)
    }

    // Encaja la vista a la ruta completa si existe (incluye base), si no a las paradas.
    const fitTo = routeGeometry && routeGeometry.length > 1 ? routeGeometry : coords
    if (fitTo.length === 1) {
      map.setView(fitTo[0], 14)
    } else {
      map.fitBounds(L.latLngBounds(fitTo), { padding: [30, 30], maxZoom: 16 })
    }
  }, [stops, routeGeometry])

  return (
    <div ref={containerRef} style={{
      width: '100%', height: 280, borderRadius: 8,
      overflow: 'hidden', border: '1px solid var(--border)', marginTop: 8,
    }} />
  )
}
