import type { QueryClient } from '@tanstack/react-query'
import type { WsMessage } from './types'
import { keys } from './queryKeys'

import type { VehicleStatus } from './types'

const RECONNECT_MAX_MS = 30_000

// Fusiona un parche de status sobre el anterior preservando los campos que el
// mensaje WS no aporta. Además NO sobrescribe con null/undefined: algunos campos
// (p. ej. ext_voltage_mv) llegan como null en paquetes que no incluyen esa
// lectura, pero el último valor bueno debe conservarse en lugar de borrarse en
// pantalla. El status individual (detalle) no se autorrecupera tan rápido como
// el bulk, así que sin esto el dato parpadea/desaparece.
function mergeStatus(old: VehicleStatus, data: VehicleStatus): VehicleStatus {
  const merged: Record<string, unknown> = { ...old }
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && value !== undefined) merged[key] = value
  }
  return merged as unknown as VehicleStatus
}

type TelemetryCallback = (data: VehicleStatus) => void
type ConnectionCallback = (connected: boolean) => void

class WsClientImpl {
  private socket: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1_000
  private token: string | null = null
  private queryClient: QueryClient | null = null
  private listeners = new Set<TelemetryCallback>()
  private connectionListeners = new Set<ConnectionCallback>()
  private _connected = false

  isConnected(): boolean {
    return this._connected
  }

  onConnectionChange(cb: ConnectionCallback): () => void {
    this.connectionListeners.add(cb)
    return () => { this.connectionListeners.delete(cb) }
  }

  private setConnected(value: boolean): void {
    if (this._connected === value) return
    this._connected = value
    this.connectionListeners.forEach(cb => cb(value))
  }

  connect(token: string, queryClient: QueryClient): void {
    if (this.socket) return
    this.token = token
    this.queryClient = queryClient
    this.open()
  }

  disconnect(): void {
    this.clearReconnect()
    this.token = null
    this.queryClient = null
    this.reconnectDelay = 1_000
    if (this.socket) {
      this.socket.onclose = null
      this.socket.close()
      this.socket = null
    }
    this.listeners.clear()
    this.connectionListeners.clear()
  }

  onTelemetry(cb: TelemetryCallback): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  private open(): void {
    if (!this.token) return
    this.clearReconnect()

    this.socket = new WebSocket(`/ws/fleet?token=${encodeURIComponent(this.token)}`)

    this.socket.onopen = () => {
      this.reconnectDelay = 1_000
      this.setConnected(true)
    }

    this.socket.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as WsMessage
        if (msg.type === 'telemetry' && msg.data) {
          const data = msg.data
          // Cache individual — lo lee VehicleDetailPage.
          // Merge en lugar de replace: preserva online/last_seen si el mensaje WS
          // no los incluye (evita parpadeo de "sin señal" entre paquetes).
          this.queryClient?.setQueryData(
            keys.vehicleStatus(data.vehicle_id),
            (old: VehicleStatus | undefined) => old ? mergeStatus(old, data) : data,
          )
          // Cache bulk — lo leen FleetMap y FleetDashboard.
          // Sin este patch, el bulk queda congelado (staleTime: Infinity) y
          // el mapa muestra "sin señal" mientras el detalle se ve online.
          this.queryClient?.setQueriesData<VehicleStatus[]>(
            { queryKey: ['vehicles', 'statuses'] },
            (old) => {
              if (!old) return old
              const idx = old.findIndex(s => s.vehicle_id === data.vehicle_id)
              if (idx === -1) return [...old, data]
              const next = old.slice()
              next[idx] = mergeStatus(next[idx], data)
              return next
            },
          )
          this.listeners.forEach(cb => cb(data))
        } else if (msg.type === 'alert') {
          // Invalida todas las queries de alertas para que el frontend refresque
          void this.queryClient?.invalidateQueries({ queryKey: ['alerts'] })
        }
      } catch {
        /* ignora mensajes malformados */
      }
    }

    this.socket.onerror = () => {
      // El navegador dispara onclose automáticamente después de onerror;
      // llamar close() explícitamente causaría un doble onclose y dos timers de reconexión
    }

    this.socket.onclose = () => {
      this.socket = null
      this.setConnected(false)
      const delay = this.reconnectDelay
      this.reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_MS)
      this.reconnectTimer = setTimeout(() => { this.open() }, delay)
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}

export const wsClient = new WsClientImpl()
