import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  url: string
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  close = vi.fn(() => { this.onclose?.() })
}

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function getClient() {
  vi.resetModules()
  const mod = await import('../wsClient')
  return mod.wsClient
}

describe('wsClient', () => {
  it('abre conexión WebSocket con la URL correcta', async () => {
    const client = await getClient()
    client.connect('my-token', new QueryClient())
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0].url).toContain('/ws/fleet?token=my-token')
  })

  it('no abre segunda conexión si ya está conectada', async () => {
    const client = await getClient()
    const qc = new QueryClient()
    client.connect('token', qc)
    client.connect('token', qc)
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('inyecta VehicleStatus en queryClient al recibir telemetría', async () => {
    const client = await getClient()
    const qc = new QueryClient()
    client.connect('token', qc)

    const ws = MockWebSocket.instances[0]
    const status = {
      vehicle_id: 'v-abc',
      online: true,
      last_seen: '2026-04-19T10:00:00Z',
      lat: 39.5,
      lon: -0.4,
      speed_kmh: 60,
      ignition: true,
      pto_active: false,
      can_data: { avl_305: 390 },
    }
    ws.onmessage?.({ data: JSON.stringify({ type: 'telemetry', data: status }) })

    const cached = qc.getQueryData(['vehicles', 'v-abc', 'status'])
    expect(cached).toMatchObject({ vehicle_id: 'v-abc', speed_kmh: 60 })
  })

  it('preserva el último valor bueno cuando el WS envía un campo como null', async () => {
    const client = await getClient()
    const qc = new QueryClient()
    client.connect('token', qc)
    const ws = MockWebSocket.instances[0]

    // Primer paquete: con tensión
    ws.onmessage?.({ data: JSON.stringify({ type: 'telemetry', data: {
      vehicle_id: 'v-abc', online: true, last_seen: '2026-06-15T08:00:00Z',
      lat: 39.5, lon: -0.4, speed_kmh: 0, ignition: true, pto_active: true,
      ext_voltage_mv: 13613, can_data: {},
    } }) })
    // Segundo paquete: sin tensión (ext_voltage_mv null) — no debe borrar el 13613
    ws.onmessage?.({ data: JSON.stringify({ type: 'telemetry', data: {
      vehicle_id: 'v-abc', online: true, last_seen: '2026-06-15T08:00:05Z',
      lat: 39.5, lon: -0.4, speed_kmh: 0, ignition: true, pto_active: true,
      ext_voltage_mv: null, can_data: {},
    } }) })

    const cached = qc.getQueryData(['vehicles', 'v-abc', 'status']) as { ext_voltage_mv: number; last_seen: string }
    expect(cached.ext_voltage_mv).toBe(13613)
    expect(cached.last_seen).toBe('2026-06-15T08:00:05Z')  // los campos no-null sí se actualizan
  })

  it('llama a los callbacks de onTelemetry', async () => {
    const client = await getClient()
    const qc = new QueryClient()
    client.connect('token', qc)

    const cb = vi.fn()
    client.onTelemetry(cb)

    const ws = MockWebSocket.instances[0]
    const status = {
      vehicle_id: 'v-1', online: true, last_seen: null,
      lat: null, lon: null, speed_kmh: 0,
      ignition: false, pto_active: false, can_data: {},
    }
    ws.onmessage?.({ data: JSON.stringify({ type: 'telemetry', data: status }) })

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ vehicle_id: 'v-1' }))
  })

  it('reconecta tras close con delay de 1s', async () => {
    const client = await getClient()
    client.connect('token', new QueryClient())
    expect(MockWebSocket.instances).toHaveLength(1)

    // Simular que el servidor cierra la conexión
    const firstSocket = MockWebSocket.instances[0]
    firstSocket.close = vi.fn()  // prevent the mock close from calling onclose again
    firstSocket.onclose?.()

    // Aún no reconecta (necesita el tick del timer)
    expect(MockWebSocket.instances).toHaveLength(1)

    vi.advanceTimersByTime(1_100)
    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('disconnect cancela la reconexión y cierra el socket', async () => {
    const client = await getClient()
    client.connect('token', new QueryClient())
    expect(MockWebSocket.instances).toHaveLength(1)

    client.disconnect()
    expect(MockWebSocket.instances[0].close).toHaveBeenCalled()

    // No se reconecta después de disconnect
    vi.advanceTimersByTime(5_000)
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('elimina el listener al llamar el unsubscribe devuelto por onTelemetry', async () => {
    const client = await getClient()
    const qc = new QueryClient()
    client.connect('token', qc)

    const cb = vi.fn()
    const unsub = client.onTelemetry(cb)
    unsub()

    const ws = MockWebSocket.instances[0]
    const status = {
      vehicle_id: 'v-1', online: true, last_seen: null,
      lat: null, lon: null, speed_kmh: 0,
      ignition: false, pto_active: false, can_data: {},
    }
    ws.onmessage?.({ data: JSON.stringify({ type: 'telemetry', data: status }) })

    expect(cb).not.toHaveBeenCalled()
  })
})
