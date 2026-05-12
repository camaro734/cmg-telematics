import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { DriverOut } from '../../lib/types'
import Shell from '../../shared/ui/Shell'
import { useTenantContext } from '../../lib/useTenantContext'
import { useConfirm } from '../../shared/ui/ConfirmDialog'
import { useAuthStore } from '../auth/useAuthStore'

// ── Styles ───────────────────────────────────────────────────────────────────
const S = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 } as const,
  title: { fontFamily: 'var(--font-ui)', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 } as const,
  btn: {
    fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600,
    padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
    background: 'var(--accent-energy)', color: '#fff',
  } as const,
  btnSecondary: {
    fontFamily: 'var(--font-ui)', fontSize: 12, padding: '5px 12px', borderRadius: 6,
    border: '1px solid var(--bg-border)', background: 'var(--bg-elevated)',
    color: 'var(--text-muted)', cursor: 'pointer',
  } as const,
  card: {
    background: 'var(--bg-surface)', border: '1px solid var(--bg-border)',
    borderRadius: 10, padding: '16px 20px',
    display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'start', gap: 12,
  } as const,
  label: { fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  value: { fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--text-primary)' },
  grid: { display: 'flex', flexDirection: 'column' as const, gap: 10 },
  overlay: {
    position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: 'var(--bg-surface)', borderRadius: 12, padding: 28,
    width: 440, display: 'flex', flexDirection: 'column' as const, gap: 16,
  },
  field: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  input: {
    background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
    borderRadius: 6, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
    fontSize: 13, padding: '8px 10px',
  } as const,
  warn: { fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--accent-warn)' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function licenseExpirySoon(expiry: string | null): boolean {
  if (!expiry) return false
  const days = (new Date(expiry).getTime() - Date.now()) / 86_400_000
  return days >= 0 && days < 60
}

function licenseExpired(expiry: string | null): boolean {
  if (!expiry) return false
  return new Date(expiry).getTime() < Date.now()
}

// ── Modal de creación/edición ─────────────────────────────────────────────────
interface ModalProps {
  initial?: DriverOut | null
  onClose: () => void
  onSaved: () => void
}

function DriverModal({ initial, onClose, onSaved }: ModalProps) {
  const [form, setForm] = useState({
    full_name: initial?.full_name ?? '',
    phone: initial?.phone ?? '',
    license_number: initial?.license_number ?? '',
    license_expiry: initial?.license_expiry ?? '',
    notes: initial?.notes ?? '',
  })
  const [error, setError] = useState('')

  const { mutate, isPending } = useMutation({
    mutationFn: () => initial
      ? apiClient.put<DriverOut>(`/api/v1/drivers/${initial.id}`, form)
      : apiClient.post<DriverOut>('/api/v1/drivers', form),
    onSuccess: () => { onSaved(); onClose() },
    onError: (e) => setError((e as Error).message),
  })

  const update = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <h2 style={{ ...S.title, fontSize: 16, margin: 0 }}>
          {initial ? 'Editar conductor' : 'Nuevo conductor'}
        </h2>

        <div style={S.field}>
          <span style={S.label}>Nombre completo *</span>
          <input style={S.input} value={form.full_name} onChange={e => update('full_name', e.target.value)} placeholder="Ej: Juan García López"/>
        </div>
        <div style={S.field}>
          <span style={S.label}>Teléfono</span>
          <input style={S.input} value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="+34 600 000 000"/>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={S.field}>
            <span style={S.label}>Nº licencia</span>
            <input style={S.input} value={form.license_number} onChange={e => update('license_number', e.target.value)} placeholder="B-123456"/>
          </div>
          <div style={S.field}>
            <span style={S.label}>Vencimiento licencia</span>
            <input style={{ ...S.input }} type="date" value={form.license_expiry} onChange={e => update('license_expiry', e.target.value)}/>
          </div>
        </div>
        <div style={S.field}>
          <span style={S.label}>Notas</span>
          <textarea style={{ ...S.input, resize: 'vertical', minHeight: 64 }} value={form.notes} onChange={e => update('notes', e.target.value)}/>
        </div>

        {error && <span style={{ ...S.warn, color: 'var(--accent-crit)' }}>{error}</span>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button style={S.btnSecondary} onClick={onClose}>Cancelar</button>
          <button
            style={{ ...S.btn, opacity: isPending || !form.full_name.trim() ? 0.6 : 1 }}
            disabled={isPending || !form.full_name.trim()}
            onClick={() => mutate()}
          >
            {isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function DriversPage() {
  const qc = useQueryClient()
  const confirmAsk = useConfirm()
  const isAdmin = useAuthStore(s => s.user?.role === 'admin')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<DriverOut | null>(null)
  const [search, setSearch] = useState('')
  const { activeTenantId } = useTenantContext()

  const { data: drivers = [], isLoading } = useQuery({
    queryKey: [...keys.drivers(), activeTenantId],
    queryFn: () => apiClient.get<DriverOut[]>(`/api/v1/drivers${activeTenantId ? `?tenant_id=${activeTenantId}` : ''}`),
  })

  const { mutate: deactivate } = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/drivers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.drivers() }),
  })

  const handleSaved = () => qc.invalidateQueries({ queryKey: keys.drivers() })

  return (
    <Shell title="Conductores">
      <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
      <div style={S.header}>
        <h1 style={S.title}>Conductores</h1>
        {isAdmin && <button style={S.btn} onClick={() => { setEditing(null); setShowModal(true) }}>
          + Nuevo conductor
        </button>}
      </div>

      <input
        type="search"
        placeholder="Buscar conductor…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          width: '100%', maxWidth: 320, padding: '7px 12px',
          background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
          borderRadius: 6, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
          fontSize: 13, marginBottom: 16, boxSizing: 'border-box',
        }}
      />

      {isLoading && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Cargando…</div>
      )}

      {!isLoading && drivers.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          No hay conductores registrados. Pulsa <strong>+ Nuevo conductor</strong> para empezar.
        </div>
      )}

      <div style={S.grid}>
        {drivers.filter(d => d.full_name.toLowerCase().includes(search.toLowerCase())).map(d => {
          const expirySoon = licenseExpirySoon(d.license_expiry)
          const expired = licenseExpired(d.license_expiry)
          return (
            <div key={d.id} style={S.card}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {d.full_name}
                  </span>
                  {d.current_vehicle_name && (
                    <span style={{
                      fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600,
                      padding: '2px 8px', borderRadius: 99,
                      background: 'color-mix(in srgb, var(--accent-ok) 15%, transparent)',
                      color: 'var(--accent-ok)',
                    }}>
                      {d.current_vehicle_name}
                    </span>
                  )}
                  {!d.current_vehicle_name && (
                    <span style={{
                      fontFamily: 'var(--font-ui)', fontSize: 11,
                      padding: '2px 8px', borderRadius: 99,
                      background: 'var(--bg-elevated)', color: 'var(--text-muted)',
                    }}>
                      Sin vehículo
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  {d.phone && (
                    <span style={S.value}>{d.phone}</span>
                  )}
                  {d.license_number && (
                    <span style={S.value}>Lic: {d.license_number}</span>
                  )}
                  {d.license_expiry && (
                    <span style={{
                      ...S.value,
                      color: expired ? 'var(--accent-crit)' : expirySoon ? 'var(--accent-warn)' : 'var(--text-muted)',
                      fontWeight: (expired || expirySoon) ? 600 : 400,
                    }}>
                      {expired ? 'Licencia vencida' : expirySoon ? `Vence: ${d.license_expiry}` : `Vence: ${d.license_expiry}`}
                    </span>
                  )}
                </div>

                {d.notes && (
                  <span style={{ ...S.label, textTransform: 'none', letterSpacing: 0, fontSize: 12 }}>{d.notes}</span>
                )}
              </div>

              {isAdmin && <div style={{ display: 'flex', gap: 8 }}>
                <button
                  style={S.btnSecondary}
                  onClick={() => { setEditing(d); setShowModal(true) }}
                >
                  Editar
                </button>
                <button
                  style={{ ...S.btnSecondary, color: 'var(--accent-crit)' }}
                  onClick={async () => { if (await confirmAsk({ title: 'Desactivar conductor', message: `¿Desactivar a ${d.full_name}?`, confirmLabel: 'Desactivar', kind: 'danger' })) deactivate(d.id) }}
                >
                  Desactivar
                </button>
              </div>}
            </div>
          )
        })}
      </div>

      {showModal && (
        <DriverModal
          initial={editing}
          onClose={() => setShowModal(false)}
          onSaved={handleSaved}
        />
      )}
      </div>
    </Shell>
  )
}
