import { useEffect, useRef } from 'react'
import L from 'leaflet'

// Centro de España como fallback cuando no hay polígono
const DEFAULT_CENTER: [number, number] = [40.416775, -3.70379]
const DEFAULT_ZOOM = 6

const T_ORANGE = '#F97316'
const T_BG     = '#1C1917'

interface Props {
  polygon: [number, number][]
  onChange: (polygon: [number, number][]) => void
}

export default function GeofenceMapEditor({ polygon, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<L.Map | null>(null)
  const layerRef     = useRef<L.LayerGroup | null>(null)
  // Ref espejo para que el click handler siempre lea el valor actual
  const polygonRef   = useRef<[number, number][]>(polygon)

  useEffect(() => { polygonRef.current = polygon }, [polygon])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map)

    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    map.on('click', (e: L.LeafletMouseEvent) => {
      const newPoly: [number, number][] = [...polygonRef.current, [e.latlng.lat, e.latlng.lng]]
      onChange(newPoly)
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-dibuja el polígono cada vez que cambia
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return

    layer.clearLayers()

    if (polygon.length === 0) return

    // Vértices como marcadores pequeños
    polygon.forEach(([lat, lon], i) => {
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:10px;height:10px;border-radius:50%;background:${T_ORANGE};border:2px solid #fff;"></div>`,
        iconAnchor: [5, 5],
      })
      L.marker([lat, lon], { icon }).bindTooltip(`${i + 1}`).addTo(layer)
    })

    // Línea del polígono (cerrado si ≥3 vértices)
    const coords: [number, number][] = polygon.length >= 3
      ? [...polygon, polygon[0]]
      : polygon

    L.polyline(coords, { color: T_ORANGE, weight: 2, dashArray: '6 4' }).addTo(layer)

    if (polygon.length >= 3) {
      L.polygon(polygon, { color: T_ORANGE, fillColor: T_ORANGE, fillOpacity: 0.12, weight: 0 }).addTo(layer)
    }

    // Centrar el mapa en el polígono la primera vez que tiene vértices
    if (polygon.length >= 2) {
      map.fitBounds(L.latLngBounds(polygon.map(([la, lo]) => [la, lo] as [number, number])), { padding: [40, 40], maxZoom: 15 })
    }
  }, [polygon])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-muted)' }}>
          {polygon.length === 0
            ? 'Haz clic en el mapa para añadir vértices al polígono'
            : polygon.length < 3
            ? `${polygon.length} vértice${polygon.length > 1 ? 's' : ''} — necesitas al menos 3`
            : `${polygon.length} vértices — polígono válido`}
        </span>
        {polygon.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            style={{
              fontFamily: 'var(--font-ui)', fontSize: 11, padding: '3px 8px',
              background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
              borderRadius: 4, color: 'var(--accent-crit)', cursor: 'pointer',
            }}
          >
            Borrar zona
          </button>
        )}
      </div>
      <div
        ref={containerRef}
        style={{
          height: 280,
          borderRadius: 8,
          border: `1px solid ${polygon.length >= 3 ? T_ORANGE : 'var(--bg-border)'}`,
          overflow: 'hidden',
          background: T_BG,
          transition: 'border-color 0.2s',
        }}
      />
    </div>
  )
}
