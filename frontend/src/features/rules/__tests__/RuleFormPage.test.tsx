import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import RuleFormPage from '../RuleFormPage'
import type { RuleOut, VehicleTypeOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}))
const mockAuthState = { user: { role: 'admin', tenant_tier: 'client' }, enabledModules: [], logoUrl: null, brandName: null, logout: vi.fn() }
vi.mock('../../../features/auth/useAuthStore', () => ({
  useAuthStore: vi.fn((selector?: (s: typeof mockAuthState) => unknown) =>
    typeof selector === 'function' ? selector(mockAuthState) : mockAuthState
  ),
}))

import { apiClient } from '../../../lib/apiClient'

const mockVehicleType: VehicleTypeOut = {
  id: 'vt1', slug: 'vacuum', name: 'Camión aspirador',
  sensor_schema: [
    { key: 'hydraulic_pressure_1', label: 'Presión bomba', unit: 'bar', gauge_type: 'circular', min: 0, max: 300 },
  ],
}

const mockRule: RuleOut = {
  id: 'r1', tenant_id: 't1', name: 'Presión alta', description: null,
  active: true, severity: 'critical',
  vehicle_filter: { scope: 'all' },
  condition: { type: 'threshold', field: 'hydraulic_pressure_1', op: '>', value: 220 },
  actions: [{ type: 'in_app' }], escalation: [],
  cooldown_minutes: 30, created_at: '2026-04-19T00:00:00Z',
}

function wrapCreate() {
  vi.mocked(apiClient.get).mockResolvedValue([mockVehicleType])
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/rules/new']}>
        <Routes>
          <Route path="/rules/new" element={<RuleFormPage />} />
          <Route path="/rules" element={<div>Lista</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function wrapEdit() {
  vi.mocked(apiClient.get).mockImplementation((path: string) => {
    if (path.includes('/api/v1/rules/r1')) return Promise.resolve(mockRule)
    return Promise.resolve([mockVehicleType])
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(['rules', 'r1'], mockRule)
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/rules/r1']}>
        <Routes>
          <Route path="/rules/:id" element={<RuleFormPage />} />
          <Route path="/rules" element={<div>Lista</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

// Navega el wizard hasta el paso final (paso 5) partiendo desde el paso 1
async function advanceToReview(nameValue = 'Nueva regla') {
  // Paso 1: rellenar nombre y avanzar
  fireEvent.change(screen.getByPlaceholderText(/presión bomba alta/i), { target: { value: nameValue } })
  fireEvent.click(screen.getByText('Siguiente →'))
  // Paso 2 → 3 → 4 → 5
  await waitFor(() => screen.getByText('Siguiente →'))
  fireEvent.click(screen.getByText('Siguiente →'))
  await waitFor(() => screen.getByText('Siguiente →'))
  fireEvent.click(screen.getByText('Siguiente →'))
  await waitFor(() => screen.getByText('Siguiente →'))
  fireEvent.click(screen.getByText('Siguiente →'))
  await waitFor(() => screen.getByText(/Crear regla|Guardar cambios/))
}

describe('RuleFormPage', () => {
  it('muestra formulario de creación en paso 1 con campo nombre', () => {
    wrapCreate()
    expect(screen.getByPlaceholderText(/presión bomba alta/i)).toBeInTheDocument()
    // En paso 1 el botón de envío aún no es visible — solo "Siguiente"
    expect(screen.getByText('Siguiente →')).toBeInTheDocument()
  })

  it('submit en creación llama apiClient.post con payload correcto', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(mockRule)
    wrapCreate()
    await advanceToReview('Nueva regla')
    fireEvent.click(screen.getByText('Crear regla'))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/rules',
      expect.objectContaining({ name: 'Nueva regla', condition: expect.objectContaining({ type: 'threshold' }) })
    ))
  })

  it('en modo edición pre-carga el nombre de la regla', async () => {
    wrapEdit()
    await waitFor(() => expect(screen.getByDisplayValue('Presión alta')).toBeInTheDocument())
  })

  it('submit en edición llama apiClient.put', async () => {
    vi.mocked(apiClient.put).mockResolvedValue(mockRule)
    wrapEdit()
    await waitFor(() => screen.getByDisplayValue('Presión alta'))
    await advanceToReview('Presión alta')
    fireEvent.click(screen.getByText('Guardar cambios'))
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      '/api/v1/rules/r1', expect.objectContaining({ name: 'Presión alta' })
    ))
  })

  it('muestra error si nombre está vacío al intentar avanzar del paso 1', async () => {
    wrapCreate()
    // Intentar avanzar sin rellenar el nombre
    fireEvent.click(screen.getByText('Siguiente →'))
    expect(screen.getByText(/El nombre es obligatorio/)).toBeInTheDocument()
  })
})
