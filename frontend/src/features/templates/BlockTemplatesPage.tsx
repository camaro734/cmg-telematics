import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { useAuthStore } from '../auth/useAuthStore'
import { useConfirm } from '../../shared/ui/ConfirmDialog'
import { Input } from '../../shared/ui/Input'
import BlockEditor from '../../shared/ui/BlockEditor'
import type { SystemBlock } from '../../lib/types'

// ── Types ────────────────────────────────────────────────────────────────────

type TemplateMeta = {
  id: string          // slug (para apply-template)
  uuid: string        // UUID real para CRUD
  label: string
  description: string
  blocks: SystemBlock[]
  is_builtin: boolean
}
type TemplatesResponse = Record<string, TemplateMeta>

type SensorRef = { key: string; label: string; unit?: string | null }

// ── Styles ───────────────────────────────────────────────────────────────────

const btnPrimary: React.CSSProperties = {
  background: 'var(--cmg-teal)', color: '#fff', border: 'none',
  borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600,
}
const btnSecondary: React.CSSProperties = {
  background: 'var(--bg-elevated)', color: 'var(--fg-primary)',
  border: '1px solid var(--border)', borderRadius: 6, padding: '7px 12px',
  fontSize: 13, cursor: 'pointer',
}
const btnDanger: React.CSSProperties = {
  background: 'transparent', color: 'var(--danger)',
  border: '1px solid var(--danger)', borderRadius: 6, padding: '7px 12px',
  fontSize: 13, cursor: 'pointer',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BlockTemplatesPage() {
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const confirmAsk = useConfirm()

  const isCmgAdmin = user?.tenant_tier === 'cmg' && user?.role === 'admin'

  // ── State ──────────────────────────────────────────────────────────────
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [localName, setLocalName] = useState('')
  const [localDesc, setLocalDesc] = useState('')
  const [showNewModal, setShowNewModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [metaSaving, setMetaSaving] = useState(false)

  // ── Queries ────────────────────────────────────────────────────────────

  const { data: templates = {}, isLoading } = useQuery<TemplatesResponse>({
    queryKey: ['block-templates'],
    queryFn: () => apiClient.get('/api/v1/vehicle-types/system-blocks/templates'),
    staleTime: 30_000,
    enabled: isCmgAdmin,
  })

  const { data: catalog = [] } = useQuery<SensorRef[]>({
    queryKey: ['sensor-catalog'],
    queryFn: () => apiClient.get('/api/v1/sensors/catalog'),
    staleTime: 60_000,
    enabled: isCmgAdmin,
  })

  const selected = selectedSlug ? templates[selectedSlug] : null

  // ── Mutations ──────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (body: { name: string; description?: string; blocks: SystemBlock[] }) =>
      apiClient.post<{ id: string; slug: string; name: string }>('/api/v1/vehicle-types/system-blocks/templates', body),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['block-templates'] })
      setShowNewModal(false)
      setNewName('')
      setNewDesc('')
      // Seleccionar la nueva plantilla tras invalidar
      setTimeout(() => setSelectedSlug(created.slug), 300)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ uuid, body }: { uuid: string; body: { name: string; description: string | null; blocks: SystemBlock[] } }) =>
      apiClient.put(`/api/v1/vehicle-types/system-blocks/templates/${uuid}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['block-templates'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (uuid: string) =>
      apiClient.delete(`/api/v1/vehicle-types/system-blocks/templates/${uuid}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['block-templates'] })
      setSelectedSlug(null)
    },
  })

  // ── Handlers ───────────────────────────────────────────────────────────

  function selectTemplate(slug: string) {
    const tpl = templates[slug]
    if (!tpl) return
    setSelectedSlug(slug)
    setLocalName(tpl.label)
    setLocalDesc(tpl.description)
  }

  async function saveMeta() {
    if (!selected || !localName.trim()) return
    setMetaSaving(true)
    try {
      await updateMutation.mutateAsync({
        uuid: selected.uuid,
        body: { name: localName.trim(), description: localDesc || null, blocks: selected.blocks },
      })
    } finally {
      setMetaSaving(false)
    }
  }

  async function saveBlocks(blocks: SystemBlock[]) {
    if (!selected) return
    await updateMutation.mutateAsync({
      uuid: selected.uuid,
      body: { name: localName.trim() || selected.label, description: localDesc || null, blocks },
    })
  }

  async function deleteTemplate() {
    if (!selected) return
    const message = selected.is_builtin
      ? `"${selected.label}" es una plantilla de fábrica. Borrarla eliminará la configuración original permanentemente. ¿Continuar?`
      : `¿Eliminar la plantilla "${selected.label}"? Esta acción no se puede deshacer.`
    const ok = await confirmAsk({
      title: 'Eliminar plantilla',
      message,
      confirmLabel: 'Eliminar', kind: 'danger',
    })
    if (!ok) return
    deleteMutation.mutate(selected.uuid)
  }

  function createTemplate() {
    if (!newName.trim()) return
    createMutation.mutate({ name: newName.trim(), description: newDesc || undefined, blocks: [] })
  }

  // ── Guard ──────────────────────────────────────────────────────────────

  if (!isCmgAdmin) {
    return (
      <div style={{ padding: 40, color: 'var(--fg-muted)', fontSize: 13 }}>
        Acceso restringido a administradores CMG.
      </div>
    )
  }

  const templateList = Object.values(templates)

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>

      {/* ── Panel izquierdo: lista ─────────────────────────────────── */}
      <div style={{
        width: 280, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
        background: 'var(--bg-surface)',
      }}>
        <div style={{ padding: '16px 12px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Plantillas de bloques
          </span>
          <button style={{ ...btnPrimary, padding: '5px 10px', fontSize: 11 }} onClick={() => setShowNewModal(true)}>
            + Nueva
          </button>
        </div>

        {isLoading && (
          <div style={{ padding: 16, fontSize: 12, color: 'var(--fg-muted)' }}>Cargando…</div>
        )}

        {templateList.map(tpl => (
          <button key={tpl.id}
            onClick={() => selectTemplate(tpl.id)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '10px 14px', border: 'none', cursor: 'pointer',
              background: selectedSlug === tpl.id ? 'var(--bg-elevated)' : 'transparent',
              borderLeft: selectedSlug === tpl.id ? '3px solid var(--cmg-teal)' : '3px solid transparent',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg-primary)', flex: 1 }}>
                {tpl.label}
              </span>
              {tpl.is_builtin && (
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                  background: 'var(--bg-card)', color: 'var(--fg-muted)',
                  border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px',
                }}>
                  FÁBRICA
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
              {tpl.blocks.length} bloque{tpl.blocks.length !== 1 ? 's' : ''}
              {tpl.description ? ` · ${tpl.description.slice(0, 40)}` : ''}
            </div>
          </button>
        ))}

        {!isLoading && templateList.length === 0 && (
          <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--fg-muted)' }}>
            Sin plantillas. Crea una nueva.
          </div>
        )}
      </div>

      {/* ── Panel derecho: editor ──────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {!selected ? (
          <div style={{ color: 'var(--fg-muted)', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
            Selecciona una plantilla para editarla.
          </div>
        ) : (
          <>
            {/* Cabecera */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--fg-primary)' }}>
                {selected.label}
                {selected.is_builtin && (
                  <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700,
                    background: 'var(--bg-card)', color: 'var(--fg-muted)',
                    border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px',
                    verticalAlign: 'middle' }}>
                    DE FÁBRICA
                  </span>
                )}
              </h2>
              <button style={btnDanger} onClick={deleteTemplate}
                disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? 'Eliminando…' : 'Eliminar plantilla'}
              </button>
            </div>

            {/* Formulario nombre + descripción */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 8, padding: 16, marginBottom: 24 }}>
              <Input label="NOMBRE" value={localName}
                onChange={e => setLocalName(e.target.value)} />
              <div>
                <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)',
                  letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
                  DESCRIPCIÓN (opcional)
                </label>
                <textarea
                  value={localDesc}
                  onChange={e => setLocalDesc(e.target.value)}
                  rows={2}
                  style={{ width: '100%', background: 'var(--bg-elevated)', color: 'var(--fg-primary)',
                    border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px',
                    fontSize: 13, resize: 'vertical', fontFamily: 'var(--font-ui)', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button style={btnPrimary} onClick={saveMeta}
                  disabled={!localName.trim() || metaSaving}>
                  {metaSaving ? 'Guardando…' : 'Guardar nombre y descripción'}
                </button>
              </div>
            </div>

            {/* Editor de bloques */}
            <BlockEditor
              blocks={selected.blocks}
              availableSensors={catalog}
              onSave={saveBlocks}
            />
          </>
        )}
      </div>

      {/* ── Modal: Nueva plantilla ─────────────────────────────────── */}
      {showNewModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
          onClick={e => { if (e.target === e.currentTarget) setShowNewModal(false) }}
        >
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 24, width: 400,
            border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--fg-primary)' }}>
              Nueva plantilla de bloques
            </h3>
            <Input label="NOMBRE" value={newName} placeholder="Ej. Cisterna presión"
              onChange={e => setNewName(e.target.value)} />
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)',
                letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
                DESCRIPCIÓN (opcional)
              </label>
              <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} rows={2}
                style={{ width: '100%', background: 'var(--bg-card)', color: 'var(--fg-primary)',
                  border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px',
                  fontSize: 13, resize: 'vertical', fontFamily: 'var(--font-ui)', boxSizing: 'border-box' }}
              />
            </div>
            {createMutation.isError && (
              <div style={{ fontSize: 12, color: 'var(--danger)' }}>
                {(createMutation.error as Error).message}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => setShowNewModal(false)}>Cancelar</button>
              <button style={btnPrimary} onClick={createTemplate}
                disabled={!newName.trim() || createMutation.isPending}>
                {createMutation.isPending ? 'Creando…' : 'Crear plantilla'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
