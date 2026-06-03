import type { VehicleStatus } from './types'

/** Mismo umbral que FleetMap: 70 min con motor, 62 min sin motor. */
export function isEffectivelyOnline(status: VehicleStatus | null | undefined): boolean {
  if (!status?.last_seen) return false
  const ms = Date.now() - new Date(status.last_seen).getTime()
  const threshold = status.ignition ? 70 * 60_000 : 62 * 60_000
  return ms < threshold
}

/** Sello de datos no actuales con hora del último dato. */
export function staleStamp(lastSeen: string | null): string {
  if (!lastSeen) return '⏱ Datos no actuales · sin datos'
  const time = new Date(lastSeen).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  return `⏱ Datos no actuales · último dato ${time}`
}
