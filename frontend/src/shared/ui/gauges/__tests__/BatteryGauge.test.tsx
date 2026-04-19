import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import BatteryGauge from '../BatteryGauge'

describe('BatteryGauge', () => {
  it('muestra el voltaje formateado y estado OK', () => {
    const { getByText } = render(
      <BatteryGauge value={24.1} min={18} max={30} label="BATERÍA"
        warnBelow={21} alertBelow={19} />
    )
    expect(getByText('24.1 V')).toBeInTheDocument()
    expect(getByText('OK')).toBeInTheDocument()
  })

  it('relleno proporcional: 24V en rango 18-30 = 50%', () => {
    const { container } = render(
      <BatteryGauge value={24} min={18} max={30} label="BATERÍA" />
    )
    const fill = container.querySelector('.bat-fill') as HTMLElement
    expect(fill.style.width).toBe('50%')
  })

  it('relleno 100% en valor máximo', () => {
    const { container } = render(
      <BatteryGauge value={30} min={18} max={30} label="BATERÍA" />
    )
    const fill = container.querySelector('.bat-fill') as HTMLElement
    expect(fill.style.width).toBe('100%')
  })

  it('relleno 0% cuando value está por debajo de min', () => {
    const { container } = render(
      <BatteryGauge value={10} min={18} max={30} label="BATERÍA" />
    )
    const fill = container.querySelector('.bat-fill') as HTMLElement
    expect(fill.style.width).toBe('0%')
  })

  it('muestra ADVERTENCIA cuando value <= warnBelow', () => {
    const { getByText } = render(
      <BatteryGauge value={20} min={18} max={30} label="BATERÍA"
        warnBelow={21} alertBelow={19} />
    )
    expect(getByText('ADVERTENCIA')).toBeInTheDocument()
  })

  it('muestra BAJA cuando value <= alertBelow', () => {
    const { getByText } = render(
      <BatteryGauge value={18.5} min={18} max={30} label="BATERÍA"
        warnBelow={21} alertBelow={19} />
    )
    expect(getByText('BAJA')).toBeInTheDocument()
  })

  it('muestra guión cuando value es null', () => {
    const { getByText } = render(
      <BatteryGauge value={null} min={18} max={30} label="BATERÍA" />
    )
    expect(getByText('— V')).toBeInTheDocument()
  })

  it('usa la unidad personalizada cuando se proporciona', () => {
    const { getByText } = render(
      <BatteryGauge value={75} min={0} max={100} label="NIVEL" unit="%" />
    )
    expect(getByText('75.0 %')).toBeInTheDocument()
  })

  it('advierte en dev cuando alertBelow >= warnBelow (umbrales invertidos)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(
      <BatteryGauge value={20} min={0} max={30} label="TEST"
        warnBelow={19} alertBelow={22} />
    )
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('alertBelow'))
    spy.mockRestore()
  })
})
