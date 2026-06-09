import { useState, useEffect, useRef } from 'react'
import L from 'leaflet'
import { CARTO_TILES_URL } from '../../lib/mapConfig'

type NominatimPlace = { lat: string; lon: string; display_name: string }

// Chincheta naranja SVG — evita el icono PNG por defecto de Leaflet que Vite no resuelve
function makeStopIcon(label?: string) {
  return L.divIcon({
    html: `<div style="position:relative;width:28px;height:36px">
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36" style="display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.45))">
        <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.268 21.732 0 14 0z" fill="var(--energy-orange)"/>
        <circle cx="14" cy="14" r="6" fill="white"/>
        ${label ? `<text x="14" y="18" text-anchor="middle" font-size="8" font-weight="700" fill="var(--energy-orange)" font-family="monospace">${label}</text>` : ''}
      </svg>
    </div>`,
    className: '',
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -38],
  })
}

export function StopLocationPicker({
  lat, lon, searchQuery, onPick,
}: { lat: number | null; lon: number | null; searchQuery?: string; onPick: (lat: number, lon: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef    = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const [query,       setQuery]       = useState(searchQuery ?? '')
  const [places,      setPlaces]      = useState<NominatimPlace[]>([])
  const [searching,   setSearching]   = useState(false)
  const [showDrop,    setShowDrop]    = useState(false)
  const [noResults,   setNoResults]   = useState(false)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const center: [number, number] = lat && lon ? [lat, lon] : [39.47, -0.376]
    const map = L.map(containerRef.current, { center, zoom: lat ? 14 : 6, zoomControl: true })
    L.tileLayer(CARTO_TILES_URL, {
      subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap © CARTO',
    }).addTo(map)
    mapRef.current = map
    if (lat && lon) {
      markerRef.current = L.marker([lat, lon], { icon: makeStopIcon() }).addTo(map)
    }
    map.on('click', (e: L.LeafletMouseEvent) => {
      onPick(e.latlng.lat, e.latlng.lng)
      if (markerRef.current) markerRef.current.setLatLng(e.latlng)
      else markerRef.current = L.marker(e.latlng, { icon: makeStopIcon() }).addTo(map)
      setShowDrop(false)
    })
    return () => { map.remove(); mapRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function geocode() {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setPlaces([])
    setNoResults(false)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&accept-language=es`,
        { headers: { 'Accept': 'application/json' } }
      )
      const data: NominatimPlace[] = await res.json()
      if (data.length === 0) { setNoResults(true); setShowDrop(true) }
      else { setPlaces(data); setShowDrop(true) }
    } catch {
      setNoResults(true); setShowDrop(true)
    }
    setSearching(false)
  }

  function pickPlace(p: NominatimPlace) {
    const la = parseFloat(p.lat), lo = parseFloat(p.lon)
    setShowDrop(false)
    setPlaces([])
    onPick(la, lo)
    if (mapRef.current) {
      mapRef.current.setView([la, lo], 16)
      if (markerRef.current) markerRef.current.setLatLng([la, lo])
      else markerRef.current = L.marker([la, lo], { icon: makeStopIcon() }).addTo(mapRef.current)
    }
  }

  const inputStyle: React.CSSProperties = {
    flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 5, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)',
    fontSize: 12, padding: '6px 9px',
  }

  return (
    <div>
      {/* Buscador de dirección */}
      <div style={{ position: 'relative', marginBottom: 6 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            style={inputStyle}
            placeholder="Buscar dirección, lugar o coordenadas…"
            value={query}
            onChange={e => { setQuery(e.target.value); setShowDrop(false) }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); geocode() } }}
            onFocus={() => places.length > 0 && setShowDrop(true)}
          />
          <button
            type="button"
            onClick={geocode}
            disabled={searching || !query.trim()}
            style={{ background: 'var(--cmg-teal)', color: '#fff', border: 'none', borderRadius: 5, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0, opacity: searching || !query.trim() ? 0.6 : 1 }}
          >
            {searching ? '…' : 'Buscar'}
          </button>
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
        Busca una dirección arriba o haz clic en el mapa para fijar la ubicación
        {lat && lon ? ` · ${lat.toFixed(5)}, ${lon.toFixed(5)}` : ''}
      </p>
    </div>
  )
}
