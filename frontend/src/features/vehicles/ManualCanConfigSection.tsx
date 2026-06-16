import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleTypeOut, ManualCanSlotCfg, ManualCanButtonCfg } from '../../lib/types'
import { Input } from '../../shared/ui/Input'
import { Select } from '../../shared/ui/Select'

// Roles que pueden accionar un botón (admin siempre puede, no se lista aquí).
const PRESSABLE_ROLES: { value: string; label: string }[] = [
  { value: 'operator', label: 'Operador' },
  { value: 'driver', label: 'Conductor' },
]

const btnPrimary: React.CSSProperties = {
  background: 'var(--cmg-teal)', color: '#fff', border: 'none', borderRadius: 6,
  padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600,
}
const btnSecondary: React.CSSProperties = {
  background: 'var(--bg-elevated)', color: 'var(--fg-primary)', border: '1px solid var(--border)',
  borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
}
const th: React.CSSProperties = {
  padding: '4px 8px', textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, fontWeight: 600,
}
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'middle' }

interface Props {
  typeId: string
  selectedType: VehicleTypeOut
}

export default function ManualCanConfigSection({ typeId, selectedType }: Props) {
  const qc = useQueryClient()
  const [slots, setSlots] = useState<ManualCanSlotCfg[]>([])
  const [buttons, setButtons] = useState<ManualCanButtonCfg[]>([])

  // Resincroniza el estado editable cuando cambia el tipo seleccionado.
  useEffect(() => {
    setSlots((selectedType.manual_can_slots ?? []).map(s => ({ ...s })))
    setButtons((selectedType.manual_can_buttons ?? []).map(b => ({ ...b })))
  }, [selectedType.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${typeId}/manual-can`, {
        manual_can_slots: slots,
        manual_can_buttons: buttons,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.vehicleTypes() }),
  })

  // ── Slots ──────────────────────────────────────────────────────────────
  function addSlot() {
    setSlots(s => [...s, { id: crypto.randomUUID(), slot: 0, param_id: 16000, description: '' }])
  }
  function patchSlot(id: string, patch: Partial<ManualCanSlotCfg>) {
    setSlots(s => s.map(x => (x.id === id ? { ...x, ...patch } : x)))
  }
  function removeSlot(id: string) {
    setSlots(s => s.filter(x => x.id !== id))
    setButtons(b => b.filter(x => x.slot_id !== id)) // arrastra sus botones
  }

  // ── Botones ────────────────────────────────────────────────────────────
  function addButton() {
    const slotId = slots[0]?.id ?? ''
    setButtons(b => [...b, {
      id: crypto.randomUUID(), slot_id: slotId, byte_index: 0, bit_index: 0,
      label: '', function: 'toggle', allowed_roles: ['operator'], sort_order: b.length, active: true,
    }])
  }
  function patchButton(id: string, patch: Partial<ManualCanButtonCfg>) {
    setButtons(b => b.map(x => (x.id === id ? { ...x, ...patch } : x)))
  }
  function removeButton(id: string) {
    setButtons(b => b.filter(x => x.id !== id))
  }
  function toggleRole(id: string, role: string, checked: boolean) {
    setButtons(b => b.map(x => {
      if (x.id !== id) return x
      const set = new Set(x.allowed_roles)
      if (checked) set.add(role); else set.delete(role)
      return { ...x, allowed_roles: [...set] }
    }))
  }

  const num = (v: string, fallback = 0) => (v === '' ? fallback : Number(v))

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Botones CAN manual (FMC650 → CR2530)
        </span>
        <button style={btnPrimary} onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? 'Guardando…' : 'Guardar configuración'}
        </button>
      </div>

      {/* ── Slots ─────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--fg-primary)', fontWeight: 600 }}>Slots (mensaje CAN → param_id)</span>
          <button style={btnSecondary} onClick={addSlot}>+ Slot</button>
        </div>
        {slots.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Sin slots. Añade uno para mapear un mensaje CAN del CR2530.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['SLOT (0-9)', 'PARAM ID', 'DESCRIPCIÓN', ''].map(h => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {slots.map(s => (
                <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...td, width: 90 }}>
                    <Input type="number" min={0} max={9} value={String(s.slot)}
                      onChange={e => patchSlot(s.id, { slot: num(e.target.value) })} />
                  </td>
                  <td style={{ ...td, width: 120 }}>
                    <Input type="number" min={1} value={String(s.param_id)}
                      onChange={e => patchSlot(s.id, { param_id: num(e.target.value, 1) })} />
                  </td>
                  <td style={td}>
                    <Input value={s.description} placeholder="Hidráulica"
                      onChange={e => patchSlot(s.id, { description: e.target.value })} />
                  </td>
                  <td style={{ ...td, width: 40 }}>
                    <button style={{ ...btnSecondary, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      onClick={() => removeSlot(s.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Botones ───────────────────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--fg-primary)', fontWeight: 600 }}>Botones</span>
          <button style={btnSecondary} onClick={addButton} disabled={slots.length === 0}>+ Botón</button>
        </div>
        {buttons.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Sin botones. {slots.length === 0 ? 'Crea primero un slot.' : 'Añade uno.'}</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['ETIQUETA', 'SLOT', 'BYTE', 'BIT', 'FUNCIÓN', 'ROLES', 'ORDEN', 'ACTIVO', ''].map(h => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {buttons.map(b => (
                <tr key={b.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...td, minWidth: 120 }}>
                    <Input value={b.label} placeholder="Bomba"
                      onChange={e => patchButton(b.id, { label: e.target.value })} />
                  </td>
                  <td style={td}>
                    <Select value={b.slot_id} onChange={e => patchButton(b.id, { slot_id: e.target.value })}>
                      {slots.map(s => <option key={s.id} value={s.id}>{s.description || `Slot ${s.slot}`}</option>)}
                    </Select>
                  </td>
                  <td style={{ ...td, width: 70 }}>
                    <Input type="number" min={0} max={7} value={String(b.byte_index)}
                      onChange={e => patchButton(b.id, { byte_index: num(e.target.value) })} />
                  </td>
                  <td style={{ ...td, width: 70 }}>
                    <Input type="number" min={0} max={7} value={String(b.bit_index)}
                      onChange={e => patchButton(b.id, { bit_index: num(e.target.value) })} />
                  </td>
                  <td style={td}>
                    <Select value={b.function}
                      onChange={e => patchButton(b.id, { function: e.target.value as 'toggle' | 'hold' })}>
                      <option value="toggle">Enclavado</option>
                      <option value="hold">Mantener pulsado</option>
                    </Select>
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {PRESSABLE_ROLES.map(r => (
                        <label key={r.value} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, cursor: 'pointer' }}>
                          <input type="checkbox" checked={b.allowed_roles.includes(r.value)}
                            onChange={e => toggleRole(b.id, r.value, e.target.checked)} />
                          {r.label}
                        </label>
                      ))}
                    </div>
                  </td>
                  <td style={{ ...td, width: 70 }}>
                    <Input type="number" min={0} value={String(b.sort_order)}
                      onChange={e => patchButton(b.id, { sort_order: num(e.target.value) })} />
                  </td>
                  <td style={{ ...td, width: 50 }}>
                    <input type="checkbox" checked={b.active}
                      onChange={e => patchButton(b.id, { active: e.target.checked })} />
                  </td>
                  <td style={{ ...td, width: 40 }}>
                    <button style={{ ...btnSecondary, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      onClick={() => removeButton(b.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg-muted)' }}>
        Los administradores siempre pueden accionar cualquier botón. «Mantener pulsado» envía ON al pulsar y OFF al soltar.
      </div>
      {mutation.isError && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)' }}>
          {(mutation.error as Error).message}
        </div>
      )}
    </div>
  )
}
