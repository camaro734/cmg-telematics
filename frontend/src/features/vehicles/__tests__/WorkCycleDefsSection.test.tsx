import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import WorkCycleDefsSection from '../WorkCycleDefsSection'
import type { WorkCycleDefinition, SensorDef } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

import { apiClient } from '../../../lib/apiClient'
import { keys } from '../../../lib/queryKeys'

const mockDef: WorkCycleDefinition = {
  id: 'def-1',
  vehicle_type_id: 'type-1',
  tenant_id: null,
  name: 'Ciclo bomba',
  trigger_type: 'pto_change',
  trigger_config: {},
  snapshot_fields: ['hydraulic_pressure'],
  aggregate_fields: [],
  active: true,
  created_at: '2026-04-25T00:00:00Z',
}

const mockSchema: SensorDef[] = [
  { key: 'hydraulic_pressure', label: 'Presión Hidráulica', unit: 'bar', gauge_type: 'circular', avl_id: 305, min: 0, max: 600 },
  { key: 'oil_temp', label: 'Temp Aceite', unit: '°C', gauge_type: 'numeric', avl_id: 306 },
]

function wrap(definitions: WorkCycleDefinition[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(keys.workCycleDefinitions('type-1'), definitions)
  return render(
    <QueryClientProvider client={qc}>
      <WorkCycleDefsSection typeId="type-1" sensorSchema={mockSchema} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.mocked(apiClient.get).mockResolvedValue([])
  vi.mocked(apiClient.post).mockResolvedValue({ ...mockDef, id: 'def-new' })
  vi.mocked(apiClient.patch).mockResolvedValue({ ...mockDef, active: false })
  vi.mocked(apiClient.delete).mockResolvedValue(undefined)
})

describe('WorkCycleDefsSection', () => {
  it('muestra mensaje vacío cuando no hay definiciones', () => {
    wrap([])
    expect(screen.getByText(/Sin definiciones/)).toBeInTheDocument()
  })

  it('muestra el nombre y trigger en la tabla', () => {
    wrap([mockDef])
    expect(screen.getByText('Ciclo bomba')).toBeInTheDocument()
    expect(screen.getByText('pto_change')).toBeInTheDocument()
  })

  it('muestra el número de snapshot fields', () => {
    wrap([mockDef])
    expect(screen.getByText('1 campos')).toBeInTheDocument()
  })

  it('abre el modal al pulsar el botón de nueva definición', () => {
    wrap([])
    fireEvent.click(screen.getByText('+ Añadir definición'))
    expect(screen.getByText('Nueva definición de ciclo')).toBeInTheDocument()
  })

  it('cierra el modal al pulsar Cancelar', () => {
    wrap([])
    fireEvent.click(screen.getByText('+ Añadir definición'))
    fireEvent.click(screen.getByText('Cancelar'))
    expect(screen.queryByText('Nueva definición de ciclo')).not.toBeInTheDocument()
  })

  it('abre el modal de edición con el nombre pre-rellenado', () => {
    wrap([mockDef])
    const editBtn = screen.getByText('✎')
    fireEvent.click(editBtn)
    expect(screen.getByText('Editar definición de ciclo')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Ciclo bomba')).toBeInTheDocument()
  })

  it('llama a DELETE al pulsar ✕', async () => {
    wrap([mockDef])
    fireEvent.click(screen.getByText('✕'))
    await waitFor(() => {
      expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/work-cycles/definitions/def-1')
    })
  })

  it('llama a PATCH al pulsar el toggle de activo', async () => {
    wrap([mockDef])
    fireEvent.click(screen.getByText('Activo'))
    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalledWith(
        '/api/v1/work-cycles/definitions/def-1',
        { active: false }
      )
    })
  })

  it('llama a POST con los datos del formulario al crear', async () => {
    wrap([])
    fireEvent.click(screen.getByText('+ Añadir definición'))
    fireEvent.change(screen.getByPlaceholderText('ej. Ciclo bomba agua'), { target: { value: 'Mi ciclo' } })
    fireEvent.click(screen.getByText('Crear'))
    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/v1/work-cycles/definitions',
        expect.objectContaining({ name: 'Mi ciclo', trigger_type: 'pto_change', vehicle_type_id: 'type-1' })
      )
    })
  })

  it('muestra campos de sensor cuando el trigger es threshold_exceeded', () => {
    wrap([])
    fireEvent.click(screen.getByText('+ Añadir definición'))
    const select = screen.getByRole('combobox', { name: /tipo de trigger/i })
    fireEvent.change(select, { target: { value: 'threshold_exceeded' } })
    expect(screen.getByText('SENSOR (CLAVE EN can_data)')).toBeInTheDocument()
    expect(screen.getByText('UMBRAL')).toBeInTheDocument()
  })

  it('llama a POST con trigger_config correcto para threshold_exceeded', async () => {
    wrap([])
    fireEvent.click(screen.getByText('+ Añadir definición'))
    fireEvent.change(screen.getByPlaceholderText('ej. Ciclo bomba agua'), { target: { value: 'Ciclo presión' } })
    const triggerSelect = screen.getByRole('combobox', { name: /tipo de trigger/i })
    fireEvent.change(triggerSelect, { target: { value: 'threshold_exceeded' } })
    const sensorSelect = screen.getAllByRole('combobox')[1]
    fireEvent.change(sensorSelect, { target: { value: 'hydraulic_pressure' } })
    const opSelect = screen.getByDisplayValue('>')
    fireEvent.change(opSelect, { target: { value: '>=' } })
    fireEvent.change(screen.getByPlaceholderText('ej. 280'), { target: { value: '300' } })
    fireEvent.click(screen.getByText('Crear'))
    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/v1/work-cycles/definitions',
        expect.objectContaining({
          name: 'Ciclo presión',
          trigger_type: 'threshold_exceeded',
          trigger_config: { sensor: 'hydraulic_pressure', op: '>=', threshold: 300 },
        })
      )
    })
  })
})
