import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import LinearGauge from '../LinearGauge'

describe('LinearGauge', () => {
  it('muestra el porcentaje', () => {
    const { getByText } = render(
      <LinearGauge value={78} min={0} max={100} label="NIVEL ACEITE" />
    )
    expect(getByText('78%')).toBeInTheDocument()
  })

  it('la barra vertical tiene la altura proporcional al valor', () => {
    const { container } = render(
      <LinearGauge value={50} min={0} max={100} label="NIVEL" />
    )
    const fill = container.querySelector('.linear-fill') as HTMLElement
    expect(fill.style.height).toBe('50%')
  })

  it('muestra estado OK cuando está sobre warnBelow', () => {
    const { getByText } = render(
      <LinearGauge value={78} min={0} max={100} label="NIVEL" warnBelow={20} />
    )
    expect(getByText('OK')).toBeInTheDocument()
  })

  it('muestra BAJO cuando value <= warnBelow', () => {
    const { getByText } = render(
      <LinearGauge value={15} min={0} max={100} label="NIVEL" warnBelow={20} alertBelow={10} />
    )
    expect(getByText('BAJO')).toBeInTheDocument()
  })

  it('muestra CRÍTICO cuando value <= alertBelow', () => {
    const { getByText } = render(
      <LinearGauge value={5} min={0} max={100} label="NIVEL" warnBelow={20} alertBelow={10} />
    )
    expect(getByText('CRÍTICO')).toBeInTheDocument()
  })

  it('muestra guión cuando value es null', () => {
    const { getByText } = render(
      <LinearGauge value={null} min={0} max={100} label="NIVEL" />
    )
    expect(getByText('—')).toBeInTheDocument()
  })

  it('advierte en dev cuando alertBelow >= warnBelow (umbrales invertidos)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(
      <LinearGauge value={20} min={0} max={100} label="TEST"
        warnBelow={15} alertBelow={25} />
    )
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('alertBelow'))
    spy.mockRestore()
  })
})
