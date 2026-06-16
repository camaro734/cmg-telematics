import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { toast } from '../../shared/ui/Toast'
import { useConfirm } from '../../shared/ui/ConfirmDialog'
import { useAuthStore } from '../auth/useAuthStore'

interface Slot {
  id: string
  slot: number
  param_id: number
  description: string | null
  active: boolean
}

interface CanButton {
  id: string
  slot_id: string
  label: string
  byte_index: number
  bit_index: number
  active: boolean
  sort_order: number
  current_bit: boolean
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

function ButtonForm({
  initial,
  isEdit,
  onSave,
  onCancel,
  saving,
}: {
  initial: { label: string; byte_index: number; bit_index: number; sort_order: number; active: boolean }
  isEdit: boolean
  onSave: (vals: { label: string; byte_index: number; bit_index: number; sort_order: number; active: boolean }) => void
  onCancel: () => void
  saving: boolean
}) {
  const [label, setLabel] = useState(initial.label)
  const [byteIndex, setByteIndex] = useState(String(initial.byte_index))
  const [bitIndex, setBitIndex] = useState(String(initial.bit_index))
  const [sortOrder, setSortOrder] = useState(String(initial.sort_order))
  const [active, setActive] = useState(initial.active)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim()) { toast.error('La etiqueta es obligatoria'); return }
    const b = Number(byteIndex)
    const bit = Number(bitIndex)
    const ord = Number(sortOrder)
    if (isNaN(b) || b < 0 || b > 7) { toast.error('Byte debe ser 0-7'); return }
    if (isNaN(bit) || bit < 0 || bit > 7) { toast.error('Bit debe ser 0-7'); return }
    if (isNaN(ord) || ord < 0) { toast.error('Orden debe ser ≥ 0'); return }
    onSave({ label: label.trim(), byte_index: b, bit_index: bit, sort_order: ord, active })
  }

  return (
    <form onSubmit={handleSubmit} style={{
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        {isEdit ? 'Editar botón' : 'Nuevo botón'}
      </div>

      <div>
        <label style={LABEL}>Etiqueta</label>
        <input
          style={INPUT} type="text" maxLength={100} value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="Bomba hidráulica"
          data-testid="input-label"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <div>
          <label style={LABEL}>Byte (0-7)</label>
          <input
            style={{ ...INPUT, background: isEdit ? 'var(--bg-card)' : 'var(--bg-elevated)', cursor: isEdit ? 'not-allowed' : 'auto' }}
            type="number" min={0} max={7} value={byteIndex}
            onChange={e => setByteIndex(e.target.value)}
            disabled={isEdit}
            data-testid="input-byte-index"
          />
        </div>
        <div>
          <label style={LABEL}>Bit (0-7)</label>
          <input
            style={{ ...INPUT, background: isEdit ? 'var(--bg-card)' : 'var(--bg-elevated)', cursor: isEdit ? 'not-allowed' : 'auto' }}
            type="number" min={0} max={7} value={bitIndex}
            onChange={e => setBitIndex(e.target.value)}
            disabled={isEdit}
            data-testid="input-bit-index"
          />
        </div>
        <div>
          <label style={LABEL}>Orden</label>
          <input
            style={INPUT} type="number" min={0} value={sortOrder}
            onChange={e => setSortOrder(e.target.value)}
            data-testid="input-sort-order"
          />
        </div>
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

function SlotButtonSection({
  vehicleId,
  slot,
}: {
  vehicleId: string
  slot: Slot
}) {
  const confirmAsk = useConfirm()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<CanButton | null>(null)
  const [saving, setSaving] = useState(false)

  const { data: buttons = [], isLoading } = useQuery<CanButton[]>({
    queryKey: ['can-buttons-admin', slot.id],
    queryFn: () =>
      apiClient.get<CanButton[]>(
        `/api/v1/vehicles/${vehicleId}/can-slots/${slot.id}/buttons`,
      ),
  })

  function refresh() {
    qc.invalidateQueries({ queryKey: ['can-buttons-admin', slot.id] })
    qc.invalidateQueries({ queryKey: ['can-buttons', slot.id] })
  }

  async function handleCreate(vals: { label: string; byte_index: number; bit_index: number; sort_order: number; active: boolean }) {
    setSaving(true)
    try {
      await apiClient.post(`/api/v1/vehicles/${vehicleId}/can-slots/${slot.id}/buttons`, vals)
      setShowForm(false)
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al crear el botón')
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit(vals: { label: string; byte_index: number; bit_index: number; sort_order: number; active: boolean }) {
    if (!editing) return
    setSaving(true)
    try {
      await apiClient.patch(
        `/api/v1/vehicles/${vehicleId}/can-slots/${slot.id}/buttons/${editing.id}`,
        { label: vals.label, sort_order: vals.sort_order, active: vals.active },
      )
      setEditing(null)
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al editar el botón')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(btn: CanButton) {
    const ok = await confirmAsk({
      title: 'Eliminar botón',
      message: `¿Eliminar el botón "${btn.label}" (byte ${btn.byte_index} bit ${btn.bit_index})?`,
      confirmLabel: 'Eliminar',
      kind: 'danger',
    })
    if (!ok) return
    try {
      await apiClient.delete(
        `/api/v1/vehicles/${vehicleId}/can-slots/${slot.id}/buttons/${btn.id}`,
      )
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al eliminar el botón')
    }
  }

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 7, padding: '8px 12px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)',
      }}>
        Slot {slot.slot}
        {slot.description && (
          <span style={{ fontWeight: 400, color: 'var(--fg-muted)', marginLeft: 6 }}>
            — {slot.description}
          </span>
        )}
        <span style={{ marginLeft: 8, fontSize: 9, color: 'var(--fg-dim)' }}>
          param {slot.param_id}
        </span>
      </div>

      {isLoading ? (
        <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Cargando…</div>
      ) : buttons.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontStyle: 'italic' }}>
          Sin botones configurados.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Etiqueta', 'Byte', 'Bit', 'Orden', 'Activo', ''].map(h => (
                  <th key={h} style={{
                    padding: '4px 8px', textAlign: 'left', fontSize: 9,
                    fontWeight: 700, color: 'var(--fg-muted)', textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buttons.map(btn => (
                <tr key={btn.id} style={{ borderBottom: '1px solid var(--border)', opacity: btn.active ? 1 : 0.5 }}>
                  <td style={{ padding: '5px 8px', color: 'var(--fg-primary)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {btn.label}
                  </td>
                  <td style={{ padding: '5px 8px', color: 'var(--fg-primary)', textAlign: 'center' }}>{btn.byte_index}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--fg-primary)', textAlign: 'center' }}>{btn.bit_index}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--fg-muted)', textAlign: 'center' }}>{btn.sort_order}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'center' }}>{btn.active ? '✅' : '○'}</td>
                  <td style={{ padding: '5px 8px' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => { setEditing(btn); setShowForm(false) }}
                        style={BTN_SM('var(--info)')}
                        data-testid={`btn-edit-button-${btn.id}`}
                      >Editar</button>
                      <button
                        onClick={() => handleDelete(btn)}
                        style={BTN_SM('var(--danger)')}
                        data-testid={`btn-delete-button-${btn.id}`}
                      >Borrar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ButtonForm
          initial={{ label: editing.label, byte_index: editing.byte_index, bit_index: editing.bit_index, sort_order: editing.sort_order, active: editing.active }}
          isEdit={true}
          onSave={handleEdit}
          onCancel={() => setEditing(null)}
          saving={saving}
        />
      )}

      {showForm && !editing && (
        <ButtonForm
          initial={{ label: '', byte_index: 0, bit_index: 0, sort_order: 0, active: true }}
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
            color: 'var(--fg-muted)', cursor: 'pointer',
            fontFamily: 'var(--font-sans)', textAlign: 'left',
          }}
          data-testid="btn-add-button"
        >
          + Añadir botón
        </button>
      )}
    </div>
  )
}

export default function ManualCanButtonManager({ vehicleId }: Props) {
  const isAdmin = useAuthStore(s => s.user?.role === 'admin')
  const [open, setOpen] = useState(false)

  const { data: slots = [], isLoading } = useQuery<Slot[]>({
    queryKey: ['manual-can-slots-admin', vehicleId],
    queryFn: () =>
      apiClient.get<Slot[]>(`/api/v1/vehicles/${vehicleId}/manual-can-slots?include_inactive=false`),
    enabled: !!vehicleId && isAdmin === true,
  })

  if (!isAdmin) return null

  const activeSlots = slots.filter(s => s.active)

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 8, overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', background: 'none', border: 'none', padding: '7px 10px',
          display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
        }}
        data-testid="button-manager-toggle"
      >
        <span style={{
          transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          transition: 'transform 0.2s', display: 'inline-block',
          fontSize: 10, color: 'var(--fg-muted)',
        }}>▾</span>
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: 9, fontWeight: 700,
          color: 'var(--fg-muted)', letterSpacing: '0.07em', textTransform: 'uppercase',
        }}>Botones CAN Manual</span>
        <span style={{
          marginLeft: 'auto', fontSize: 9, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)',
        }}>admin</span>
      </button>

      {open && (
        <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {isLoading ? (
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', padding: '8px 0' }}>Cargando…</div>
          ) : activeSlots.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontStyle: 'italic', padding: '4px 0' }}>
              No hay slots activos. Configura al menos un slot primero.
            </div>
          ) : (
            activeSlots.map(slot => (
              <SlotButtonSection key={slot.id} vehicleId={vehicleId} slot={slot} />
            ))
          )}
        </div>
      )}
    </div>
  )
}
