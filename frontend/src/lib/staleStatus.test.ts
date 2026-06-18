import { describe, it, expect } from 'vitest'
import { isOutOfService, isOnline } from './staleStatus'

describe('out of service', () => {
  it('isOutOfService true cuando el device está fuera de servicio', () => {
    expect(isOutOfService({ device_out_of_service: true } as never)).toBe(true)
  })
  it('isOnline es false si está fuera de servicio aunque el dato sea fresco', () => {
    const fresh = new Date().toISOString()
    expect(isOnline({ device_out_of_service: true, last_seen: fresh, ignition: false } as never)).toBe(false)
  })
})
