import { useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
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
import RulesTab from '../rules/RulesTab'
import type { HistoryStatus } from './AlertHistory'
import type { AlertInstanceOut, VehicleOut, RuleOut } from '../../lib/types'
import { useAuthStore } from '../auth/useAuthStore'
import { useTenantContext } from '../../lib/useTenantContext'

type AlertTab = 'activas' | 'historial' | 'reglas'

export default function AlertsPage() {
  const user = useAuthStore(s => s.user)
  const canManageRules = user?.role === 'admin' && user?.tenant_tier !== 'subclient'
  const { activeTenantId } = useTenantContext()
  const tenantQ = activeTenantId ? `&tenant_id=${activeTenantId}` : ''
  const location = useLocation()

  const [tab, setTab] = useState<AlertTab>(() => {
    const fromState = (location.state as { tab?: string } | null)?.tab
    if (fromState === 'reglas' && canManageRules) return 'reglas'
    return 'activas'
  })

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
    reglas: null,
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
          {vehicleParam && tab !== 'reglas' && (
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

          {tab === 'reglas' && canManageRules && <RulesTab />}

        </div>
      </div>
    </Shell>
  )
}
