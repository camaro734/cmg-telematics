import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BinaryIndicator } from '../BinaryIndicator'

describe('BinaryIndicator', () => {
  it('muestra "ON" cuando value es true', () => {
    render(<BinaryIndicator label="PTO" value={true} />)
    expect(screen.getByText('ON')).toBeInTheDocument()
  })

  it('muestra "OFF" cuando value es false', () => {
    render(<BinaryIndicator label="PTO" value={false} />)
    expect(screen.getByText('OFF')).toBeInTheDocument()
  })

  it('muestra "—" cuando value es null', () => {
    render(<BinaryIndicator label="PTO" value={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('muestra el label', () => {
    render(<BinaryIndicator label="Estado PTO" value={true} />)
    expect(screen.getByText('Estado PTO')).toBeInTheDocument()
  })

  it('respeta onLabel y offLabel personalizados', () => {
    render(<BinaryIndicator label="Compuerta" value={true} onLabel="Abierta" offLabel="Cerrada" />)
    expect(screen.getByText('Abierta')).toBeInTheDocument()
  })

  it('aplica color activo cuando value es true', () => {
    const { container } = render(<BinaryIndicator label="PTO" value={true} />)
    const pill = container.querySelector('[data-testid="binary-pill"]') as HTMLElement
    expect(pill.style.background).toBe('var(--cmg-teal-soft)')
  })

  it('aplica color atenuado cuando value es false', () => {
    const { container } = render(<BinaryIndicator label="PTO" value={false} />)
    const pill = container.querySelector('[data-testid="binary-pill"]') as HTMLElement
    expect(pill.style.background).toBe('var(--offline-soft)')
  })
})
