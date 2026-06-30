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
  return L.divIcon({
    html: `<div style="position:relative;width:28px;height:36px">
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36" style="display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.45))">
        <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.268 21.732 0 14 0z" fill="var(--energy-orange)"/>
        <circle cx="14" cy="14" r="6" fill="white"/>
        <text x="14" y="18" text-anchor="middle" font-size="8" font-weight="700" fill="var(--energy-orange)" font-family="monospace">${num}</text>
      </svg>
    </div>`,
    className: '',
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -38],
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
