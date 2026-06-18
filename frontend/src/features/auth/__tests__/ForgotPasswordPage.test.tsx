import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ForgotPasswordPage from '../ForgotPasswordPage'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: { post: vi.fn() },
}))
import { apiClient } from '../../../lib/apiClient'

function renderPage() {
  return render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)
}

describe('ForgotPasswordPage', () => {
  it('envía el email y muestra el mensaje genérico de confirmación', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ detail: 'ok' })
    renderPage()
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } })
    fireEvent.click(screen.getByRole('button', { name: /enviar enlace/i }))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/auth/forgot-password', { email: 'a@b.com' },
    ))
    expect(await screen.findByText(/si el correo está registrado/i)).toBeInTheDocument()
  })

  it('muestra el mensaje genérico aunque la llamada a la API falle (anti-enumeración)', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('Error de red'))
    renderPage()
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'b@c.com' } })
    fireEvent.click(screen.getByRole('button', { name: /enviar enlace/i }))
    expect(await screen.findByText(/si el correo está registrado/i)).toBeInTheDocument()
  })
})
