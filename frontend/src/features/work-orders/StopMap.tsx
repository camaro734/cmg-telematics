import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { CARTO_TILES_URL, CARTO_ATTRIBUTION } from '../../lib/mapConfig'

// Una parada con coordenadas para pintar en el mapa.
export type MapStop = {
  id: string      // 'primary' o el _id de la parada
  lat: number
  lon: number
  n: number       // número visible (1, 2, 3…) según su orden
}

// Pin numerado: naranja y más grande para la parada activa, teal para el resto.
// El número se coloca sobre el círculo blanco del pin, con el color del pin.
function makeNumIcon(n: number, active: boolean): L.DivIcon {
  const fill = active ? 'var(--energy-orange)' : '#1D9E75'
  const w = active ? 34 : 28
  const h = active ? 44 : 38
  return L.divIcon({
    html: `<div style="position:relative;width:${w}px;height:${h}px">
      <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 28 36" style="display:block;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.5))">
        <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.268 21.732 0 14 0z" fill="${fill}"/>
        <circle cx="14" cy="14" r="7" fill="white"/>
      </svg>
      <span style="position:absolute;top:${active ? 6 : 5}px;left:0;width:${w}px;text-align:center;font-family:var(--font-sans);font-weight:700;font-size:${active ? 14 : 12}px;color:${fill};line-height:1">${n}</span>
    </div>`,
    className: '',
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
  })
}

const GEOCIRCLE: L.CircleOptions = {
  color: '#1D9E75', fillColor: '#1D9E75', fillOpacity: 0.12, weight: 2,
}

export function StopMap({
  stops, activeId, activeRadiusM, onPick, onAddressChange, onSelectStop, routeGeometry,
}: {
  stops: MapStop[]
  activeId: string
  activeRadiusM: number
  // El click en el mapa vacío y el arrastre del pin activo aplican a la parada ACTIVA.
  onPick: (lat: number, lon: number) => void
  onAddressChange?: (address: string) => void
  // Click en un pin no-activo → seleccionar esa parada como activa.
  onSelectStop?: (id: string) => void
  // Polyline de la ruta optimizada (lista de [lat, lon]); si se omite, no se dibuja.
  routeGeometry?: [number, number][]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<L.Map | null>(null)
  const markersRef   = useRef<Map<string, L.Marker>>(new Map())
  const circleRef    = useRef<L.Circle | null>(null)
  const routeLineRef = useRef<L.Polyline | null>(null)
  const routeRef     = useRef(routeGeometry)
  routeRef.current = routeGeometry

  const onPickRef    = useRef(onPick)
  const onAddrRef    = useRef(onAddressChange)
  const onSelectRef  = useRef(onSelectStop)
  const radiusRef    = useRef(activeRadiusM)
  const stopsRef     = useRef(stops)
  const activeRef    = useRef(activeId)
  // Marca cambios originados DENTRO del mapa (click/drag) para no re-encajar la
  // vista en ese caso (sería un salto molesto tras arrastrar).
  const internalRef  = useRef(false)

  useEffect(() => { onPickRef.current = onPick }, [onPick])
  useEffect(() => { onAddrRef.current = onAddressChange }, [onAddressChange])
  useEffect(() => { onSelectRef.current = onSelectStop }, [onSelectStop])
  stopsRef.current = stops
  activeRef.current = activeId

  // El radio solo cambia el círculo de la parada activa; no debe re-encajar la vista.
  useEffect(() => { radiusRef.current = activeRadiusM; circleRef.current?.setRadius(activeRadiusM) }, [activeRadiusM])

  // Inicializar el mapa una sola vez.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const first = stopsRef.current[0]
    const center: [number, number] = first ? [first.lat, first.lon] : [39.47, -0.376]
    const map = L.map(containerRef.current, { center, zoom: first ? 15 : 6, zoomControl: true })
    L.tileLayer(CARTO_TILES_URL, { subdomains: 'abcd', maxZoom: 19, attribution: CARTO_ATTRIBUTION }).addTo(map)
    mapRef.current = map

    // Click en el mapa vacío → fija la ubicación de la parada activa.
    map.on('click', (e: L.LeafletMouseEvent) => {
      internalRef.current = true
      onPickRef.current(e.latlng.lat, e.latlng.lng)
    })

    setTimeout(() => map.invalidateSize(), 0)
    reconcile()

    return () => {
      map.remove()
      mapRef.current = null
      markersRef.current.clear()
      circleRef.current = null
      routeLineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reconcilia marcadores/círculo y encaja la vista. Lee el estado vía refs para
  // no recrear handlers; se dispara por la "firma" de las paradas y la activa.
  function reconcile() {
    const map = mapRef.current
    if (!map) return
    const list = stopsRef.current
    const active = activeRef.current
    const seen = new Set<string>()

    for (const s of list) {
      seen.add(s.id)
      const isActive = s.id === active
      let m = markersRef.current.get(s.id)
      if (!m) {
        m = L.marker([s.lat, s.lon], { icon: makeNumIcon(s.n, isActive), draggable: isActive })
        m.addTo(map)
        m.on('click', () => { if (s.id !== activeRef.current) onSelectRef.current?.(s.id) })
        m.on('dragend', async () => {
          // Solo el pin activo es arrastrable → este drag aplica a la parada activa.
          const pos = m!.getLatLng()
          internalRef.current = true
          onPickRef.current(pos.lat, pos.lng)
          circleRef.current?.setLatLng(pos)
          try {
            const res = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${pos.lat}&lon=${pos.lng}&format=json&accept-language=es`,
              { headers: { Accept: 'application/json' } },
            )
            const data: { display_name?: string } = await res.json()
            if (data.display_name) onAddrRef.current?.(data.display_name)
          } catch { /* silencioso */ }
        })
        markersRef.current.set(s.id, m)
      } else {
        m.setLatLng([s.lat, s.lon])
        m.setIcon(makeNumIcon(s.n, isActive))
      }
      // Solo la parada activa es arrastrable.
      if (isActive) m.dragging?.enable()
      else m.dragging?.disable()
    }

    // Retirar marcadores de paradas que ya no tienen coordenadas / fueron borradas.
    for (const [id, m] of markersRef.current) {
      if (!seen.has(id)) { m.remove(); markersRef.current.delete(id) }
    }

    // Círculo de radio sobre la parada activa (si tiene coordenadas).
    const act = list.find(s => s.id === active)
    if (act) {
      const ll: [number, number] = [act.lat, act.lon]
      if (circleRef.current) circleRef.current.setLatLng(ll).setRadius(radiusRef.current)
      else circleRef.current = L.circle(ll, { ...GEOCIRCLE, radius: radiusRef.current }).addTo(map)
    } else if (circleRef.current) {
      circleRef.current.remove()
      circleRef.current = null
    }

    // Polyline de la ruta optimizada. Resuelve --cmg-teal en runtime (white-label).
    const route = routeRef.current
    if (route && route.length > 1) {
      const teal = getComputedStyle(document.documentElement).getPropertyValue('--cmg-teal').trim() || '#1D9E75'
      if (routeLineRef.current) routeLineRef.current.setLatLngs(route)
      else routeLineRef.current = L.polyline(route, { color: teal, weight: 4, opacity: 0.85 }).addTo(map)
    } else if (routeLineRef.current) {
      routeLineRef.current.remove()
      routeLineRef.current = null
    }

    // Encaje de la vista: salta si el cambio fue interno (click/drag del propio mapa).
    if (internalRef.current) { internalRef.current = false; return }
    // Con ruta dibujada, encaja a la ruta completa (incluye origen/destino base).
    if (routeLineRef.current) {
      map.fitBounds(routeLineRef.current.getBounds(), { padding: [48, 48], maxZoom: 16 })
    } else if (list.length >= 2) {
      map.fitBounds(L.latLngBounds(list.map(s => [s.lat, s.lon] as [number, number])), { padding: [48, 48], maxZoom: 16 })
    } else if (list.length === 1) {
      map.setView([list[0].lat, list[0].lon], Math.max(map.getZoom(), 15), { animate: true })
    }
  }

  // "Firma" estable: cambia solo si varían coordenadas, orden o el conjunto de paradas
  // (no al teclear texto de dirección, que no afecta al mapa).
  const sig = stops.map(s => `${s.id}:${s.lat.toFixed(6)},${s.lon.toFixed(6)}:${s.n}`).join('|')
  const routeSig = routeGeometry ? `${routeGeometry.length}:${routeGeometry[0]?.join(',')}` : ''
  useEffect(() => {
    reconcile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, activeId, routeSig])

  return <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 320, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }} />
}
