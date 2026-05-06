import type { CSSProperties } from 'react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import ActiveAlertsList from './ActiveAlertsList'
import AlertHistory from './AlertHistory'
import type { AlertInstanceOut, VehicleOut, RuleOut } from '../../lib/types'
import { useAuthStore } from '../auth/useAuthStore'
import { useTenantContext } from '../../lib/useTenantContext'

const SECTION_LABEL: CSSProperties = {
  fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-ui)',
  color: 'var(--text-muted)', letterSpacing: '0.06em',
  marginBottom: 12,
}

export default function AlertsPage() {
  const [tab, setTab] = useState<'activas' | 'reglas'>('activas')
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const { activeTenantId } = useTenantContext()
  const tenantQ = activeTenantId ? `&tenant_id=${activeTenantId}` : ''

  async function handleExportCsv() {
    const blob = await apiClient.getBlob(`/api/v1/alerts/export.csv${activeTenantId ? `?tenant_id=${activeTenantId}` : ''}`)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'alertas.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const { data: vehicles = [] } = useQuery({
    queryKey: [...keys.vehicles(), activeTenantId],
    queryFn: () => apiClient.get<VehicleOut[]>(`/api/v1/vehicles${activeTenantId ? `?tenant_id=${activeTenantId}` : ''}`),
    staleTime: Infinity,
  })

  const { data: rules = [] } = useQuery({
    queryKey: keys.rules(),
    queryFn: () => apiClient.get<RuleOut[]>('/api/v1/rules'),
    staleTime: Infinity,
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
    (a, b) => (b.triggered_at > a.triggered_at ? 1 : b.triggered_at < a.triggered_at ? -1 : 0),
  )

  return (
    <Shell title="Alertas">
      <div style={{ padding: 24, maxWidth: 1200, overflowY: 'auto', height: '100%' }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--bg-border)', marginBottom: 20 }}>
          {(['activas', 'reglas'] as const)
            .filter(t => t === 'activas' || isAdmin)
            .map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '8px 20px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: tab === t ? '2px solid var(--accent-energy)' : '2px solid transparent',
                  color: tab === t ? 'var(--accent-energy)' : 'var(--text-muted)',
                  fontSize: 13,
                  fontWeight: tab === t ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {t === 'activas' ? 'Activas' : 'Reglas de alerta'}
              </button>
            ))}
        </div>

        {/* Activas tab */}
        {tab === 'activas' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ ...SECTION_LABEL, marginBottom: 0 }}>ALERTAS ACTIVAS</div>
              <button
                onClick={handleExportCsv}
                style={{ padding: '5px 12px', background: 'var(--bg-elevated)', color: 'var(--text-base, #E7E5E4)', border: '1px solid var(--bg-border)', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}
              >
                Exportar CSV
              </button>
            </div>
            <ActiveAlertsList alerts={activeAlerts} vehicles={vehicles} rules={rules} />

            <div style={{ ...SECTION_LABEL, marginTop: 32 }}>HISTORIAL</div>
            <AlertHistory vehicles={vehicles} rules={rules} />
          </>
        )}

        {/* Reglas tab */}
        {tab === 'reglas' && isAdmin && (
          <div style={{ padding: '24px 0', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: 16, fontSize: 14 }}>
              Las reglas de alerta definen cuándo se dispara una notificación.
            </p>
            <a
              href="/rules"
              style={{
                color: 'var(--accent-info)',
                fontSize: 14,
                textDecoration: 'none',
                borderBottom: '1px solid var(--accent-info)',
                paddingBottom: 2,
              }}
            >
              Ir al configurador de reglas →
            </a>
          </div>
        )}
      </div>
    </Shell>
  )
}
