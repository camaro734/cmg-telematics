import type { QueryClient } from '@tanstack/react-query'
import type { WsMessage } from './types'
import { keys } from './queryKeys'

import type { VehicleStatus } from './types'

const RECONNECT_MAX_MS = 30_000

type TelemetryCallback = (data: VehicleStatus) => void

class WsClientImpl {
  private socket: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1_000
  private token: string | null = null
  private queryClient: QueryClient | null = null
  private listeners = new Set<TelemetryCallback>()

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
    }

    this.socket.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as WsMessage
        if (msg.type === 'telemetry' && msg.data) {
          this.queryClient?.setQueryData(keys.vehicleStatus(msg.data.vehicle_id), msg.data)
          this.listeners.forEach(cb => cb(msg.data))
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
