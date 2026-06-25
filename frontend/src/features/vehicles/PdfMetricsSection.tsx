import { useState, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useConfirm } from '../../shared/ui/ConfirmDialog'
import type { PdfMetricItem, PdfMetricFormat, PdfMetricAggregate, VehicleTypeOut, SensorDef } from '../../lib/types'
import { Input } from '../../shared/ui/Input'
import { Select } from '../../shared/ui/Select'

interface CatalogEntry {
  key: string
  label: string
  unit: string
  format: PdfMetricFormat
  source: 'stop' | 'sensor'
  aggregate?: PdfMetricAggregate
}

// Métricas "de parada": columnas fijas que agrega el rules-engine en cada parada.
const CATALOG: CatalogEntry[] = [
  { key: 'pto_minutes',   label: 'Tiempo PTO',   unit: 'min', format: 'integer',  source: 'stop' },
  { key: 'pressure_min',  label: 'Presión mín.', unit: 'bar', format: 'decimal1', source: 'stop' },
  { key: 'pressure_max',  label: 'Presión máx.', unit: 'bar', format: 'decimal1', source: 'stop' },
  { key: 'rpm_avg',       label: 'RPM medio',    unit: 'rpm', format: 'integer',  source: 'stop' },
  { key: 'pump_minutes',  label: 'Tiempo bomba', unit: 'min', format: 'integer',  source: 'stop' },
  { key: 'fuel_l',        label: 'Combustible',  unit: 'L',   format: 'decimal1', source: 'stop' },
]

const FORMAT_LABELS: Record<PdfMetricFormat, string> = {
  integer:  'Entero',
  decimal1: '1 decimal',
  decimal2: '2 decimales',
}

const AGG_LABELS: Record<PdfMetricAggregate, string> = {
  max: 'Máximo', min: 'Mínimo', avg: 'Media', last: 'Último',
}

const SAMPLE_VALUES: Record<string, number> = {
  pto_minutes: 22, pressure_min: 7.8, pressure_max: 8.4,
  rpm_avg: 1850, pump_minutes: 18, fuel_l: 4.2,
}

function formatSample(v: number, fmt: PdfMetricFormat, unit: string): string {
  if (fmt === 'integer')  return `${Math.trunc(v)} ${unit}`
  if (fmt === 'decimal1') return `${v.toFixed(1)} ${unit}`
  if (fmt === 'decimal2') return `${v.toFixed(2)} ${unit}`
  return `${v} ${unit}`
}

const buttonStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  color: 'var(--fg-primary)',
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
  const confirmAsk = useConfirm()
  const value: PdfMetricItem[] = selectedType.pdf_metrics ?? []

  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  const usedKeys = useMemo(() => new Set(value.map(m => m.key)), [value])

  // Opciones derivadas de los sensores configurados en el tipo de vehículo.
  const sensorOptions: CatalogEntry[] = useMemo(() =>
    ((selectedType.sensor_schema as SensorDef[] | undefined) ?? [])
      .filter(s => s.key)
      .map(s => ({
        key: s.key,
        label: s.label || s.key,
        unit: s.unit || '—',
        format: 'decimal1' as PdfMetricFormat,
        source: 'sensor' as const,
        aggregate: 'max' as PdfMetricAggregate,
      })),
    [selectedType.sensor_schema],
  )

  const availableStop = CATALOG.filter(c => !usedKeys.has(c.key))
  const availableSensor = sensorOptions.filter(c => !usedKeys.has(c.key))
  const available = [...availableStop, ...availableSensor]

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
  const remove = async (idx: number) => {
    const ok = await confirmAsk({
      title: 'Quitar métrica',
      message: '¿Quitar esta métrica del PDF?',
      confirmLabel: 'Quitar', kind: 'danger',
    })
    if (!ok) return
    save(value.filter((_, i) => i !== idx))
  }
  const update = (idx: number, patch: Partial<PdfMetricItem>) => {
    const next = [...value]
    next[idx] = { ...next[idx], ...patch }
    save(next)
  }
  const add = (m: CatalogEntry) => {
    const item: PdfMetricItem = { key: m.key, label: m.label, unit: m.unit, format: m.format, source: m.source }
    if (m.source === 'sensor') item.aggregate = m.aggregate ?? 'max'
    save([...value, item])
    setAdding(false)
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <h4 style={{ color: 'var(--fg-primary)', fontSize: 14, margin: '0 0 4px' }}>
          Métricas en el PDF de partes
        </h4>
        <p style={{ color: 'var(--fg-muted)', fontSize: 12, margin: 0 }}>
          Selecciona y ordena las métricas que aparecerán en cada parada del PDF de informe de servicio.
        </p>
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {value.length === 0 && (
          <li style={{ color: 'var(--fg-muted)', fontSize: 12, fontStyle: 'italic', padding: '12px 0' }}>
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
            <span style={{ color: 'var(--fg-primary)', fontSize: 13, fontWeight: 500 }}>
              {m.label}
              {m.source === 'sensor' && (
                <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--cmg-teal)', border: '1px solid var(--cmg-teal)', borderRadius: 4, padding: '1px 4px' }}>sensor</span>
              )}
            </span>
            <span style={{ color: 'var(--fg-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{m.key}</span>
            <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{m.unit}</span>
            <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
              {FORMAT_LABELS[m.format]}
              {m.source === 'sensor' && m.aggregate && (
                <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-dim)' }}>{AGG_LABELS[m.aggregate]}</span>
              )}
            </span>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              <button onClick={() => move(idx, -1)} disabled={idx === 0 || mutation.isPending} style={buttonStyle} title="Subir">↑</button>
              <button onClick={() => move(idx, +1)} disabled={idx === value.length - 1 || mutation.isPending} style={buttonStyle} title="Bajar">↓</button>
              <button onClick={() => setEditingIdx(idx)} disabled={mutation.isPending} style={buttonStyle} title="Editar">✎</button>
              <button onClick={() => remove(idx)} disabled={mutation.isPending} style={{ ...buttonStyle, color: 'var(--danger)' }} title="Quitar">✕</button>
            </div>
          </li>
        ))}
      </ul>

      {available.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {!adding ? (
            <button onClick={() => setAdding(true)} style={{ ...buttonStyle, background: 'var(--cmg-teal)', borderColor: 'var(--cmg-teal)', color: '#fff', padding: '6px 12px' }}>
              + Añadir métrica
            </button>
          ) : (
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: 10, marginTop: 4 }}>
              {[
                { title: 'Datos de la parada', items: availableStop },
                { title: 'Sensores configurados', items: availableSensor },
              ].filter(g => g.items.length > 0).map(group => (
                <div key={group.title} style={{ marginBottom: 10 }}>
                  <p style={{ color: 'var(--fg-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 6px' }}>{group.title}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {group.items.map(m => (
                      <button key={m.key} onClick={() => add(m)}
                              style={{ ...buttonStyle, padding: '8px 10px', textAlign: 'left' }}>
                        <span style={{ color: 'var(--fg-primary)' }}>{m.label}</span>
                        {' '}<span style={{ color: 'var(--fg-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>({m.key})</span>
                        {m.source === 'sensor' && <span style={{ color: 'var(--fg-dim)', fontSize: 11 }}> · agregado: {AGG_LABELS[m.aggregate ?? 'max']}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {available.length === 0 && (
                <p style={{ color: 'var(--fg-muted)', fontSize: 12, fontStyle: 'italic', margin: 0 }}>No quedan datos por añadir.</p>
              )}
              <button onClick={() => setAdding(false)} style={{ ...buttonStyle, marginTop: 4 }}>Cancelar</button>
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
          <h4 style={{ color: 'var(--fg-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>
            Vista previa
          </h4>
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: 10, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--fg-muted)', borderBottom: '1px solid var(--border)' }}>#</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--fg-muted)', borderBottom: '1px solid var(--border)' }}>Ubicación</th>
                  {value.map(m => (
                    <th key={m.key} style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--fg-muted)', borderBottom: '1px solid var(--border)' }}>{m.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: '6px 8px', color: 'var(--cmg-teal)', fontWeight: 600 }}>1</td>
                  <td style={{ padding: '6px 8px', color: 'var(--fg-primary)' }}>C/ Mayor 12, Valencia</td>
                  {value.map(m => (
                    <td key={m.key} style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)' }}>
                      {SAMPLE_VALUES[m.key] !== undefined ? formatSample(SAMPLE_VALUES[m.key], m.format, m.unit) : '—'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mutation.isError && (
        <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>
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
  const [aggregate, setAggregate] = useState<PdfMetricAggregate>(metric.aggregate ?? 'max')
  const isSensor = metric.source === 'sensor'

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, width: '100%', maxWidth: 360 }}>
        <h4 style={{ color: 'var(--fg-primary)', fontSize: 14, margin: '0 0 4px' }}>
          Editar métrica
        </h4>
        <p style={{ color: 'var(--fg-muted)', fontSize: 11, fontFamily: 'var(--font-mono)', margin: '0 0 14px' }}>
          {metric.key}
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Etiqueta a mostrar</span>
          <Input value={label} maxLength={60} onChange={e => setLabel(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Unidad</span>
          <Input value={unit} maxLength={10} onChange={e => setUnit(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
          <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Formato</span>
          <Select value={format} onChange={e => setFormat(e.target.value as PdfMetricFormat)}>
            <option value="integer">Entero</option>
            <option value="decimal1">1 decimal</option>
            <option value="decimal2">2 decimales</option>
          </Select>
        </label>
        {isSensor && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
            <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Agregado (sobre la parada)</span>
            <Select value={aggregate} onChange={e => setAggregate(e.target.value as PdfMetricAggregate)}>
              <option value="max">Máximo</option>
              <option value="min">Mínimo</option>
              <option value="avg">Media</option>
              <option value="last">Último</option>
            </Select>
          </label>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={buttonStyle}>Cancelar</button>
          <button
            onClick={() => onSave({
              label: label.trim() || metric.label,
              unit: unit.trim() || metric.unit,
              format,
              ...(isSensor ? { aggregate } : {}),
            })}
            style={{ ...buttonStyle, background: 'var(--cmg-teal)', borderColor: 'var(--cmg-teal)', color: '#fff' }}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
