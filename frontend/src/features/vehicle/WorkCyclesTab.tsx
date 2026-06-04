import { useState, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { WorkCycleDefinition, WorkCycle } from '../../lib/types'
import { exportToCsv } from '../../lib/csvExport'
import { Select } from '../../shared/ui/Select'

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

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--fg-muted)',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  marginBottom: 4,
}

const dateInputStyle: React.CSSProperties = {
  fontSize: 12,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 5,
  padding: '3px 8px',
  color: 'var(--fg-primary)',
  colorScheme: 'dark',
}

const btnPrimaryStyle: React.CSSProperties = {
  background: 'var(--cmg-teal)',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '7px 16px',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 600,
}

const btnSecondaryStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  color: 'var(--fg-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '7px 16px',
  fontSize: 13,
  cursor: 'pointer',
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  color: 'var(--fg-muted)',
  fontWeight: 600,
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
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderTop: '2px solid var(--cmg-teal)',
      borderRadius: 8,
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>

      {/* Cabecera */}
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-muted)', letterSpacing: '0.07em', textTransform: 'uppercase' as const }}>
        Ciclos
      </div>

      {/* Controles */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <div style={labelStyle}>Definición</div>
          <Select value={selectedDefinitionId} onChange={e => setSelectedDefinitionId(e.target.value)}>
            <option value="">Todas</option>
            {activeDefinitions.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <div style={labelStyle}>Desde</div>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={dateInputStyle} />
        </div>
        <div>
          <div style={labelStyle}>Hasta</div>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={dateInputStyle} />
        </div>
        {selectedDefinitionId && (
          <button
            onClick={() => computeMutation.mutate(selectedDefinitionId)}
            disabled={computeMutation.isPending}
            style={btnPrimaryStyle}
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
          <button onClick={handleExport} style={btnSecondaryStyle}>
            Exportar CSV
          </button>
        )}
      </div>

      {/* Contenido */}
      {isLoading ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 13, padding: '8px 0' }}>Cargando ciclos…</div>
      ) : cycles.length === 0 ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 13, padding: '8px 0' }}>
          {selectedDefinitionId
            ? 'Sin ciclos en el rango seleccionado. Pulsa "Calcular ciclos" para detectarlos.'
            : 'Sin ciclos en el rango seleccionado.'}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={thStyle}>Definición</th>
              <th style={thStyle}>Inicio</th>
              <th style={thStyle}>Fin</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Duración</th>
              <th style={thStyle}>GPS</th>
              <th style={thStyle}>Datos</th>
            </tr>
          </thead>
          <tbody>
            {cycles.map(cycle => (
              <Fragment key={cycle.id}>
                <tr
                  style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
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
                  <td style={{ padding: '6px 8px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {cycle.lat != null ? `${Number(cycle.lat).toFixed(4)}, ${Number(cycle.lon).toFixed(4)}` : '—'}
                  </td>
                  <td style={{ padding: '6px 8px', color: 'var(--info)', fontSize: 11 }}>
                    {Object.keys(cycle.cycle_data).length > 0 ? '▶ ver datos' : '—'}
                  </td>
                </tr>
                {expandedId === cycle.id && Object.keys(cycle.cycle_data).length > 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: '4px 8px 8px 24px', background: 'var(--bg-card)' }}>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        {Object.entries(cycle.cycle_data).map(([k, v]) => (
                          <div key={k}>
                            <span style={{ color: 'var(--fg-muted)', fontSize: 10 }}>{k}: </span>
                            <span style={{ color: 'var(--fg-secondary)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
