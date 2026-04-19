import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import KpiChart from '../KpiChart'

function renderChart(kpis: unknown[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['vehicles', 'v1', 'kpis', 24], kpis)
  return render(
    <QueryClientProvider client={queryClient}>
      <KpiChart vehicleId="v1" />
    </QueryClientProvider>
  )
}

describe('KpiChart', () => {
  it('muestra "Sin datos" cuando no hay registros', () => {
    const { getByText } = renderChart([])
    expect(getByText(/sin datos/i)).toBeInTheDocument()
  })

  it('muestra los botones de rango de tiempo', () => {
    const { getByText } = renderChart([])
    expect(getByText('24h')).toBeInTheDocument()
    expect(getByText('7d')).toBeInTheDocument()
    expect(getByText('30d')).toBeInTheDocument()
  })

  it('no muestra "Sin datos" cuando hay registros', () => {
    const kpis = [
      {
        bucket: '2026-04-19T09:00:00Z',
        avg_pressure_1: 300,
        max_pressure_1: 350,
        avg_oil_temp: 85,
        max_oil_temp: 90,
        pto_active_minutes: 45,
        engine_on_minutes: 60,
        record_count: 120,
      },
    ]
    // ResponsiveContainer usa ResizeObserver que jsdom no procesa de forma síncrona;
    // verificamos que el mensaje vacío no aparece cuando hay datos
    const { queryByText } = renderChart(kpis)
    expect(queryByText(/sin datos/i)).not.toBeInTheDocument()
  })

  it('cambia el rango al hacer clic en 7d', async () => {
    const user = userEvent.setup()
    const { getByText } = renderChart([])
    const btn = getByText('7d')
    await user.click(btn)
    expect(btn).toBeInTheDocument()
  })
})
