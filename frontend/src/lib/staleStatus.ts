import type { VehicleStatus } from './types'

/** Ignición ON: el FMC650 reporta cada ~30 s — consideramos offline si pasan más de 5 min. */
export const ONLINE_ACTIVE_MIN = 5
/** Parado/sleep: el dispositivo puede silenciarse hasta 60 min y seguir siendo válido. */
export const ONLINE_PARKED_MIN = 60

/** Online con umbral adaptativo según ignición.
 *  ignition=true  → umbral 5 min  (detección rápida de corte de corriente)
 *  ignition=false/undefined → umbral 60 min (vehículo aparcado en sleep mode) */
export function isOnline(status: VehicleStatus | null | undefined): boolean {
  if (!status) return false
  // Offline empujado explícitamente por el servidor (desconexión TCP o silencio)
  if (status.online === false) return false
  const ts = status.device_last_seen ?? status.last_seen
  if (!ts) return false
  const limitMin = status.ignition === true ? ONLINE_ACTIVE_MIN : ONLINE_PARKED_MIN
  return Date.now() - new Date(ts).getTime() < limitMin * 60_000
}

/** Alias para compatibilidad con los consumidores existentes. */
export const isEffectivelyOnline = isOnline

export type OfflineReason = 'no_power' | 'no_signal'

/** Clasifica el motivo de offline.
 *  no_power: voltaje externo presente y < 7 V (aplica a sistemas de 12 V y 24 V). */
export function offlineReason(status: VehicleStatus | null | undefined): OfflineReason {
  if (status?.ext_voltage_mv != null && status.ext_voltage_mv < 7000) return 'no_power'
  return 'no_signal'
}

/** Sello unificado offline — distingue "Sin alimentación" (⚡) de "Sin señal" (⏱).
 *  color: CSS variable lista para style={{color}} en JSX.
 *  hexColor: hex equivalente para strings HTML de Leaflet donde las CSS vars no están garantizadas. */
export function statusStamp(status: VehicleStatus | null | undefined): { text: string; color: string; hexColor: string } {
  const lastSeen = status?.device_last_seen ?? status?.last_seen ?? null
  const time = lastSeen
    ? new Date(lastSeen).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : null
  const suffix = time ? ` · último dato ${time}` : ' · sin datos'
  if (offlineReason(status) === 'no_power') {
    return { text: `⚡ Sin alimentación${suffix}`, color: 'var(--accent-crit)', hexColor: '#EF4444' }
  }
  return { text: `⏱ Sin señal${suffix}`, color: 'var(--fg-muted)', hexColor: '#9ca3af' }
}

/** @deprecated Usar statusStamp(status) para distinguir sin-alimentación vs sin-señal. */
export function staleStamp(lastSeen: string | null): string {
  if (!lastSeen) return '⏱ Datos no actuales · sin datos'
  const time = new Date(lastSeen).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  return `⏱ Datos no actuales · último dato ${time}`
}
