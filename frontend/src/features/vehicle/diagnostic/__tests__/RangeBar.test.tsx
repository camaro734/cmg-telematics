import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RangeBar } from '../RangeBar'

describe('RangeBar', () => {
  it('muestra el valor y la unidad', () => {
    render(<RangeBar label="Presión" value={150} min={0} max={600} unit="bar" />)
    expect(screen.getByText('150 bar')).toBeInTheDocument()
  })

  it('muestra el label', () => {
    render(<RangeBar label="Presión bomba" value={150} min={0} max={600} unit="bar" />)
    expect(screen.getByText('Presión bomba')).toBeInTheDocument()
  })

  it('muestra "—" cuando value es null', () => {
    render(<RangeBar label="Presión" value={null} min={0} max={600} unit="bar" />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('aplica color verde cuando el valor está en zona ok', () => {
    const { container } = render(
      <RangeBar label="P" value={100} min={0} max={600} unit="bar" warnAbove={300} alertAbove={400} />
    )
    const fill = container.querySelector('[data-testid="rangebar-fill"]') as HTMLElement
    expect(fill.style.background).toBe('var(--ok)')
  })

  it('aplica color ámbar cuando el valor supera warnAbove', () => {
    const { container } = render(
      <RangeBar label="P" value={350} min={0} max={600} unit="bar" warnAbove={300} alertAbove={400} />
    )
    const fill = container.querySelector('[data-testid="rangebar-fill"]') as HTMLElement
    expect(fill.style.background).toBe('var(--warn)')
  })

  it('aplica color rojo cuando el valor supera alertAbove', () => {
    const { container } = render(
      <RangeBar label="P" value={450} min={0} max={600} unit="bar" warnAbove={300} alertAbove={400} />
    )
    const fill = container.querySelector('[data-testid="rangebar-fill"]') as HTMLElement
    expect(fill.style.background).toBe('var(--danger)')
  })

  it('aplica color rojo cuando el valor cae por debajo de alertBelow', () => {
    const { container } = render(
      <RangeBar label="Nivel" value={5} min={0} max={100} unit="%" warnBelow={20} alertBelow={10} />
    )
    const fill = container.querySelector('[data-testid="rangebar-fill"]') as HTMLElement
    expect(fill.style.background).toBe('var(--danger)')
  })

  it('aplica color ámbar cuando el valor cae por debajo de warnBelow', () => {
    const { container } = render(
      <RangeBar label="Nivel" value={15} min={0} max={100} unit="%" warnBelow={20} alertBelow={10} />
    )
    const fill = container.querySelector('[data-testid="rangebar-fill"]') as HTMLElement
    expect(fill.style.background).toBe('var(--warn)')
  })
})
