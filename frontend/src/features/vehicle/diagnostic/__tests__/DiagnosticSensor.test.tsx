import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiagnosticSensor } from '../DiagnosticSensor'
import type { SensorDef } from '../../../../lib/types'

const base: Omit<SensorDef, 'gauge_type'> = {
  key: 's1',
  label: 'Test sensor',
  unit: 'bar',
  min: 0,
  max: 100,
  scale: 1,
  offset: 0,
}

describe('DiagnosticSensor — mapeo por gauge_type', () => {
  it('circular → RangeBar (muestra rangebar-fill)', () => {
    const { container } = render(
      <DiagnosticSensor sensor={{ ...base, gauge_type: 'circular' }} raw={50} />
    )
    expect(container.querySelector('[data-testid="rangebar-fill"]')).toBeTruthy()
  })

  it('linear → RangeBar', () => {
    const { container } = render(
      <DiagnosticSensor sensor={{ ...base, gauge_type: 'linear' }} raw={50} />
    )
    expect(container.querySelector('[data-testid="rangebar-fill"]')).toBeTruthy()
  })

  it('gauge_arc → RangeBar', () => {
    const { container } = render(
      <DiagnosticSensor sensor={{ ...base, gauge_type: 'gauge_arc' }} raw={50} />
    )
    expect(container.querySelector('[data-testid="rangebar-fill"]')).toBeTruthy()
  })

  it('tank → LevelTank (muestra leveltank-fill)', () => {
    const { container } = render(
      <DiagnosticSensor sensor={{ ...base, gauge_type: 'tank' }} raw={60} />
    )
    expect(container.querySelector('[data-testid="leveltank-fill"]')).toBeTruthy()
  })

  it('battery → LevelTank', () => {
    const { container } = render(
      <DiagnosticSensor sensor={{ ...base, gauge_type: 'battery' }} raw={60} />
    )
    expect(container.querySelector('[data-testid="leveltank-fill"]')).toBeTruthy()
  })

  it('numeric → BigNumber (muestra el valor escalado)', () => {
    render(
      <DiagnosticSensor sensor={{ ...base, gauge_type: 'numeric', scale: 2, offset: 10 }} raw={20} />
    )
    // 20 * 2 + 10 = 50
    expect(screen.getByText('50')).toBeInTheDocument()
  })

  it('counter → BigNumber', () => {
    render(
      <DiagnosticSensor sensor={{ ...base, gauge_type: 'counter' }} raw={99} />
    )
    expect(screen.getByText('99')).toBeInTheDocument()
  })

  it('gauge_type desconocido → BigNumber (fallback)', () => {
    render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <DiagnosticSensor sensor={{ ...base, gauge_type: 'unknown' as any }} raw={7} />
    )
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('led sin bit_index → BinaryIndicator ON cuando raw != 0', () => {
    const { container } = render(
      <DiagnosticSensor sensor={{ ...base, gauge_type: 'led' }} raw={1} />
    )
    expect(container.querySelector('[data-testid="binary-pill"]')).toBeTruthy()
    expect(screen.getByText('ON')).toBeInTheDocument()
  })

  it('led con bit_index extrae el bit correcto (bit 2 de 4 = 0b100 → ON)', () => {
    render(
      <DiagnosticSensor sensor={{ ...base, gauge_type: 'led', bit_index: 2 }} raw={4} />
    )
    expect(screen.getByText('ON')).toBeInTheDocument()
  })

  it('led con bit_index = 0 y raw = 4 → bit 0 es 0 → OFF', () => {
    render(
      <DiagnosticSensor sensor={{ ...base, gauge_type: 'led', bit_index: 0 }} raw={4} />
    )
    expect(screen.getByText('OFF')).toBeInTheDocument()
  })

  it('raw null → todos los indicadores muestran "—" o null state', () => {
    const { container } = render(
      <DiagnosticSensor sensor={{ ...base, gauge_type: 'circular' }} raw={null} />
    )
    expect(container.querySelector('[data-testid="rangebar-fill"]')).toBeTruthy()
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
