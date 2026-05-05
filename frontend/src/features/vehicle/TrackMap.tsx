import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { TrackPoint, VehicleStatus } from '../../lib/types'


// ── Design token mirrors (CSS vars cannot be used in SVG/Leaflet strings) ──
const T_OK     = '#22C55E'  // var(--accent-ok)
const T_ORANGE = '#F97316'  // var(--accent-orange)
const T_INFO   = '#38BDF8'  // var(--accent-info)

// CSS para efecto pulse en TrackMap — comparte el mismo id que FleetMap para no duplicar
const PULSE_CSS = `
@keyframes cmg-pulse-ring {
  0%   { transform: scale(0.8); opacity: 1; }
  100% { transform: scale(2.2); opacity: 0; }
}
.cmg-pulse-wrapper {
  position: relative;
  width: 20px;
  height: 20px;
}
.cmg-pulse-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: rgba(56, 189, 248, 0.45);
  animation: cmg-pulse-ring 1.4s ease-out infinite;
}
.cmg-pulse-dot {
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: ${T_INFO};
  border: 2px solid #fff;
}
`

function injectPulseCSS() {
  if (document.getElementById('cmg-pulse-css')) return
  const style = document.createElement('style')
  style.id = 'cmg-pulse-css'
  style.textContent = PULSE_CSS
  document.head.appendChild(style)
}

function isMoving(status: VehicleStatus): boolean {
  return (status.speed_kmh ?? 0) > 2
}

// Marcador pulsante para vehículo en movimiento
function makeMovingMarker(): L.DivIcon {
  return L.divIcon({
    html: `
      <div class="cmg-pulse-wrapper">
        <div class="cmg-pulse-ring"></div>
        <div class="cmg-pulse-dot"></div>
      </div>`,
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -14],
  })
}

// Chincheta estática naranja para vehículo parado
function makeStoppedMarker(): L.DivIcon {
  return L.divIcon({
    html: `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32" style="display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.5))">
        <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 20 12 20s12-11 12-20C24 5.373 18.627 0 12 0z" fill="${T_ORANGE}"/>
        <circle cx="12" cy="12" r="5" fill="white"/>
      </svg>`,
    className: '',
    iconSize: [24, 32],
    iconAnchor: [12, 32],
    popupAnchor: [0, -34],
  })
}

interface TrackMapProps {
  track: TrackPoint[]
  status: VehicleStatus | undefined
}

export default function TrackMap({ track, status }: TrackMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    injectPulseCSS()
    if (!containerRef.current || mapRef.current) return
    mapRef.current = L.map(containerRef.current, {
      center: [40.416775, -3.70379],
      zoom: 12,
    })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
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

    const MIN_DIST_M = 25
    const filtered: typeof validPoints = []
    for (let i = 0; i < validPoints.length; i++) {
      const p = validPoints[i]
      const prev = filtered[filtered.length - 1]
      if (!prev) { filtered.push(p); continue }
      const pSpd = p.speed_kmh ?? 0
      const prevSpd = prev.speed_kmh ?? 0
      const dLat = (p.lat! - prev.lat!) * 111320
      const dLon = (p.lon! - prev.lon!) * 111320 * Math.cos(prev.lat! * Math.PI / 180)
      const dist = Math.sqrt(dLat * dLat + dLon * dLon)
      // Skip segment when both endpoints are near-stationary and within distance threshold
      if (pSpd <= 2 && prevSpd <= 2 && dist <= MIN_DIST_M) continue
      filtered.push(p)
    }

    if (filtered.length > 0) {
      const latlngs = filtered.map(p => [p.lat!, p.lon!] as [number, number])

      // Track polyline en naranja
      L.polyline(latlngs, {
        color: T_ORANGE,
        weight: 3,
        opacity: 0.8,
      }).addTo(map)

      // Marcador de inicio (verde)
      L.circleMarker(latlngs[0], {
        radius: 5, fillColor: T_OK, color: '#fff',
        weight: 2, fillOpacity: 1,
      }).bindTooltip('Inicio').addTo(map)
    }

    // Marcador de posición actual según estado — always rendered regardless of track data
    if (status?.lat != null && status?.lon != null) {
      const latlng: [number, number] = [status.lat, status.lon]
      const moving = isMoving(status)

      if (moving) {
        // En movimiento: punto pulsante cyan
        L.marker(latlng, { icon: makeMovingMarker() })
          .bindTooltip('Posición actual')
          .addTo(map)
      } else {
        // Parado: chincheta naranja estática
        L.marker(latlng, { icon: makeStoppedMarker() })
          .bindTooltip('Posición actual')
          .addTo(map)
      }

      // Círculo de precisión GPS cuando online
      if (status.online) {
        L.circle(latlng, {
          radius: 15,
          color: 'rgba(110,197,177,0.4)',
          weight: 1,
          fillColor: 'rgba(110,197,177,0.15)',
          fillOpacity: 1,
          interactive: false,
        }).addTo(map)
      }
    }

    // Fit bounds
    const allPoints: [number, number][] = filtered.map(p => [p.lat!, p.lon!])
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
