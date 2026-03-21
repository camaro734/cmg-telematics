import { useEffect, useRef, useCallback } from 'react'

export interface WsTelemetryMessage {
  type?: undefined
  device_id: string
  vehicle_id: string
  imei: string
  time: string
  lat: number | null
  lng: number | null
  speed: number
  ignition: boolean
  ext_voltage_mv: number
  dout1: boolean
  dout2: boolean
  io_data: Record<string, number>
}

export interface WsAlertMessage {
  type: 'alert'
  alert_id: string
  device_id: string
  vehicle_id: string
  imei: string
  io_key: string
  display_name: string
  level: 'high' | 'low'
  converted_value: number
  threshold: number
  unit: string
  fired_at: string
}

export type WsMessage = WsTelemetryMessage | WsAlertMessage

export function useFleetWebSocket(
  onTelemetry: (data: WsTelemetryMessage) => void,
  onAlert?: (data: WsAlertMessage) => void
) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectDelay = useRef(3000)
  const mountedRef = useRef(true)
  const onTelemetryRef = useRef(onTelemetry)
  onTelemetryRef.current = onTelemetry
  const onAlertRef = useRef(onAlert)
  onAlertRef.current = onAlert

  const connect = useCallback(() => {
    if (!mountedRef.current) return

    const token = localStorage.getItem('cmg_token')
    if (!token) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const ws = new WebSocket(`${protocol}//${host}/ws/fleet?token=${token}`)
    wsRef.current = ws

    ws.onopen = () => {
      reconnectDelay.current = 3000
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WsMessage
        if (data.type === 'alert') {
          onAlertRef.current?.(data as WsAlertMessage)
        } else {
          onTelemetryRef.current(data as WsTelemetryMessage)
        }
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      reconnectTimeout.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, 30000)
        connect()
      }, reconnectDelay.current)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current)
      wsRef.current?.close()
    }
  }, [connect])
}
