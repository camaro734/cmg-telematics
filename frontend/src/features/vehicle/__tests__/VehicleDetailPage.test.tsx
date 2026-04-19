import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import VehicleDetailPage from '../VehicleDetailPage'

vi.mock('../TrackMap', () => ({ default: () => <div data-testid="track-map" /> }))
vi.mock('../KpiChart', () => ({ default: () => <div data-testid="kpi-chart" /> }))

function renderPage(vehicleId = 'v-test') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })

  const vehicle = {
    id: vehicleId,
    tenant_id: 't1',
    vehicle_type_id: 'vt-1',
    name: 'Camión 01',
    license_plate: '1234ABC',
    vin: null,
    year: 2020,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
  }
  const vehicleType = {
    id: 'vt-1',
    slug: 'wasterent-vacuum',
    name: 'Wasterent — Sistema vacío-presión',
    sensor_schema: [],
  }
  const status = {
    vehicle_id: vehicleId,
    online: true,
    last_seen: '2026-04-19T10:00:00Z',
    lat: 39.5, lon: -0.4,
    speed_kmh: 60, ignition: true, pto_active: false,
    can_data: { avl_305: 390 },
  }

  queryClient.setQueryData(['vehicles', vehicleId], vehicle)
  queryClient.setQueryData(['vehicle-types'], [vehicleType])
  queryClient.setQueryData(['vehicles', vehicleId, 'status'], status)
  queryClient.setQueryData(['vehicles', vehicleId, 'track'], [])

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/fleet/${vehicleId}`]}>
        <Routes>
          <Route path="/fleet/:id" element={<VehicleDetailPage />} />
          <Route path="/fleet" element={<div>Fleet</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('VehicleDetailPage', () => {
  it('muestra la pestaña EN VIVO por defecto', () => {
    const { getByRole } = renderPage()
    const tab = getByRole('tab', { name: 'EN VIVO' })
    expect(tab).toHaveAttribute('aria-selected', 'true')
  })

  it('muestra el mapa en la pestaña EN VIVO', () => {
    const { getByTestId } = renderPage()
    expect(getByTestId('track-map')).toBeInTheDocument()
  })

  it('cambia a la pestaña HISTÓRICO al hacer clic', async () => {
    const user = userEvent.setup()
    const { getByRole, getByTestId } = renderPage()
    await user.click(getByRole('tab', { name: 'HISTÓRICO' }))
    expect(getByTestId('kpi-chart')).toBeInTheDocument()
  })
})
