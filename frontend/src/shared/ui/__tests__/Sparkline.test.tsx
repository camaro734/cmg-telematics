import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Sparkline } from '../Sparkline'

describe('Sparkline', () => {
  it('returns null when fewer than 2 values', () => {
    const { container } = render(<Sparkline values={[42]} />)
    expect(container.firstChild).toBeNull()
  })
  it('returns null for empty array', () => {
    const { container } = render(<Sparkline values={[]} />)
    expect(container.firstChild).toBeNull()
  })
  it('renders SVG with polyline when given 2+ values', () => {
    const { container } = render(<Sparkline values={[10, 20, 15, 30]} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    const polyline = svg!.querySelector('polyline')
    expect(polyline).toBeTruthy()
  })
  it('uses default dimensions w=72 h=24', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('72')
    expect(svg.getAttribute('height')).toBe('24')
  })
})
