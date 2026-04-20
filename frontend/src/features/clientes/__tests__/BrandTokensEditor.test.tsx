import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BrandTokensEditor from '../BrandTokensEditor'

const mockApplyBrandTokens = vi.hoisted(() => vi.fn())

vi.mock('../../../lib/apiClient', () => ({ apiClient: { get: vi.fn(), put: vi.fn() } }))

vi.mock('../../auth/useAuthStore', () => {
  const useAuthStore: any = vi.fn(() => ({ user: { tenant_id: 't1' } }))
  useAuthStore.getState = vi.fn(() => ({
    user: { tenant_id: 't1' },
    applyBrandTokens: mockApplyBrandTokens,
  }))
  return { useAuthStore }
})

import { apiClient } from '../../../lib/apiClient'

function wrap(tenantId = 't1') {
  vi.mocked(apiClient.get).mockResolvedValue({ brand_color: '#F97316', brand_name: 'Wasterent', logo_url: '' })
  vi.mocked(apiClient.put).mockResolvedValue({})
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BrandTokensEditor tenantId={tenantId} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => { mockApplyBrandTokens.mockClear() })

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

  it('aplica brand tokens al guardar cuando tenantId es el propio tenant', async () => {
    wrap('t1')
    fireEvent.click(await screen.findByText('Guardar'))
    await waitFor(() => expect(mockApplyBrandTokens).toHaveBeenCalledWith(
      expect.objectContaining({ brand_color: expect.any(String) })
    ))
  })

  it('no aplica brand tokens al guardar cuando tenantId es de otro tenant', async () => {
    wrap('otro-tenant')
    fireEvent.click(await screen.findByText('Guardar'))
    await waitFor(() => expect(apiClient.put).toHaveBeenCalled())
    await waitFor(() => {
      expect(mockApplyBrandTokens).not.toHaveBeenCalled()
    })
  })
})
