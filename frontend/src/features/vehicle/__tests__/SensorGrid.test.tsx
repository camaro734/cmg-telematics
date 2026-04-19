import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import SensorGrid from '../SensorGrid'
import type { SensorDef } from '../../../lib/types'

const circular: SensorDef = {
  key: 'hydraulic_pressure_1',
  label: 'Presión hidráulica 1',
  unit: 'bar',
  min: 0,
  max: 600,
  gauge_type: 'circular',
  warn_above: 300,
  alert_above: 400,
  avl_id: 305,
}

const linear: SensorDef = { ...circular, gauge_type: 'linear', key: 'oil_level' }
const numeric: SensorDef = { ...circular, gauge_type: 'numeric', key: 'cycles' }
const battery: SensorDef = { ...circular, gauge_type: 'battery', key: 'battery' }

describe('SensorGrid', () => {
  it('renderiza CircularGauge para sensor circular', () => {
    const { container } = render(
      <SensorGrid sensorSchema={[circular]} canData={{ avl_305: 390 }} />
    )
    expect(container.querySelector('.g-val')).toBeInTheDocument()
  })

  it('pasa el valor correcto desde canData (avl_305 → 390)', () => {
    const { getByText } = render(
      <SensorGrid sensorSchema={[circular]} canData={{ avl_305: 390 }} />
    )
    expect(getByText('390')).toBeInTheDocument()
  })

  it('renderiza LinearGauge para sensor lineal', () => {
    const { container } = render(
      <SensorGrid sensorSchema={[linear]} canData={{ avl_305: 78 }} />
    )
    expect(container.querySelector('.linear-fill')).toBeInTheDocument()
  })

  it('renderiza NumericDisplay para sensor numérico', () => {
    const { getByText } = render(
      <SensorGrid sensorSchema={[numeric]} canData={{ avl_305: 47 }} />
    )
    expect(getByText('47')).toBeInTheDocument()
  })

  it('renderiza BatteryGauge para sensor de batería', () => {
    const { container } = render(
      <SensorGrid sensorSchema={[battery]} canData={{ avl_305: 24.1 }} />
    )
    expect(container.querySelector('.bat-fill')).toBeInTheDocument()
  })

  it('usa derivedValues para sensores con kpi_key', () => {
    const ptoSensor: SensorDef = {
      key: 'pto_hours_today',
      label: 'Horas PTO hoy',
      unit: 'h',
      gauge_type: 'numeric',
      kpi_key: 'pto_hours_today',
    }
    const { getByText } = render(
      <SensorGrid
        sensorSchema={[ptoSensor]}
        canData={{}}
        derivedValues={{ pto_hours_today: 3.4 }}
      />
    )
    expect(getByText('3.4')).toBeInTheDocument()
  })

  it('pasa null al gauge cuando avl_id no está en canData', () => {
    const { getByText } = render(
      <SensorGrid sensorSchema={[circular]} canData={{}} />
    )
    expect(getByText('—')).toBeInTheDocument()
  })

  it('aplica scale a valores raw — AVL 66 en mV → V (×0.001)', () => {
    const batterySensor: SensorDef = {
      key: 'battery_v',
      label: 'Batería',
      unit: 'V',
      min: 18, max: 30,
      gauge_type: 'battery',
      warn_below: 21, alert_below: 19,
      avl_id: 66,
      scale: 0.001,
    }
    // avl_66 = 24100 mV → scale 0.001 → 24.1 V
    const { getByText } = render(
      <SensorGrid sensorSchema={[batterySensor]} canData={{ avl_66: 24100 }} />
    )
    expect(getByText('24.1 V')).toBeInTheDocument()
  })
})
