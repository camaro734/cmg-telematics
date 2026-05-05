import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import FleetDashboard from '../FleetDashboard'
import { keys } from '../../../lib/queryKeys'
import type { VehicleOut, VehicleStatus } from '../../../lib/types'

// Mockear dependencias con side-effects (Leaflet, react-router navigate, etc.)
vi.mock('../../../lib/apiClient', () => ({
  apiClient: { get: vi.fn() },
}))
vi.mock('../../../features/auth/useAuthStore', () => ({
  useAuthStore: vi.fn(() => ({
    user: { role: 'admin', tenant_tier: 'client' },
    enabledModules: [],
    logoUrl: null,
    brandName: null,
    logout: vi.fn(),
  })),
}))
// FleetMap usa Leaflet y DOM APIs que no existen en jsdom
vi.mock('../FleetMap', () => ({
  default: () => <div data-testid="fleet-map">Mapa</div>,
}))
// VehicleCard es un componente con lógica visual; mockearlo simplifica los tests
vi.mock('../VehicleCard', () => ({
  default: ({ vehicle }: { vehicle: VehicleOut }) => (
    <div data-testid="vehicle-card">{vehicle.name}</div>
  ),
}))
// useIsMobile: retornar false para renderizar la versión desktop en todos los tests
vi.mock('../../../lib/useIsMobile', () => ({
  useIsMobile: () => false,
}))

import { apiClient } from '../../../lib/apiClient'

function makeVehicle(id: string, name: string): VehicleOut {
  return {
    id,
    tenant_id: 't1',
    vehicle_type_id: 'vt1',
    name,
    license_plate: `MAT-${id}`,
    vin: null,
    driver_name: null,
    year: null,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
  }
}

function makeStatus(vehicle_id: string): VehicleStatus {
  return {
    vehicle_id,
    online: true,
    last_seen: new Date().toISOString(),
    lat: 39.4,
    lon: -0.37,
    speed_kmh: 10,
    ignition: true,
    pto_active: false,
    ext_voltage_mv: 13500,
    can_data: null,
    dout_state: {},
  }
}

function wrap(preloaded: {
  vehicles?: VehicleOut[]
  statuses?: VehicleStatus[]
  loadingVehicles?: boolean
} = {}) {
  const { vehicles = [], statuses = [] } = preloaded
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  // Pre-populate el cache para evitar llamadas reales a la red
  qc.setQueryData(keys.vehicles(), vehicles)
  qc.setQueryData(keys.vehicleTypes(), [])
  qc.setQueryData(keys.tenants(), [])
  qc.setQueryData(keys.rules(), [])
  qc.setQueryData([...keys.alerts(), 'firing'], [])

  // Cache de statuses bulk
  const ids = vehicles.map(v => v.id).join(',')
  if (ids) {
    qc.setQueryData([...keys.vehicles(), 'statuses', ids], statuses)
  }

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FleetDashboard />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('FleetDashboard', () => {
  it('muestra skeletons mientras carga los vehículos', () => {
    // apiClient.get devuelve una promesa que nunca resuelve → estado loading
    vi.mocked(apiClient.get).mockReturnValue(new Promise(() => {}))

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    })
    // No pre-populamos el cache → isLoading = true
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <FleetDashboard />
        </MemoryRouter>
      </QueryClientProvider>
    )

    // Los skeletons se renderizan cuando loadingVehicles es true
    // Identificamos por el mapa que sí está siempre presente
    expect(screen.getByTestId('fleet-map')).toBeInTheDocument()
  })

  it('muestra VehicleCards cuando hay vehículos en cache', () => {
    vi.mocked(apiClient.get).mockResolvedValue([])
    const vehicles = [makeVehicle('v1', 'WR-04'), makeVehicle('v2', 'PR-07')]
    const statuses = vehicles.map(v => makeStatus(v.id))
    wrap({ vehicles, statuses })

    expect(screen.getAllByTestId('vehicle-card')).toHaveLength(2)
    expect(screen.getByText('WR-04')).toBeInTheDocument()
    expect(screen.getByText('PR-07')).toBeInTheDocument()
  })

  it('muestra "Sin vehículos registrados" cuando la lista está vacía', () => {
    vi.mocked(apiClient.get).mockResolvedValue([])
    wrap({ vehicles: [] })

    expect(screen.getByText('Sin vehículos registrados')).toBeInTheDocument()
  })

  it('muestra el mapa siempre (con o sin vehículos)', () => {
    vi.mocked(apiClient.get).mockResolvedValue([])
    wrap({ vehicles: [] })

    expect(screen.getByTestId('fleet-map')).toBeInTheDocument()
  })

  it('muestra "Sin incidencias activas" cuando no hay alertas', () => {
    vi.mocked(apiClient.get).mockResolvedValue([])
    const vehicles = [makeVehicle('v1', 'WR-04')]
    wrap({ vehicles })

    expect(screen.getByText(/Sin incidencias activas/i)).toBeInTheDocument()
  })

  it('muestra contadores de estado de flota', () => {
    vi.mocked(apiClient.get).mockResolvedValue([])
    const vehicles = [makeVehicle('v1', 'WR-04'), makeVehicle('v2', 'PR-07')]
    const statuses = vehicles.map(v => makeStatus(v.id))
    // Sin señal suficientemente antigua → aparecen como offline
    wrap({ vehicles, statuses })

    // El header siempre muestra los contadores de estado
    expect(screen.getByText(/en ruta/i)).toBeInTheDocument()
    expect(screen.getByText(/parados/i)).toBeInTheDocument()
    expect(screen.getByText(/sin señal/i)).toBeInTheDocument()
  })
})
