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

  it('transforma el label a mayúsculas', () => {
    const { getByText } = render(
      <CircularGauge value={100} min={0} max={100} unit="%" label="nivel aceite" />
    )
    expect(getByText('NIVEL ACEITE')).toBeInTheDocument()
  })

  it('color verde (cmg-teal) cuando valor está en rango OK', () => {
    const { container } = render(
      <CircularGauge value={100} min={0} max={600} unit="bar" label="P."
        warnAbove={300} alertAbove={400} />
    )
    expect(container.querySelector('.g-val')).toHaveAttribute('stroke', 'var(--cmg-teal)')
  })

  it('color amarillo (warn) cuando value >= warnAbove', () => {
    const { container } = render(
      <CircularGauge value={350} min={0} max={600} unit="bar" label="P."
        warnAbove={300} alertAbove={400} />
    )
    expect(container.querySelector('.g-val')).toHaveAttribute('stroke', 'var(--warn)')
  })

  it('color rojo (danger) cuando value >= alertAbove', () => {
    const { container } = render(
      <CircularGauge value={450} min={0} max={600} unit="bar" label="P."
        warnAbove={300} alertAbove={400} />
    )
    expect(container.querySelector('.g-val')).toHaveAttribute('stroke', 'var(--danger)')
  })

  it('color amarillo cuando value <= warnBelow', () => {
    const { container } = render(
      <CircularGauge value={15} min={0} max={100} unit="%" label="Nivel" warnBelow={20} />
    )
    expect(container.querySelector('.g-val')).toHaveAttribute('stroke', 'var(--warn)')
  })

  it('color rojo (danger) cuando value <= alertBelow', () => {
    const { container } = render(
      <CircularGauge value={5} min={0} max={100} unit="%" label="Nivel"
        warnBelow={20} alertBelow={10} />
    )
    expect(container.querySelector('.g-val')).toHaveAttribute('stroke', 'var(--danger)')
  })

  it('no renderiza arco ni punto cuando value es null', () => {
    const { container } = render(
      <CircularGauge value={null} min={0} max={600} unit="bar" label="P." />
    )
    expect(container.querySelector('.g-val')?.getAttribute('d') ?? '').toBe('')
    expect(container.querySelector('.g-dot')).toBeNull()
  })

  it('muestra guión cuando value es null', () => {
    const { getByText } = render(
      <CircularGauge value={null} min={0} max={600} unit="bar" label="P." />
    )
    expect(getByText('—')).toBeInTheDocument()
  })

  it('no renderiza arco ni punto cuando value === min', () => {
    const { container } = render(
      <CircularGauge value={0} min={0} max={600} unit="bar" label="P." />
    )
    expect(container.querySelector('.g-val')?.getAttribute('d') ?? '').toBe('')
    expect(container.querySelector('.g-dot')).toBeNull()
  })
})
