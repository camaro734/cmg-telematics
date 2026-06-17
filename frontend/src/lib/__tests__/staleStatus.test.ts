import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isFresh, isOnline } from '../staleStatus'
import type { VehicleStatus } from '../types'

// Reloj fijo para que los umbrales sean deterministas.
const NOW = new Date('2026-06-17T12:00:00.000Z').getTime()
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('isFresh — regla unificada de frescor por timestamp', () => {
  it('sin timestamp → no fresco', () => {
    expect(isFresh(null)).toBe(false)
    expect(isFresh(undefined)).toBe(false)
  })

  it('aparcado (sin ignición): válido hasta 60 min', () => {
    expect(isFresh(minsAgo(45))).toBe(true)   // transmite cada hora → sigue online
    expect(isFresh(minsAgo(75))).toBe(false)  // hace rato que no llega nada
  })

  it('con ignición ON: umbral estricto de 5 min', () => {
    expect(isFresh(minsAgo(3), true)).toBe(true)
    expect(isFresh(minsAgo(10), true)).toBe(false)
  })
})

describe('isOnline — usa el frescor del timestamp, no el flag crudo', () => {
  const base: VehicleStatus = {
    vehicle_id: 'v1', online: false, last_seen: null, device_last_seen: null,
    lat: null, lon: null, speed_kmh: null, heading: null, ignition: null,
    pto_active: null, ext_voltage_mv: null, can_data: null, dout_state: {},
  }

  it('online=false pero dato reciente → online (FMC650 cerró TCP tras el batch)', () => {
    expect(isOnline({ ...base, online: false, last_seen: minsAgo(10) })).toBe(true)
  })

  it('online=true pero dato viejo → offline (flag pegado)', () => {
    expect(isOnline({ ...base, online: true, last_seen: minsAgo(120) })).toBe(false)
  })

  it('prefiere device_last_seen sobre last_seen', () => {
    expect(isOnline({ ...base, device_last_seen: minsAgo(10), last_seen: minsAgo(200) })).toBe(true)
  })
})
