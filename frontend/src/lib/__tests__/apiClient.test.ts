import { describe, it, expect, vi, afterEach } from 'vitest'
import { apiClient } from '../apiClient'

// Regresión del bug "vehículo no encontrado": apiClient lanzaba Error SIN `.status`,
// así que el supresor de toasts 401/403/404 (main.tsx) y la política de no-retry se
// saltaban. El error debe llevar el código HTTP adjunto.

function mockFetch(status: number, body: string) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'err',
    text: async () => body,
  })))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiClient adjunta .status al error', () => {
  it('404 con detail JSON → error.status=404 y message=detail', async () => {
    mockFetch(404, JSON.stringify({ detail: 'Vehículo no encontrado' }))
    const err = await apiClient.get('/api/v1/vehicles/x/commands').catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as { status?: number }).status).toBe(404)
    expect((err as Error).message).toBe('Vehículo no encontrado')
  })

  it('403 → error.status=403', async () => {
    mockFetch(403, JSON.stringify({ detail: 'prohibido' }))
    const err = await apiClient.get('/x').catch(e => e)
    expect((err as { status?: number }).status).toBe(403)
  })

  it('cuerpo no-JSON → error.status presente con el texto plano', async () => {
    mockFetch(500, 'Internal Server Error')
    const err = await apiClient.get('/x').catch(e => e)
    expect((err as { status?: number }).status).toBe(500)
    expect((err as Error).message).toBe('Internal Server Error')
  })
})
