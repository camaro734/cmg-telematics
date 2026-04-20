import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import UserFormModal from '../UserFormModal'
import type { UserOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({ apiClient: { post: vi.fn(), put: vi.fn() } }))

import { apiClient } from '../../../lib/apiClient'

const existingUser: UserOut = { id: 'u1', tenant_id: 't1', email: 'op@w.com', full_name: 'Operador', role: 'operator', active: true, created_at: '2026-01-01T00:00:00Z' }

function wrap(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>)
}

describe('UserFormModal', () => {
  it('llama a POST al crear con contraseña', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ ...existingUser, id: 'u-new' })
    wrap(<UserFormModal tenantId="t1" onClose={vi.fn()} />)

    // En modo creación: email, nombre completo y contraseña son visibles
    // Los <label> envuelven los inputs → getByLabelText usa el texto del <span> dentro
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'new@w.com' } })
    fireEvent.change(screen.getByLabelText(/nombre completo/i), { target: { value: 'Nuevo' } })
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'Pass1234!' } })
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/tenants/t1/users',
      expect.objectContaining({ email: 'new@w.com', password: 'Pass1234!' })
    ))
  })

  it('llama a PUT al editar sin campo contraseña', async () => {
    vi.mocked(apiClient.put).mockResolvedValue(existingUser)
    wrap(<UserFormModal tenantId="t1" user={existingUser} onClose={vi.fn()} />)
    // En modo edición no hay campo contraseña
    expect(screen.queryByLabelText(/contraseña/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      `/api/v1/users/${existingUser.id}`,
      expect.not.objectContaining({ password: expect.anything() })
    ))
  })
})
