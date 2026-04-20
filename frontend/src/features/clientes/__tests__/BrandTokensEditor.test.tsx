import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BrandTokensEditor from '../BrandTokensEditor'

vi.mock('../../../lib/apiClient', () => ({ apiClient: { get: vi.fn(), put: vi.fn() } }))

import { apiClient } from '../../../lib/apiClient'

function wrap() {
  vi.mocked(apiClient.get).mockResolvedValue({ brand_color: '#F97316', brand_name: 'Wasterent', logo_url: '' })
  vi.mocked(apiClient.put).mockResolvedValue({})
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter><BrandTokensEditor tenantId="t1" /></MemoryRouter></QueryClientProvider>)
}

describe('BrandTokensEditor', () => {
  it('muestra nombre de marca en preview', async () => {
    wrap()
    expect(await screen.findByText('Wasterent')).toBeInTheDocument()
  })

  it('llama a PUT al guardar', async () => {
    wrap()
    fireEvent.click(await screen.findByText('Guardar'))
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      '/api/v1/tenants/t1/brand-tokens',
      expect.objectContaining({ brand_tokens: expect.objectContaining({ brand_color: expect.any(String) }) })
    ))
  })
})
