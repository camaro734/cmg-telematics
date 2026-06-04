import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { SkeletonRow } from '../../shared/ui/SkeletonCard'
import ProgressBar from './ProgressBar'
import ThresholdBuilder from './ThresholdBuilder'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import { useTenantContext } from '../../lib/useTenantContext'
import type { MaintenancePlanOut, VehicleOut, MaintenancePlanCreate, MaintenancePlanUpdate, MaintenanceThreshold } from '../../lib/types'
import { Input } from '../../shared/ui/Input'
import { Select } from '../../shared/ui/Select'

type StatusFilter = 'all' | 'vencido' | 'próximo' | 'ok'

const STATUS_COLORS: Record<string, { border: string; badge: string; text: string }> = {
  vencido:  { border: 'var(--danger)', badge: 'var(--danger)', text: '#fff' },
  'próximo':{ border: 'var(--warn)',   badge: 'var(--warn)',   text: '#fff' },
  ok:       { border: 'var(--ok)',     badge: 'var(--ok)',     text: '#fff' },
}

const STATUS_BADGE_LABEL: Record<string, string> = {
  ok: 'Al día', 'próximo': 'Próximo', vencido: 'Vencido',
}

const THRESHOLD_LABEL: Record<string, string> = {
  pto_hours: 'h PTO', engine_hours: 'h motor', calendar_days: 'días',
}

const STATUS_ORDER: Record<string, number> = { vencido: 0, 'próximo': 1, ok: 2 }
const DEFAULT_THRESHOLDS: MaintenanceThreshold[] = [{ type: 'pto_hours', value: 500 }]

export default function MaintenancePage() {
  const [vehicleFilter, setVehicleFilter] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const qc = useQueryClient()
  const { user } = useAuthStore()
  const isCmg = user?.tenant_tier === 'cmg'
  const isAdmin = user?.role === 'admin'
  const { activeTenantId } = useTenantContext()

  // ── Modal "Realizar" ─────────────────────────────────────────────────────
  const [completingPlan, setCompletingPlan] = useState<MaintenancePlanOut | null>(null)
  const [completeFile, setCompleteFile] = useState<File | null>(null)
  const [completeDesc, setCompleteDesc] = useState('')
  const [completeError, setCompleteError] = useState('')

  const completeMutation = useMutation({
    mutationFn: async ({ planId, file, description }: { planId: string; file: File | null; description: string }) => {
      const token = useAuthStore.getState().accessToken
      const formData = new FormData()
      if (file) formData.append('file', file)
      if (description) formData.append('description', description)
      const res = await fetch(`/api/v1/maintenance/plans/${planId}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Error al registrar mantenimiento' }))
        throw new Error((err as { detail?: string }).detail ?? 'Error')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.maintenancePlans() })
      setCompletingPlan(null)
      setCompleteFile(null)
      setCompleteDesc('')
      setCompleteError('')
    },
    onError: (err: Error) => setCompleteError(err.message),
  })

  function openComplete(plan: MaintenancePlanOut) {
    setCompletingPlan(plan)
    setCompleteFile(null)
    setCompleteDesc('')
    setCompleteError('')
  }

  function handleComplete() {
    if (!completingPlan) return
    if (!isCmg && !completeFile) {
      setCompleteError('Debe adjuntar un documento (factura o albarán)')
      return
    }
    completeMutation.mutate({ planId: completingPlan.id, file: completeFile, description: completeDesc })
  }

  // ── Modal "Nuevo / Editar plan" ──────────────────────────────────────────
  const [formTarget, setFormTarget] = useState<null | 'new' | MaintenancePlanOut>(null)
  const [formName, setFormName] = useState('')
  const [formVehicleId, setFormVehicleId] = useState('')
  const [formThresholds, setFormThresholds] = useState<MaintenanceThreshold[]>(DEFAULT_THRESHOLDS)
  const [formWarnPct, setFormWarnPct] = useState(10)
  const [formActive, setFormActive] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)

  function openForm(target: 'new' | MaintenancePlanOut) {
    if (target === 'new') {
      setFormName('')
      setFormVehicleId(vehicles[0]?.id ?? '')
      setFormThresholds(DEFAULT_THRESHOLDS)
      setFormWarnPct(10)
      setFormActive(true)
    } else {
      setFormName(target.name)
      setFormVehicleId(target.vehicle_id)
      setFormThresholds(target.trigger_condition.thresholds ?? DEFAULT_THRESHOLDS)
      setFormWarnPct(target.warn_before_pct)
      setFormActive(target.active)
    }
    setFormError(null)
    setFormTarget(target)
  }

  const formMutation = useMutation({
    mutationFn: ({ isEdit, id, payload }: { isEdit: boolean; id?: string; payload: MaintenancePlanCreate | MaintenancePlanUpdate }) =>
      isEdit && id
        ? apiClient.put<MaintenancePlanOut>(`/api/v1/maintenance/plans/${id}`, payload)
        : apiClient.post<MaintenancePlanOut>('/api/v1/maintenance/plans', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.maintenancePlans() })
      setFormTarget(null)
    },
    onError: () => setFormError('Error al guardar el plan'),
  })

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formName.trim()) return
    const isEdit = formTarget !== 'new' && formTarget !== null
    if (isEdit) {
      formMutation.mutate({
        isEdit: true,
        id: (formTarget as MaintenancePlanOut).id,
        payload: {
          name: formName.trim(),
          trigger_condition: { thresholds: formThresholds, op: 'OR' },
          warn_before_pct: formWarnPct,
          active: formActive,
        } satisfies MaintenancePlanUpdate,
      })
    } else {
      formMutation.mutate({
        isEdit: false,
        payload: {
          vehicle_id: formVehicleId,
          name: formName.trim(),
          trigger_condition: { thresholds: formThresholds, op: 'OR' },
          warn_before_pct: formWarnPct,
          active: formActive,
        } satisfies MaintenancePlanCreate,
      })
    }
  }

  async function handleExportCsv() {
    const params = new URLSearchParams()
    if (vehicleFilter) params.set('vehicle_id', vehicleFilter)
    const blob = await apiClient.getBlob(`/api/v1/maintenance/logs/export.csv?${params}`)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mantenimiento.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  // ── Queries ──────────────────────────────────────────────────────────────
  const tenantQ = activeTenantId ? `?tenant_id=${activeTenantId}` : ''

  const { data: plans = [], isLoading } = useQuery({
    queryKey: [...keys.maintenancePlans(), activeTenantId],
    queryFn: () => apiClient.get<MaintenancePlanOut[]>(`/api/v1/maintenance/plans${tenantQ}`),
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: [...keys.vehicles(), activeTenantId],
    queryFn: () => apiClient.get<VehicleOut[]>(`/api/v1/vehicles${tenantQ}`),
    staleTime: 60_000,
  })

  // ── Filtering ─────────────────────────────────────────────────────────────
  const byVehicle = plans.filter(p => !vehicleFilter || p.vehicle_id === vehicleFilter)

  const countVencido = byVehicle.filter(p => p.progress.status === 'vencido').length
  const countProximo = byVehicle.filter(p => p.progress.status === 'próximo').length
  const countOk      = byVehicle.filter(p => p.progress.status === 'ok').length
  const uniqueVehicles = new Set(byVehicle.map(p => p.vehicle_id)).size

  const searchLower = search.toLowerCase()

  const visible = byVehicle
    .filter(p => statusFilter === 'all' || p.progress.status === statusFilter)
    .filter(p => !searchLower ||
      p.vehicle_name.toLowerCase().includes(searchLower) ||
      p.name.toLowerCase().includes(searchLower))
    .sort((a, b) => (STATUS_ORDER[a.progress.status] ?? 3) - (STATUS_ORDER[b.progress.status] ?? 3))

  const pillDefs: Array<{ key: StatusFilter; label: string; count: number; color: string }> = [
    { key: 'all',      label: 'Todos',   count: byVehicle.length, color: 'var(--fg-secondary)' },
    { key: 'vencido',  label: 'Vencido', count: countVencido,     color: 'var(--danger)' },
    { key: 'próximo',  label: 'Próximo', count: countProximo,     color: 'var(--warn)' },
    { key: 'ok',       label: 'Al día',  count: countOk,          color: 'var(--ok)' },
  ]

  return (
    <Shell title="Mantenimiento">
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Cabecera ─────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--fg-primary)', lineHeight: 1.2 }}>
              Mantenimiento
            </div>
            {!isLoading && (
              <div style={{ fontSize: 'var(--fs-meta)', color: 'var(--fg-muted)', marginTop: 3 }}>
                {plans.length} {plans.length === 1 ? 'plan' : 'planes'} · {uniqueVehicles} vehículo{uniqueVehicles !== 1 ? 's' : ''}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <button
              onClick={handleExportCsv}
              style={{
                padding: '7px 14px',
                background: 'transparent',
                color: 'var(--fg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 'var(--fs-sm)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Exportar CSV
            </button>
            {isAdmin && (
              <button
                onClick={() => openForm('new')}
                style={{
                  background: 'var(--cmg-teal)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '7px 16px',
                  fontSize: 'var(--fs-sm)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                + Nuevo plan
              </button>
            )}
          </div>
        </div>

        {/* ── Barra de filtros ─────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Select
            size="sm"
            value={vehicleFilter}
            onChange={e => { setVehicleFilter(e.target.value); setStatusFilter('all') }}
          >
            <option value="">Todos los vehículos</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>

          <input
            type="search"
            placeholder="Buscar vehículo o plan…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '5px 10px',
              fontSize: 'var(--fs-sm)',
              color: 'var(--fg-primary)',
              colorScheme: 'dark',
              outline: 'none',
              width: 200,
            }}
          />

          <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

          {pillDefs.map(({ key, label, count, color }) => {
            const active = statusFilter === key
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                style={{
                  background: active ? 'var(--bg-elevated)' : 'transparent',
                  border: active ? '1px solid var(--border-strong)' : '1px solid transparent',
                  borderRadius: 20,
                  padding: '3px 10px',
                  fontSize: 'var(--fs-sm)',
                  cursor: 'pointer',
                  color: active ? 'var(--fg-primary)' : 'var(--fg-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  fontWeight: active ? 600 : 400,
                  transition: 'background 0.15s, border-color 0.15s',
                }}
              >
                {label}
                <span style={{
                  fontSize: 'var(--fs-2xs)',
                  fontWeight: 700,
                  color: count > 0 ? color : 'var(--fg-dim)',
                }}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* ── Tabla ────────────────────────────────────────────────────────── */}
        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[0, 1, 2, 3].map(i => <SkeletonRow key={i} height={52} />)}
          </div>
        ) : visible.length === 0 ? (
          <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-meta)', padding: '32px 0' }}>
            {plans.length === 0
              ? 'Sin planes de mantenimiento configurados'
              : 'Sin planes que coincidan con los filtros'}
          </div>
        ) : (
          <div style={{ background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                  {['VEHÍCULO', 'PLAN', 'PROGRESO', 'ESTADO', ''].map(h => (
                    <th
                      key={h}
                      style={{
                        padding: '8px 14px',
                        fontSize: 'var(--fs-2xs)',
                        color: 'var(--fg-muted)',
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textAlign: 'left',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((plan, i) => {
                  const status = plan.progress.status
                  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.ok
                  const worst = plan.progress.thresholds.length > 0
                    ? plan.progress.thresholds.reduce((a, b) => a.pct > b.pct ? a : b)
                    : null
                  const remaining = worst ? worst.limit - worst.current : null
                  const pctCapped = worst ? Math.min(worst.pct, 999) : 0

                  return (
                    <tr
                      key={plan.id}
                      style={{ borderBottom: i < visible.length - 1 ? '1px solid var(--border)' : 'none' }}
                    >

                      {/* Vehículo — borde izquierdo de color por estado */}
                      <td style={{
                        padding: '10px 14px 10px 11px',
                        borderLeft: `3px solid ${colors.border}`,
                        minWidth: 140,
                      }}>
                        <div style={{ fontSize: 'var(--fs-base)', fontWeight: 600, color: 'var(--fg-primary)' }}>
                          {plan.vehicle_name}
                        </div>
                      </td>

                      {/* Plan */}
                      <td style={{ padding: '10px 14px', minWidth: 160 }}>
                        <Link
                          to={`/maintenance/${plan.id}`}
                          style={{ fontSize: 'var(--fs-base)', color: 'var(--fg-secondary)', textDecoration: 'none' }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--fg-primary)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--fg-secondary)')}
                        >
                          {plan.name}
                        </Link>
                      </td>

                      {/* Progreso */}
                      <td style={{ padding: '10px 14px', minWidth: 220 }}>
                        {worst ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ flex: 1 }}>
                                <ProgressBar pct={worst.pct} status={status} />
                              </div>
                              <span style={{
                                fontSize: 'var(--fs-sm)',
                                fontFamily: 'var(--font-mono)',
                                fontWeight: 600,
                                color: colors.border,
                                minWidth: 36,
                                textAlign: 'right',
                              }}>
                                {pctCapped.toFixed(0)}%
                              </span>
                            </div>
                            <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                              {Math.round(worst.current)}/{worst.limit} {THRESHOLD_LABEL[worst.type] ?? worst.type}
                              {remaining !== null && (
                                <span style={{ color: status === 'vencido' ? 'var(--danger)' : 'var(--fg-dim)', marginLeft: 4 }}>
                                  · {remaining < 0
                                    ? `excedido en ${Math.abs(remaining).toFixed(0)}`
                                    : `quedan ${remaining.toFixed(0)}`
                                  }
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span style={{ fontSize: 'var(--fs-meta)', color: 'var(--fg-dim)' }}>—</span>
                        )}
                      </td>

                      {/* Estado — badge */}
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{
                          fontSize: 'var(--fs-2xs)',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: colors.badge,
                          color: colors.text,
                          letterSpacing: '0.04em',
                          whiteSpace: 'nowrap',
                        }}>
                          {(STATUS_BADGE_LABEL[status] ?? status).toUpperCase()}
                        </span>
                      </td>

                      {/* Acciones */}
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {(status === 'próximo' || status === 'vencido') && (
                            <button
                              onClick={() => openComplete(plan)}
                              style={{
                                background: 'var(--cmg-teal)',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 5,
                                padding: '4px 10px',
                                fontSize: 'var(--fs-xs)',
                                cursor: 'pointer',
                                fontWeight: 600,
                              }}
                            >
                              Realizar
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              onClick={() => openForm(plan)}
                              title="Editar plan"
                              style={{ background: 'none', border: 'none', padding: 0, color: 'var(--fg-muted)', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
                            >
                              <i className="ti ti-pencil" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modal "Nuevo / Editar plan" ────────────────────────────────────── */}
      {formTarget !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 28, width: 520, maxWidth: 'calc(100vw - 32px)', border: '1px solid var(--border)', maxHeight: 'calc(100vh - 64px)', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: 15, fontWeight: 700, color: 'var(--fg-primary)' }}>
              {formTarget === 'new' ? 'Nuevo plan de mantenimiento' : 'Editar plan'}
            </h3>
            <form onSubmit={handleFormSubmit}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <Input
                  label="Nombre del plan"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="Nombre del plan"
                  required
                />
                {formTarget === 'new' && (
                  <Select label="Vehículo" value={formVehicleId} onChange={e => setFormVehicleId(e.target.value)}>
                    {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </Select>
                )}
                <div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 8 }}>
                    UMBRALES (se dispara al llegar al primero)
                  </div>
                  <ThresholdBuilder thresholds={formThresholds} onChange={setFormThresholds} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }}>
                    AVISAR CUANDO QUEDE (%)
                  </div>
                  <Input
                    type="number"
                    value={formWarnPct}
                    min={1}
                    max={50}
                    onChange={e => setFormWarnPct(Number(e.target.value))}
                    style={{ width: 100 }}
                  />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={formActive} onChange={e => setFormActive(e.target.checked)} />
                  <span style={{ fontSize: 13, color: 'var(--fg-primary)' }}>Plan activo</span>
                </label>
                {formError && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{formError}</div>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => setFormTarget(null)}
                    style={{ background: 'var(--bg-elevated)', color: 'var(--fg-secondary)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={formMutation.isPending}
                    style={{ background: 'var(--cmg-teal)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 24px', fontSize: 13, fontWeight: 600, cursor: formMutation.isPending ? 'not-allowed' : 'pointer', opacity: formMutation.isPending ? 0.7 : 1 }}
                  >
                    {formMutation.isPending ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal "Realizar" — sin cambios en lógica ────────────────────────── */}
      {completingPlan && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 24, width: 400, border: '1px solid var(--border)' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600 }}>Registrar mantenimiento</h3>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 16 }}>
              {completingPlan.name}
            </p>

            <label style={{ fontSize: 11, color: 'var(--offline)', fontWeight: 600, letterSpacing: '0.04em', marginBottom: 4, display: 'block' }}>
              Documento (factura / albarán){!isCmg && ' *'}
            </label>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={e => setCompleteFile(e.target.files?.[0] ?? null)}
              style={{ marginBottom: 12, fontSize: 12, color: 'var(--fg-secondary)', width: '100%' }}
            />

            <label style={{ fontSize: 11, color: 'var(--offline)', fontWeight: 600, letterSpacing: '0.04em', marginBottom: 4, display: 'block' }}>
              Descripción (opcional)
            </label>
            <textarea
              value={completeDesc}
              onChange={e => setCompleteDesc(e.target.value)}
              rows={3}
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--fg-secondary)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box', resize: 'vertical', marginBottom: 12 }}
            />

            {completeError && (
              <p style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>{completeError}</p>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setCompletingPlan(null)}
                style={{ background: 'var(--bg-elevated)', color: 'var(--fg-secondary)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleComplete}
                disabled={completeMutation.isPending}
                style={{ background: 'var(--cmg-teal)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600, opacity: completeMutation.isPending ? 0.7 : 1 }}
              >
                {completeMutation.isPending ? 'Guardando…' : 'Confirmar y resetear contador'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}
