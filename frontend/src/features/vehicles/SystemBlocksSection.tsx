import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useConfirm } from '../../shared/ui/ConfirmDialog'
import { toast } from '../../shared/ui/Toast'
import { Input } from '../../shared/ui/Input'
import BlockEditor from '../../shared/ui/BlockEditor'
import type { VehicleTypeOut, SystemBlock, SensorDef } from '../../lib/types'

// ── Styles ───────────────────────────────────────────────────────────────────

const btnSecondary: React.CSSProperties = {
  background: 'var(--bg-elevated)', color: 'var(--fg-primary)',
  border: '1px solid var(--border)', borderRadius: 6, padding: '7px 12px',
  fontSize: 13, cursor: 'pointer',
}
const btnPrimary: React.CSSProperties = {
  background: 'var(--cmg-teal)', color: '#fff', border: 'none',
  borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600,
}

// ── Template types ────────────────────────────────────────────────────────────

type TemplateMeta = { id: string; label: string; description: string; blocks: SystemBlock[] }
type TemplatesResponse = Record<string, TemplateMeta>

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  typeId: string
  selectedType: VehicleTypeOut
}

export default function SystemBlocksSection({ typeId, selectedType }: Props) {
  const qc = useQueryClient()
  const confirmAsk = useConfirm()

  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [showSaveAsModal, setShowSaveAsModal] = useState(false)
  const [saveAsName, setSaveAsName] = useState('')
  const [saveAsDesc, setSaveAsDesc] = useState('')

  const blocks: SystemBlock[] = selectedType.system_blocks ?? []
  const sensors: SensorDef[] = (selectedType.sensor_schema as SensorDef[]) ?? []

  // ── Queries & mutations ──────────────────────────────────────────────────

  const { data: templates } = useQuery<TemplatesResponse>({
    queryKey: ['system-block-templates'],
    queryFn: () => apiClient.get('/api/v1/vehicle-types/system-blocks/templates'),
    staleTime: Infinity,
  })

  const patchMutation = useMutation({
    mutationFn: (system_blocks: SystemBlock[]) =>
      apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${typeId}/system-blocks`, { system_blocks }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.vehicleTypes() }),
  })

  const applyTemplateMutation = useMutation({
    mutationFn: (template_id: string) =>
      apiClient.post<VehicleTypeOut>(`/api/v1/vehicle-types/${typeId}/apply-template`, { template_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.vehicleTypes() }),
  })

  const saveAsMutation = useMutation({
    mutationFn: (body: { name: string; description?: string }) =>
      apiClient.post(`/api/v1/vehicle-types/${typeId}/save-as-template`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['block-templates'] })
      setShowSaveAsModal(false)
      setSaveAsName('')
      setSaveAsDesc('')
      toast.success('Plantilla guardada correctamente')
    },
    onError: () => toast.error('No se pudo guardar la plantilla'),
  })

  // ── Handlers ────────────────────────────────────────────────────────────

  async function applyTemplate() {
    if (!selectedTemplate) return
    const tpl = templates?.[selectedTemplate]
    if (!tpl) return
    const ok = await confirmAsk({
      title: 'Aplicar plantilla',
      message: `Aplicar "${tpl.label}" reemplazará todos los bloques actuales (${blocks.length}). ¿Continuar?`,
      confirmLabel: 'Aplicar', kind: 'warning',
    })
    if (!ok) return
    applyTemplateMutation.mutate(selectedTemplate)
  }

  function openSaveAs() {
    setSaveAsName(selectedType.name)
    setSaveAsDesc('')
    setShowSaveAsModal(true)
  }

  function submitSaveAs() {
    if (!saveAsName.trim()) return
    saveAsMutation.mutate({ name: saveAsName.trim(), description: saveAsDesc || undefined })
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 24 }}>

        {/* Selector de plantilla + guardar como */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>

          {templates && Object.keys(templates).length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 240,
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>Plantilla base:</span>
              <select
                value={selectedTemplate}
                onChange={e => setSelectedTemplate(e.target.value)}
                style={{ flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 6, padding: '5px 8px', color: 'var(--fg-primary)', fontSize: 12 }}
              >
                <option value="">— seleccionar —</option>
                {Object.values(templates).map(t => (
                  <option key={t.id} value={t.id}>{t.label} — {t.description}</option>
                ))}
              </select>
              <button
                style={{ ...btnSecondary, whiteSpace: 'nowrap', opacity: selectedTemplate ? 1 : 0.5 }}
                disabled={!selectedTemplate || applyTemplateMutation.isPending}
                onClick={applyTemplate}
              >
                {applyTemplateMutation.isPending ? 'Aplicando…' : 'Aplicar'}
              </button>
            </div>
          )}

          {blocks.length > 0 && (
            <button style={{ ...btnSecondary, whiteSpace: 'nowrap', fontSize: 12 }} onClick={openSaveAs}>
              💾 Guardar como plantilla
            </button>
          )}
        </div>

        {/* Editor de bloques reutilizable */}
        <BlockEditor
          blocks={blocks}
          availableSensors={sensors}
          onSave={async (next) => { await patchMutation.mutateAsync(next) }}
        />
      </div>

      {/* ── Modal: Guardar como plantilla ──────────────────────────── */}
      {showSaveAsModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
          onClick={e => { if (e.target === e.currentTarget) setShowSaveAsModal(false) }}
        >
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 24, width: 420,
            border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--fg-primary)' }}>
              Guardar bloques como plantilla
            </h3>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-muted)' }}>
              Se guardará la configuración actual de {blocks.length} bloque{blocks.length !== 1 ? 's' : ''} (incluyendo sensores asignados).
            </p>
            <Input label="NOMBRE DE LA PLANTILLA" value={saveAsName}
              placeholder="Ej. Cisterna presión alta"
              onChange={e => setSaveAsName(e.target.value)} />
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)',
                letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
                DESCRIPCIÓN (opcional)
              </label>
              <textarea value={saveAsDesc} onChange={e => setSaveAsDesc(e.target.value)} rows={2}
                style={{ width: '100%', background: 'var(--bg-card)', color: 'var(--fg-primary)',
                  border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px',
                  fontSize: 13, resize: 'vertical', fontFamily: 'var(--font-ui)', boxSizing: 'border-box' }}
              />
            </div>
            {saveAsMutation.isError && (
              <div style={{ fontSize: 12, color: 'var(--danger)' }}>
                {(saveAsMutation.error as Error).message}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => setShowSaveAsModal(false)}>Cancelar</button>
              <button style={btnPrimary} onClick={submitSaveAs}
                disabled={!saveAsName.trim() || saveAsMutation.isPending}>
                {saveAsMutation.isPending ? 'Guardando…' : 'Guardar plantilla'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
