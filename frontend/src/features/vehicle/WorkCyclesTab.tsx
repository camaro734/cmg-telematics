import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { WorkCycleDefinition, WorkCycle } from '../../lib/types'
import { exportToCsv } from '../../lib/csvExport'
import { Input } from '../../shared/ui/Input'

interface Props {
  vehicleId: string
  vehicleTypeId: string
  tenantId: string
}


function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
}

function getDefaultRange(): { from: string; to: string } {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 16,
}

export default function WorkCyclesTab({ vehicleId, vehicleTypeId }: Props) {
  const defaultRange = getDefaultRange()
  const [fromDate, setFromDate] = useState(defaultRange.from)
  const [toDate, setToDate] = useState(defaultRange.to)
  const [selectedDefinitionId, setSelectedDefinitionId] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: definitions = [] } = useQuery({
    queryKey: keys.workCycleDefinitions(vehicleTypeId),
    queryFn: () => apiClient.get<WorkCycleDefinition[]>(
      `/api/v1/work-cycles/definitions?vehicle_type_id=${vehicleTypeId}`
    ),
  })

  const activeDefinitions = definitions.filter(d => d.active)

  const fromDt = fromDate + 'T00:00:00Z'
  const toDt = toDate + 'T23:59:59Z'

  const { data: cycles = [], isLoading } = useQuery({
    queryKey: keys.workCycles(vehicleId, fromDt, toDt),
    queryFn: () => {
      const params = new URLSearchParams({ vehicle_id: vehicleId, from_dt: fromDt, to_dt: toDt })
      if (selectedDefinitionId) params.set('definition_id', selectedDefinitionId)
      return apiClient.get<WorkCycle[]>(`/api/v1/work-cycles?${params}`)
    },
    enabled: !!vehicleId,
  })

  const computeMutation = useMutation({
    mutationFn: (definitionId: string) =>
      apiClient.post<{ computed: number }>('/api/v1/work-cycles/compute', {
        vehicle_id: vehicleId,
        definition_id: definitionId,
        from_dt: fromDt,
        to_dt: toDt,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-cycles'] })
    },
  })

  const defnMap = Object.fromEntries(definitions.map(d => [d.id, d]))

  function handleExport() {
    const allCycleKeys = Array.from(
      new Set(cycles.flatMap(c => Object.keys(c.cycle_data)))
    ).sort()

    const rows = cycles.map(cycle => {
      const row: Record<string, string | number | null | undefined> = {
        definition: defnMap[cycle.definition_id]?.name ?? cycle.definition_id,
        started_at: cycle.started_at,
        ended_at: cycle.ended_at,
        duration_seconds: cycle.duration_seconds,
        lat: cycle.lat,
        lon: cycle.lon,
      }
      for (const key of allCycleKeys) {
        const v = cycle.cycle_data[key]
        row[key] = v != null ? String(v) : null
      }
      return row
    })

    const date = new Date().toISOString().slice(0, 10)
    exportToCsv(`ciclos_${vehicleId}_${date}.csv`, rows)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Controls */}
      <div style={{ ...cardStyle, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--offline)', marginBottom: 4 }}>DEFINICIÓN</div>
          <select
            value={selectedDefinitionId}
            onChange={e => setSelectedDefinitionId(e.target.value)}
            style={{ background: 'var(--bg-card)', color: 'var(--fg-secondary)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', fontSize: 13 }}
          >
            <option value="">Todas</option>
            {activeDefinitions.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--offline)', marginBottom: 4 }}>DESDE</div>
          <Input type="date" size="sm" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--offline)', marginBottom: 4 }}>HASTA</div>
          <Input type="date" size="sm" value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>
        {selectedDefinitionId && (
          <button
            onClick={() => computeMutation.mutate(selectedDefinitionId)}
            disabled={computeMutation.isPending}
            style={{ padding: '6px 14px', background: 'var(--cmg-teal)', color: '#fff', border: 'none', borderRadius: 5, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
          >
            {computeMutation.isPending ? 'Calculando…' : 'Calcular ciclos'}
          </button>
        )}
        {computeMutation.isSuccess && (
          <span style={{ fontSize: 12, color: 'var(--ok)' }}>
            {computeMutation.data.computed} ciclos detectados
          </span>
        )}
        {cycles.length > 0 && (
          <button
            onClick={handleExport}
            style={{ padding: '6px 12px', background: 'var(--bg-card)', color: 'var(--fg-secondary)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 13, cursor: 'pointer' }}
          >
            Exportar CSV
          </button>
        )}
      </div>

      {/* Table */}
      <div style={cardStyle}>
        {isLoading ? (
          <div style={{ color: 'var(--offline)', fontSize: 13 }}>Cargando ciclos…</div>
        ) : cycles.length === 0 ? (
          <div style={{ color: 'var(--offline)', fontSize: 13 }}>
            No hay ciclos para este período.
            {selectedDefinitionId ? ' Pulsa "Calcular ciclos" para detectarlos.' : ' Selecciona una definición y pulsa "Calcular ciclos".'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--offline)', fontWeight: 600 }}>Definición</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--offline)', fontWeight: 600 }}>Inicio</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--offline)', fontWeight: 600 }}>Fin</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--offline)', fontWeight: 600 }}>Duración</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--offline)', fontWeight: 600 }}>GPS</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--offline)', fontWeight: 600 }}>Datos</th>
              </tr>
            </thead>
            <tbody>
              {cycles.map(cycle => (
                <React.Fragment key={cycle.id}>
                  <tr
                    style={{ borderBottom: '1px solid var(--bg-card)', cursor: 'pointer' }}
                    onClick={() => setExpandedId(expandedId === cycle.id ? null : cycle.id)}
                  >
                    <td style={{ padding: '6px 8px', color: 'var(--fg-secondary)' }}>
                      {defnMap[cycle.definition_id]?.name ?? '—'}
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--fg-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {formatDate(cycle.started_at)}
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--fg-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {formatDate(cycle.ended_at)}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--cmg-teal)', fontFamily: 'var(--font-mono)' }}>
                      {formatDuration(cycle.duration_seconds)}
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--offline)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {cycle.lat != null ? `${Number(cycle.lat).toFixed(4)}, ${Number(cycle.lon).toFixed(4)}` : '—'}
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--info)', fontSize: 11 }}>
                      {Object.keys(cycle.cycle_data).length > 0 ? '▶ ver datos' : '—'}
                    </td>
                  </tr>
                  {expandedId === cycle.id && Object.keys(cycle.cycle_data).length > 0 && (
                    <tr key={`${cycle.id}-expanded`}>
                      <td colSpan={6} style={{ padding: '4px 8px 8px 24px', background: 'var(--bg-card)' }}>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                          {Object.entries(cycle.cycle_data).map(([k, v]) => (
                            <div key={k}>
                              <span style={{ color: 'var(--offline)', fontSize: 10 }}>{k}: </span>
                              <span style={{ color: 'var(--fg-secondary)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
