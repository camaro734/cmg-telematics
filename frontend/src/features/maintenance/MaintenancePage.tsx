import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { SkeletonRow } from '../../shared/ui/SkeletonCard'
import ProgressBar from './ProgressBar'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import { useTenantContext } from '../../lib/useTenantContext'
import type { MaintenancePlanOut, VehicleOut } from '../../lib/types'

const STATUS_LABEL: Record<string, string> = { ok: 'OK', 'próximo': 'PRÓXIMO', vencido: 'VENCIDO' }
const STATUS_COLOR: Record<string, string> = {
  ok: 'var(--accent-ok)',
  'próximo': 'var(--accent-warn)',
  vencido: 'var(--accent-crit)',
}
const THRESHOLD_LABEL: Record<string, string> = {
  pto_hours: 'h PTO',
  engine_hours: 'h motor',
  calendar_days: 'días',
}
const STATUS_ORDER: Record<string, number> = { vencido: 0, 'próximo': 1, ok: 2 }

export default function MaintenancePage() {
  const [vehicleFilter, setVehicleFilter] = useState('')

  // ── Complete maintenance state ────────────────────────────────────────────
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const isCmg = user?.tenant_tier === 'cmg'
  const isAdmin = user?.role === 'admin'
  const { activeTenantId } = useTenantContext()

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
    onError: (err: Error) => {
      setCompleteError(err.message)
    },
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

  const sorted = [...plans]
    .filter(p => !vehicleFilter || p.vehicle_id === vehicleFilter)
    .sort((a, b) => (STATUS_ORDER[a.progress.status] ?? 3) - (STATUS_ORDER[b.progress.status] ?? 3))

  return (
    <Shell title="Mantenimiento">
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <select
            value={vehicleFilter}
            onChange={e => setVehicleFilter(e.target.value)}
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--bg-border)',
              color: 'var(--text-primary)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
            }}
          >
            <option value="">Todos los vehículos</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={handleExportCsv}
              style={{ padding: '5px 12px', background: 'var(--bg-elevated)', color: 'var(--text-base, #E7E5E4)', border: '1px solid var(--bg-border)', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}
            >
              Exportar CSV
            </button>
            {isAdmin && <Link
              to="/maintenance/new"
              style={{
                background: 'var(--accent-energy)',
                color: '#fff',
                borderRadius: 6,
                padding: '8px 16px',
                fontSize: 12,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              + Nuevo plan
            </Link>}
          </div>
        </div>

        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[0,1,2,3].map(i => <SkeletonRow key={i} height={44} />)}
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Sin planes de mantenimiento configurados</div>
        ) : (
          <div style={{ background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--bg-border)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
                  {['VEHÍCULO', 'PLAN', 'PROGRESO', 'ESTADO', ''].map(h => (
                    <th key={h} style={{ padding: '8px 16px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', textAlign: 'left' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((plan, i) => {
                  const worst = plan.progress.thresholds.length > 0
                    ? plan.progress.thresholds.reduce((a, b) => a.pct > b.pct ? a : b)
                    : null
                  return (
                    <tr key={plan.id} style={{ borderBottom: i < sorted.length - 1 ? '1px solid var(--bg-border)' : 'none' }}>
                      <td style={{ padding: '10px 16px', fontSize: 13 }}>{plan.vehicle_name}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <Link to={`/maintenance/${plan.id}`} style={{ color: 'var(--text-primary)', fontSize: 13 }}>
                          {plan.name}
                        </Link>
                      </td>
                      <td style={{ padding: '10px 16px', minWidth: 200 }}>
                        {worst && (
                          <div>
                            <ProgressBar pct={worst.pct} status={plan.progress.status} />
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                              {THRESHOLD_LABEL[worst.type] ?? worst.type}: {Math.round(worst.current)}/{worst.limit}
                            </div>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: STATUS_COLOR[plan.progress.status] ?? 'var(--text-muted)' }}>
                          {STATUS_LABEL[plan.progress.status] ?? plan.progress.status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
                        {isAdmin && <Link to={`/maintenance/${plan.id}/edit`} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          Editar
                        </Link>}
                        {(plan.progress.status === 'próximo' || plan.progress.status === 'vencido') && (
                          <button
                            onClick={() => openComplete(plan)}
                            style={{
                              background: 'var(--accent-energy)',
                              color: '#fff',
                              border: 'none',
                              borderRadius: 5,
                              padding: '4px 10px',
                              fontSize: 11,
                              cursor: 'pointer',
                              fontWeight: 600,
                              marginLeft: 8,
                            }}
                          >
                            Realizar
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Complete maintenance modal ─────────────────────────────────────────── */}
      {completingPlan && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 24, width: 400, border: '1px solid var(--bg-border)' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600 }}>Registrar mantenimiento</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
              {completingPlan.name}
            </p>

            <label style={{ fontSize: 11, color: 'var(--accent-off)', fontWeight: 600, letterSpacing: '0.04em', marginBottom: 4, display: 'block' }}>
              Documento (factura / albarán){!isCmg && ' *'}
            </label>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={e => setCompleteFile(e.target.files?.[0] ?? null)}
              style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-primary, #E7E5E4)', width: '100%' }}
            />

            <label style={{ fontSize: 11, color: 'var(--accent-off)', fontWeight: 600, letterSpacing: '0.04em', marginBottom: 4, display: 'block' }}>
              Descripción (opcional)
            </label>
            <textarea
              value={completeDesc}
              onChange={e => setCompleteDesc(e.target.value)}
              rows={3}
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', color: 'var(--text-primary, #E7E5E4)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box', resize: 'vertical', marginBottom: 12 }}
            />

            {completeError && (
              <p style={{ fontSize: 12, color: 'var(--accent-crit)', marginBottom: 12 }}>{completeError}</p>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setCompletingPlan(null)}
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary, #E7E5E4)', border: '1px solid var(--bg-border)', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleComplete}
                disabled={completeMutation.isPending}
                style={{ background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600, opacity: completeMutation.isPending ? 0.7 : 1 }}
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
