import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleTypeOut, MaintenanceTemplateItem } from '../../lib/types'

// ── Types ──────────────────────────────────────────────────────────────────

type TemplateFormState = {
  name: string
  thresholdType: 'pto_hours' | 'engine_hours' | 'calendar_days'
  value: string
  warn_before_pct: string
}

const emptyTemplateForm: TemplateFormState = {
  name: '', thresholdType: 'pto_hours', value: '', warn_before_pct: '10',
}

// ── Shared styles ──────────────────────────────────────────────────────────

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

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--accent-off)',
  fontWeight: 600,
  letterSpacing: '0.04em',
  marginBottom: 4,
  display: 'block',
}

const btnPrimary: React.CSSProperties = {
  background: 'var(--accent-energy)',
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
  color: 'var(--text-primary)',
  border: '1px solid var(--bg-border)',
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

export default function MaintenanceTemplatesSection({ typeId, selectedType }: Props) {
  const qc = useQueryClient()

  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [editingTemplateIdx, setEditingTemplateIdx] = useState<number | null>(null)
  const [templateForm, setTemplateForm] = useState<TemplateFormState>(emptyTemplateForm)
  const [applyResult, setApplyResult] = useState<{ created: number } | null>(null)

  const applyTemplatesMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<{ created: number }>(`/api/v1/vehicle-types/${id}/apply-maintenance-templates`, {}),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['maintenance'] })
      qc.invalidateQueries({ queryKey: ['vehicles'] })
      setApplyResult(result)
    },
  })

  const updateTemplatesMutation = useMutation({
    mutationFn: ({ id, templates }: { id: string; templates: MaintenanceTemplateItem[] }) =>
      apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${id}/maintenance-templates`, { templates }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: keys.vehicleTypes() })
      setShowTemplateModal(false)
      applyTemplatesMutation.mutate(variables.id)
    },
  })

  function openNewTemplate() {
    setEditingTemplateIdx(null)
    setTemplateForm(emptyTemplateForm)
    setShowTemplateModal(true)
  }

  function openEditTemplate(tmpl: MaintenanceTemplateItem, idx: number) {
    setEditingTemplateIdx(idx)
    setTemplateForm({
      name: tmpl.name,
      thresholdType: tmpl.thresholds[0]?.type ?? 'pto_hours',
      value: tmpl.thresholds[0]?.value?.toString() ?? '',
      warn_before_pct: tmpl.warn_before_pct.toString(),
    })
    setShowTemplateModal(true)
  }

  function saveTemplate() {
    if (!templateForm.name.trim() || !templateForm.value) return
    const newTemplate: MaintenanceTemplateItem = {
      name: templateForm.name.trim(),
      thresholds: [{ type: templateForm.thresholdType, value: parseFloat(templateForm.value) }],
      warn_before_pct: parseInt(templateForm.warn_before_pct) || 10,
    }
    const current: MaintenanceTemplateItem[] = selectedType.maintenance_templates ?? []
    let next: MaintenanceTemplateItem[]
    if (editingTemplateIdx === null) {
      next = [...current, newTemplate]
    } else {
      next = current.map((t, i) => i === editingTemplateIdx ? newTemplate : t)
    }
    updateTemplatesMutation.mutate({ id: typeId, templates: next })
  }

  function deleteTemplate(idx: number) {
    const next = (selectedType.maintenance_templates ?? []).filter((_, i) => i !== idx)
    updateTemplatesMutation.mutate({ id: typeId, templates: next })
  }

  return (
    <>
      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Planes de mantenimiento
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {(selectedType.maintenance_templates ?? []).length > 0 && (
              <button
                style={{ ...btnSecondary, fontSize: 11 }}
                onClick={() => { setApplyResult(null); applyTemplatesMutation.mutate(typeId) }}
                disabled={applyTemplatesMutation.isPending}
                title="Crear planes en todos los vehículos activos de este tipo que aún no los tengan"
              >
                {applyTemplatesMutation.isPending ? 'Aplicando…' : 'Aplicar a vehículos existentes'}
              </button>
            )}
            <button style={btnPrimary} onClick={openNewTemplate}>+ Añadir</button>
          </div>
        </div>
        {applyResult !== null && (
          <div style={{
            fontSize: 12,
            color: applyResult.created > 0 ? 'var(--accent-ok)' : 'var(--accent-off)',
            background: applyResult.created > 0 ? 'rgba(34,197,94,0.08)' : 'rgba(120,113,108,0.08)',
            border: `1px solid ${applyResult.created > 0 ? 'var(--accent-ok)' : 'var(--bg-border)'}`,
            borderRadius: 6,
            padding: '6px 10px',
            marginBottom: 8,
          }}>
            {applyResult.created > 0
              ? `Se crearon ${applyResult.created} plan${applyResult.created > 1 ? 'es' : ''} de mantenimiento en vehículos existentes`
              : 'Todos los vehículos activos ya tienen estos planes de mantenimiento'}
          </div>
        )}
        {applyTemplatesMutation.isError && (
          <div style={{ fontSize: 12, color: 'var(--accent-crit)', marginBottom: 8 }}>
            Error al aplicar plantillas: {(applyTemplatesMutation.error as Error).message}
          </div>
        )}
        {(selectedType.maintenance_templates ?? []).length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sin plantillas configuradas</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
                {['NOMBRE', 'UMBRAL', 'VALOR', '% AVISO', ''].map(h => (
                  <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-muted)', fontSize: 10, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(selectedType.maintenance_templates ?? []).map((tmpl, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid var(--bg-border)' }}>
                  <td style={{ padding: '6px 8px' }}>{tmpl.name}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>
                    {{ pto_hours: 'h PTO', engine_hours: 'h motor', calendar_days: 'días' }[tmpl.thresholds[0]?.type] ?? tmpl.thresholds[0]?.type}
                  </td>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--font-data)' }}>{tmpl.thresholds[0]?.value}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--font-data)' }}>{tmpl.warn_before_pct}%</td>
                  <td style={{ padding: '6px 8px', display: 'flex', gap: 6 }}>
                    <button style={btnSecondary} onClick={() => openEditTemplate(tmpl, idx)}>Editar</button>
                    <button style={{ ...btnSecondary, color: 'var(--accent-crit)', borderColor: 'var(--accent-crit)' }} onClick={() => deleteTemplate(idx)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Modal: Plantilla de mantenimiento ──────────────────────────── */}
      {showTemplateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 24, width: 360, border: '1px solid var(--bg-border)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600 }}>
              {editingTemplateIdx === null ? 'Nueva plantilla' : 'Editar plantilla'}
            </h3>
            <label style={labelStyle}>Nombre</label>
            <input style={{ ...inputStyle, marginBottom: 12 }} value={templateForm.name}
              onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))} />
            <label style={labelStyle}>Tipo de umbral</label>
            <select style={{ ...inputStyle, marginBottom: 12 }}
              value={templateForm.thresholdType}
              onChange={e => setTemplateForm(f => ({ ...f, thresholdType: e.target.value as TemplateFormState['thresholdType'] }))}>
              <option value="pto_hours">Horas PTO</option>
              <option value="engine_hours">Horas motor</option>
              <option value="calendar_days">Días naturales</option>
            </select>
            <label style={labelStyle}>Valor</label>
            <input style={{ ...inputStyle, marginBottom: 12 }} type="number" min="1" value={templateForm.value}
              onChange={e => setTemplateForm(f => ({ ...f, value: e.target.value }))} />
            <label style={labelStyle}>% aviso previo</label>
            <input style={{ ...inputStyle, marginBottom: 20 }} type="number" min="1" max="50" value={templateForm.warn_before_pct}
              onChange={e => setTemplateForm(f => ({ ...f, warn_before_pct: e.target.value }))} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => setShowTemplateModal(false)}>Cancelar</button>
              <button style={btnPrimary} onClick={saveTemplate}
                disabled={updateTemplatesMutation.isPending}>
                {updateTemplatesMutation.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
