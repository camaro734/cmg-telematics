import { useState, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { PdfMetricItem, PdfMetricKey, PdfMetricFormat, VehicleTypeOut } from '../../lib/types'

interface CatalogEntry {
  key: PdfMetricKey
  label: string
  unit: string
  format: PdfMetricFormat
}

const CATALOG: CatalogEntry[] = [
  { key: 'pto_minutes',   label: 'Tiempo PTO',   unit: 'min', format: 'integer'  },
  { key: 'pressure_min',  label: 'Presión mín.', unit: 'bar', format: 'decimal1' },
  { key: 'pressure_max',  label: 'Presión máx.', unit: 'bar', format: 'decimal1' },
  { key: 'rpm_avg',       label: 'RPM medio',    unit: 'rpm', format: 'integer'  },
  { key: 'pump_minutes',  label: 'Tiempo bomba', unit: 'min', format: 'integer'  },
  { key: 'fuel_l',        label: 'Combustible',  unit: 'L',   format: 'decimal1' },
]

const FORMAT_LABELS: Record<PdfMetricFormat, string> = {
  integer:  'Entero',
  decimal1: '1 decimal',
  decimal2: '2 decimales',
}

const SAMPLE_VALUES: Record<PdfMetricKey, number> = {
  pto_minutes: 22, pressure_min: 7.8, pressure_max: 8.4,
  rpm_avg: 1850, pump_minutes: 18, fuel_l: 4.2,
}

function formatSample(v: number, fmt: PdfMetricFormat, unit: string): string {
  if (fmt === 'integer')  return `${Math.trunc(v)} ${unit}`
  if (fmt === 'decimal1') return `${v.toFixed(1)} ${unit}`
  if (fmt === 'decimal2') return `${v.toFixed(2)} ${unit}`
  return `${v} ${unit}`
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--bg-border)',
  color: 'var(--text-primary)',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
}

const buttonStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--bg-border)',
  color: 'var(--text-primary)',
  borderRadius: 4,
  padding: '4px 8px',
  fontSize: 12,
  cursor: 'pointer',
}

interface Props {
  typeId: string
  selectedType: VehicleTypeOut
}

export default function PdfMetricsSection({ typeId, selectedType }: Props) {
  const qc = useQueryClient()
  const value: PdfMetricItem[] = selectedType.pdf_metrics ?? []

  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  const usedKeys = useMemo(() => new Set(value.map(m => m.key)), [value])
  const available = CATALOG.filter(c => !usedKeys.has(c.key))

  const mutation = useMutation({
    mutationFn: (next: PdfMetricItem[]) =>
      apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${typeId}`, { pdf_metrics: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.vehicleTypes() }),
  })

  const save = (next: PdfMetricItem[]) => mutation.mutate(next)

  const move = (idx: number, delta: number) => {
    const j = idx + delta
    if (j < 0 || j >= value.length) return
    const next = [...value]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    save(next)
  }
  const remove = (idx: number) => {
    if (!confirm('¿Quitar esta métrica del PDF?')) return
    save(value.filter((_, i) => i !== idx))
  }
  const update = (idx: number, patch: Partial<PdfMetricItem>) => {
    const next = [...value]
    next[idx] = { ...next[idx], ...patch }
    save(next)
  }
  const add = (m: CatalogEntry) => {
    save([...value, { key: m.key, label: m.label, unit: m.unit, format: m.format }])
    setAdding(false)
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <h4 style={{ color: 'var(--text-primary)', fontSize: 14, margin: '0 0 4px' }}>
          Métricas en el PDF de partes
        </h4>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>
          Selecciona y ordena las métricas que aparecerán en cada parada del PDF de informe de servicio.
        </p>
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {value.length === 0 && (
          <li style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic', padding: '12px 0' }}>
            Sin métricas configuradas — el PDF mostrará solo la lista de paradas sin tabla de mediciones.
          </li>
        )}
        {value.map((m, idx) => (
          <li key={m.key}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(160px,1.5fr) minmax(120px,1fr) 80px 100px auto',
                gap: 8, alignItems: 'center',
                background: 'var(--bg-elevated)', borderRadius: 6, padding: '8px 10px',
              }}>
            <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500 }}>{m.label}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-data)' }}>{m.key}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{m.unit}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{FORMAT_LABELS[m.format]}</span>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              <button onClick={() => move(idx, -1)} disabled={idx === 0 || mutation.isPending} style={buttonStyle} title="Subir">↑</button>
              <button onClick={() => move(idx, +1)} disabled={idx === value.length - 1 || mutation.isPending} style={buttonStyle} title="Bajar">↓</button>
              <button onClick={() => setEditingIdx(idx)} disabled={mutation.isPending} style={buttonStyle} title="Editar">✎</button>
              <button onClick={() => remove(idx)} disabled={mutation.isPending} style={{ ...buttonStyle, color: 'var(--accent-crit)' }} title="Quitar">✕</button>
            </div>
          </li>
        ))}
      </ul>

      {available.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {!adding ? (
            <button onClick={() => setAdding(true)} style={{ ...buttonStyle, background: 'var(--accent-energy)', borderColor: 'var(--accent-energy)', color: '#fff', padding: '6px 12px' }}>
              + Añadir métrica
            </button>
          ) : (
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: 10, marginTop: 4 }}>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '0 0 8px' }}>Elige una métrica del catálogo:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {available.map(m => (
                  <button key={m.key} onClick={() => add(m)}
                          style={{ ...buttonStyle, padding: '8px 10px', textAlign: 'left' }}>
                    <span style={{ color: 'var(--text-primary)' }}>{m.label}</span>
                    {' '}<span style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-data)' }}>({m.key})</span>
                  </button>
                ))}
              </div>
              <button onClick={() => setAdding(false)} style={{ ...buttonStyle, marginTop: 8 }}>Cancelar</button>
            </div>
          )}
        </div>
      )}

      {editingIdx !== null && (
        <EditMetricModal
          metric={value[editingIdx]}
          onSave={patch => { update(editingIdx, patch); setEditingIdx(null) }}
          onCancel={() => setEditingIdx(null)}
        />
      )}

      {value.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <h4 style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>
            Vista previa
          </h4>
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: 10, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--bg-border)' }}>#</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--bg-border)' }}>Ubicación</th>
                  {value.map(m => (
                    <th key={m.key} style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-muted)', borderBottom: '1px solid var(--bg-border)' }}>{m.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: '6px 8px', color: 'var(--accent-energy)', fontWeight: 600 }}>1</td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-primary)' }}>C/ Mayor 12, Valencia</td>
                  {value.map(m => (
                    <td key={m.key} style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-primary)', fontFamily: 'var(--font-data)' }}>
                      {formatSample(SAMPLE_VALUES[m.key], m.format, m.unit)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mutation.isError && (
        <p style={{ color: 'var(--accent-crit)', fontSize: 12, marginTop: 8 }}>
          Error al guardar. Revisa la consola.
        </p>
      )}
    </div>
  )
}

function EditMetricModal({ metric, onSave, onCancel }: {
  metric: PdfMetricItem
  onSave: (patch: Partial<PdfMetricItem>) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState(metric.label)
  const [unit, setUnit]   = useState(metric.unit)
  const [format, setFormat] = useState<PdfMetricFormat>(metric.format)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 8, padding: 20, width: '100%', maxWidth: 360 }}>
        <h4 style={{ color: 'var(--text-primary)', fontSize: 14, margin: '0 0 4px' }}>
          Editar métrica
        </h4>
        <p style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-data)', margin: '0 0 14px' }}>
          {metric.key}
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Etiqueta a mostrar</span>
          <input value={label} maxLength={60} onChange={e => setLabel(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Unidad</span>
          <input value={unit} maxLength={10} onChange={e => setUnit(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Formato</span>
          <select value={format} onChange={e => setFormat(e.target.value as PdfMetricFormat)} style={inputStyle}>
            <option value="integer">Entero</option>
            <option value="decimal1">1 decimal</option>
            <option value="decimal2">2 decimales</option>
          </select>
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={buttonStyle}>Cancelar</button>
          <button
            onClick={() => onSave({
              label: label.trim() || metric.label,
              unit: unit.trim() || metric.unit,
              format,
            })}
            style={{ ...buttonStyle, background: 'var(--accent-energy)', borderColor: 'var(--accent-energy)', color: '#fff' }}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
