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
  const ts = status.device_last_seen ?? status.last_seen
  if (!ts) return false
  const limitMin = status.ignition === true ? ONLINE_ACTIVE_MIN : ONLINE_PARKED_MIN
  return Date.now() - new Date(ts).getTime() < limitMin * 60_000
}

/** Alias para compatibilidad con los consumidores existentes. */
export const isEffectivelyOnline = isOnline

/** Sello de datos no actuales con hora del último dato.
 *  Pasar device_last_seen ?? last_seen para mostrar la hora más reciente. */
export function staleStamp(lastSeen: string | null): string {
  if (!lastSeen) return '⏱ Datos no actuales · sin datos'
  const time = new Date(lastSeen).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  return `⏱ Datos no actuales · último dato ${time}`
}
