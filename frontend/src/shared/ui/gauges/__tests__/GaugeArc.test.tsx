import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { GaugeArc } from '../GaugeArc'

describe('GaugeArc', () => {
  it('renders SVG', () => {
    const { container } = render(<GaugeArc value={50} max={100} label="Velocidad" unit="km/h"/>)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('path')).toBeTruthy()
  })
  it('renders null value', () => {
    const { container } = render(<GaugeArc value={null} max={100} label="Speed" unit="km/h"/>)
    expect(container.querySelector('svg')).toBeTruthy()
  })
  it('shows label', () => {
    const { getByText } = render(<GaugeArc value={30} max={120} label="Motor" unit="rpm"/>)
    expect(getByText('Motor')).toBeTruthy()
  })
})
