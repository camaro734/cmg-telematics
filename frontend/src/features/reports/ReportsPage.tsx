import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import Shell from '../../shared/ui/Shell'
import FleetDashboard from '../fleet/FleetDashboard'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import { useReportsTabStore } from './useReportsTabStore'
import type {
  TenantOut, VehicleOut, VehicleTypeOut, KpiHour,
  AlertInstanceOut, MaintenancePlanOut, MaintenanceLogOut,
} from '../../lib/types'

type Period = 'dia' | 'semana' | 'mes'

const PERIOD_HOURS: Record<Period, number> = { dia: 24, semana: 168, mes: 720 }
const PERIOD_LABELS: Record<Period, string> = { dia: 'Último día', semana: 'Última semana', mes: 'Último mes' }

// ── Style constants ──────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--bg-border)',
  borderRadius: 8,
  padding: '14px 16px',
}

const thStyle: React.CSSProperties = {
  padding: '6px 8px', fontSize: 11, fontWeight: 600, textAlign: 'left',
  borderBottom: '1px solid var(--bg-border)', color: 'var(--text-muted)',
}

const tdStyle: React.CSSProperties = {
  padding: '6px 8px', fontSize: 12,
  color: 'var(--text-default)', borderBottom: '1px solid var(--bg-border)',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtHours(min: number) {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${h}h ${String(m).padStart(2, '0')}m`
}

function groupByPeriod(
  kpis: KpiHour[],
  period: Period,
  metricKey: string,
  transform: number,
): { label: string; value: number }[] {
  if (period === 'dia') {
    return kpis.map(h => ({
      label: new Date(h.bucket).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
      value: Math.round(((h[metricKey as keyof KpiHour] as number) ?? 0) * transform * 100) / 100,
    }))
  }
  // Group by day for semana / mes
  const byDay = new Map<string, number>()
  for (const h of kpis) {
    const day = h.bucket.slice(0, 10)
    const v = (h[metricKey as keyof KpiHour] as number) ?? 0
    byDay.set(day, (byDay.get(day) ?? 0) + v)
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, total]) => ({
      label: day.slice(5).replace('-', '/'),
      value: Math.round(total * transform * 100) / 100,
    }))
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SelectorBar({
  isCmg, tenants, tenantId, setTenantId,
  vehicles, vehicleId, setVehicleId,
}: {
  isCmg: boolean
  tenants: TenantOut[]
  tenantId: string
  setTenantId: (v: string) => void
  vehicles: VehicleOut[]
  vehicleId: string
  setVehicleId: (v: string) => void
}) {
  const selStyle: React.CSSProperties = {
    fontSize: 12, background: 'var(--bg-elevated)',
    border: '1px solid var(--bg-border)', borderRadius: 5, padding: '5px 8px',
  }
  return (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--bg-border)', flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {isCmg && (
          <select
            value={tenantId}
            onChange={e => { setTenantId(e.target.value); setVehicleId('') }}
            style={{ ...selStyle, color: 'var(--text-muted)' }}
          >
            <option value="">— Cliente —</option>
            {tenants.filter(t => t.tier !== 'cmg').map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
        <select
          value={vehicleId}
          onChange={e => setVehicleId(e.target.value)}
          style={{ ...selStyle, color: vehicleId ? 'var(--text-default)' : 'var(--text-muted)', minWidth: 180 }}
        >
          <option value="">— Selecciona un vehículo —</option>
          {vehicles.map(v => (
            <option key={v.id} value={v.id}>{v.name}{v.license_plate ? ` (${v.license_plate})` : ''}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

function PeriodFilterBar({ period, setPeriod }: { period: Period; setPeriod: (p: Period) => void }) {
  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 14px', fontSize: 12, fontWeight: 600,
    fontFamily: 'var(--font-ui)', border: '1px solid var(--bg-border)',
    borderRadius: 20, cursor: 'pointer',
    background: active ? 'var(--accent-energy)' : 'transparent',
    color: active ? '#fff' : 'var(--text-muted)',
    transition: 'background 0.15s',
  })
  return (
    <div style={{
      padding: '8px 16px', borderBottom: '1px solid var(--bg-border)',
      display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
    }}>
      {(['dia', 'semana', 'mes'] as Period[]).map(p => (
        <button key={p} style={btnStyle(period === p)} onClick={() => setPeriod(p)}>
          {p === 'dia' ? 'Día' : p === 'semana' ? 'Semana' : 'Mes'}
        </button>
      ))}
    </div>
  )
}

// ── HISTÓRICO tab ─────────────────────────────────────────────────────────────

function HistoricoTab({
  vehicleId, vehicleTypeId, vehicleTypes, period,
}: {
  vehicleId: string
  vehicleTypeId: string
  vehicleTypes: VehicleTypeOut[]
  period: Period
}) {
  const hours = PERIOD_HOURS[period]

  const { data: kpis = [] } = useQuery<KpiHour[]>({
    queryKey: [...keys.vehicleKpis(vehicleId), hours],
    queryFn: () => apiClient.get<KpiHour[]>(`/api/v1/vehicles/${vehicleId}/kpis?hours=${hours}`),
    enabled: Boolean(vehicleId),
    staleTime: 60_000,
  })

  const vehicleType = vehicleTypes.find(vt => vt.id === vehicleTypeId)
  const metrics = vehicleType?.historic_metrics ?? []

  if (!vehicleId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--text-muted)', fontSize: 13 }}>
        Selecciona un vehículo para ver el histórico
      </div>
    )
  }

  if (metrics.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--text-muted)', fontSize: 13, flexDirection: 'column', gap: 6 }}>
        <span>Sin métricas configuradas</span>
        <span style={{ fontSize: 11, opacity: 0.7 }}>Ve a Tipos de vehículo para añadir métricas históricas</span>
      </div>
    )
  }

  // KPI summary
  const totalEngMin = kpis.reduce((s, h) => s + (h.engine_on_minutes ?? 0), 0)
  const totalPtoMin = kpis.reduce((s, h) => s + (h.pto_active_minutes ?? 0), 0)
  const diasTrabajados = period === 'dia'
    ? (kpis.some(h => (h.engine_on_minutes ?? 0) > 0) ? 1 : 0)
    : new Set(kpis.filter(h => (h.engine_on_minutes ?? 0) > 0).map(h => h.bucket.slice(0, 10))).size
  const ptoPct = totalEngMin > 0 ? Math.round((totalPtoMin / totalEngMin) * 100) : null

  const kpiCards: { label: string; value: string }[] = [
    { label: 'Días trabajados', value: String(diasTrabajados) },
    { label: 'Total horas motor', value: totalEngMin > 0 ? fmtHours(totalEngMin) : '—' },
    { label: '% PTO / Motor', value: ptoPct != null ? `${ptoPct}%` : '—' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* KPI summary row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {kpiCards.map(k => (
          <div key={k.label} style={{ ...card, minWidth: 140, flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-default)', fontFamily: 'var(--font-data)' }}>
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {/* One chart per configured metric */}
      {metrics.map(metric => {
        const data = groupByPeriod(kpis, period, metric.key, metric.transform)
        return (
          <div key={metric.key} style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-default)', marginBottom: 10 }}>
              {metric.label}{metric.unit ? ` (${metric.unit})` : ''} — {PERIOD_LABELS[period]}
            </div>
            {data.length === 0 ? (
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                Sin datos para este período
              </div>
            ) : (
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(87,83,78,0.4)" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#78716C' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#78716C' }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', borderRadius: 6, fontSize: 12 }}
                      formatter={(v: number) => [`${v}${metric.unit ? ' ' + metric.unit : ''}`, metric.label]}
                    />
                    <Bar dataKey="value" fill={metric.color} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── MANTENIMIENTO tab ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: MaintenancePlanOut['progress']['status'] }) {
  const colors: Record<string, string> = {
    ok: 'var(--accent-ok)',
    próximo: 'var(--accent-warn)',
    vencido: 'var(--accent-crit)',
  }
  const labels: Record<string, string> = {
    ok: 'OK',
    próximo: 'PRÓXIMO',
    vencido: 'VENCIDO',
  }
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
      background: `${colors[status] ?? '#78716C'}22`,
      color: colors[status] ?? '#78716C',
    }}>
      {labels[status] ?? status.toUpperCase()}
    </span>
  )
}

function MantenimientoTab({ vehicleId }: { vehicleId: string }) {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)

  const { data: plans = [] } = useQuery<MaintenancePlanOut[]>({
    queryKey: keys.vehicleMaintenance(vehicleId),
    queryFn: () => apiClient.get<MaintenancePlanOut[]>(`/api/v1/maintenance/plans?vehicle_id=${vehicleId}`),
    enabled: Boolean(vehicleId),
    staleTime: 60_000,
  })

  const selectedPlan = plans.find(p => p.id === selectedPlanId) ?? null

  const { data: allLogs = [] } = useQuery<MaintenanceLogOut[]>({
    queryKey: keys.maintenanceLogs(selectedPlanId ?? ''),
    queryFn: () => apiClient.get<MaintenanceLogOut[]>(`/api/v1/maintenance/plans/${selectedPlanId}/logs`),
    enabled: Boolean(selectedPlanId),
    staleTime: 60_000,
  })

  if (!vehicleId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--text-muted)', fontSize: 13 }}>
        Selecciona un vehículo para ver los planes de mantenimiento
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 12, height: '100%' }}>

      {/* Left: plan list */}
      <div style={{ ...card, width: 200, flexShrink: 0, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--bg-border)', fontSize: 12, fontWeight: 600, color: 'var(--text-default)' }}>
          Planes de mantenimiento
        </div>
        {plans.length === 0 ? (
          <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>Sin planes</div>
        ) : (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {plans.map(p => (
              <div
                key={p.id}
                onClick={() => setSelectedPlanId(p.id === selectedPlanId ? null : p.id)}
                style={{
                  padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--bg-border)',
                  background: p.id === selectedPlanId ? 'var(--bg-elevated)' : 'transparent',
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--text-default)', fontWeight: p.id === selectedPlanId ? 600 : 400 }}>
                  {p.name}
                </span>
                <StatusBadge status={p.progress.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Center: intervention logs */}
      <div style={{ ...card, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!selectedPlan ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 150, color: 'var(--text-muted)', fontSize: 13 }}>
            Selecciona un plan
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-default)' }}>
              {selectedPlan.name} — Historial de intervenciones
            </div>
            {allLogs.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '16px 0' }}>Sin intervenciones registradas</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Fecha</th>
                    <th style={thStyle}>Notas</th>
                    <th style={thStyle}>Documento</th>
                  </tr>
                </thead>
                <tbody>
                  {allLogs.map(log => (
                    <tr key={log.id}>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-data)', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {new Date(log.performed_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                      </td>
                      <td style={tdStyle}>{log.description ?? '—'}</td>
                      <td style={tdStyle}>
                        {log.document_url
                          ? <a href={log.document_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-info)', fontSize: 11 }}>Ver</a>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {/* Right: KPI cards */}
      <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!selectedPlan ? null : (
          <>
            <div style={card}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Estado</div>
              <StatusBadge status={selectedPlan.progress.status} />
            </div>
            {selectedPlan.progress.thresholds.map((t, i) => {
              const pct = Math.min(100, Math.round(t.pct))
              const barColor = t.pct >= 100
                ? 'var(--accent-crit)'
                : t.pct >= (100 - selectedPlan.warn_before_pct)
                  ? 'var(--accent-warn)'
                  : 'var(--accent-ok)'
              const typeLabel: Record<string, string> = {
                pto_hours: 'Horas PTO',
                engine_hours: 'Horas motor',
                calendar_days: 'Días calendario',
              }
              return (
                <div key={i} style={card}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                    {typeLabel[t.type] ?? t.type}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-default)', fontFamily: 'var(--font-data)', marginBottom: 6 }}>
                    {Math.round(t.current)} / {t.limit}
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 0.3s' }} />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{pct}%</div>
                </div>
              )
            })}
          </>
        )}
      </div>

    </div>
  )
}

// ── RUTAS tab ────────────────────────────────────────────────────────────────

function RutasTab() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--text-muted)', fontSize: 13, flexDirection: 'column', gap: 8 }}>
      <svg width={40} height={40} viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 32 Q14 20 20 24 Q26 28 32 8"/>
        <circle cx="8" cy="32" r="2.5" fill="currentColor" stroke="none"/>
        <circle cx="32" cy="8" r="2.5" fill="currentColor" stroke="none"/>
      </svg>
      <span>Módulo de rutas — próximamente</span>
      <span style={{ fontSize: 11, opacity: 0.6 }}>Visualización de recorridos GPS diarios</span>
    </div>
  )
}

// ── ALERTAS tab ──────────────────────────────────────────────────────────────

function AlertasTab({ vehicleId }: { vehicleId: string }) {
  const { data: alerts = [] } = useQuery<AlertInstanceOut[]>({
    queryKey: [...keys.alerts(), 'reports', vehicleId],
    queryFn: () => apiClient.get<AlertInstanceOut[]>(`/api/v1/alerts?vehicle_id=${vehicleId}&limit=200`),
    enabled: Boolean(vehicleId),
    staleTime: 60_000,
  })

  if (!vehicleId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--text-muted)', fontSize: 13 }}>
        Selecciona un vehículo para ver las alertas
      </div>
    )
  }

  const rows = alerts
    .filter(a => a.vehicle_id === vehicleId)
    .sort((a, b) => (b.triggered_at > a.triggered_at ? 1 : -1))

  const severityBadge = (ruleId: string) => (
    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>
      {ruleId.slice(0, 8)}
    </span>
  )

  const statusColors: Record<string, string> = {
    firing: 'var(--accent-crit)',
    escalated: 'var(--accent-crit)',
    acknowledged: 'var(--accent-warn)',
    resolved: 'var(--accent-ok)',
  }
  const statusLabels: Record<string, string> = {
    firing: 'Activa',
    escalated: 'Escalada',
    acknowledged: 'Reconocida',
    resolved: 'Resuelta',
  }

  const fmtTriggerValue = (v: Record<string, unknown> | null): string => {
    if (!v) return '—'
    const str = JSON.stringify(v)
    return str.length > 20 ? str.slice(0, 20) + '…' : str
  }

  return (
    <div style={card}>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '16px 0', textAlign: 'center' }}>
          Sin alertas registradas para este vehículo
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Fecha</th>
              <th style={thStyle}>Regla</th>
              <th style={thStyle}>Estado</th>
              <th style={thStyle}>Valor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(a => (
              <tr key={a.id}>
                <td style={{ ...tdStyle, fontFamily: 'var(--font-data)', fontSize: 11, whiteSpace: 'nowrap' }}>
                  {new Date(a.triggered_at).toLocaleString('es-ES', {
                    day: '2-digit', month: '2-digit', year: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </td>
                <td style={tdStyle}>{severityBadge(a.rule_id)}</td>
                <td style={tdStyle}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: `${statusColors[a.status] ?? '#78716C'}22`,
                    color: statusColors[a.status] ?? 'var(--text-muted)',
                  }}>
                    {statusLabels[a.status] ?? a.status.toUpperCase()}
                  </span>
                </td>
                <td style={{ ...tdStyle, fontFamily: 'var(--font-data)', fontSize: 11 }}>
                  {fmtTriggerValue(a.trigger_value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function ReportsPage() {
  const user = useAuthStore(s => s.user)
  const isCmg = user?.tenant_tier === 'cmg'

  const { tab } = useReportsTabStore()
  const [period, setPeriod] = useState<Period>('semana')
  const [vehicleId, setVehicleId] = useState('')
  const [tenantId, setTenantId] = useState('')

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: tenants = [] } = useQuery<TenantOut[]>({
    queryKey: keys.tenants(),
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants'),
    enabled: isCmg,
    staleTime: 60_000,
  })

  const effectiveTenantId = isCmg ? tenantId : (user?.tenant_id ?? '')

  const { data: vehicles = [] } = useQuery<VehicleOut[]>({
    queryKey: isCmg ? keys.vehiclesByTenant(effectiveTenantId) : keys.vehicles(),
    queryFn: () => isCmg
      ? apiClient.get<VehicleOut[]>(`/api/v1/vehicles?tenant_id=${effectiveTenantId}`)
      : apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    enabled: !isCmg || Boolean(effectiveTenantId),
    staleTime: 60_000,
  })

  const { data: vehicleTypes = [] } = useQuery<VehicleTypeOut[]>({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: 300_000,
  })

  const selectedVehicle = vehicles.find(v => v.id === vehicleId)

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Shell title="Reportes">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

        {/* Vehicle selector — only shown when not on HOME */}
        {tab !== 'home' && (
          <SelectorBar
            isCmg={isCmg}
            tenants={tenants}
            tenantId={tenantId}
            setTenantId={setTenantId}
            vehicles={vehicles}
            vehicleId={vehicleId}
            setVehicleId={setVehicleId}
          />
        )}

        {/* Period filter — only on histórico */}
        {tab === 'historico' && (
          <PeriodFilterBar period={period} setPeriod={setPeriod} />
        )}

        {/* HOME: full-height fleet dashboard, no padding */}
        {tab === 'home' && (
          <div style={{ flex: 1, minHeight: 0 }}>
            <FleetDashboard />
          </div>
        )}

        {/* Other tabs: scrollable padded area */}
        {tab !== 'home' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>

            {tab === 'historico' && (
              <HistoricoTab
                vehicleId={vehicleId}
                vehicleTypeId={selectedVehicle?.vehicle_type_id ?? ''}
                vehicleTypes={vehicleTypes}
                period={period}
              />
            )}

            {tab === 'mantenimiento' && (
              <MantenimientoTab vehicleId={vehicleId} />
            )}

            {tab === 'rutas' && (
              <RutasTab />
            )}

            {tab === 'alertas' && (
              <AlertasTab vehicleId={vehicleId} />
            )}

          </div>
        )}
      </div>
    </Shell>
  )
}
