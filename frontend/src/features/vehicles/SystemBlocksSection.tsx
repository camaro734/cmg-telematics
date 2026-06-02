import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useConfirm } from '../../shared/ui/ConfirmDialog'
import type { VehicleTypeOut, SystemBlock, SensorDef } from '../../lib/types'
import { Input } from '../../shared/ui/Input'
import IconPicker from './IconPicker'

// ── Styles ─────────────────────────────────────────────────────────────────

const btnPrimary: React.CSSProperties = {
  background: 'var(--cmg-teal)', color: '#fff', border: 'none',
  borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600,
}
const btnSecondary: React.CSSProperties = {
  background: 'var(--bg-elevated)', color: 'var(--fg-primary)',
  border: '1px solid var(--border)', borderRadius: 6, padding: '7px 12px',
  fontSize: 13, cursor: 'pointer',
}
const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)',
  letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 4,
}

// ── Types ──────────────────────────────────────────────────────────────────

type BlockForm = {
  id: string; name: string; icon: string
  sensor_keys: string[]; key_sensor_keys: string[]; key_count: string
}

const emptyBlockForm = (): BlockForm => ({
  id: '', name: '', icon: 'ti-settings', sensor_keys: [], key_sensor_keys: [], key_count: '2',
})

function blockToForm(b: SystemBlock): BlockForm {
  return { ...b, key_count: b.key_count.toString() }
}

function formToBlock(f: BlockForm): SystemBlock {
  return {
    id: f.id.trim() || `block_${Date.now()}`,
    name: f.name.trim(),
    icon: f.icon,
    sensor_keys: f.sensor_keys,
    key_sensor_keys: f.key_sensor_keys.filter(k => f.sensor_keys.includes(k)),
    key_count: parseInt(f.key_count) || 2,
  }
}

// ── Template types ─────────────────────────────────────────────────────────

type TemplateMeta = { id: string; label: string; description: string; blocks: SystemBlock[] }
type TemplatesResponse = Record<string, TemplateMeta>

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  typeId: string
  selectedType: VehicleTypeOut
}

export default function SystemBlocksSection({ typeId, selectedType }: Props) {
  const qc = useQueryClient()
  const confirmAsk = useConfirm()

  // ── Modal state ────────────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [form, setForm] = useState<BlockForm>(emptyBlockForm())

  // ── Template state ─────────────────────────────────────────────────────
  const [selectedTemplate, setSelectedTemplate] = useState('')

  const blocks: SystemBlock[] = selectedType.system_blocks ?? []
  const sensors: SensorDef[] = (selectedType.sensor_schema as SensorDef[]) ?? []

  // ── Queries & mutations ────────────────────────────────────────────────

  const { data: templates } = useQuery<TemplatesResponse>({
    queryKey: ['system-block-templates'],
    queryFn: () => apiClient.get('/api/v1/vehicle-types/system-blocks/templates'),
    staleTime: Infinity,
  })

  const patchMutation = useMutation({
    mutationFn: (system_blocks: SystemBlock[]) =>
      apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${typeId}/system-blocks`, { system_blocks }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.vehicleTypes() })
      setShowModal(false)
    },
  })

  const applyTemplateMutation = useMutation({
    mutationFn: (template_id: string) =>
      apiClient.post<VehicleTypeOut>(`/api/v1/vehicle-types/${typeId}/apply-template`, { template_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.vehicleTypes() }),
  })

  // ── Handlers ──────────────────────────────────────────────────────────

  function openNew() {
    setEditingIdx(null)
    setForm(emptyBlockForm())
    setShowModal(true)
  }

  function openEdit(b: SystemBlock, idx: number) {
    setEditingIdx(idx)
    setForm(blockToForm(b))
    setShowModal(true)
  }

  function save() {
    if (!form.name.trim()) return
    const block = formToBlock(form)
    const next =
      editingIdx === null
        ? [...blocks, block]
        : blocks.map((b, i) => (i === editingIdx ? block : b))
    patchMutation.mutate(next)
  }

  async function deleteBlock(idx: number) {
    const ok = await confirmAsk({
      title: 'Eliminar bloque',
      message: `¿Eliminar el bloque "${blocks[idx].name}"? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar', kind: 'danger',
    })
    if (!ok) return
    patchMutation.mutate(blocks.filter((_, i) => i !== idx))
  }

  function moveUp(idx: number) {
    if (idx === 0) return
    const next = [...blocks]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    patchMutation.mutate(next)
  }

  function moveDown(idx: number) {
    if (idx === blocks.length - 1) return
    const next = [...blocks]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    patchMutation.mutate(next)
  }

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

  function toggleSensorKey(key: string) {
    setForm(f => {
      const next = f.sensor_keys.includes(key)
        ? f.sensor_keys.filter(k => k !== key)
        : [...f.sensor_keys, key]
      // Mantener key_sensor_keys solo si siguen en sensor_keys
      const nextKey = f.key_sensor_keys.filter(k => next.includes(k))
      return { ...f, sensor_keys: next, key_sensor_keys: nextKey }
    })
  }

  function toggleKeyKey(key: string) {
    setForm(f => ({
      ...f,
      key_sensor_keys: f.key_sensor_keys.includes(key)
        ? f.key_sensor_keys.filter(k => k !== key)
        : [...f.key_sensor_keys, key],
    }))
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <>
      <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 24 }}>

        {/* Cabecera de sección */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Bloques del panel de diagnóstico
          </span>
          <button style={btnPrimary} onClick={openNew}>+ Añadir bloque</button>
        </div>

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

        {/* Lista de bloques */}
        {blocks.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            Sin bloques configurados. Aplica una plantilla o añade uno manualmente.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {blocks.map((b, idx) => (
              <div key={b.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8,
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '8px 12px' }}
              >
                {/* Orden */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button style={{ ...btnSecondary, padding: '2px 6px', fontSize: 10, opacity: idx === 0 ? 0.3 : 1 }}
                    disabled={idx === 0 || patchMutation.isPending} onClick={() => moveUp(idx)}>▲</button>
                  <button style={{ ...btnSecondary, padding: '2px 6px', fontSize: 10, opacity: idx === blocks.length - 1 ? 0.3 : 1 }}
                    disabled={idx === blocks.length - 1 || patchMutation.isPending} onClick={() => moveDown(idx)}>▼</button>
                </div>

                {/* Icono */}
                <i className={b.icon} style={{ fontSize: 20, color: 'var(--cmg-teal)', width: 24, textAlign: 'center' }} />

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg-primary)' }}>{b.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                    {b.sensor_keys.length} sensor{b.sensor_keys.length !== 1 ? 'es' : ''} · {b.key_sensor_keys.length} clave{b.key_sensor_keys.length !== 1 ? 's' : ''}
                  </div>
                </div>

                {/* Acciones */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={btnSecondary} onClick={() => openEdit(b, idx)}>✎</button>
                  <button style={{ ...btnSecondary, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                    onClick={() => deleteBlock(idx)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Modal: Editar / Nuevo bloque ─────────────────────────────────── */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}
        >
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 24, width: 480,
            maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--fg-primary)' }}>
              {editingIdx === null ? 'Nuevo bloque' : `Editar bloque: ${blocks[editingIdx]?.name}`}
            </h3>

            {/* Nombre */}
            <Input label="NOMBRE DEL BLOQUE" value={form.name} placeholder="Motor"
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />

            {/* ID slug */}
            <Input label="ID INTERNO (slug)" value={form.id}
              placeholder="block_motor (auto si vacío)"
              onChange={e => setForm(f => ({ ...f, id: e.target.value }))} />

            {/* Icono */}
            <div>
              <label style={labelStyle}>ICONO</label>
              <IconPicker value={form.icon} onChange={icon => setForm(f => ({ ...f, icon }))} />
            </div>

            {/* Sensores asignados al bloque */}
            {sensors.length > 0 && (
              <div>
                <label style={labelStyle}>SENSORES DEL BLOQUE</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160,
                  overflowY: 'auto', background: 'var(--bg-card)', borderRadius: 6,
                  border: '1px solid var(--border)', padding: '8px 10px' }}>
                  {sensors.map(s => (
                    <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8,
                      fontSize: 12, color: 'var(--fg-primary)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={form.sensor_keys.includes(s.key)}
                        onChange={() => toggleSensorKey(s.key)} />
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--cmg-teal)', fontSize: 11 }}>{s.key}</span>
                      <span>{s.label}</span>
                      {s.unit && <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{s.unit}</span>}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Sensores clave (resumen de la tarjeta) */}
            {form.sensor_keys.length > 0 && (
              <div>
                <label style={labelStyle}>VALORES CLAVE (resumen tarjeta)</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4,
                  background: 'var(--bg-card)', borderRadius: 6, border: '1px solid var(--border)',
                  padding: '8px 10px' }}>
                  {form.sensor_keys.map(k => {
                    const s = sensors.find(s => s.key === k)
                    return (
                      <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8,
                        fontSize: 12, color: 'var(--fg-primary)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={form.key_sensor_keys.includes(k)}
                          onChange={() => toggleKeyKey(k)} />
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-info)', fontSize: 11 }}>{k}</span>
                        <span>{s?.label ?? k}</span>
                      </label>
                    )
                  })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
                  Selecciona los que aparecen en el resumen de la tarjeta del panel.
                </div>
              </div>
            )}

            {/* Número de valores clave a mostrar */}
            <Input label="VALORES CLAVE A MOSTRAR (key_count)"
              type="number" value={form.key_count} min="1" max="4"
              onChange={e => setForm(f => ({ ...f, key_count: e.target.value }))} />

            {patchMutation.isError && (
              <div style={{ fontSize: 12, color: 'var(--danger)' }}>
                {(patchMutation.error as Error).message}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
              <button style={btnSecondary} onClick={() => setShowModal(false)}>Cancelar</button>
              <button style={btnPrimary} onClick={save}
                disabled={!form.name.trim() || patchMutation.isPending}>
                {patchMutation.isPending ? 'Guardando…' : 'Guardar bloque'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
