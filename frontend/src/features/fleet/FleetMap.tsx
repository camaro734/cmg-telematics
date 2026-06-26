import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import { useNavigate } from 'react-router-dom'
import { useFleetStore } from './useFleetStore'
import { isEffectivelyOnline } from '../../lib/staleStatus'
import type { VehicleOut, VehicleStatus, AlertInstanceOut, RuleOut, WorkOrderOut, VehicleTypeOut } from '../../lib/types'
import { CARTO_TILES_URL, CARTO_ATTRIBUTION } from '../../lib/mapConfig'
import { buildPopupHtml } from './popupHtml'
import { T_OK, T_CRIT, T_ORANGE, T_INFO, T_OFF, T_ELEVATED } from './mapTokens'

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

// Icono EN MOVIMIENTO — flecha verde orientada al rumbo (heading, grados 0=N horario).
// La flecha SVG apunta al norte por defecto; se rota con CSS `rotate(<heading>deg)`.
function makeMovingArrowIcon(heading: number): L.DivIcon {
  return L.divIcon({
    html: `
      <div style="width:28px;height:28px;transform:rotate(${heading}deg);transform-origin:center;will-change:transform">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5))">
          <path d="M14 2 L22 24 L14 18.5 L6 24 Z" fill="${T_OK}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>
      </div>`,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
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

// Icono PARADO — punto sólido (verde=contacto ON, rojo=contacto OFF)
function makeStoppedDotIcon(ignition: boolean | null): L.DivIcon {
  const color = ignition ? T_OK : T_CRIT
  return L.divIcon({
    html: `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.45))">
        <circle cx="9" cy="9" r="6" fill="${color}" stroke="#fff" stroke-width="2"/>
      </svg>`,
    className: '',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -11],
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

// `fallbackHeading` — último rumbo conocido del vehículo, usado cuando el
// instante actual no trae heading (campo null) para que la flecha no salte a 0.
function makeVehicleIcon(status: VehicleStatus, hasAlert: boolean, fallbackHeading: number): L.DivIcon {
  if (status.device_out_of_service === true) return makeOfflineIcon()
  if (!isEffectivelyOnline(status)) return makeOfflineIcon()
  if (hasAlert) return makeAlertIcon()
  if ((status.speed_kmh ?? 0) > 2) return makeMovingArrowIcon(status.heading ?? fallbackHeading)
  return makeStoppedDotIcon(status.ignition)
}

interface FleetMapProps {
  vehicles: VehicleOut[]
  statuses: Map<string, VehicleStatus>
  vehicleTypes?: VehicleTypeOut[]
  firingAlerts?: AlertInstanceOut[]
  rules?: RuleOut[]
  workOrders?: WorkOrderOut[]
  tenantNames?: Map<string, string>
  // Destino y ruta a pintar sobre el mapa
  destination?: { lat: number; lon: number; label: string } | null
  routeGeometry?: [number, number][] | null
}

export default function FleetMap({ vehicles, statuses, firingAlerts = [], rules = [], workOrders = [], tenantNames = new Map(), vehicleTypes = [], destination, routeGeometry }: FleetMapProps) {
  const navigate = useNavigate()
  const { selectedId } = useFleetStore()
  const mapRef = useRef<L.Map | null>(null)
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  // Último rumbo conocido por vehículo — fallback cuando heading llega null
  const lastHeadingRef = useRef<Map<string, number>>(new Map())
  // Círculos de precisión GPS por vehículo
  const circlesRef = useRef<Map<string, L.Circle>>(new Map())
  const geofenceLayerRef = useRef<L.LayerGroup | null>(null)
  const orderLayerRef    = useRef<L.LayerGroup | null>(null)
  // Marcador de destino + polyline de ruta
  const destMarkerRef = useRef<L.Marker | null>(null)
  const routeLineRef  = useRef<L.Polyline | null>(null)
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
      L.tileLayer(CARTO_TILES_URL, {
        attribution: CARTO_ATTRIBUTION,
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(mapRef.current)

      const clusterGroup = L.markerClusterGroup({
        maxClusterRadius: 60,
        iconCreateFunction: (cluster) => {
          const count = cluster.getChildCount()
          return L.divIcon({
            html: `<div style="background:var(--cmg-teal);color:#fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;border:2px solid rgba(255,255,255,0.3)">${count}</div>`,
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
      geofenceLayerRef.current?.clearLayers()
      geofenceLayerRef.current = null
      orderLayerRef.current?.clearLayers()
      orderLayerRef.current = null
      // Limpiar marcador de destino y ruta al desmontar
      if (destMarkerRef.current) { mapRef.current?.removeLayer(destMarkerRef.current); destMarkerRef.current = null }
      if (routeLineRef.current)  { mapRef.current?.removeLayer(routeLineRef.current);  routeLineRef.current  = null }
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // Marcador de destino y polyline de ruta — limpia y repinta cuando cambian las props
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // Limpiar capas previas
    if (destMarkerRef.current) { map.removeLayer(destMarkerRef.current); destMarkerRef.current = null }
    if (routeLineRef.current)  { map.removeLayer(routeLineRef.current);  routeLineRef.current  = null }
    // Pintar nuevo destino
    if (destination) {
      destMarkerRef.current = L.marker([destination.lat, destination.lon], {
        icon: L.divIcon({
          className: '',
          html: '<div style="font-size:24px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.5))">📍</div>',
          iconSize: [24, 24],
          iconAnchor: [12, 24],
          popupAnchor: [0, -26],
        }),
      }).addTo(map).bindPopup(destination.label)
    }
    // Pintar ruta como polyline — resuelve --cmg-teal en runtime para white-label
    if (routeGeometry && routeGeometry.length > 1) {
      const teal = getComputedStyle(document.documentElement).getPropertyValue('--cmg-teal').trim() || '#1D9E75'
      routeLineRef.current = L.polyline(routeGeometry, {
        color: teal, weight: 4, opacity: 0.85,
      }).addTo(map)
      // Encuadra la ruta completa (origen vehículo + destino)
      map.fitBounds(routeLineRef.current.getBounds(), { padding: [60, 60] })
    } else if (destination) {
      // Sin ruta aún: centra el mapa sobre el destino para que el marcador sea visible
      map.flyTo([destination.lat, destination.lon], 14, { duration: 0.8 })
    }
    // Limpieza al desmontar o al cambiar destination/routeGeometry
    return () => {
      if (destMarkerRef.current) { mapRef.current?.removeLayer(destMarkerRef.current); destMarkerRef.current = null }
      if (routeLineRef.current)  { mapRef.current?.removeLayer(routeLineRef.current);  routeLineRef.current  = null }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination, routeGeometry])

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
    const rulesById = new Map(rules.map(r => [r.id, r]))

    // Add/update markers and GPS accuracy circles
    for (const vehicle of validVehicles) {
      const status = statuses.get(vehicle.id)!
      const lat = status.lat!
      const lon = status.lon!
      const latlng: [number, number] = [lat, lon]
      const hasAlert = alertVehicleIds.has(vehicle.id)
      const online = isEffectivelyOnline(status)
      // Memoriza el último rumbo válido para reusarlo si un instante llega sin heading
      if (status.heading != null) lastHeadingRef.current.set(vehicle.id, status.heading)
      const icon = makeVehicleIcon(status, hasAlert, lastHeadingRef.current.get(vehicle.id) ?? 0)
      const vehicleAlerts = firingAlerts.filter(a => a.vehicle_id === vehicle.id)
      const vehicleType = vehicleTypes.find(vt => vt.id === vehicle.vehicle_type_id)
      const popupHtml = buildPopupHtml(vehicle, status, vehicleAlerts, tenantNames, rulesById, vehicleType)

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

  // Geofence polygons from alert rules
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!geofenceLayerRef.current) {
      geofenceLayerRef.current = L.layerGroup().addTo(map)
    }
    geofenceLayerRef.current.clearLayers()
    for (const rule of rules) {
      const cond = rule.condition
      if (cond.type !== 'geofence' || !cond.polygon || cond.polygon.length < 3) continue
      const poly = L.polygon(cond.polygon as [number, number][], {
        color: T_ORANGE, fillColor: T_ORANGE, fillOpacity: 0.10,
        weight: 2, dashArray: '6 4',
      })
      poly.bindTooltip(rule.name, { direction: 'center', className: '' })
      geofenceLayerRef.current.addLayer(poly)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules])

  // Work order pins (pending + in_progress with coordinates)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!orderLayerRef.current) {
      orderLayerRef.current = L.layerGroup().addTo(map)
    }
    orderLayerRef.current.clearLayers()
    for (const order of workOrders) {
      if (order.location_lat == null || order.location_lon == null) continue
      if (order.status !== 'pending' && order.status !== 'in_progress') continue
      const color = order.status === 'in_progress' ? T_ORANGE : T_INFO
      const label = order.status === 'in_progress' ? 'En curso' : 'Pendiente'
      const marker = L.circleMarker([order.location_lat, order.location_lon], {
        radius: 9, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.92,
      })
      marker.bindPopup(`
        <div style="font-family:var(--font-sans,sans-serif);min-width:170px;padding:2px 0">
          <div style="font-weight:600;font-size:13px;margin-bottom:4px">${order.title}</div>
          ${order.vehicle_name ? `<div style="font-size:11px;color:#999;margin-bottom:2px">${order.vehicle_name}</div>` : ''}
          ${order.driver_name  ? `<div style="font-size:11px;color:#999;margin-bottom:6px">${order.driver_name}</div>` : ''}
          <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:${color}22;color:${color}">${label}</span>
        </div>
      `)
      orderLayerRef.current.addLayer(marker)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrders])

  // Handle popup link clicks (SPA navigation) + toggle "Ver más"
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement

      // SPA navigation
      if (target.tagName === 'A' && target.getAttribute('href')?.startsWith('/vehicles/')) {
        e.preventDefault()
        navigate(target.getAttribute('href')!)
        return
      }

      // Toggle equipo industrial
      const btn = target.closest('button[data-popup-action="toggle-more"]') as HTMLButtonElement | null
      if (btn) {
        const root = btn.closest('[data-popup-root]')
        const section = root?.querySelector('[data-popup-section="more"]') as HTMLElement | null
        if (!section) return
        const expanded = section.style.display !== 'none'
        section.style.display = expanded ? 'none' : 'block'
        btn.textContent = expanded ? 'Ver más ↓' : 'Ver menos ↑'
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
