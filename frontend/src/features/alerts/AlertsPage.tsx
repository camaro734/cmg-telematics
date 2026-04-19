import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import ActiveAlertsList from './ActiveAlertsList'
import AlertHistory from './AlertHistory'
import type { AlertInstanceOut, VehicleOut, RuleOut } from '../../lib/types'

const SECTION_LABEL: CSSProperties = {
  fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-ui)',
  color: 'var(--text-muted)', letterSpacing: '0.06em',
  marginBottom: 12,
}

export default function AlertsPage() {
  const { data: vehicles = [] } = useQuery({
    queryKey: keys.vehicles(),
    queryFn: () => apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    staleTime: Infinity,
  })

  const { data: rules = [] } = useQuery({
    queryKey: keys.rules(),
    queryFn: () => apiClient.get<RuleOut[]>('/api/v1/rules'),
    staleTime: Infinity,
  })

  const { data: firing = [] } = useQuery({
    queryKey: [...keys.alerts(), 'firing'],
    queryFn: () => apiClient.get<AlertInstanceOut[]>('/api/v1/alerts?status=firing'),
    refetchInterval: 30_000,
  })

  const { data: escalated = [] } = useQuery({
    queryKey: [...keys.alerts(), 'escalated'],
    queryFn: () => apiClient.get<AlertInstanceOut[]>('/api/v1/alerts?status=escalated'),
    refetchInterval: 30_000,
  })

  const activeAlerts = [...firing, ...escalated].sort(
    (a, b) => b.triggered_at.localeCompare(a.triggered_at),
  )

  return (
    <Shell title="Alertas">
      <div style={{ padding: 24, maxWidth: 1200, overflowY: 'auto', height: '100%' }}>
        <div style={SECTION_LABEL}>ALERTAS ACTIVAS</div>
        <ActiveAlertsList alerts={activeAlerts} vehicles={vehicles} rules={rules} />

        <div style={{ ...SECTION_LABEL, marginTop: 32 }}>HISTORIAL</div>
        <AlertHistory vehicles={vehicles} rules={rules} />
      </div>
    </Shell>
  )
}
