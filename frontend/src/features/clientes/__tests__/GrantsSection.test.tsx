import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import GrantsSection from '../GrantsSection'
import type { GrantOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))

import { apiClient } from '../../../lib/apiClient'

const grant: GrantOut = { id: 'g1', grantor_id: 't0', grantee_id: 't1', resource_type: 'maintenance', resource_id: null, allowed_actions: ['log'], constraints: null, granted_at: '2026-01-01T00:00:00Z', expires_at: null, active: true }

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter><GrantsSection tenantId="t1" /></MemoryRouter></QueryClientProvider>)
}

describe('GrantsSection', () => {
  it('muestra grants existentes', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([grant])
    wrap()
    expect(await screen.findByText('maintenance')).toBeInTheDocument()
  })

  it('llama a POST al añadir grant', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([])
    vi.mocked(apiClient.post).mockResolvedValue(grant)
    wrap()
    fireEvent.click(await screen.findByText('Añadir'))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/grants',
      expect.objectContaining({ grantee_id: 't1', resource_type: 'maintenance' })
    ))
  })

  it('llama a DELETE al revocar', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([grant])
    vi.mocked(apiClient.delete).mockResolvedValue(undefined)
    wrap()
    fireEvent.click(await screen.findByText('Revocar'))
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/grants/g1'))
  })
})
