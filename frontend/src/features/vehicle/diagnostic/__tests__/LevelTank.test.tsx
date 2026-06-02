import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LevelTank } from '../LevelTank'

describe('LevelTank', () => {
  it('muestra el valor y la unidad', () => {
    render(<LevelTank label="Nivel aceite" value={80} min={0} max={100} unit="%" />)
    expect(screen.getByText(/80/)).toBeInTheDocument()
    expect(screen.getByText(/%/)).toBeInTheDocument()
  })

  it('muestra el label', () => {
    render(<LevelTank label="Nivel aceite" value={80} min={0} max={100} unit="%" />)
    expect(screen.getByText('Nivel aceite')).toBeInTheDocument()
  })

  it('muestra "—" cuando value es null', () => {
    render(<LevelTank label="Nivel aceite" value={null} min={0} max={100} unit="%" />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('aplica color verde cuando el valor está en zona ok', () => {
    const { container } = render(
      <LevelTank label="Nivel" value={80} min={0} max={100} unit="%" warnBelow={20} alertBelow={10} />
    )
    const fill = container.querySelector('[data-testid="leveltank-fill"]') as HTMLElement
    expect(fill.style.background).toBe('var(--ok)')
  })

  it('aplica color ámbar cuando el valor cae por debajo de warnBelow', () => {
    const { container } = render(
      <LevelTank label="Nivel" value={15} min={0} max={100} unit="%" warnBelow={20} alertBelow={10} />
    )
    const fill = container.querySelector('[data-testid="leveltank-fill"]') as HTMLElement
    expect(fill.style.background).toBe('var(--warn)')
  })

  it('aplica color rojo cuando el valor cae por debajo de alertBelow', () => {
    const { container } = render(
      <LevelTank label="Nivel" value={5} min={0} max={100} unit="%" warnBelow={20} alertBelow={10} />
    )
    const fill = container.querySelector('[data-testid="leveltank-fill"]') as HTMLElement
    expect(fill.style.background).toBe('var(--danger)')
  })

  it('el fill tiene altura proporcional al valor (80% → ~80%)', () => {
    const { container } = render(
      <LevelTank label="Nivel" value={80} min={0} max={100} unit="%" />
    )
    const fill = container.querySelector('[data-testid="leveltank-fill"]') as HTMLElement
    expect(fill.style.height).toBe('80%')
  })
})
