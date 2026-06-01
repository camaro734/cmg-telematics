import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import { useNavigate } from 'react-router-dom'
import { useFleetStore } from './useFleetStore'
import type { VehicleOut, VehicleStatus, AlertInstanceOut, RuleOut, WorkOrderOut, VehicleTypeOut, SensorDef } from '../../lib/types'


// ── Design token mirrors (CSS vars can't be used in SVG strings) ────────────
const T_OK     = '#22C55E'  // var(--ok)
const T_WARN   = '#EAB308'  // var(--warn)
const T_CRIT   = '#EF4444'  // var(--danger)
const T_ORANGE = 'var(--energy-orange)'  // var(--cmg-teal)
const T_INFO   = '#38BDF8'  // var(--info)
const T_OFF    = '#64748B'  // var(--offline)
const T_ELEVATED = '#22263A' // var(--bg-elevated)
const T_MUTED  = 'var(--fg-muted)'

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
  if (!status.last_seen) return false
  const ms = Date.now() - new Date(status.last_seen).getTime()
  const threshold = status.ignition ? 70 * 60_000 : 62 * 60_000
  return ms < threshold
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

function formatLastSeen(lastSeen: string | null): string {
  if (!lastSeen) return 'Sin datos'
  const d = new Date(lastSeen)
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

function buildPopupHtml(
  vehicle: VehicleOut,
  status: VehicleStatus,
  vehicleAlerts: AlertInstanceOut[],
  tenantNames: Map<string, string>,
  rulesById: Map<string, RuleOut>,
  vehicleType: VehicleTypeOut | undefined
): string {
  const clientName = tenantNames.get(vehicle.tenant_id) ?? '—'
  const online = isEffectivelyOnline(status)

  // Severidad peor de las alertas activas del vehículo
  let worstSev: '' | 'warning' | 'critical' = ''
  for (const a of vehicleAlerts) {
    const sev = rulesById.get(a.rule_id)?.severity
    if (sev === 'critical') { worstSev = 'critical'; break }
    if (sev === 'warning') worstSev = 'warning'
  }
  const borderColor = worstSev === 'critical' ? 'var(--danger)' : worstSev === 'warning' ? 'var(--warn)' : 'transparent'

  // Banda offline (2 rgba hardcoded — ver deuda técnica opacidad)
  const offlineBand = !online
    ? `<div style="background:var(--danger-12);color:var(--danger);padding:5px 14px;font-size:11px;font-weight:600;border-bottom:1px solid var(--danger-25)">Datos desactualizados desde ${formatLastSeen(status.last_seen)}</div>`
    : ''

  // Chips de alertas (3 rgba hardcoded — ver deuda técnica opacidad)
  const chips = vehicleAlerts.map(a => {
    const rule = rulesById.get(a.rule_id)
    const name = rule?.name ?? 'Alerta'
    const sev = rule?.severity ?? 'info'
    const bg = sev === 'critical' ? 'var(--danger-12)' : sev === 'warning' ? 'var(--warn-12)' : 'var(--info-12)'
    const color = sev === 'critical' ? 'var(--danger)' : sev === 'warning' ? 'var(--warn)' : 'var(--info)'
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;background:${bg};color:${color};font-size:10px;font-weight:600">⚠ ${name}</span>`
  }).join('')
  const chipsRow = chips ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">${chips}</div>` : ''

  // Tabla compacta — fondo blanco del popup nativo de Leaflet: usar colores oscuros para contraste
  const driverCell = vehicle.driver_name
    ? `<span style="color:#111827;font-size:12px">${vehicle.driver_name}</span>`
    : `<span style="color:${T_MUTED};font-style:italic;font-size:12px">Sin conductor asignado</span>`
  const stateCell = online
    ? `<span style="color:var(--ok);font-size:12px;font-weight:500">En línea</span>`
    : `<span style="color:${T_MUTED};font-size:12px">Offline</span>`

  // Equipo industrial (Bloque 4)
  const ledSensors: SensorDef[] = (vehicleType?.sensor_schema ?? []).filter(
    s => s.gauge_type === 'led' && (s.category ?? 'maquina') === 'maquina'
  )
  const equipRows: string[] = []
  if (status.pto_active != null) {
    const a = status.pto_active
    equipRows.push(`<tr><td style="padding:3px 8px 3px 0;font-size:12px;color:${T_MUTED}">PTO</td><td style="padding:3px 0;font-size:12px;color:${a ? 'var(--ok)' : T_MUTED};font-weight:${a ? 500 : 400}">${a ? 'Activo' : 'Inactivo'}</td></tr>`)
  }
  for (const s of ledSensors) {
    const raw = status.can_data?.[s.key]
    const a: boolean | null = raw == null ? null : s.bit_index !== undefined ? ((Number(raw) >> s.bit_index) & 1) === 1 : Boolean(raw)
    equipRows.push(`<tr><td style="padding:3px 8px 3px 0;font-size:12px;color:${T_MUTED}">${s.label}</td><td style="padding:3px 0;font-size:12px;color:${a === true ? 'var(--ok)' : T_MUTED};font-weight:${a === true ? 500 : 400}">${a === null ? '—' : a ? 'Activo' : 'Inactivo'}</td></tr>`)
  }
  const equipHtml = equipRows.length === 0
    ? `<div style="font-size:11px;color:${T_MUTED};font-style:italic">Sin equipo configurado</div>`
    : `<table style="width:100%;border-collapse:collapse">${equipRows.join('')}</table>`
  const equipSection = `<div style="font-size:10px;color:${T_MUTED};font-weight:600;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px">Equipo industrial</div>${equipHtml}`

  return `
    <div data-popup-root style="min-width:280px;max-width:340px;font-family:var(--font-sans,sans-serif);border-left:3px solid ${borderColor};overflow:hidden">
      ${offlineBand}
      <div style="padding:12px 14px 10px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px">
          <span style="font-weight:500;font-size:13px;color:#111827">${vehicle.name}</span>
          <span style="font-size:11px;color:${T_MUTED};margin-left:8px">${vehicle.license_plate ?? ''}</span>
        </div>
        <div style="font-size:11px;color:${T_MUTED};margin-bottom:${chips ? '8px' : '10px'}">${clientName}</div>
        ${chipsRow}
        <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
          <tr>
            <td style="padding:2px 8px 2px 0;color:${T_MUTED}">👤</td>
            <td style="padding:2px 8px 2px 0;font-size:12px;color:${T_MUTED};white-space:nowrap">Conductor</td>
            <td style="padding:2px 0">${driverCell}</td>
          </tr>
          <tr>
            <td style="padding:2px 8px 2px 0;color:${T_MUTED}">●</td>
            <td style="padding:2px 8px 2px 0;font-size:12px;color:${T_MUTED};white-space:nowrap">Estado</td>
            <td style="padding:2px 0">${stateCell}</td>
          </tr>
          <tr>
            <td style="padding:2px 8px 2px 0;color:${T_MUTED}">🕐</td>
            <td style="padding:2px 8px 2px 0;font-size:12px;color:${T_MUTED};white-space:nowrap">Última señal</td>
            <td style="padding:2px 0;font-size:12px;color:${T_MUTED}">${formatLastSeen(status.last_seen)}</td>
          </tr>
        </table>
        <div style="display:flex;gap:8px">
          <button
            data-popup-action="toggle-more"
            data-vehicle-id="${vehicle.id}"
            style="flex:1;padding:6px 0;border:1px solid #d1d5db;background:transparent;border-radius:6px;font-size:12px;cursor:pointer;color:#374151">
            Ver más ↓
          </button>
          <a href="/vehicles/${vehicle.id}"
            style="flex:1;padding:6px 0;text-align:center;background:var(--cmg-teal,#1D9E75);color:#000;text-decoration:none;border-radius:6px;font-size:12px;font-weight:600;display:inline-block">
            Detalle →
          </a>
        </div>
        <div data-popup-section="more" style="display:none;border-top:1px solid #e2e8f0;margin-top:10px;padding-top:10px">
          ${equipSection}
        </div>
      </div>
    </div>
  `
}

interface FleetMapProps {
  vehicles: VehicleOut[]
  statuses: Map<string, VehicleStatus>
  vehicleTypes?: VehicleTypeOut[]
  firingAlerts?: AlertInstanceOut[]
  rules?: RuleOut[]
  workOrders?: WorkOrderOut[]
  tenantNames?: Map<string, string>
}

export default function FleetMap({ vehicles, statuses, firingAlerts = [], rules = [], workOrders = [], tenantNames = new Map(), vehicleTypes = [] }: FleetMapProps) {
  const navigate = useNavigate()
  const { selectedId } = useFleetStore()
  const mapRef = useRef<L.Map | null>(null)
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  // Círculos de precisión GPS por vehículo
  const circlesRef = useRef<Map<string, L.Circle>>(new Map())
  const geofenceLayerRef = useRef<L.LayerGroup | null>(null)
  const orderLayerRef    = useRef<L.LayerGroup | null>(null)
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
    const rulesById = new Map(rules.map(r => [r.id, r]))

    // Add/update markers and GPS accuracy circles
    for (const vehicle of validVehicles) {
      const status = statuses.get(vehicle.id)!
      const lat = status.lat!
      const lon = status.lon!
      const latlng: [number, number] = [lat, lon]
      const hasAlert = alertVehicleIds.has(vehicle.id)
      const online = isEffectivelyOnline(status)
      const icon = makeVehicleIcon(status, hasAlert)
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
