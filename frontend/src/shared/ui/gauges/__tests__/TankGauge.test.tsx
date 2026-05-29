import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { TankGauge } from '../TankGauge'

describe('TankGauge', () => {
  it('renders SVG', () => {
    const { container } = render(<TankGauge value={500} max={1000} label="Cisterna" unit="L" />)
    expect(container.querySelector('svg')).toBeTruthy()
  })
  it('renders with null value', () => {
    const { container } = render(<TankGauge value={null} max={1000} label="Cisterna" unit="L" />)
    expect(container.querySelector('svg')).toBeTruthy()
  })
  it('shows label', () => {
    const { getByText } = render(<TankGauge value={750} max={1000} label="Depósito" unit="L" />)
    expect(getByText('Depósito')).toBeTruthy()
  })
})
