import type { VehicleStatus } from './types'

export const ONLINE_THRESHOLD_MIN = 60

/** Online si recibimos un paquete hace menos de 60 min.
 *  Usa device_last_seen (hora de recepción en servidor) con fallback a last_seen (fix GPS)
 *  para dispositivos que aún no han re-emitido con el publisher actualizado. */
export function isOnline(status: VehicleStatus | null | undefined): boolean {
  if (!status) return false
  const ts = status.device_last_seen ?? status.last_seen
  if (!ts) return false
  return Date.now() - new Date(ts).getTime() < ONLINE_THRESHOLD_MIN * 60_000
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
