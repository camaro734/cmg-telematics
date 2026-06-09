import { useState, useEffect, useRef } from 'react'
import L from 'leaflet'
import { CARTO_TILES_URL, CARTO_ATTRIBUTION } from '../../lib/mapConfig'

type NominatimPlace = { lat: string; lon: string; display_name: string }

function makeStopIcon() {
  return L.divIcon({
    html: `<div style="position:relative;width:28px;height:36px">
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36" style="display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.45))">
        <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.268 21.732 0 14 0z" fill="var(--energy-orange)"/>
        <circle cx="14" cy="14" r="6" fill="white"/>
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

export function StopLocationPicker({
  lat, lon, searchQuery, arrivalRadiusM, onPick, onAddressChange,
}: {
  lat: number | null
  lon: number | null
  searchQuery?: string
  arrivalRadiusM: number
  onPick: (lat: number, lon: number) => void
  onAddressChange?: (address: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<L.Map | null>(null)
  const markerRef    = useRef<L.Marker | null>(null)
  const circleRef    = useRef<L.Circle | null>(null)
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const radiusRef    = useRef(arrivalRadiusM)
  const onPickRef    = useRef(onPick)
  const onAddrRef    = useRef(onAddressChange)

  const [query,     setQuery]     = useState(searchQuery ?? '')
  const [places,    setPlaces]    = useState<NominatimPlace[]>([])
  const [searching, setSearching] = useState(false)
  const [showDrop,  setShowDrop]  = useState(false)
  const [noResults, setNoResults] = useState(false)

  // Mantener refs de callbacks actualizados
  useEffect(() => { onPickRef.current = onPick }, [onPick])
  useEffect(() => { onAddrRef.current = onAddressChange }, [onAddressChange])
  useEffect(() => { radiusRef.current = arrivalRadiusM }, [arrivalRadiusM])

  // Actualizar radio del círculo cuando cambia la prop
  useEffect(() => {
    circleRef.current?.setRadius(arrivalRadiusM)
  }, [arrivalRadiusM])

  // Coloca o mueve el pin + círculo en el mapa; registra dragend al crear
  function setOrMovePin(la: number, lo: number) {
    const map = mapRef.current
    if (!map) return
    const latlng: [number, number] = [la, lo]

    if (circleRef.current) {
      circleRef.current.setLatLng(latlng)
    } else {
      circleRef.current = L.circle(latlng, { ...GEOCIRCLE, radius: radiusRef.current }).addTo(map)
    }

    if (markerRef.current) {
      markerRef.current.setLatLng(latlng)
    } else {
      const m = L.marker(latlng, { icon: makeStopIcon(), draggable: true }).addTo(map)
      m.on('dragend', async () => {
        const pos = m.getLatLng()
        onPickRef.current(pos.lat, pos.lng)
        circleRef.current?.setLatLng(pos)
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${pos.lat}&lon=${pos.lng}&format=json&accept-language=es`,
            { headers: { Accept: 'application/json' } },
          )
          const data: { display_name?: string } = await res.json()
          if (data.display_name) {
            setQuery(data.display_name)
            onAddrRef.current?.(data.display_name)
          }
        } catch { /* silencioso */ }
      })
      markerRef.current = m
    }
  }

  // Inicializar mapa (una sola vez)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const center: [number, number] = lat && lon ? [lat, lon] : [39.47, -0.376]
    const map = L.map(containerRef.current, { center, zoom: lat ? 14 : 6, zoomControl: true })
    L.tileLayer(CARTO_TILES_URL, {
      subdomains: 'abcd', maxZoom: 19, attribution: CARTO_ATTRIBUTION,
    }).addTo(map)
    mapRef.current = map

    if (lat && lon) setOrMovePin(lat, lon)

    map.on('click', (e: L.LeafletMouseEvent) => {
      setOrMovePin(e.latlng.lat, e.latlng.lng)
      onPickRef.current(e.latlng.lat, e.latlng.lng)
      setShowDrop(false)
    })

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      map.remove()
      mapRef.current = null
      markerRef.current = null
      circleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function geocode(q: string) {
    setSearching(true)
    setPlaces([])
    setNoResults(false)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&accept-language=es`,
        { headers: { Accept: 'application/json' } },
      )
      const data: NominatimPlace[] = await res.json()
      if (data.length === 0) { setNoResults(true); setShowDrop(true) }
      else                   { setPlaces(data);    setShowDrop(true) }
    } catch {
      setNoResults(true); setShowDrop(true)
    }
    setSearching(false)
  }

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    setShowDrop(false)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.trim().length >= 3) {
      debounceRef.current = setTimeout(() => geocode(val.trim()), 400)
    }
  }

  function pickPlace(p: NominatimPlace) {
    const la = parseFloat(p.lat), lo = parseFloat(p.lon)
    setShowDrop(false)
    setPlaces([])
    onPickRef.current(la, lo)
    if (mapRef.current) {
      mapRef.current.setView([la, lo], 16)
      setOrMovePin(la, lo)
    }
  }

  const inputStyle: React.CSSProperties = {
    flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 5, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)',
    fontSize: 12, padding: '6px 9px',
  }

  return (
    <div>
      {/* Buscador con debounce */}
      <div style={{ position: 'relative', marginBottom: 6 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            style={inputStyle}
            placeholder="Escribe para buscar (≥3 letras) o arrastra el pin…"
            value={query}
            onChange={handleQueryChange}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (debounceRef.current) clearTimeout(debounceRef.current)
                const q = query.trim()
                if (q) geocode(q)
              }
            }}
            onFocus={() => places.length > 0 && setShowDrop(true)}
          />
          {searching && (
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)', flexShrink: 0, whiteSpace: 'nowrap' }}>
              Buscando…
            </span>
          )}
        </div>

        {/* Dropdown resultados */}
        {showDrop && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 600, boxShadow: '0 6px 20px rgba(0,0,0,0.5)', maxHeight: 210, overflowY: 'auto', marginTop: 2 }}>
            {noResults ? (
              <div style={{ padding: '10px 12px', fontSize: 12, fontFamily: 'var(--font-sans)', color: 'var(--fg-muted)' }}>
                Sin resultados — prueba con otra dirección o haz clic en el mapa
              </div>
            ) : places.map((p, i) => (
              <div
                key={i}
                onClick={() => pickPlace(p)}
                style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'var(--font-sans)', cursor: 'pointer', borderBottom: i < places.length - 1 ? '1px solid var(--border)' : 'none', color: 'var(--fg-primary)', lineHeight: 1.4 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {p.display_name}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mapa */}
      <div ref={containerRef} style={{ width: '100%', height: 220, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }} />
      <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--fg-muted)', marginTop: 4, marginBottom: 0 }}>
        Selecciona buscando o haz clic en el mapa · pin arrastrable
        {lat && lon ? ` · ${lat.toFixed(5)}, ${lon.toFixed(5)}` : ''}
      </p>
    </div>
  )
}
