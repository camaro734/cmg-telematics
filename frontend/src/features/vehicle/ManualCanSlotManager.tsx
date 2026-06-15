import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { toast } from '../../shared/ui/Toast'
import { useConfirm } from '../../shared/ui/ConfirmDialog'
import { useAuthStore } from '../auth/useAuthStore'

interface Slot {
  id: string
  vehicle_id: string
  slot: number
  param_id: number
  description: string | null
  active: boolean
}

interface Props {
  vehicleId: string
}

const LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)',
  fontFamily: 'var(--font-sans)', display: 'block', marginBottom: 3,
}

const INPUT: React.CSSProperties = {
  width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  borderRadius: 6, padding: '5px 8px', color: 'var(--fg-primary)', fontSize: 12,
  fontFamily: 'var(--font-mono)', boxSizing: 'border-box',
}

const BTN_SM = (color: string): React.CSSProperties => ({
  background: 'none', border: `1px solid ${color}`, borderRadius: 5,
  color, padding: '2px 8px', fontSize: 10, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'var(--font-sans)',
})

function SlotForm({
  initial,
  isEdit,
  onSave,
  onCancel,
  saving,
}: {
  initial: { slot: number; param_id: number; description: string; active: boolean }
  isEdit: boolean
  onSave: (vals: { slot: number; param_id: number; description: string; active: boolean }) => void
  onCancel: () => void
  saving: boolean
}) {
  const [slot, setSlot] = useState(String(initial.slot))
  const [paramId, setParamId] = useState(String(initial.param_id))
  const [description, setDescription] = useState(initial.description)
  const [active, setActive] = useState(initial.active)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const s = Number(slot)
    const p = Number(paramId)
    if (isNaN(s) || s < 0 || s > 9) { toast.error('Slot debe ser un número entre 0 y 9'); return }
    if (isNaN(p) || p <= 0) { toast.error('Param ID debe ser mayor que 0'); return }
    if (!description.trim()) { toast.error('La descripción es obligatoria'); return }
    onSave({ slot: s, param_id: p, description: description.trim(), active })
  }

  return (
    <form onSubmit={handleSubmit} style={{
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        {isEdit ? 'Editar slot' : 'Nuevo slot'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label style={LABEL}>Slot (0-9)</label>
          <input
            style={{ ...INPUT, background: isEdit ? 'var(--bg-card)' : 'var(--bg-elevated)', cursor: isEdit ? 'not-allowed' : 'auto' }}
            type="number" min={0} max={9} value={slot}
            onChange={e => setSlot(e.target.value)}
            disabled={isEdit}
            data-testid="input-slot"
          />
        </div>
        <div>
          <label style={LABEL}>Param ID</label>
          <input
            style={INPUT} type="number" min={1} value={paramId}
            onChange={e => setParamId(e.target.value)}
            data-testid="input-param-id"
          />
        </div>
      </div>

      <div>
        <label style={LABEL}>
          Descripción
          <span style={{ fontSize: 9, fontWeight: 400, color: 'var(--fg-dim)', marginLeft: 6 }}>
            ID del campo Data del Manual CAN Command en el Configurator del FMC650 (ej. 16002)
          </span>
        </label>
        <input
          style={INPUT} type="text" maxLength={100} value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="PTO bomba hidráulica"
          data-testid="input-description"
        />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)' }}>
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} data-testid="input-active" />
        Activo
      </label>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={BTN_SM('var(--fg-muted)')}>
          Cancelar
        </button>
        <button type="submit" disabled={saving} style={{
          ...BTN_SM('var(--cmg-teal)'),
          background: 'color-mix(in srgb, var(--cmg-teal) 15%, transparent)',
          opacity: saving ? 0.6 : 1,
        }}>
          {saving ? '…' : isEdit ? 'Guardar' : 'Añadir'}
        </button>
      </div>
    </form>
  )
}

export default function ManualCanSlotManager({ vehicleId }: Props) {
  const isAdmin = useAuthStore(s => s.user?.role === 'admin')
  const confirmAsk = useConfirm()
  const qc = useQueryClient()

  const [open, setOpen] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Slot | null>(null)
  const [saving, setSaving] = useState(false)

  const { data: slots = [], isLoading } = useQuery<Slot[]>({
    queryKey: ['manual-can-slots-admin', vehicleId],
    queryFn: () =>
      apiClient.get<Slot[]>(`/api/v1/vehicles/${vehicleId}/manual-can-slots?include_inactive=true`),
    enabled: !!vehicleId && isAdmin === true,
  })

  if (!isAdmin) return null

  function refresh() {
    qc.invalidateQueries({ queryKey: ['manual-can-slots-admin', vehicleId] })
    qc.invalidateQueries({ queryKey: ['manual-can-slots', vehicleId] })
  }

  async function handleCreate(vals: { slot: number; param_id: number; description: string; active: boolean }) {
    setSaving(true)
    try {
      await apiClient.post(`/api/v1/vehicles/${vehicleId}/manual-can-slots`, vals)
      setShowForm(false)
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al crear el slot')
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit(vals: { slot: number; param_id: number; description: string; active: boolean }) {
    if (!editing) return
    setSaving(true)
    try {
      await apiClient.patch(`/api/v1/vehicles/${vehicleId}/manual-can-slots/${editing.id}`, {
        param_id: vals.param_id,
        description: vals.description,
        active: vals.active,
      })
      setEditing(null)
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al editar el slot')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(slot: Slot) {
    const ok = await confirmAsk({
      title: 'Eliminar slot',
      message: `¿Eliminar el slot ${slot.slot} (${slot.description ?? '—'})?`,
      confirmLabel: 'Eliminar',
      kind: 'danger',
    })
    if (!ok) return
    try {
      await apiClient.delete(`/api/v1/vehicles/${vehicleId}/manual-can-slots/${slot.id}`)
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al eliminar el slot')
    }
  }

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 8, overflow: 'hidden',
    }}>
      {/* Cabecera colapsable */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', background: 'none', border: 'none', padding: '7px 10px',
          display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
        }}
        data-testid="slot-manager-toggle"
      >
        <span style={{
          transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          transition: 'transform 0.2s', display: 'inline-block',
          fontSize: 10, color: 'var(--fg-muted)',
        }}>▾</span>
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: 9, fontWeight: 700,
          color: 'var(--fg-muted)', letterSpacing: '0.07em', textTransform: 'uppercase',
        }}>Configuración Manual CAN</span>
        <span style={{
          marginLeft: 'auto', fontSize: 9, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)',
        }}>admin</span>
      </button>

      {open && (
        <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {isLoading ? (
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', padding: '8px 0' }}>Cargando…</div>
          ) : slots.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontStyle: 'italic', padding: '4px 0' }}>
              Sin slots configurados.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%', borderCollapse: 'collapse',
                fontSize: 11, fontFamily: 'var(--font-mono)',
              }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Slot', 'Param ID', 'Descripción', 'Activo', ''].map(h => (
                      <th key={h} style={{
                        padding: '4px 8px', textAlign: 'left', fontSize: 9,
                        fontWeight: 700, color: 'var(--fg-muted)', textTransform: 'uppercase',
                        letterSpacing: '0.07em',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {slots.map(s => (
                    <tr key={s.id} style={{
                      borderBottom: '1px solid var(--border)',
                      opacity: s.active ? 1 : 0.5,
                    }}>
                      <td style={{ padding: '5px 8px', color: 'var(--fg-primary)' }}>{s.slot}</td>
                      <td style={{ padding: '5px 8px', color: 'var(--fg-primary)' }}>{s.param_id}</td>
                      <td style={{ padding: '5px 8px', color: 'var(--fg-muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.description ?? '—'}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                        {s.active ? '✅' : '○'}
                      </td>
                      <td style={{ padding: '5px 8px' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            onClick={() => { setEditing(s); setShowForm(false) }}
                            style={BTN_SM('var(--info)')}
                            data-testid={`btn-edit-slot-${s.slot}`}
                          >Editar</button>
                          <button
                            onClick={() => handleDelete(s)}
                            style={BTN_SM('var(--danger)')}
                            data-testid={`btn-delete-slot-${s.slot}`}
                          >Borrar</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Formulario edición inline */}
          {editing && (
            <SlotForm
              initial={{ slot: editing.slot, param_id: editing.param_id, description: editing.description ?? '', active: editing.active }}
              isEdit={true}
              onSave={handleEdit}
              onCancel={() => setEditing(null)}
              saving={saving}
            />
          )}

          {/* Formulario creación inline */}
          {showForm && !editing && (
            <SlotForm
              initial={{ slot: 0, param_id: 0, description: '', active: true }}
              isEdit={false}
              onSave={handleCreate}
              onCancel={() => setShowForm(false)}
              saving={saving}
            />
          )}

          {!showForm && !editing && (
            <button
              onClick={() => setShowForm(true)}
              style={{
                background: 'none', border: '1px dashed var(--border)', borderRadius: 7,
                padding: '6px 10px', fontSize: 11, fontWeight: 600,
                color: 'var(--fg-muted)', cursor: 'pointer', textAlign: 'left',
                fontFamily: 'var(--font-sans)', transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={e => { const el = e.currentTarget; el.style.borderColor = 'var(--cmg-teal)'; el.style.color = 'var(--cmg-teal)' }}
              onMouseLeave={e => { const el = e.currentTarget; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--fg-muted)' }}
              data-testid="btn-add-slot"
            >
              + Añadir slot
            </button>
          )}
        </div>
      )}
    </div>
  )
}
