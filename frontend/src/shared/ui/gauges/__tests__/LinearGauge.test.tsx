import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import LinearGauge from '../LinearGauge'

describe('LinearGauge', () => {
  it('muestra el porcentaje', () => {
    const { getByText } = render(
      <LinearGauge value={78} min={0} max={100} unit="%" label="NIVEL ACEITE" />
    )
    expect(getByText('78%')).toBeInTheDocument()
  })

  it('la barra vertical tiene la altura proporcional al valor', () => {
    const { container } = render(
      <LinearGauge value={50} min={0} max={100} unit="%" label="NIVEL" />
    )
    const fill = container.querySelector('.linear-fill') as HTMLElement
    expect(fill.style.height).toBe('50%')
  })

  it('muestra estado OK cuando está sobre warnBelow', () => {
    const { getByText } = render(
      <LinearGauge value={78} min={0} max={100} unit="%" label="NIVEL" warnBelow={20} />
    )
    expect(getByText('OK')).toBeInTheDocument()
  })

  it('muestra BAJO cuando value <= warnBelow', () => {
    const { getByText } = render(
      <LinearGauge value={15} min={0} max={100} unit="%" label="NIVEL" warnBelow={20} alertBelow={10} />
    )
    expect(getByText('BAJO')).toBeInTheDocument()
  })

  it('muestra guión cuando value es null', () => {
    const { getByText } = render(
      <LinearGauge value={null} min={0} max={100} unit="%" label="NIVEL" />
    )
    expect(getByText('—')).toBeInTheDocument()
  })
})
