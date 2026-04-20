import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import RuleFormPage from '../RuleFormPage'
import type { RuleOut, VehicleTypeOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}))
vi.mock('../../../features/auth/useAuthStore', () => ({
  useAuthStore: vi.fn(() => ({ user: { role: 'admin', tenant_tier: 'client' } })),
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

describe('RuleFormPage', () => {
  it('muestra formulario de creación vacío', () => {
    wrapCreate()
    expect(screen.getByPlaceholderText(/nombre de la regla/i)).toBeInTheDocument()
    expect(screen.getByText('Guardar regla')).toBeInTheDocument()
  })

  it('submit en creación llama apiClient.post con payload correcto', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(mockRule)
    wrapCreate()
    fireEvent.change(screen.getByPlaceholderText(/nombre de la regla/i), { target: { value: 'Nueva regla' } })
    fireEvent.click(screen.getByText('Guardar regla'))
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
    fireEvent.click(screen.getByText('Guardar regla'))
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      '/api/v1/rules/r1', expect.objectContaining({ name: 'Presión alta' })
    ))
  })

  it('muestra error si nombre está vacío al guardar', async () => {
    wrapCreate()
    fireEvent.click(screen.getByText('Guardar regla'))
    expect(screen.getByText(/El nombre es obligatorio/)).toBeInTheDocument()
  })
})
