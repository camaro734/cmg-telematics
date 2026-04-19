import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import CircularGauge from '../CircularGauge'

describe('CircularGauge', () => {
  it('muestra el valor y max+unidad en el centro', () => {
    const { getByText } = render(
      <CircularGauge value={390} min={0} max={600} unit="bar" label="P. HIDRÁULICA 1" />
    )
    expect(getByText('390')).toBeInTheDocument()
    expect(getByText('/ 600 bar')).toBeInTheDocument()
  })

  it('muestra el label inferior', () => {
    const { getByText } = render(
      <CircularGauge value={100} min={0} max={600} unit="bar" label="P. HIDRÁULICA 1" />
    )
    expect(getByText('P. HIDRÁULICA 1')).toBeInTheDocument()
  })

  it('color verde (accent-energy) cuando valor está en rango OK', () => {
    const { container } = render(
      <CircularGauge value={100} min={0} max={600} unit="bar" label="P."
        warnAbove={300} alertAbove={400} />
    )
    expect(container.querySelector('.g-val')).toHaveAttribute('stroke', 'var(--accent-energy)')
  })

  it('color amarillo (accent-warn) cuando value >= warnAbove', () => {
    const { container } = render(
      <CircularGauge value={350} min={0} max={600} unit="bar" label="P."
        warnAbove={300} alertAbove={400} />
    )
    expect(container.querySelector('.g-val')).toHaveAttribute('stroke', 'var(--accent-warn)')
  })

  it('color rojo (accent-crit) cuando value >= alertAbove', () => {
    const { container } = render(
      <CircularGauge value={450} min={0} max={600} unit="bar" label="P."
        warnAbove={300} alertAbove={400} />
    )
    expect(container.querySelector('.g-val')).toHaveAttribute('stroke', 'var(--accent-crit)')
  })

  it('color amarillo cuando value <= warnBelow', () => {
    const { container } = render(
      <CircularGauge value={15} min={0} max={100} unit="%" label="Nivel" warnBelow={20} />
    )
    expect(container.querySelector('.g-val')).toHaveAttribute('stroke', 'var(--accent-warn)')
  })

  it('no renderiza arco de valor cuando value es null', () => {
    const { container } = render(
      <CircularGauge value={null} min={0} max={600} unit="bar" label="P." />
    )
    const arc = container.querySelector('.g-val')
    expect(arc?.getAttribute('d') ?? '').toBe('')
  })

  it('muestra guión cuando value es null', () => {
    const { getByText } = render(
      <CircularGauge value={null} min={0} max={600} unit="bar" label="P." />
    )
    expect(getByText('—')).toBeInTheDocument()
  })
})
