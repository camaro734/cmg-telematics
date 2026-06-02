import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ActivityDrawer from '../ActivityDrawer'
import type { CommandLogEntry } from '../../../lib/types'

const mockCommands: CommandLogEntry[] = [
  {
    id: 'cmd-1',
    device_id: 'dev-1',
    vehicle_id: 'veh-1',
    tenant_id: 'ten-1',
    command: 'DOUT1:1',
    status: 'confirmed',
    sent_at: new Date(Date.now() - 90_000).toISOString(),
    response: 'OK',
    error_message: null,
  },
  {
    id: 'cmd-2',
    device_id: 'dev-1',
    vehicle_id: 'veh-1',
    tenant_id: 'ten-1',
    command: 'DOUT2:0',
    status: 'failed',
    sent_at: new Date(Date.now() - 3_600_000).toISOString(),
    response: null,
    error_message: 'Timeout al enviar',
  },
]

describe('ActivityDrawer', () => {
  it('muestra comandos cuando está abierto', () => {
    render(<ActivityDrawer isOpen={true} onClose={vi.fn()} commands={mockCommands} />)
    expect(screen.getByText('DOUT1:1')).toBeInTheDocument()
    expect(screen.getByText('DOUT2:0')).toBeInTheDocument()
  })

  it('no muestra contenido del panel cuando está cerrado', () => {
    render(<ActivityDrawer isOpen={false} onClose={vi.fn()} commands={mockCommands} />)
    // El panel existe en el DOM pero está fuera de pantalla (translateX 100%)
    // El backdrop no debe estar visible
    expect(screen.queryByTestId('activity-drawer-backdrop')).toBeNull()
  })

  it('muestra estado vacío cuando no hay comandos', () => {
    render(<ActivityDrawer isOpen={true} onClose={vi.fn()} commands={[]} />)
    expect(screen.getByText('Sin actividad registrada')).toBeInTheDocument()
  })

  it('muestra el error_message en rojo cuando existe', () => {
    render(<ActivityDrawer isOpen={true} onClose={vi.fn()} commands={mockCommands} />)
    expect(screen.getByText(/Timeout al enviar/)).toBeInTheDocument()
  })

  it('muestra la respuesta del comando cuando existe', () => {
    render(<ActivityDrawer isOpen={true} onClose={vi.fn()} commands={mockCommands} />)
    expect(screen.getByText(/→ OK/)).toBeInTheDocument()
  })

  it('llama onClose al hacer click en el backdrop', () => {
    const onClose = vi.fn()
    render(<ActivityDrawer isOpen={true} onClose={onClose} commands={[]} />)
    fireEvent.click(screen.getByTestId('activity-drawer-backdrop'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('llama onClose al hacer click en el botón X', () => {
    const onClose = vi.fn()
    render(<ActivityDrawer isOpen={true} onClose={onClose} commands={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('llama onClose al pulsar Escape', () => {
    const onClose = vi.fn()
    render(<ActivityDrawer isOpen={true} onClose={onClose} commands={[]} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
