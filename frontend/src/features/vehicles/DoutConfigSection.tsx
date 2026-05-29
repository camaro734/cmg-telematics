import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleTypeOut, DoutSlot } from '../../lib/types'

// ── Types ──────────────────────────────────────────────────────────────────

type DoutFormState = { slot: string; label: string; enabled: boolean }

const emptyDoutForm: DoutFormState = { slot: '1', label: '', enabled: true }

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

export default function DoutConfigSection({ typeId, selectedType }: Props) {
  const qc = useQueryClient()

  const [showDoutModal, setShowDoutModal] = useState(false)
  const [editingDoutIdx, setEditingDoutIdx] = useState<number | null>(null)
  const [doutForm, setDoutForm] = useState<DoutFormState>(emptyDoutForm)

  const updateDoutMutation = useMutation({
    mutationFn: ({ dout_config }: { dout_config: DoutSlot[] }) =>
      apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${typeId}/dout-config`, { dout_config }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.vehicleTypes() })
      setShowDoutModal(false)
    },
  })

  function openNewDout() {
    setEditingDoutIdx(null)
    setDoutForm(emptyDoutForm)
    setShowDoutModal(true)
  }

  function openEditDout(d: DoutSlot, idx: number) {
    setEditingDoutIdx(idx)
    setDoutForm({ slot: d.slot.toString(), label: d.label, enabled: d.enabled })
    setShowDoutModal(true)
  }

  function saveDout() {
    if (!doutForm.label.trim()) return
    const newSlot: DoutSlot = {
      slot: parseInt(doutForm.slot) || 1,
      label: doutForm.label.trim(),
      enabled: doutForm.enabled,
    }
    const current: DoutSlot[] = selectedType.dout_config ?? []
    let next: DoutSlot[]
    if (editingDoutIdx === null) {
      next = [...current, newSlot]
    } else {
      next = current.map((d, i) => i === editingDoutIdx ? newSlot : d)
    }
    updateDoutMutation.mutate({ dout_config: next })
  }

  function deleteDout(idx: number) {
    const next = (selectedType.dout_config ?? []).filter((_, i) => i !== idx)
    updateDoutMutation.mutate({ dout_config: next })
  }

  return (
    <>
      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Salidas digitales (controles de mando)
          </span>
          {(selectedType.dout_config ?? []).length < 4 && (
            <button style={btnPrimary} onClick={openNewDout}>+ Añadir salida</button>
          )}
        </div>
        {(selectedType.dout_config ?? []).length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Sin salidas configuradas. Máximo 4 (DOUT1–DOUT4 del FMC650).</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['DOUT', 'ETIQUETA', 'HABILITADO', ''].map(h => (
                  <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(selectedType.dout_config ?? []).map((d, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', color: 'var(--cmg-teal)' }}>DOUT{d.slot}</td>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{d.label}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600,
                      background: d.enabled ? 'color-mix(in srgb, var(--ok) 15%, transparent)' : 'transparent',
                      color: d.enabled ? 'var(--ok)' : 'var(--fg-muted)',
                      border: `1px solid ${d.enabled ? 'var(--ok)' : 'var(--border)'}`,
                    }}>
                      {d.enabled ? 'Sí' : 'No'}
                    </span>
                  </td>
                  <td style={{ padding: '6px 8px', display: 'flex', gap: 6 }}>
                    <button style={btnSecondary} onClick={() => openEditDout(d, idx)}>✎</button>
                    <button style={{ ...btnSecondary, color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => deleteDout(idx)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Modal: Salida digital (DOUT) ──────────────────────────────── */}
      {showDoutModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
          onClick={e => { if (e.target === e.currentTarget) setShowDoutModal(false) }}
        >
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 24, width: 360, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--fg-primary)' }}>
              {editingDoutIdx === null ? 'Nueva salida digital' : 'Editar salida digital'}
            </h3>
            <div>
              <label style={labelStyle}>DOUT (1–4)</label>
              <select style={inputStyle} value={doutForm.slot}
                onChange={e => setDoutForm(f => ({ ...f, slot: e.target.value }))}>
                {[1, 2, 3, 4].map(n => <option key={n} value={n}>DOUT{n}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>ETIQUETA (acción)</label>
              <input style={inputStyle} value={doutForm.label} placeholder="Parar motor"
                onChange={e => setDoutForm(f => ({ ...f, label: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" id="dout-enabled" checked={doutForm.enabled}
                onChange={e => setDoutForm(f => ({ ...f, enabled: e.target.checked }))} />
              <label htmlFor="dout-enabled" style={{ fontSize: 13, color: 'var(--fg-primary)', cursor: 'pointer' }}>
                Habilitado (visible en controles de mando)
              </label>
            </div>
            {updateDoutMutation.isError && (
              <div style={{ fontSize: 12, color: 'var(--danger)' }}>
                {(updateDoutMutation.error as Error).message}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => setShowDoutModal(false)}>Cancelar</button>
              <button style={btnPrimary} onClick={saveDout}
                disabled={!doutForm.label.trim() || updateDoutMutation.isPending}>
                {updateDoutMutation.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
