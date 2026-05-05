import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import { useNavigate } from 'react-router-dom'
import { useFleetStore } from './useFleetStore'
import type { VehicleOut, VehicleStatus, AlertInstanceOut } from '../../lib/types'


// ── Design token mirrors (CSS vars can't be used in SVG strings) ────────────
const T_OK     = '#22C55E'  // var(--accent-ok)
const T_WARN   = '#EAB308'  // var(--accent-warn)
const T_CRIT   = '#EF4444'  // var(--accent-crit)
const T_ORANGE = '#F97316'  // var(--accent-orange)
const T_INFO   = '#38BDF8'  // var(--accent-info)
const T_OFF    = '#57534E'  // --bg-border dark
const T_ELEVATED = '#3C3330' // var(--bg-elevated)
const T_MUTED  = '#a8a29e'  // var(--text-dim)

// CSS para efecto pulse — se inyecta una sola vez en el documento
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
  background: rgba(56,189,248,0.45);
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

function isEffectivelyOnline(status: VehicleStatus): boolean {
  if (!status.online || !status.last_seen) return false
  return (Date.now() - new Date(status.last_seen).getTime()) < 5 * 60_000
}

// Icono EN MOVIMIENTO — punto pulsante verde
function makeMovingIcon(): L.DivIcon {
  return L.divIcon({
    html: `
      <div class="cmg-pulse-wrapper">
        <div class="cmg-pulse-ring" style="background:rgba(34,197,94,0.45)"></div>
        <div class="cmg-pulse-dot" style="background:${T_OK}"></div>
      </div>`,
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -14],
  })
}

// Icono ALERTA — punto pulsante rojo
function makeAlertIcon(): L.DivIcon {
  return L.divIcon({
    html: `
      <div class="cmg-pulse-wrapper">
        <div class="cmg-pulse-ring" style="background:rgba(239,68,68,0.5)"></div>
        <div class="cmg-pulse-dot" style="background:${T_CRIT}"></div>
      </div>`,
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -14],
  })
}

// Icono PARADO — drop-pin SVG (amarillo=motor ON, naranja=motor OFF)
function makeStoppedIcon(ignition: boolean | null): L.DivIcon {
  const pinColor = ignition ? T_WARN : T_ORANGE
  return L.divIcon({
    html: `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32" style="display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.5))">
        <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 20 12 20s12-11 12-20C24 5.373 18.627 0 12 0z" fill="${pinColor}"/>
        <circle cx="12" cy="12" r="5" fill="white"/>
      </svg>`,
    className: '',
    iconSize: [24, 32],
    iconAnchor: [12, 32],
    popupAnchor: [0, -34],
  })
}

// Icono OFFLINE — círculo gris estático sin animación
function makeOfflineIcon(): L.DivIcon {
  return L.divIcon({
    html: `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" style="display:block">
        <circle cx="9" cy="9" r="7" fill="${T_OFF}" stroke="${T_ELEVATED}" stroke-width="2" opacity="0.7"/>
      </svg>`,
    className: '',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -12],
  })
}

function makeVehicleIcon(status: VehicleStatus, hasAlert: boolean): L.DivIcon {
  if (!isEffectivelyOnline(status)) return makeOfflineIcon()
  if (hasAlert) return makeAlertIcon()
  if ((status.speed_kmh ?? 0) > 2) return makeMovingIcon()
  return makeStoppedIcon(status.ignition)
}

function formatStoppedTime(lastSeen: string | null): string {
  if (!lastSeen) return 'Sin señal'
  const mins = Math.round((Date.now() - new Date(lastSeen).getTime()) / 60000)
  if (mins < 1) return 'Ahora mismo'
  if (mins < 60) return `Parado ${mins} min`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0 ? `Parado ${hrs}h ${rem}min` : `Parado ${hrs}h`
}

function formatLastSeen(lastSeen: string | null): string {
  if (!lastSeen) return 'Sin datos'
  const d = new Date(lastSeen)
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

function buildPopupHtml(vehicle: VehicleOut, status: VehicleStatus, hasAlert: boolean): string {
  const online = isEffectivelyOnline(status)
  const moving = online && (status.speed_kmh ?? 0) > 2
  let statusText: string
  if (!online) {
    statusText = `⚫ Sin señal`
  } else if (hasAlert) {
    statusText = `🔴 Alerta activa`
  } else if (moving) {
    statusText = `🟢 En movimiento — <strong>${Math.round(status.speed_kmh ?? 0)} km/h</strong>`
  } else {
    statusText = `🟡 ${formatStoppedTime(status.last_seen)}`
  }
  const plateLine = vehicle.license_plate
    ? `<div style="color:${T_MUTED};font-size:11px;margin-bottom:4px">${vehicle.license_plate}</div>`
    : ''
  return `
    <div style="font-family:sans-serif;min-width:160px;padding:2px 0">
      <div style="font-weight:700;font-size:14px;margin-bottom:2px">${vehicle.name}</div>
      ${plateLine}
      <div style="font-size:12px;margin-bottom:4px">${statusText}</div>
      <div style="font-size:11px;color:${T_MUTED};margin-bottom:6px">
        Ultima señal: ${formatLastSeen(status.last_seen)}
      </div>
      <a href="/vehicles/${vehicle.id}" style="color:${T_ORANGE};font-size:12px;text-decoration:none">Ver detalle →</a>
    </div>
  `
}

interface FleetMapProps {
  vehicles: VehicleOut[]
  statuses: Map<string, VehicleStatus>
  vehicleTypes?: unknown[]
  firingAlerts?: AlertInstanceOut[]
}

export default function FleetMap({ vehicles, statuses, firingAlerts = [] }: FleetMapProps) {
  const navigate = useNavigate()
  const { selectedId } = useFleetStore()
  const mapRef = useRef<L.Map | null>(null)
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  // Círculos de precisión GPS por vehículo
  const circlesRef = useRef<Map<string, L.Circle>>(new Map())
  const containerRef = useRef<HTMLDivElement>(null)
  const initialFitDoneRef = useRef(false)

  // Init map — Leaflet requiere que el contenedor tenga altura > 0
  useEffect(() => {
    injectPulseCSS()
    if (!containerRef.current || mapRef.current) return

    function initMap() {
      if (!containerRef.current || mapRef.current) return
      mapRef.current = L.map(containerRef.current, {
        center: [40.416775, -3.70379], // Madrid default
        zoom: 6,
        zoomControl: false,
      })
      L.control.zoom({ position: 'topright' }).addTo(mapRef.current)
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(mapRef.current)

      const clusterGroup = L.markerClusterGroup({
        maxClusterRadius: 60,
        iconCreateFunction: (cluster) => {
          const count = cluster.getChildCount()
          return L.divIcon({
            html: `<div style="background:var(--accent-energy);color:#fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;border:2px solid rgba(255,255,255,0.3)">${count}</div>`,
            className: '',
            iconSize: [36, 36],
          })
        },
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
      })
      mapRef.current.addLayer(clusterGroup)
      clusterGroupRef.current = clusterGroup
    }

    // Guard: if container has no height yet, defer init to next paint frame
    let raf: number | null = null
    if (containerRef.current.clientHeight === 0) {
      raf = requestAnimationFrame(initMap)
    } else {
      initMap()
    }

    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
      clusterGroupRef.current?.clearLayers()
      clusterGroupRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // Update markers when statuses change
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const validVehicles = vehicles.filter(v => {
      const s = statuses.get(v.id)
      return s?.lat != null && s?.lon != null
    })

    const validIds = new Set(validVehicles.map(v => v.id))

    // Remove old markers and circles not in current list
    for (const [id, marker] of markersRef.current) {
      if (!validIds.has(id)) {
        clusterGroupRef.current?.removeLayer(marker)
        markersRef.current.delete(id)
      }
    }
    for (const [id, circle] of circlesRef.current) {
      if (!validIds.has(id)) {
        circle.remove()
        circlesRef.current.delete(id)
      }
    }

    const alertVehicleIds = new Set(firingAlerts.map(a => a.vehicle_id))

    // Add/update markers and GPS accuracy circles
    for (const vehicle of validVehicles) {
      const status = statuses.get(vehicle.id)!
      const lat = status.lat!
      const lon = status.lon!
      const latlng: [number, number] = [lat, lon]
      const hasAlert = alertVehicleIds.has(vehicle.id)
      const online = isEffectivelyOnline(status)
      const icon = makeVehicleIcon(status, hasAlert)
      const popupHtml = buildPopupHtml(vehicle, status, hasAlert)

      if (markersRef.current.has(vehicle.id)) {
        const marker = markersRef.current.get(vehicle.id)!
        marker.setLatLng(latlng)
        marker.setIcon(icon)
        // Actualizar contenido del popup sin re-abrir si está cerrado
        const popup = marker.getPopup()
        if (popup) popup.setContent(popupHtml)
      } else {
        const marker = L.marker(latlng, { icon })
          .bindPopup(popupHtml)
        clusterGroupRef.current?.addLayer(marker)
        markersRef.current.set(vehicle.id, marker)
      }

      // Círculo de precisión GPS — solo cuando efectivamente online
      if (online) {
        if (circlesRef.current.has(vehicle.id)) {
          circlesRef.current.get(vehicle.id)!.setLatLng(latlng)
        } else {
          const circle = L.circle(latlng, {
            radius: 15,
            color: 'rgba(110,197,177,0.4)',
            weight: 1,
            fillColor: 'rgba(110,197,177,0.15)',
            fillOpacity: 1,
            interactive: false,
          }).addTo(map)
          circlesRef.current.set(vehicle.id, circle)
        }
      } else {
        circlesRef.current.get(vehicle.id)?.remove()
        circlesRef.current.delete(vehicle.id)
      }
    }

    // Fit bounds solo la primera vez que llegan posiciones válidas
    if (!initialFitDoneRef.current && markersRef.current.size > 0) {
      const group = L.featureGroup(Array.from(markersRef.current.values()))
      try {
        map.fitBounds(group.getBounds().pad(0.2))
        initialFitDoneRef.current = true
      } catch { /* ignore */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses, vehicles])

  // Fly to selected vehicle
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedId) return
    const status = statuses.get(selectedId)
    if (status?.lat != null && status?.lon != null) {
      map.flyTo([status.lat, status.lon], 14, { duration: 0.8 })
    }
  }, [selectedId, statuses])

  // Handle popup link clicks (SPA navigation)
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'A' && target.getAttribute('href')?.startsWith('/vehicles/')) {
        e.preventDefault()
        navigate(target.getAttribute('href')!)
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [navigate])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', background: 'var(--bg-base)' }}
    />
  )
}
