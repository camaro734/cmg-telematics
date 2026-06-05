import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import ContextNavBand from '../../shared/ui/ContextNavBand'
import type { ContextNavTab } from '../../shared/ui/ContextNavBand'
import { Input } from '../../shared/ui/Input'
import { Select } from '../../shared/ui/Select'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { Chip } from '../../shared/ui/Chip'
import ActiveAlertsList from './ActiveAlertsList'
import AlertHistory from './AlertHistory'
import type { HistoryStatus } from './AlertHistory'
import type { AlertInstanceOut, VehicleOut, RuleOut } from '../../lib/types'
import { useAuthStore } from '../auth/useAuthStore'
import { useTenantContext } from '../../lib/useTenantContext'
import { useConfirm } from '../../shared/ui/ConfirmDialog'

const SEVERITY: Record<string, { label: string; color: string }> = {
  info:     { label: 'INFO',    color: 'var(--info)' },
  warning:  { label: 'AVISO',   color: 'var(--warn)' },
  critical: { label: 'CRÍTICA', color: 'var(--danger)' },
}

type AlertTab = 'activas' | 'historial' | 'reglas'

export default function AlertsPage() {
  const user = useAuthStore(s => s.user)
  const canManageRules = user?.role === 'admin' && user?.tenant_tier !== 'subclient'
  const { activeTenantId } = useTenantContext()
  const tenantQ = activeTenantId ? `&tenant_id=${activeTenantId}` : ''
  const qc = useQueryClient()
  const confirm = useConfirm()

  const [tab, setTab] = useState<AlertTab>('activas')

  // Estado levantado desde AlertHistory
  const [histStatus, setHistStatus] = useState<HistoryStatus>('all')
  const [histVehicleId, setHistVehicleId] = useState('')
  const [histDateFrom, setHistDateFrom] = useState('')
  const [histDateTo, setHistDateTo] = useState('')

  const [searchParams, setSearchParams] = useSearchParams()
  const vehicleParam = searchParams.get('vehicle') ?? undefined
  const vehicleQ = vehicleParam ? `&vehicle_id=${vehicleParam}` : ''

  async function handleExportCsv() {
    const blob = await apiClient.getBlob(`/api/v1/alerts/export.csv${activeTenantId ? `?tenant_id=${activeTenantId}` : ''}`)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'alertas.csv'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const { data: vehicles = [] } = useQuery({
    queryKey: [...keys.vehicles(), activeTenantId],
    queryFn: () => apiClient.get<VehicleOut[]>(`/api/v1/vehicles${activeTenantId ? `?tenant_id=${activeTenantId}` : ''}`),
    staleTime: 60_000,
  })

  const { data: rules = [] } = useQuery({
    queryKey: keys.rules(),
    queryFn: () => apiClient.get<RuleOut[]>('/api/v1/rules'),
    staleTime: 60_000,
  })

  const { data: firing = [] } = useQuery({
    queryKey: [...keys.alerts(), 'firing', activeTenantId, vehicleParam],
    queryFn: () => apiClient.get<AlertInstanceOut[]>(`/api/v1/alerts?status=firing${tenantQ}${vehicleQ}`),
    refetchInterval: 30_000,
  })

  const { data: escalated = [] } = useQuery({
    queryKey: [...keys.alerts(), 'escalated', activeTenantId, vehicleParam],
    queryFn: () => apiClient.get<AlertInstanceOut[]>(`/api/v1/alerts?status=escalated${tenantQ}${vehicleQ}`),
    refetchInterval: 30_000,
  })

  const activeAlerts = [...firing, ...escalated].sort(
    (a, b) => (b.triggered_at > a.triggered_at ? 1 : b.triggered_at < a.triggered_at ? -1 : 0)
  )

  const toggleRule = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiClient.put<RuleOut>(`/api/v1/rules/${id}`, { active }),
    onSuccess: (updated) =>
      qc.setQueryData(keys.rules(), (prev: RuleOut[] = []) =>
        prev.map(r => r.id === updated.id ? updated : r)
      ),
  })

  const deleteRule = useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/rules/${id}`),
    onSuccess: (_, id) =>
      qc.setQueryData(keys.rules(), (prev: RuleOut[] = []) => prev.filter(r => r.id !== id)),
  })

  const alertTabsConfig: ContextNavTab[] = [
    {
      key: 'activas',
      label: 'Activas',
      icon: 'ti-bell',
      count: activeAlerts.length > 0 ? activeAlerts.length : undefined,
    },
    { key: 'historial', label: 'Historial', icon: 'ti-history' },
    ...(canManageRules ? [{ key: 'reglas', label: 'Reglas', icon: 'ti-settings' } as ContextNavTab] : []),
  ]

  const btnSecondary: React.CSSProperties = {
    padding: '5px 12px', fontSize: 13, fontWeight: 600,
    fontFamily: 'var(--font-sans)', border: '1px solid var(--border)',
    borderRadius: 6, cursor: 'pointer',
    background: 'var(--bg-card)', color: 'var(--fg-primary)',
    display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
  }

  const rightSlotByTab: Record<AlertTab, React.ReactNode> = {
    activas: (
      <button style={btnSecondary} onClick={handleExportCsv}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Exportar CSV
      </button>
    ),
    historial: (
      <>
        <Select size="sm" value={histStatus} onChange={e => setHistStatus(e.target.value as HistoryStatus)}>
          <option value="all">Todos los estados</option>
          <option value="acknowledged">Reconocidas</option>
          <option value="resolved">Resueltas</option>
        </Select>
        <Select size="sm" value={histVehicleId} onChange={e => setHistVehicleId(e.target.value)} aria-label="Filtrar por vehículo">
          <option value="">Todos los vehículos</option>
          {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </Select>
        <Input type="date" size="sm" value={histDateFrom} onChange={e => setHistDateFrom(e.target.value)} title="Desde" />
        <Input type="date" size="sm" value={histDateTo}   onChange={e => setHistDateTo(e.target.value)}   title="Hasta" />
      </>
    ),
    reglas: canManageRules ? (
      <Link
        to="/rules/new"
        style={{
          padding: '6px 16px', background: 'var(--cmg-teal)', color: '#fff',
          borderRadius: 6, fontSize: 13, fontWeight: 600,
          textDecoration: 'none', fontFamily: 'var(--font-sans)',
          display: 'inline-flex', alignItems: 'center',
        }}
      >
        + Nueva regla
      </Link>
    ) : null,
  }

  return (
    <Shell title="Alertas">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

        <ContextNavBand
          tabs={alertTabsConfig}
          activeKey={tab}
          onChange={(k) => setTab(k as AlertTab)}
          rightSlot={rightSlotByTab[tab]}
        />

        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

          {/* Filtro activo por vehículo (desde URL) */}
          {vehicleParam && (
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)' }}>
                Filtrado por vehículo:
              </span>
              <Chip color="var(--info)" soft size="sm">
                {vehicles.find(v => v.id === vehicleParam)?.license_plate ??
                 vehicles.find(v => v.id === vehicleParam)?.name ??
                 vehicleParam.slice(0, 8) + '…'}
              </Chip>
              <button
                onClick={() => setSearchParams({})}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg-dim)', fontSize: 12, fontFamily: 'var(--font-sans)' }}
              >
                × Quitar filtro
              </button>
            </div>
          )}

          {tab === 'activas' && (
            <ActiveAlertsList alerts={activeAlerts} vehicles={vehicles} rules={rules} />
          )}

          {tab === 'historial' && (
            <AlertHistory
              vehicles={vehicles}
              rules={rules}
              status={histStatus}
              vehicleId={histVehicleId}
              dateFrom={histDateFrom}
              dateTo={histDateTo}
            />
          )}

          {tab === 'reglas' && canManageRules && (
            <div>
              {rules.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 0' }}>
                  <p style={{ color: 'var(--fg-muted)', fontSize: 14, marginBottom: 16 }}>
                    No hay reglas de alerta configuradas.
                  </p>
                  <Link
                    to="/rules/new"
                    style={{
                      color: 'var(--cmg-teal)', fontSize: 14,
                      textDecoration: 'none', borderBottom: '1px solid var(--cmg-teal)', paddingBottom: 2,
                    }}
                  >
                    Crear la primera regla →
                  </Link>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {rules.map(rule => {
                    const sev = SEVERITY[rule.severity] ?? SEVERITY.info
                    return (
                      <div
                        key={rule.id}
                        style={{
                          background: 'var(--bg-card)', border: '1px solid var(--border)',
                          borderRadius: 10, padding: '12px 16px',
                          display: 'flex', alignItems: 'center', gap: 12,
                        }}
                      >
                        <Chip color={sev.color} soft size="sm">{sev.label}</Chip>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{
                            margin: 0, fontSize: 14, fontWeight: 600,
                            color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)',
                          }}>
                            {rule.name}
                          </p>
                          {rule.description && (
                            <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
                              {rule.description}
                            </p>
                          )}
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--fg-muted)' }}>
                          <input
                            type="checkbox"
                            checked={rule.active}
                            onChange={() => toggleRule.mutate({ id: rule.id, active: !rule.active })}
                            style={{ accentColor: 'var(--cmg-teal)', cursor: 'pointer' }}
                          />
                          Activa
                        </label>
                        <Link
                          to={`/rules/${rule.id}`}
                          style={{
                            padding: '4px 12px', fontSize: 12, color: 'var(--fg-tertiary)',
                            border: '1px solid var(--border)', borderRadius: 6,
                            textDecoration: 'none', fontFamily: 'var(--font-sans)',
                          }}
                        >
                          Editar
                        </Link>
                        <button
                          onClick={async () => {
                            const ok = await confirm({
                              title: 'Eliminar regla',
                              message: `¿Eliminar "${rule.name}"? Las alertas activas de esta regla se cerrarán.`,
                              confirmLabel: 'Eliminar',
                              kind: 'danger',
                            })
                            if (ok) deleteRule.mutate(rule.id)
                          }}
                          style={{
                            padding: '4px 12px', fontSize: 12, color: 'var(--danger)',
                            border: '1px solid var(--danger)', borderRadius: 6,
                            background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                          }}
                        >
                          Eliminar
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </Shell>
  )
}
