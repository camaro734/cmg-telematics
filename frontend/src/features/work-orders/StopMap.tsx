import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { CARTO_TILES_URL, CARTO_ATTRIBUTION } from '../../lib/mapConfig'

// Mismo pin/estilo que StopLocationPicker (coherencia visual), pero este mapa es
// GRANDE y CONTROLADO: refleja la parada activa (lat/lon) y permite ajuste fino
// arrastrando el pin. No incluye buscador propio — la búsqueda vive en la columna
// del formulario (AddressAutocomplete / Valhalla).
function makeStopIcon() {
  return L.divIcon({
    html: `<div style="position:relative;width:30px;height:40px">
      <svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 28 36" style="display:block;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.5))">
        <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.268 21.732 0 14 0z" fill="var(--energy-orange)"/>
        <circle cx="14" cy="14" r="6" fill="white"/>
      </svg>
    </div>`,
    className: '',
    iconSize: [30, 40],
    iconAnchor: [15, 40],
  })
}

const GEOCIRCLE: L.CircleOptions = {
  color: '#1D9E75', fillColor: '#1D9E75', fillOpacity: 0.12, weight: 2,
}

export function StopMap({
  lat, lon, arrivalRadiusM, onPick, onAddressChange,
}: {
  lat: number | null
  lon: number | null
  arrivalRadiusM: number
  onPick: (lat: number, lon: number) => void
  onAddressChange?: (address: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<L.Map | null>(null)
  const markerRef    = useRef<L.Marker | null>(null)
  const circleRef    = useRef<L.Circle | null>(null)
  const onPickRef    = useRef(onPick)
  const onAddrRef    = useRef(onAddressChange)
  const radiusRef    = useRef(arrivalRadiusM)
  // Marca los cambios de lat/lon originados DENTRO del mapa (click/drag) para no
  // re-centrar la vista en ese caso (sería un salto molesto tras arrastrar).
  const internalRef  = useRef(false)

  useEffect(() => { onPickRef.current = onPick }, [onPick])
  useEffect(() => { onAddrRef.current = onAddressChange }, [onAddressChange])
  useEffect(() => { radiusRef.current = arrivalRadiusM; circleRef.current?.setRadius(arrivalRadiusM) }, [arrivalRadiusM])

  function setOrMovePin(la: number, lo: number) {
    const map = mapRef.current
    if (!map) return
    const latlng: [number, number] = [la, lo]
    if (circleRef.current) circleRef.current.setLatLng(latlng)
    else circleRef.current = L.circle(latlng, { ...GEOCIRCLE, radius: radiusRef.current }).addTo(map)

    if (markerRef.current) {
      markerRef.current.setLatLng(latlng)
    } else {
      const m = L.marker(latlng, { icon: makeStopIcon(), draggable: true }).addTo(map)
      m.on('dragend', async () => {
        const pos = m.getLatLng()
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
      markerRef.current = m
    }
  }

  // Inicializar el mapa una sola vez.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const center: [number, number] = lat != null && lon != null ? [lat, lon] : [39.47, -0.376]
    const map = L.map(containerRef.current, { center, zoom: lat != null ? 15 : 6, zoomControl: true })
    L.tileLayer(CARTO_TILES_URL, { subdomains: 'abcd', maxZoom: 19, attribution: CARTO_ATTRIBUTION }).addTo(map)
    mapRef.current = map
    if (lat != null && lon != null) setOrMovePin(lat, lon)

    map.on('click', (e: L.LeafletMouseEvent) => {
      internalRef.current = true
      setOrMovePin(e.latlng.lat, e.latlng.lng)
      onPickRef.current(e.latlng.lat, e.latlng.lng)
    })

    // Leaflet necesita recalcular el tamaño cuando el contenedor ya tiene altura.
    setTimeout(() => map.invalidateSize(), 0)

    return () => { map.remove(); mapRef.current = null; markerRef.current = null; circleRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reflejar cambios de la parada activa (lat/lon) venidos del formulario: mover el
  // pin y centrar. Si el cambio fue interno (drag/click), solo mover el pin.
  useEffect(() => {
    const map = mapRef.current
    if (!map || lat == null || lon == null) return
    setOrMovePin(lat, lon)
    if (internalRef.current) { internalRef.current = false; return }
    map.setView([lat, lon], Math.max(map.getZoom(), 15), { animate: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon])

  return <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 320, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }} />
}
