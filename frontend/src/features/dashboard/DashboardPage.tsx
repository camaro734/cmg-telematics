import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useTenantContext } from '../../lib/useTenantContext'
import { useVehicleStatuses } from '../fleet/useVehicleStatuses'
import type { VehicleOut, AlertInstanceOut, WorkOrderOut, MaintenancePlanOut, RuleOut } from '../../lib/types'

interface FleetKpis {
  range: string
  engine_hours: number
  pto_hours: number
  active_vehicles: number
  by_day: { date: string; engine_hours: number; pto_hours: number }[]
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

type Accent = 'ok' | 'warn' | 'crit' | 'info' | 'neutral'

const ACCENT_COLOR: Record<Accent, string> = {
  ok:      'var(--ok)',
  warn:    'var(--warn)',
  crit:    'var(--danger)',
  info:    'var(--info)',
  neutral: 'var(--fg-primary)',
}

function KpiCard({ label, value, sub, accent = 'neutral', onClick }: {
  label: string; value: string | number; sub?: string; accent?: Accent; onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '20px 24px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.borderColor = 'var(--cmg-teal)' }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.borderColor = 'var(--border)' }}
    >
      <div style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 14 }}>
        {label}
      </div>
      <div style={{ fontSize: 36, fontWeight: 700, color: ACCENT_COLOR[accent], fontFamily: 'var(--font-mono)', lineHeight: 1, marginBottom: 10 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)' }}>{sub}</div>
      )}
    </div>
  )
}

// ── Section card ──────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
      <div style={{
        fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)',
        letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 14,
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

// ── Row divider ───────────────────────────────────────────────────────────────

const ROW_STYLE: React.CSSProperties = {
  padding: '10px 0',
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
}

// ── Severity badge ────────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  critical: 'var(--danger)',
  warning:  'var(--warn)',
  info:     'var(--info)',
}

function SeverityBadge({ severity }: { severity: string }) {
  const c = SEV_COLOR[severity] ?? 'var(--offline)'
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 10,
      background: `color-mix(in srgb, ${c} 18%, transparent)`,
      color: c, fontFamily: 'var(--font-sans)', fontWeight: 600, textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {severity}
    </span>
  )
}

// ── Order status chip ─────────────────────────────────────────────────────────

const ORDER_COLOR: Record<string, string> = {
  pending:     'var(--info)',
  in_progress: 'var(--cmg-teal)',
  done:        'var(--ok)',
  cancelled:   'var(--offline)',
}
const ORDER_LABEL: Record<string, string> = {
  pending: 'Pendiente', in_progress: 'En curso', done: 'Completada', cancelled: 'Cancelada',
}

function StatusChip({ status }: { status: string }) {
  const c = ORDER_COLOR[status] ?? 'var(--offline)'
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 10,
      background: `color-mix(in srgb, ${c} 18%, transparent)`,
      color: c, fontFamily: 'var(--font-sans)', fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {ORDER_LABEL[status] ?? status}
    </span>
  )
}

// ── Relative time ─────────────────────────────────────────────────────────────

function relTime(iso: string | null): string {
  if (!iso) return '—'
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'ahora'
  if (m < 60) return `hace ${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h}h`
  return `hace ${Math.floor(h / 24)}d`
}

// ── Empty state ───────────────────────────────────────────────────────────────

function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: '20px 0', color: 'var(--fg-muted)', fontSize: 13, textAlign: 'center' }}>{msg}</div>
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate()
  const { activeTenantId, activeTenantName } = useTenantContext()
  const tQ  = activeTenantId ? `?tenant_id=${activeTenantId}` : ''
  const tAmp = activeTenantId ? `&tenant_id=${activeTenantId}` : ''

  const { data: vehicles = [] } = useQuery({
    queryKey: [...keys.vehicles(), activeTenantId, 'dashboard'],
    queryFn: () => apiClient.get<VehicleOut[]>(`/api/v1/vehicles${tQ}`),
    staleTime: 60_000,
  })

  const statuses = useVehicleStatuses(vehicles)
  const onlineCount = [...statuses.values()].filter(s => s.online).length

  const { data: rules = [] } = useQuery({
    queryKey: keys.rules(),
    queryFn: () => apiClient.get<RuleOut[]>('/api/v1/rules'),
    staleTime: 5 * 60_000,
  })
  const ruleById = new Map(rules.map(r => [r.id, r]))

  const { data: alerts = [] } = useQuery({
    queryKey: ['dashboard-alerts', activeTenantId],
    queryFn: () => apiClient.get<AlertInstanceOut[]>(`/api/v1/alerts?limit=50${tAmp}`),
    refetchInterval: 30_000,
  })
  const activeAlerts = alerts.filter(a => a.status === 'firing' || a.status === 'escalated')
  const escalatedCount = activeAlerts.filter(a => a.status === 'escalated').length

  const { data: orders = [] } = useQuery({
    queryKey: ['dashboard-orders', activeTenantId],
    queryFn: () => apiClient.get<WorkOrderOut[]>(`/api/v1/work-orders?limit=50${tAmp}`),
    refetchInterval: 60_000,
  })
  const pendingOrders    = orders.filter(o => o.status === 'pending')
  const inProgressOrders = orders.filter(o => o.status === 'in_progress')

  const { data: plans = [] } = useQuery({
    queryKey: [...keys.maintenancePlans(), activeTenantId, 'dashboard'],
    queryFn: () => apiClient.get<MaintenancePlanOut[]>(`/api/v1/maintenance/plans${tQ}`),
    staleTime: 5 * 60_000,
  })
  const maxPct = (p: MaintenancePlanOut) => Math.max(...p.progress.thresholds.map(t => t.pct), 0)
  const urgentPlans = plans
    .filter(p => p.active && p.progress.status !== 'ok')
    .sort((a, b) => maxPct(b) - maxPct(a))
  const overdueCount = urgentPlans.filter(p => p.progress.status === 'vencido').length

  // KPIs reales de telemetría — últimos 7 días
  const { data: fleetKpis } = useQuery<FleetKpis>({
    queryKey: ['fleet-kpis', '7d', activeTenantId],
    queryFn: () => apiClient.get<FleetKpis>(`/api/v1/fleet/kpis?range=7d${tAmp}`),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  })

  const alertAccent: Accent  = escalatedCount > 0 ? 'crit' : activeAlerts.length > 0 ? 'warn' : 'ok'
  const maintAccent: Accent  = overdueCount > 0 ? 'crit' : urgentPlans.length > 0 ? 'warn' : 'ok'
  const fleetAccent: Accent  = vehicles.length === 0 ? 'neutral'
    : onlineCount === vehicles.length ? 'ok' : onlineCount > 0 ? 'warn' : 'crit'

  const titleSuffix = activeTenantName ? ` — ${activeTenantName}` : ''

  return (
    <Shell title={`Dashboard${titleSuffix}`}>
      <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>

        {/* ── KPI row ──────────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          <KpiCard
            label="Vehículos en línea"
            value={vehicles.length === 0 ? '—' : `${onlineCount} / ${vehicles.length}`}
            sub={vehicles.length === 0 ? 'Sin vehículos' : `${vehicles.length - onlineCount} sin señal`}
            accent={fleetAccent}
            onClick={() => navigate('/fleet')}
          />
          <KpiCard
            label="Alertas activas"
            value={activeAlerts.length}
            sub={escalatedCount > 0 ? `${escalatedCount} escalada${escalatedCount !== 1 ? 's' : ''}` : activeAlerts.length === 0 ? 'Todo OK' : 'firing'}
            accent={alertAccent}
            onClick={() => navigate('/alerts')}
          />
          <KpiCard
            label="Órdenes en curso"
            value={inProgressOrders.length}
            sub={`${pendingOrders.length} pendiente${pendingOrders.length !== 1 ? 's' : ''}`}
            accent={inProgressOrders.length > 0 ? 'info' : 'neutral'}
            onClick={() => navigate('/work-orders')}
          />
          <KpiCard
            label="Mantenimiento"
            value={urgentPlans.length}
            sub={overdueCount > 0
              ? `${overdueCount} vencido${overdueCount !== 1 ? 's' : ''}`
              : urgentPlans.length === 0 ? 'Todo al día' : `${urgentPlans.length} próximo${urgentPlans.length !== 1 ? 's' : ''}`}
            accent={maintAccent}
            onClick={() => navigate('/maintenance')}
          />
        </div>

        {/* ── KPIs de telemetría (últimos 7 días) ──────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
          <KpiCard
            label="Horas motor · 7 días"
            value={fleetKpis ? fleetKpis.engine_hours.toLocaleString('es-ES') : '—'}
            sub={fleetKpis ? `${fleetKpis.active_vehicles} vehículo${fleetKpis.active_vehicles !== 1 ? 's' : ''} activo${fleetKpis.active_vehicles !== 1 ? 's' : ''}` : ''}
            accent="info"
          />
          <KpiCard
            label="Horas PTO · 7 días"
            value={fleetKpis ? fleetKpis.pto_hours.toLocaleString('es-ES') : '—'}
            sub={fleetKpis && fleetKpis.engine_hours > 0
              ? `${Math.round((fleetKpis.pto_hours / fleetKpis.engine_hours) * 100)}% de uso PTO`
              : 'Toma de fuerza'}
            accent="ok"
          />
          <KpiCard
            label="Utilización media"
            value={fleetKpis && fleetKpis.active_vehicles > 0
              ? `${(fleetKpis.engine_hours / fleetKpis.active_vehicles / 7).toFixed(1)} h/día`
              : '—'}
            sub="por vehículo activo"
            accent="neutral"
          />
        </div>

        {/* ── Gráfica de utilización diaria ────────────────────────────────── */}
        {fleetKpis && fleetKpis.by_day.length > 0 && (
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: 20, marginBottom: 24,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)',
              letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 14,
            }}>Utilización diaria (últimos 7 días)</div>
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fleetKpis.by_day} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={d => {
                      const date = new Date(d)
                      return `${date.getDate()}/${date.getMonth() + 1}`
                    }}
                    stroke="var(--fg-muted)"
                    fontSize={11}
                  />
                  <YAxis stroke="var(--fg-muted)" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => `${v} h`}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="engine_hours" name="Motor" fill="var(--energy-orange)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="pto_hours" name="PTO" fill="var(--ok)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ── Content grid ─────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>

          {/* Alertas activas */}
          <SectionCard title={`Alertas activas (${activeAlerts.length})`}>
            {activeAlerts.length === 0
              ? <Empty msg="Sin alertas activas"/>
              : activeAlerts.slice(0, 7).map(a => {
                  const rule = ruleById.get(a.rule_id)
                  const veh = vehicles.find(v => v.id === a.vehicle_id)
                  return (
                    <div key={a.id} style={ROW_STYLE}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, color: 'var(--fg-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {rule?.name ?? 'Alerta'}
                        </span>
                        <SeverityBadge severity={rule?.severity ?? 'warning'}/>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{veh?.name ?? a.vehicle_id.slice(0, 8)}</span>
                        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{relTime(a.triggered_at)}</span>
                      </div>
                    </div>
                  )
                })
            }
          </SectionCard>

          {/* Órdenes activas */}
          <SectionCard title={`Órdenes activas (${inProgressOrders.length + pendingOrders.length})`}>
            {inProgressOrders.length + pendingOrders.length === 0
              ? <Empty msg="Sin órdenes activas"/>
              : [...inProgressOrders, ...pendingOrders].slice(0, 7).map(o => (
                  <div key={o.id} style={ROW_STYLE}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, color: 'var(--fg-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {o.title}
                      </span>
                      <StatusChip status={o.status}/>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{o.vehicle_name ?? '—'}</span>
                      <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{o.driver_name ?? '—'}</span>
                    </div>
                  </div>
                ))
            }
          </SectionCard>

          {/* Mantenimientos urgentes */}
          <SectionCard title={`Mantenimiento pendiente (${urgentPlans.length})`}>
            {urgentPlans.length === 0
              ? <Empty msg="Todo al día"/>
              : urgentPlans.slice(0, 7).map(p => {
                  const pct = maxPct(p)
                  const overdue = p.progress.status === 'vencido'
                  const barColor = overdue ? 'var(--danger)' : 'var(--warn)'
                  return (
                    <div key={p.id} style={ROW_STYLE}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, color: 'var(--fg-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.name}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: barColor, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                          {Math.round(pct)}%
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{p.vehicle_name}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                          background: `color-mix(in srgb, ${barColor} 15%, transparent)`,
                          color: barColor,
                        }}>
                          {overdue ? 'VENCIDO' : 'PRÓXIMO'}
                        </span>
                      </div>
                      <div style={{ height: 3, background: 'var(--bg-card)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: barColor, borderRadius: 2 }}/>
                      </div>
                    </div>
                  )
                })
            }
          </SectionCard>

        </div>
      </div>
    </Shell>
  )
}
