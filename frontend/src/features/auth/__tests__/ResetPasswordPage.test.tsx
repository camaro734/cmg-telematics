import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ResetPasswordPage from '../ResetPasswordPage'

vi.mock('../../../lib/apiClient', () => ({ apiClient: { post: vi.fn() } }))
vi.mock('../../../shared/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
import { apiClient } from '../../../lib/apiClient'

function renderAt(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/reset-password/${token}`]}>
      <Routes>
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        <Route path="/login" element={<div>Login</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ResetPasswordPage', () => {
  it('no envía si las contraseñas no coinciden', async () => {
    renderAt('tok')
    fireEvent.change(screen.getByLabelText(/nueva contraseña/i), { target: { value: 'nuevapass123' } })
    fireEvent.change(screen.getByLabelText(/repetir/i), { target: { value: 'otracosa999' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    expect(await screen.findByText(/no coinciden/i)).toBeInTheDocument()
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('no envía si la contraseña es demasiado corta', async () => {
    renderAt('tok')
    fireEvent.change(screen.getByLabelText(/nueva contraseña/i), { target: { value: 'abc' } })
    fireEvent.change(screen.getByLabelText(/repetir/i), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    expect(await screen.findByText(/al menos 8/i)).toBeInTheDocument()
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('envía token y nueva contraseña cuando es válida', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ detail: 'ok' })
    renderAt('tok')
    fireEvent.change(screen.getByLabelText(/nueva contraseña/i), { target: { value: 'nuevapass123' } })
    fireEvent.change(screen.getByLabelText(/repetir/i), { target: { value: 'nuevapass123' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/auth/reset-password', { token: 'tok', new_password: 'nuevapass123' },
    ))
  })
})
