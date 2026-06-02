import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SystemBlockCard } from '../SystemBlockCard'
import type { SystemBlock, SensorDef, VehicleStatus, AlertInstanceEnrichedOut } from '../../../../lib/types'

const presionSensor: SensorDef = {
  key: 'presion',
  label: 'Presión bomba',
  unit: 'bar',
  gauge_type: 'circular',
  avl_id: 145,
  scale: 1,
  offset: 0,
  min: 0,
  max: 600,
  warn_above: 300,
  alert_above: 400,
}

const schema: SensorDef[] = [presionSensor]

const block: SystemBlock = {
  id: 'b1',
  name: 'Hidráulico',
  icon: 'ti-gauge',
  sensor_keys: ['presion'],
  key_sensor_keys: ['presion'],
  key_count: 1,
}

const statusOk: VehicleStatus = {
  vehicle_id: 'v1', ignition: true, speed_kmh: 0, lat: null, lon: null,
  last_seen: null, pto_active: false,
  can_data: { avl_145: 150 },
}

const noAlerts: AlertInstanceEnrichedOut[] = []

describe('SystemBlockCard', () => {
  it('muestra el nombre del bloque', () => {
    render(<SystemBlockCard block={block} schema={schema} status={statusOk} derived={{}} alerts={noAlerts} />)
    expect(screen.getByText('Hidráulico')).toBeInTheDocument()
  })

  it('muestra el icono del bloque', () => {
    const { container } = render(
      <SystemBlockCard block={block} schema={schema} status={statusOk} derived={{}} alerts={noAlerts} />
    )
    const icon = container.querySelector('[data-testid="block-icon"]')
    expect(icon).toBeTruthy()
    expect(icon?.className).toContain('ti-gauge')
  })

  it('muestra "Funcionando normal" cuando zone=ok', () => {
    render(<SystemBlockCard block={block} schema={schema} status={statusOk} derived={{}} alerts={noAlerts} />)
    expect(screen.getByTestId('block-phrase')).toHaveTextContent('Funcionando normal')
  })

  it('muestra la frase de alerta cuando zone=warn', () => {
    const statusWarn = { ...statusOk, can_data: { avl_145: 350 } }
    render(<SystemBlockCard block={block} schema={schema} status={statusWarn} derived={{}} alerts={noAlerts} />)
    expect(screen.getByTestId('block-phrase')).toHaveTextContent('Presión bomba alto')
  })

  it('aplica borde verde (--accent-ok) cuando zone=ok', () => {
    const { container } = render(
      <SystemBlockCard block={block} schema={schema} status={statusOk} derived={{}} alerts={noAlerts} />
    )
    const card = container.querySelector('[data-testid="system-block-card"]') as HTMLElement
    expect(card.style.borderLeft).toContain('var(--accent-ok)')
  })

  it('aplica borde ámbar (--accent-warn) cuando zone=warn', () => {
    const statusWarn = { ...statusOk, can_data: { avl_145: 350 } }
    const { container } = render(
      <SystemBlockCard block={block} schema={schema} status={statusWarn} derived={{}} alerts={noAlerts} />
    )
    const card = container.querySelector('[data-testid="system-block-card"]') as HTMLElement
    expect(card.style.borderLeft).toContain('var(--accent-warn)')
  })

  it('aplica borde rojo (--accent-crit) cuando zone=crit', () => {
    const statusCrit = { ...statusOk, can_data: { avl_145: 450 } }
    const { container } = render(
      <SystemBlockCard block={block} schema={schema} status={statusCrit} derived={{}} alerts={noAlerts} />
    )
    const card = container.querySelector('[data-testid="system-block-card"]') as HTMLElement
    expect(card.style.borderLeft).toContain('var(--accent-crit)')
  })

  it('renderiza el sensor clave (RangeBar visible)', () => {
    const { container } = render(
      <SystemBlockCard block={block} schema={schema} status={statusOk} derived={{}} alerts={noAlerts} />
    )
    expect(container.querySelector('[data-testid="rangebar-fill"]')).toBeTruthy()
  })

  it('aplica borde gris (--accent-off) y frase "Sin datos" cuando zone=nodata', () => {
    const statusNoData = { ...statusOk, can_data: {} }
    const { container } = render(
      <SystemBlockCard block={block} schema={schema} status={statusNoData} derived={{}} alerts={noAlerts} />
    )
    const card = container.querySelector('[data-testid="system-block-card"]') as HTMLElement
    expect(card.style.borderLeft).toContain('var(--accent-off)')
    expect(screen.getByTestId('block-phrase')).toHaveTextContent('Sin datos')
  })
})
