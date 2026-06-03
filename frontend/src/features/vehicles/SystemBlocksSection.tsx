import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useConfirm } from '../../shared/ui/ConfirmDialog'
import BlockEditor from '../../shared/ui/BlockEditor'
import type { VehicleTypeOut, SystemBlock, SensorDef } from '../../lib/types'

// ── Styles ───────────────────────────────────────────────────────────────────

const btnSecondary: React.CSSProperties = {
  background: 'var(--bg-elevated)', color: 'var(--fg-primary)',
  border: '1px solid var(--border)', borderRadius: 6, padding: '7px 12px',
  fontSize: 13, cursor: 'pointer',
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

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 24 }}>

      {/* Selector de plantilla */}
      {templates && Object.keys(templates).length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16,
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

      {/* Editor de bloques reutilizable */}
      <BlockEditor
        blocks={blocks}
        availableSensors={sensors}
        onSave={async (next) => { await patchMutation.mutateAsync(next) }}
      />
    </div>
  )
}
