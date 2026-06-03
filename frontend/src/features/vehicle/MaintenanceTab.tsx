import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { Input } from '../../shared/ui/Input'
import type { MaintenancePlanOut, ThresholdProgress } from '../../lib/types'

// ── Helpers ─────────────────────────────────────────────────────────────────

function thresholdUnit(type: string): string {
  return type === 'calendar_days' ? 'días' : 'h'
}

function thresholdLabel(type: string): string {
  if (type === 'pto_hours') return 'Horas PTO'
  if (type === 'engine_hours') return 'Horas motor'
  if (type === 'calendar_days') return 'Días calendario'
  return type
}

function dominantThreshold(plan: MaintenancePlanOut): ThresholdProgress {
  return plan.progress.thresholds.reduce((a, b) => (a.pct >= b.pct ? a : b))
}

const STATUS_COLORS: Record<string, { border: string; badge: string; bar: string; text: string }> = {
  vencido: { border: 'var(--danger)', badge: 'var(--danger)', bar: 'var(--danger)', text: '#fff' },
  próximo: { border: 'var(--warn)',   badge: 'var(--warn)',   bar: 'var(--warn)',   text: '#fff' },
  ok:      { border: 'var(--ok)',     badge: 'var(--ok)',     bar: 'var(--ok)',     text: '#fff' },
}

// ── Edit modal ───────────────────────────────────────────────────────────────

interface EditModalProps {
  plan: MaintenancePlanOut
  onClose: () => void
  onSaved: () => void
}

function EditModal({ plan, onClose, onSaved }: EditModalProps) {
  const [name, setName] = useState(plan.name)
  const [warnPct, setWarnPct] = useState(plan.warn_before_pct.toString())
  const [thresholdValues, setThresholdValues] = useState<Record<string, string>>(
    Object.fromEntries(plan.trigger_condition.thresholds.map(t => [t.type, t.value.toString()]))
  )
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: (body: object) =>
      apiClient.put<MaintenancePlanOut>(`/api/v1/maintenance/plans/${plan.id}`, body),
    onSuccess: () => { onSaved(); onClose() },
    onError: () => setError('Error al guardar los cambios'),
  })

  function handleSave() {
    const thresholds = plan.trigger_condition.thresholds.map(t => ({
      type: t.type,
      value: parseFloat(thresholdValues[t.type] ?? String(t.value)),
    }))
    if (thresholds.some(t => isNaN(t.value) || t.value <= 0)) {
      setError('Todos los valores deben ser números positivos')
      return
    }
    mutation.mutate({
      name,
      trigger_condition: { thresholds, op: plan.trigger_condition.op },
      warn_before_pct: Math.max(1, Math.min(50, parseInt(warnPct) || 10)),
    })
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 24, width: 380, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-primary)' }}>Editar umbrales</div>

        <Input label="Nombre" value={name} onChange={e => setName(e.target.value)} />

        {plan.trigger_condition.thresholds.map(t => (
          <div key={t.type}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {thresholdLabel(t.type)} ({thresholdUnit(t.type)})
            </label>
            <Input
              type="number" min="1" step="any"
              value={thresholdValues[t.type] ?? ''}
              onChange={e => setThresholdValues(v => ({ ...v, [t.type]: e.target.value }))}
            />
          </div>
        ))}

        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            % aviso previo (1–50)
          </label>
          <Input type="number" min="1" max="50" value={warnPct} onChange={e => setWarnPct(e.target.value)} />
        </div>

        {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'var(--bg-elevated)', color: 'var(--fg-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={mutation.isPending} style={{ background: 'var(--cmg-teal)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
            {mutation.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Plan card ────────────────────────────────────────────────────────────────

function PlanCard({ plan, isCmg, onEdit }: { plan: MaintenancePlanOut; isCmg: boolean; onEdit: () => void }) {
  const status = plan.progress.status
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.ok
  const dom = dominantThreshold(plan)
  const unit = thresholdUnit(dom.type)
  const pctClamped = Math.min(dom.pct, 100)
  const remaining = dom.limit - dom.current
  const footer = status === 'vencido'
    ? `Excedido en ${Math.abs(remaining).toFixed(1)} ${unit}`
    : `Quedan ${remaining.toFixed(1)} ${unit}`

  const badgeLabel = status === 'vencido' ? 'Vencido' : status === 'próximo' ? 'Próximo' : 'Al día'

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderLeft: `4px solid ${colors.border}`, borderRadius: 8,
      padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--fg-primary)', flex: 1 }}>{plan.name}</span>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: colors.badge, color: colors.text }}>
          {badgeLabel.toUpperCase()}
        </span>
        {isCmg && (
          <button
            title="Editar umbrales"
            onClick={onEdit}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg-muted)', fontSize: 14, padding: '2px 4px', lineHeight: 1, borderRadius: 4 }}
          >
            <i className="ti ti-pencil" />
          </button>
        )}
      </div>

      {/* Valores */}
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)', fontWeight: 600 }}>{dom.current.toFixed(1)}</span>
          {' / '}
          <span style={{ fontFamily: 'var(--font-mono)' }}>{dom.limit}</span>
          {' '}{unit}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', color: colors.bar, fontWeight: 600 }}>{dom.pct.toFixed(0)}%</span>
      </div>

      {/* Barra de progreso */}
      <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pctClamped}%`, background: colors.bar, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>

      {/* Pie */}
      <div style={{ fontSize: 11, color: status === 'vencido' ? 'var(--danger)' : 'var(--fg-muted)' }}>
        {footer}
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

interface MaintenanceTabProps {
  vehicleId: string
  isCmg: boolean
}

export default function MaintenanceTab({ vehicleId, isCmg }: MaintenanceTabProps) {
  const qc = useQueryClient()
  const [editingPlan, setEditingPlan] = useState<MaintenancePlanOut | null>(null)

  const { data: plans = [] } = useQuery({
    queryKey: keys.vehicleMaintenance(vehicleId),
    queryFn: () => apiClient.get<MaintenancePlanOut[]>(`/api/v1/vehicles/${vehicleId}/maintenance`),
    enabled: !!vehicleId,
    staleTime: 30_000,
  })

  const vencidoCount = plans.filter(p => p.progress.status === 'vencido').length
  const proximoCount = plans.filter(p => p.progress.status === 'próximo').length
  const urgentCount = vencidoCount + proximoCount

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderTop: '2px solid var(--cmg-teal)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Header */}
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-muted)', letterSpacing: '0.07em', textTransform: 'uppercase' as const }}>
        Mantenimiento
      </div>

      {/* Banner de atención */}
      {urgentCount > 0 && (
        <div style={{
          background: vencidoCount > 0 ? 'color-mix(in srgb, var(--danger) 10%, transparent)' : 'color-mix(in srgb, var(--warn) 10%, transparent)',
          border: `1px solid ${vencidoCount > 0 ? 'color-mix(in srgb, var(--danger) 30%, transparent)' : 'color-mix(in srgb, var(--warn) 30%, transparent)'}`,
          borderLeft: `3px solid ${vencidoCount > 0 ? 'var(--danger)' : 'var(--warn)'}`,
          borderRadius: 6, padding: '8px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: vencidoCount > 0 ? 'var(--danger)' : 'var(--warn)' }}>
            🔧 {urgentCount} {urgentCount === 1 ? 'plan requiere atención' : 'planes requieren atención'}
            {vencidoCount > 0 && ` — ${vencidoCount} vencido${vencidoCount > 1 ? 's' : ''}`}
            {proximoCount > 0 && `, ${proximoCount} próximo${proximoCount > 1 ? 's' : ''}`}
          </span>
          <a href="/maintenance" style={{ fontSize: 11, color: 'var(--info)', textDecoration: 'none', whiteSpace: 'nowrap', fontWeight: 600 }}>
            Ver mantenimiento →
          </a>
        </div>
      )}

      {/* Tarjetas */}
      {plans.length === 0 ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 13, padding: '8px 0' }}>
          Sin planes de mantenimiento para este vehículo
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {plans.map(plan => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCmg={isCmg}
              onEdit={() => setEditingPlan(plan)}
            />
          ))}
        </div>
      )}

      {/* Modal de edición */}
      {editingPlan && (
        <EditModal
          plan={editingPlan}
          onClose={() => setEditingPlan(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: keys.vehicleMaintenance(vehicleId) })}
        />
      )}
    </div>
  )
}
