import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Chip } from '../Chip'

describe('Chip', () => {
  it('renders children', () => {
    render(<Chip>12 en línea</Chip>)
    expect(screen.getByText('12 en línea')).toBeTruthy()
  })
  it('renders dot when dot=true', () => {
    const { container } = render(<Chip dot color="#22C55E">Online</Chip>)
    const spans = container.querySelectorAll('span')
    expect(spans.length).toBeGreaterThan(1)
  })
  it('applies soft background when soft=true', () => {
    const { container } = render(<Chip soft color="#1D9E75">teal</Chip>)
    const chip = container.firstChild as HTMLElement
    const bg = chip.style.background
    expect(bg).toBeTruthy()
    expect(bg).not.toEqual('rgba(255,255,255,0.04)')
  })
})
