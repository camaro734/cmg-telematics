import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { SensorDef } from '../../../../lib/types'
import { LiveSensorWidget, hasVisualWidget } from '../LiveSensorWidget'

const base: SensorDef = {
  key: 'rpm', label: 'RPM Motor', unit: 'rpm', gauge_type: 'numeric', avl_id: 30,
}

describe('hasVisualWidget', () => {
  it('true para gauge/bar/temp_bar, false para number/undefined', () => {
    expect(hasVisualWidget({ ...base, display_widget: 'gauge' })).toBe(true)
    expect(hasVisualWidget({ ...base, display_widget: 'bar' })).toBe(true)
    expect(hasVisualWidget({ ...base, display_widget: 'temp_bar' })).toBe(true)
    expect(hasVisualWidget({ ...base, display_widget: 'number' })).toBe(false)
    expect(hasVisualWidget(base)).toBe(false)
  })
})

describe('LiveSensorWidget', () => {
  it('gauge renderiza un SVG con el valor', () => {
    const { container } = render(
      <LiveSensorWidget sensor={{ ...base, display_widget: 'gauge', display_min: 0, display_max: 3000 }} value={1500} />,
    )
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.getByText('1500')).toBeInTheDocument()
  })

  it('bar muestra valor y unidad', () => {
    render(
      <LiveSensorWidget sensor={{ ...base, label: 'Presión', unit: 'bar', display_widget: 'bar', display_min: 0, display_max: 250 }} value={120} />,
    )
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('bar')).toBeInTheDocument()
  })

  it('sin dato (value null) muestra —', () => {
    render(<LiveSensorWidget sensor={{ ...base, display_widget: 'bar', display_min: 0, display_max: 250 }} value={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('number → no renderiza widget (null)', () => {
    const { container } = render(<LiveSensorWidget sensor={{ ...base, display_widget: 'number' }} value={100} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.textContent).toBe('')
  })
})
