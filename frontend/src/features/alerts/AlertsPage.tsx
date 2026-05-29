import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { Chip } from '../../shared/ui/Chip'
import ActiveAlertsList from './ActiveAlertsList'
import AlertHistory from './AlertHistory'
import type { AlertInstanceOut, VehicleOut, RuleOut } from '../../lib/types'
import { useAuthStore } from '../auth/useAuthStore'
import { useTenantContext } from '../../lib/useTenantContext'
import { useConfirm } from '../../shared/ui/ConfirmDialog'

const SEVERITY: Record<string, { label: string; color: string }> = {
  info:     { label: 'INFO',    color: 'var(--info)' },
  warning:  { label: 'AVISO',   color: 'var(--warn)' },
  critical: { label: 'CRÍTICA', color: 'var(--danger)' },
}

export default function AlertsPage() {
  const user = useAuthStore(s => s.user)
  const canManageRules = user?.role === 'admin' && user?.tenant_tier !== 'subclient'
  const { activeTenantId } = useTenantContext()
  const tenantQ = activeTenantId ? `&tenant_id=${activeTenantId}` : ''
  const qc = useQueryClient()
  const confirm = useConfirm()

  const tabs = ['activas', 'historial', ...(canManageRules ? ['reglas'] : [])] as const
  type Tab = typeof tabs[number]
  const [tab, setTab] = useState<Tab>('activas')

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
    queryKey: [...keys.alerts(), 'firing', activeTenantId],
    queryFn: () => apiClient.get<AlertInstanceOut[]>(`/api/v1/alerts?status=firing${tenantQ}`),
    refetchInterval: 30_000,
  })

  const { data: escalated = [] } = useQuery({
    queryKey: [...keys.alerts(), 'escalated', activeTenantId],
    queryFn: () => apiClient.get<AlertInstanceOut[]>(`/api/v1/alerts?status=escalated${tenantQ}`),
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

  const tabLabel: Record<string, string> = { activas: 'Activas', historial: 'Historial', reglas: 'Reglas' }

  return (
    <Shell title="Alertas">
      <div style={{ padding: 24, maxWidth: 1200, overflowY: 'auto', height: '100%' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)' }}>
              Alertas
            </span>
            {activeAlerts.length > 0 && (
              <Chip color="var(--danger)" soft dot size="sm">
                {activeAlerts.length} activa{activeAlerts.length !== 1 ? 's' : ''}
              </Chip>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {tab === 'activas' && (
              <button
                onClick={handleExportCsv}
                style={{
                  padding: '6px 12px', background: 'var(--bg-card)', color: 'var(--fg-secondary)',
                  border: '1px solid var(--border)', borderRadius: 6, fontSize: 12,
                  cursor: 'pointer', fontFamily: 'var(--font-sans)',
                }}
              >
                Exportar CSV
              </button>
            )}
            {canManageRules && (
              <Link
                to="/rules/new"
                style={{
                  padding: '6px 16px', background: 'var(--cmg-teal)', color: '#fff',
                  borderRadius: 6, fontSize: 13, fontWeight: 600,
                  textDecoration: 'none', fontFamily: 'var(--font-sans)',
                }}
              >
                + Nueva regla
              </Link>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
          {tabs.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '8px 20px', background: 'transparent', border: 'none',
                borderBottom: tab === t ? '2px solid var(--cmg-teal)' : '2px solid transparent',
                color: tab === t ? 'var(--cmg-teal)' : 'var(--fg-muted)',
                fontSize: 13, fontWeight: tab === t ? 600 : 400,
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
            >
              {tabLabel[t]}
              {t === 'activas' && activeAlerts.length > 0 && (
                <span style={{
                  marginLeft: 6, background: 'var(--danger)', color: '#fff',
                  borderRadius: 9999, fontSize: 10, fontWeight: 700,
                  padding: '1px 6px',
                }}>
                  {activeAlerts.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab: Activas */}
        {tab === 'activas' && (
          <ActiveAlertsList alerts={activeAlerts} vehicles={vehicles} rules={rules} />
        )}

        {/* Tab: Historial */}
        {tab === 'historial' && (
          <AlertHistory vehicles={vehicles} rules={rules} />
        )}

        {/* Tab: Reglas */}
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
    </Shell>
  )
}
