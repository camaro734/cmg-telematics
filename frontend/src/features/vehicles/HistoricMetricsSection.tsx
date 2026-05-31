import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleTypeOut, HistoricMetricItem } from '../../lib/types'
import { AVL_NAMES, AVL_OPTIONS } from '../../lib/avlNames'

// ── Types ──────────────────────────────────────────────────────────────────

type MetricFormState = {
  key: string
  label: string
  color: string
  unit: string
  transform: string
  avl_id: string
  chart_type: 'line' | 'donut' | 'bar'
  show_in_pdf: boolean
  group: string
}

const emptyMetricForm: MetricFormState = {
  key: '', label: '', color: '#22C55E', unit: '', transform: '1',
  avl_id: '', chart_type: 'line', show_in_pdf: true, group: '',
}

// Solo campos que existen realmente en la vista telemetry_1h (aggregate continua de TimescaleDB)
const KPI_OPTIONS = [
  { key: 'engine_on_minutes', label: 'Horas motor',      unit: 'h', transform: 0.01667, color: '#22C55E' },
  { key: 'pto_active_minutes', label: 'Horas PTO',       unit: 'h', transform: 0.01667, color: 'var(--energy-orange)' },
  { key: 'avg_pressure_1',     label: 'Presión media 1', unit: 'bar', transform: 1,     color: '#38BDF8' },
  { key: 'avg_oil_temp',       label: 'Temp. aceite',    unit: '°C',  transform: 1,     color: '#EAB308' },
]

// ── Shared styles ──────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  color: 'var(--fg-primary)',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--offline)',
  fontWeight: 600,
  letterSpacing: '0.04em',
  marginBottom: 4,
  display: 'block',
}

const btnPrimary: React.CSSProperties = {
  background: 'var(--cmg-teal)',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '7px 16px',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 600,
}

const btnSecondary: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  color: 'var(--fg-primary)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '7px 16px',
  fontSize: 13,
  cursor: 'pointer',
}

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  typeId: string
  selectedType: VehicleTypeOut
}

export default function HistoricMetricsSection({ typeId, selectedType }: Props) {
  const qc = useQueryClient()

  const [showMetricModal, setShowMetricModal] = useState(false)
  const [metricError, setMetricError] = useState<string | null>(null)
  const [editingMetricIdx, setEditingMetricIdx] = useState<number | null>(null)
  const [metricForm, setMetricForm] = useState<MetricFormState>(emptyMetricForm)

  const updateMetricsMutation = useMutation({
    mutationFn: ({ metrics }: { metrics: HistoricMetricItem[] }) =>
      apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${typeId}/historic-metrics`, { report_metrics: metrics }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.vehicleTypes() })
      setShowMetricModal(false)
    },
  })

  function openNewMetric() {
    setEditingMetricIdx(null)
    setMetricForm(emptyMetricForm)
    setShowMetricModal(true)
  }

  function openEditMetric(m: HistoricMetricItem, idx: number) {
    setEditingMetricIdx(idx)
    setMetricForm({
      key: m.key,
      label: m.label,
      color: m.color,
      unit: m.unit,
      transform: m.transform.toString(),
      avl_id: m.avl_id?.toString() ?? '',
      chart_type: m.chart_type ?? 'line',
      show_in_pdf: m.show_in_pdf ?? true,
      group: m.group ?? '',
    })
    setShowMetricModal(true)
  }

  function saveMetric() {
    if (!metricForm.label.trim()) {
      setMetricError('El nombre de la métrica es obligatorio')
      return
    }
    if (!metricForm.avl_id) {
      setMetricError('Debes seleccionar una señal FMC650')
      return
    }
    setMetricError(null)
    const autoKey = metricForm.key || `custom_avl_${metricForm.avl_id}`
    const newMetric: HistoricMetricItem = {
      key: autoKey,
      label: metricForm.label.trim() || metricForm.key,
      color: metricForm.color,
      unit: metricForm.unit,
      transform: parseFloat(metricForm.transform) || 1,
      avl_id: metricForm.avl_id ? parseInt(metricForm.avl_id) : undefined,
      chart_type: metricForm.chart_type,
      show_in_pdf: metricForm.show_in_pdf,
      group: metricForm.group.trim() || null,
    }
    const current: HistoricMetricItem[] = selectedType.historic_metrics ?? []
    let next: HistoricMetricItem[]
    if (editingMetricIdx === null) {
      next = [...current, newMetric]
    } else {
      next = current.map((m, i) => i === editingMetricIdx ? newMetric : m)
    }
    updateMetricsMutation.mutate({ metrics: next })
  }

  function deleteMetric(idx: number) {
    const next = (selectedType.historic_metrics ?? []).filter((_, i) => i !== idx)
    updateMetricsMutation.mutate({ metrics: next })
  }

  return (
    <>
      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Métricas del histórico
          </span>
          {(selectedType.historic_metrics ?? []).length < 5 && (
            <button style={btnPrimary} onClick={openNewMetric}>+ Añadir métrica</button>
          )}
        </div>
        {(selectedType.historic_metrics ?? []).length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Sin métricas configuradas</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['MÉTRICA', 'ETIQUETA', 'COLOR', 'TIPO GRÁFICO', 'GRUPO', 'PDF', ''].map(h => (
                  <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(selectedType.historic_metrics ?? []).map((m, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', color: 'var(--offline)', fontSize: 11 }}>{m.key}</td>
                  <td style={{ padding: '6px 8px' }}>{m.label}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <span style={{
                      display: 'inline-block', width: 14, height: 14, borderRadius: 3,
                      background: m.color, verticalAlign: 'middle',
                      border: '1px solid rgba(255,255,255,0.15)',
                    }} />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <span style={{
                      fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600,
                      background: 'var(--bg-base)',
                      color: m.chart_type === 'line' ? 'var(--info)' : m.chart_type === 'donut' ? 'var(--cmg-teal)' : 'var(--ok)',
                    }}>
                      {m.chart_type === 'donut' ? 'Dona' : m.chart_type === 'bar' ? 'Barra' : 'Línea'}
                    </span>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {m.group ? (
                      <span style={{
                        fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600,
                        background: 'rgba(56,189,248,0.12)',
                        color: 'var(--info)',
                        border: '1px solid rgba(56,189,248,0.25)',
                        fontFamily: 'var(--font-mono)',
                      }}>
                        {m.group}
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <span style={{ fontSize: 10, color: (m.show_in_pdf ?? true) ? 'var(--ok)' : 'var(--fg-muted)' }}>
                      {(m.show_in_pdf ?? true) ? '✓' : '—'}
                    </span>
                  </td>
                  <td style={{ padding: '6px 8px', display: 'flex', gap: 6 }}>
                    <button style={btnSecondary} onClick={() => openEditMetric(m, idx)}>✎</button>
                    <button style={{ ...btnSecondary, color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => deleteMetric(idx)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Modal: Métrica del histórico ───────────────────────────────── */}
      {showMetricModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, overflow: 'auto', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) { setShowMetricModal(false); setMetricError(null) } }}
        >
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 24, width: 440, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--fg-primary)' }}>
              {editingMetricIdx === null ? 'Nueva métrica de reporte' : 'Editar métrica de reporte'}
            </h3>

            <div>
              <label style={labelStyle}>MÉTRICA (KPI)</label>
              <select
                style={inputStyle}
                value={metricForm.key}
                onChange={e => {
                  const opt = KPI_OPTIONS.find(o => o.key === e.target.value)
                  setMetricForm(f => ({
                    ...f,
                    key: e.target.value,
                    label: opt ? opt.label : f.label,
                    unit: opt ? opt.unit : f.unit,
                    color: opt ? opt.color : f.color,
                    transform: opt ? opt.transform.toString() : f.transform,
                  }))
                }}
              >
                <option value="">— Selecciona —</option>
                {KPI_OPTIONS.map(o => (
                  <option key={o.key} value={o.key}>{o.label} ({o.key})</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>ETIQUETA</label>
                <input
                  style={inputStyle}
                  value={metricForm.label}
                  onChange={e => setMetricForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="Nombre visible en el histórico"
                />
              </div>
              <div>
                <label style={labelStyle}>SEÑAL FMC650</label>
                <select
                  style={inputStyle}
                  value={AVL_OPTIONS.some(o => String(o.id) === metricForm.avl_id) ? metricForm.avl_id : metricForm.avl_id ? '__custom__' : ''}
                  onChange={e => {
                    if (e.target.value === '__custom__') {
                      setMetricForm(f => ({ ...f, avl_id: '' }))
                    } else if (e.target.value === '') {
                      setMetricForm(f => ({ ...f, avl_id: '' }))
                    } else {
                      const info = AVL_NAMES[`avl_${e.target.value}`]
                      setMetricForm(f => ({
                        ...f,
                        avl_id: e.target.value,
                        label: f.label || (info?.name ?? ''),
                        unit: f.unit || (info?.unit ?? ''),
                      }))
                    }
                  }}
                >
                  <option value="">-- Selecciona señal --</option>
                  {AVL_OPTIONS.map(opt => (
                    <option key={opt.id} value={String(opt.id)}>
                      AVL {opt.id} — {opt.name}{opt.unit ? ` (${opt.unit})` : ''}
                    </option>
                  ))}
                  <option value="__custom__">Otro AVL ID personalizado...</option>
                </select>
                {!AVL_OPTIONS.some(o => String(o.id) === metricForm.avl_id) && (
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    style={{ ...inputStyle, marginTop: 6 }}
                    value={metricForm.avl_id}
                    onChange={e => setMetricForm(f => ({ ...f, avl_id: e.target.value }))}
                    placeholder="AVL ID numérico (1–65535)"
                  />
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>COLOR</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="color"
                    value={metricForm.color}
                    onChange={e => setMetricForm(f => ({ ...f, color: e.target.value }))}
                    style={{ width: 36, height: 32, padding: 2, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-elevated)', cursor: 'pointer' }}
                  />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--offline)' }}>{metricForm.color}</span>
                </div>
              </div>
              <div>
                <label style={labelStyle}>UNIDAD</label>
                <input
                  style={inputStyle}
                  value={metricForm.unit}
                  onChange={e => setMetricForm(f => ({ ...f, unit: e.target.value }))}
                  placeholder="h, km, km/h, …"
                />
              </div>
            </div>

            <div>
              <label style={labelStyle}>MULTIPLICADOR (transform) — ej: 0.01667 para convertir minutos a horas</label>
              <input
                type="number"
                step="any"
                min="0"
                style={inputStyle}
                value={metricForm.transform}
                onChange={e => setMetricForm(f => ({ ...f, transform: e.target.value }))}
                placeholder="1"
              />
            </div>

            <div>
              <label style={labelStyle}>TIPO DE GRÁFICO</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {([
                  { value: 'line', label: 'Línea' },
                  { value: 'donut', label: 'Dona' },
                  { value: 'bar', label: 'Barra' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMetricForm(f => ({ ...f, chart_type: opt.value }))}
                    style={{
                      flex: 1, padding: '7px 0', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      border: metricForm.chart_type === opt.value ? '2px solid var(--cmg-teal)' : '1px solid var(--border)',
                      background: metricForm.chart_type === opt.value ? 'rgba(249,115,22,0.12)' : 'var(--bg-surface)',
                      color: metricForm.chart_type === opt.value ? 'var(--cmg-teal)' : 'var(--offline)',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={labelStyle}>AGRUPAR CON (opcional)</label>
              <input
                style={inputStyle}
                value={metricForm.group}
                onChange={e => setMetricForm(f => ({ ...f, group: e.target.value }))}
                placeholder="ej: presiones, horas (opcional)"
              />
              <div style={{ fontSize: 11, color: 'var(--offline)', marginTop: 4 }}>
                Métricas con el mismo grupo se mostrarán en un solo gráfico multi-serie
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="checkbox"
                id="metric-pdf"
                checked={metricForm.show_in_pdf}
                onChange={e => setMetricForm(f => ({ ...f, show_in_pdf: e.target.checked }))}
              />
              <label htmlFor="metric-pdf" style={{ fontSize: 13, color: 'var(--fg-primary)', cursor: 'pointer' }}>
                Incluir en informe PDF
              </label>
            </div>

            {updateMetricsMutation.isError && (
              <div style={{ fontSize: 12, color: 'var(--danger)' }}>
                {(updateMetricsMutation.error as Error).message}
              </div>
            )}

            {metricError && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#ef4444' }}>
                {metricError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => { setShowMetricModal(false); setMetricError(null) }}>Cancelar</button>
              <button
                style={btnPrimary}
                onClick={saveMetric}
                disabled={updateMetricsMutation.isPending}
              >
                {updateMetricsMutation.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
