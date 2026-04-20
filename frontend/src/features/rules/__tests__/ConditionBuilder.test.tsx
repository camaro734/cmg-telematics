import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ConditionBuilder from '../ConditionBuilder'
import type { ConditionDef, SensorDef } from '../../../lib/types'

const sensors: SensorDef[] = [
  { key: 'hydraulic_pressure_1', label: 'Presión bomba', unit: 'bar', gauge_type: 'circular', min: 0, max: 300 },
  { key: 'oil_temp_c', label: 'Temperatura aceite', unit: '°C', gauge_type: 'circular', min: 0, max: 120 },
  { key: 'pto_active', label: 'PTO', unit: null, gauge_type: 'led' },
]

describe('ConditionBuilder', () => {
  it('renders threshold fields by default', () => {
    const cond: ConditionDef = { type: 'threshold', field: 'hydraulic_pressure_1', op: '>', value: 220 }
    render(<ConditionBuilder condition={cond} sensors={sensors} onChange={vi.fn()} />)
    expect(screen.getByDisplayValue('hydraulic_pressure_1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('>')).toBeInTheDocument()
    expect(screen.getByDisplayValue('220')).toBeInTheDocument()
  })

  it('renders sustained fields for threshold_sustained', () => {
    const cond: ConditionDef = { type: 'threshold_sustained', field: 'hydraulic_pressure_1', op: '>', value: 220, minutes: 5 }
    render(<ConditionBuilder condition={cond} sensors={sensors} onChange={vi.fn()} />)
    expect(screen.getByDisplayValue('5')).toBeInTheDocument()
    expect(screen.getByText(/minutos/)).toBeInTheDocument()
  })

  it('renders accumulation fields', () => {
    const cond: ConditionDef = { type: 'accumulation', field: 'hydraulic_pressure_1', limit: 100 }
    render(<ConditionBuilder condition={cond} sensors={sensors} onChange={vi.fn()} />)
    expect(screen.getByDisplayValue('100')).toBeInTheDocument()
    expect(screen.getByText(/alcanza/)).toBeInTheDocument()
  })

  it('renders composite with two sub-conditions', () => {
    const cond: ConditionDef = {
      type: 'composite', op_composite: 'AND',
      conditions: [
        { type: 'threshold', field: 'hydraulic_pressure_1', op: '>', value: 220 },
        { type: 'threshold', field: 'oil_temp_c', op: '>', value: 90 },
      ],
    }
    render(<ConditionBuilder condition={cond} sensors={sensors} onChange={vi.fn()} />)
    expect(screen.getByText('AND')).toBeInTheDocument()
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(2)
  })

  it('calls onChange when value changes', () => {
    const onChange = vi.fn()
    const cond: ConditionDef = { type: 'threshold', field: 'hydraulic_pressure_1', op: '>', value: 220 }
    render(<ConditionBuilder condition={cond} sensors={sensors} onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('220'), { target: { value: '250' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ value: 250 }))
  })

  it('añadir condición convierte a composite', () => {
    const onChange = vi.fn()
    const cond: ConditionDef = { type: 'threshold', field: 'hydraulic_pressure_1', op: '>', value: 220 }
    render(<ConditionBuilder condition={cond} sensors={sensors} onChange={onChange} />)
    fireEvent.click(screen.getByText(/Añadir condición/))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'composite' }))
  })
})
