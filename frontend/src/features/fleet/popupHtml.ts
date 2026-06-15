import { isEffectivelyOnline, statusStamp } from '../../lib/staleStatus'
import { resolveRawValue, applyTransform, formatSensorValue } from '../../lib/sensorValue'
import type { VehicleOut, VehicleStatus, AlertInstanceOut, RuleOut, VehicleTypeOut, SensorDef } from '../../lib/types'
import { T_OK, T_WARN, T_CRIT, T_OFF, T_MUTED } from './mapTokens'

// Valor de un sensor para mostrar en el popup: aplica la transformación
// (rango lineal o scale/offset) y añade la unidad. "—" si no hay dato.
export function sensorDisplayValue(s: SensorDef, status: VehicleStatus): string {
  const raw = resolveRawValue(s, status, {})
  if (raw == null) return '—'
  if (s.gauge_type === 'led') return raw !== 0 ? 'Activo' : 'Inactivo'
  const scaled = applyTransform(raw, s)
  if (scaled == null || !isFinite(scaled)) return '—'
  return (formatSensorValue(scaled) ?? '—') + (s.unit ? ` ${s.unit}` : '')
}

// Color del sensor según umbrales sobre el valor ya transformado.
export function sensorColor(s: SensorDef, status: VehicleStatus): string {
  const raw = resolveRawValue(s, status, {})
  if (raw == null) return T_OFF
  if (s.gauge_type === 'led') return raw !== 0 ? T_OK : T_OFF
  const num = applyTransform(raw, s)
  if (num == null || !isFinite(num)) return T_OFF
  if ((s.alert_above !== undefined && num >= s.alert_above) ||
      (s.alert_below !== undefined && num <= s.alert_below)) return T_CRIT
  if ((s.warn_above  !== undefined && num >= s.warn_above)  ||
      (s.warn_below  !== undefined && num <= s.warn_below))  return T_WARN
  return T_OK
}

function formatLastSeen(lastSeen: string | null): string {
  if (!lastSeen) return 'Sin datos'
  const d = new Date(lastSeen)
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

export function buildPopupHtml(
  vehicle: VehicleOut,
  status: VehicleStatus,
  vehicleAlerts: AlertInstanceOut[],
  tenantNames: Map<string, string>,
  rulesById: Map<string, RuleOut>,
  vehicleType: VehicleTypeOut | undefined
): string {
  const clientName = tenantNames.get(vehicle.tenant_id) ?? '—'
  const online = isEffectivelyOnline(status)
  const stale = !online

  // Severidad peor de las alertas activas del vehículo
  let worstSev: '' | 'warning' | 'critical' = ''
  for (const a of vehicleAlerts) {
    const sev = rulesById.get(a.rule_id)?.severity
    if (sev === 'critical') { worstSev = 'critical'; break }
    if (sev === 'warning') worstSev = 'warning'
  }
  const borderColor = worstSev === 'critical' ? 'var(--danger)' : worstSev === 'warning' ? 'var(--warn)' : 'transparent'

  // Banda stale — sustituye la banda "Sin señal" anterior, cubre mismo umbral
  const _stamp = stale ? statusStamp(status) : null
  const staleBand = _stamp
    ? `<div style="background:rgba(100,116,139,0.1);color:${_stamp.hexColor};padding:5px 14px;font-size:11px;font-weight:600;border-bottom:1px solid rgba(100,116,139,0.2)">${_stamp.text}</div>`
    : ''

  // Contador de alertas — enlace a la página de Alertas
  const alertCount = vehicleAlerts.length
  const alertRow = alertCount > 0
    ? `<a href="/alerts?vehicle=${vehicle.id}" style="display:inline-flex;align-items:center;gap:4px;margin-bottom:10px;font-size:12px;font-weight:600;color:var(--danger);text-decoration:none">⚠ ${alertCount} alerta${alertCount > 1 ? 's' : ''} — Ver →</a>`
    : ''

  // Sensores configurados para mostrar en popup (compacto, siempre visible)
  const popupSensors = (vehicleType?.sensor_schema ?? []).filter(s => s.show_in_popup === true)
  const sensorRows = popupSensors.map(s => {
    const val = sensorDisplayValue(s, status)
    const col = stale ? T_OFF : sensorColor(s, status)
    return `<tr>
      <td style="padding:2px 0 2px 0;width:8px"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${col};flex-shrink:0;margin-top:1px"></span></td>
      <td style="padding:2px 8px 2px 6px;font-size:12px;color:#6b7280;white-space:nowrap">${s.label}</td>
      <td style="padding:2px 0;font-size:12px;font-family:var(--font-mono,monospace);font-weight:600;color:${col}">${val}</td>
    </tr>`
  }).join('')
  const sensorBlock = sensorRows.length > 0
    ? `<table style="width:100%;border-collapse:collapse;margin-bottom:10px">${sensorRows}</table>`
    : ''

  // Sensores numéricos del tipo (visibles en detalle) — bloque desplegable "Ver más".
  // Resuelve y transforma cada valor (rango lineal / scale-offset).
  const detailSensors = (vehicleType?.sensor_schema ?? []).filter(
    s => s.visible_in_detail !== false && s.gauge_type !== 'led'
  )
  const detailRows = detailSensors.map(s => {
    const val = sensorDisplayValue(s, status)
    const col = stale ? T_OFF : sensorColor(s, status)
    return `<tr>
      <td style="padding:2px 8px 2px 0;font-size:12px;color:#6b7280;white-space:nowrap">${s.label}</td>
      <td style="padding:2px 0;font-size:12px;font-family:var(--font-mono,monospace);font-weight:600;color:${col};text-align:right">${val}</td>
    </tr>`
  }).join('')
  const detailBlock = detailRows
    ? `<div style="font-size:10px;color:${T_MUTED};font-weight:600;letter-spacing:0.06em;text-transform:uppercase;margin:0 0 6px">Sensores</div><table style="width:100%;border-collapse:collapse;margin-bottom:10px">${detailRows}</table>`
    : ''

  // Tabla compacta — fondo blanco del popup nativo de Leaflet: usar colores oscuros para contraste
  const driverCell = vehicle.driver_name
    ? `<span style="color:#111827;font-size:12px">${vehicle.driver_name}</span>`
    : `<span style="color:${T_MUTED};font-style:italic;font-size:12px">Sin conductor asignado</span>`
  const stateCell = online
    ? `<span style="color:var(--ok);font-size:12px;font-weight:500;display:inline-flex;align-items:center;gap:3px"><i class="ti ti-antenna-bars-5" style="font-size:13px"></i>En línea</span>`
    : `<span style="color:#9ca3af;font-size:12px;display:inline-flex;align-items:center;gap:3px"><i class="ti ti-antenna-bars-off" style="font-size:13px"></i>Sin señal</span>`

  // Equipo industrial (Bloque 4) — sin color "activo" si datos no actuales
  const ledSensors: SensorDef[] = (vehicleType?.sensor_schema ?? []).filter(
    s => s.gauge_type === 'led' && (s.category ?? 'maquina') === 'maquina'
  )
  const equipRows: string[] = []
  if (status.pto_active != null) {
    const a = status.pto_active
    const ptoCol = stale ? T_MUTED : (a ? 'var(--ok)' : T_MUTED)
    equipRows.push(`<tr><td style="padding:3px 8px 3px 0;font-size:12px;color:${T_MUTED}">PTO</td><td style="padding:3px 0;font-size:12px;color:${ptoCol};font-weight:${(!stale && a) ? 500 : 400}">${a ? 'Activo' : 'Inactivo'}</td></tr>`)
  }
  for (const s of ledSensors) {
    const raw = resolveRawValue(s, status, {})
    const a: boolean | null = raw == null ? null : s.bit_index !== undefined ? ((Number(raw) >> s.bit_index) & 1) === 1 : Boolean(raw)
    const ledCol = stale ? T_MUTED : (a === true ? 'var(--ok)' : T_MUTED)
    equipRows.push(`<tr><td style="padding:3px 8px 3px 0;font-size:12px;color:${T_MUTED}">${s.label}</td><td style="padding:3px 0;font-size:12px;color:${ledCol};font-weight:${(!stale && a === true) ? 500 : 400}">${a === null ? '—' : a ? 'Activo' : 'Inactivo'}</td></tr>`)
  }
  const equipHtml = equipRows.length === 0
    ? `<div style="font-size:11px;color:${T_MUTED};font-style:italic">Sin equipo configurado</div>`
    : `<table style="width:100%;border-collapse:collapse">${equipRows.join('')}</table>`
  const equipSection = `<div style="font-size:10px;color:${T_MUTED};font-weight:600;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px">Equipo industrial</div>${equipHtml}`

  return `
    <div data-popup-root style="min-width:280px;max-width:340px;font-family:var(--font-sans,sans-serif);border-left:3px solid ${borderColor};overflow:hidden">
      ${staleBand}
      <div style="padding:12px 14px 10px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px">
          <span style="font-weight:500;font-size:13px;color:#111827">${vehicle.name}</span>
          <span style="font-size:11px;color:${T_MUTED};margin-left:8px">${vehicle.license_plate ?? ''}</span>
        </div>
        <div style="font-size:11px;color:${T_MUTED};margin-bottom:${alertCount > 0 ? '8px' : '10px'}">${clientName}</div>
        ${alertRow}
        ${sensorBlock}
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
          ${detailBlock}${equipSection}
        </div>
      </div>
    </div>
  `
}
