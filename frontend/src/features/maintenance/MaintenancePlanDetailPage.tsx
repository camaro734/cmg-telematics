import { useState } from 'react'
import { useParams, Navigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import LogInterventionModal from './LogInterventionModal'
import PlanSideCard from './PlanSideCard'
import InterventionTimeline from './InterventionTimeline'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import type { MaintenancePlanOut, MaintenanceLogOut, MaintenanceProjectionOut } from '../../lib/types'

export default function MaintenancePlanDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [showLog, setShowLog] = useState(false)
  const qc = useQueryClient()
  const { user } = useAuthStore()

  const { data: plan, isLoading } = useQuery({
    queryKey: keys.maintenancePlan(id ?? ''),
    queryFn: () => apiClient.get<MaintenancePlanOut>(`/api/v1/maintenance/plans/${id}`),
    enabled: !!id,
    refetchInterval: 60_000,
  })

  const { data: logs = [] } = useQuery({
    queryKey: keys.maintenanceLogs(id ?? ''),
    queryFn: () => apiClient.get<MaintenanceLogOut[]>(`/api/v1/maintenance/plans/${id}/logs`),
    enabled: !!id,
  })

  const { data: projection } = useQuery({
    queryKey: keys.maintenanceProjection(id ?? ''),
    queryFn: () => apiClient.get<MaintenanceProjectionOut>(`/api/v1/maintenance/plans/${id}/projection`),
    enabled: !!id,
    staleTime: 120_000,
  })

  if (!id) return <Navigate to="/maintenance" replace />
  if (isLoading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}>
      Cargando…
    </div>
  )
  if (!plan) return <Navigate to="/maintenance" replace />

  const isOperatorOrAdmin = user?.role === 'admin' || user?.role === 'operator'
  const canManage = user?.role === 'admin' && (
    user.tenant_tier === 'cmg' ||
    (user.tenant_tier === 'manufacturer' && String(plan.owner_tenant_id) === String(user.tenant_id))
  )

  const lastLog = logs[0] ?? null
  const accumulatedCost = logs.reduce((s, l) => s + (l.cost_eur ?? 0), 0)

  function handleLogClose() {
    setShowLog(false)
    qc.invalidateQueries({ queryKey: keys.maintenanceLogs(id!) })
    qc.invalidateQueries({ queryKey: keys.maintenancePlan(id!) })
    qc.invalidateQueries({ queryKey: keys.maintenanceProjection(id!) })
  }

  return (
    <Shell title={plan.name}>
      <div style={{ padding: 24, maxWidth: 1100 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <Link to="/maintenance" style={{ fontSize: 12, color: 'var(--fg-muted)', textDecoration: 'none' }}>
              ← Planes de mantenimiento
            </Link>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 6 }}>{plan.vehicle_name}</div>
            <div style={{ fontSize: 20, color: 'var(--fg-primary)', fontWeight: 600, marginTop: 2 }}>{plan.name}</div>
          </div>
          {isOperatorOrAdmin && (
            <button
              onClick={() => setShowLog(true)}
              style={{ background: 'var(--cmg-teal)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', marginTop: 4 }}
            >
              + Registrar intervención
            </button>
          )}
        </div>

        {/* Layout: tarjeta lateral + timeline */}
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

          {/* Izquierda: tarjeta unificada del plan */}
          <div style={{ width: 260, flexShrink: 0 }}>
            <PlanSideCard
              plan={plan}
              projection={projection}
              lastLog={lastLog}
              accumulatedCost={accumulatedCost}
              isOperatorOrAdmin={isOperatorOrAdmin}
              canManage={canManage}
              onRegister={() => setShowLog(true)}
            />
          </div>

          {/* Derecha: timeline de intervenciones */}
          <div style={{ flex: 1, minWidth: 0, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)' }}>
                Historial de intervenciones
              </span>
            </div>
            <div style={{ padding: '16px 16px 16px 20px' }}>
              <InterventionTimeline
                logs={logs}
                isOperatorOrAdmin={isOperatorOrAdmin}
                onRegister={() => setShowLog(true)}
              />
            </div>
          </div>

        </div>
      </div>

      {showLog && (
        <LogInterventionModal
          planId={id}
          thresholds={plan.trigger_condition.thresholds}
          onClose={handleLogClose}
        />
      )}
    </Shell>
  )
}
