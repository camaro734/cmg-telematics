import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useIsMobile } from '../../lib/useIsMobile'
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import L from 'leaflet'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import { useReportsTabStore } from './useReportsTabStore'
import { exportToCsv } from '../../lib/csvExport'
import type {
  TenantOut, VehicleOut, VehicleTypeOut, KpiHour,
  AlertInstanceOut, MaintenancePlanOut, MaintenanceLogOut,
  TrackPoint, RuleOut,
} from '../../lib/types'

type Period = 'dia' | 'semana' | 'mes'

const PERIOD_HOURS: Record<Period, number> = { dia: 24, semana: 168, mes: 720 }
const PERIOD_LABELS: Record<Period, string> = { dia: 'Último día', semana: 'Última semana', mes: 'Último mes' }

// ── Style constants ───────────────────────────────────────────────────────────

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

const btnSecondary: React.CSSProperties = {
  padding: '5px 12px', fontSize: 12, fontWeight: 600,
  fontFamily: 'var(--font-ui)', border: '1px solid var(--bg-border)',
  borderRadius: 6, cursor: 'pointer',
  background: 'var(--bg-elevated)', color: 'var(--text-default)',
  display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
}

const CHART_COLORS = ['#F97316', '#22C55E', '#38BDF8', '#EAB308', '#A78BFA']

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function buildMultiSeriesData(
  kpis: KpiHour[],
  period: Period,
  metrics: { key: string; label: string; transform: number }[],
): Record<string, string | number>[] {
  if (metrics.length === 0 || kpis.length === 0) return []
  const labelMap = new Map<string, Record<string, number>>()
  for (const metric of metrics) {
    const series = groupByPeriod(kpis, period, metric.key, metric.transform)
    for (const pt of series) {
      if (!labelMap.has(pt.label)) labelMap.set(pt.label, {})
      labelMap.get(pt.label)![metric.key] = pt.value
    }
  }
  return Array.from(labelMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, vals]) => ({ label, ...vals } as Record<string, string | number>))
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (d: number) => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SelectorBar({
  isCmg, tenants, tenantId, setTenantId,
  vehicles, vehicleId, setVehicleId,
  period, setPeriod, pdfSlot,
}: {
  isCmg: boolean
  tenants: TenantOut[]
  tenantId: string
  setTenantId: (v: string) => void
  vehicles: VehicleOut[]
  vehicleId: string
  setVehicleId: (v: string) => void
  period: Period
  setPeriod: (p: Period) => void
  pdfSlot?: React.ReactNode
}) {
  const selStyle: React.CSSProperties = {
    fontSize: 12, background: 'var(--bg-elevated)',
    border: '1px solid var(--bg-border)', borderRadius: 5, padding: '5px 8px',
    color: 'var(--text-default)',
  }
  const periodBtn = (p: Period): React.CSSProperties => ({
    padding: '5px 14px', fontSize: 12, fontWeight: 600,
    fontFamily: 'var(--font-ui)', border: '1px solid var(--bg-border)',
    borderRadius: 20, cursor: 'pointer',
    background: period === p ? 'var(--accent-energy)' : 'transparent',
    color: period === p ? '#fff' : 'var(--text-muted)',
    transition: 'background 0.15s',
  })

  return (
    <div style={{
      padding: '12px 20px',
      borderBottom: '1px solid var(--bg-border)',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
    }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-default)', marginRight: 4, letterSpacing: '-0.01em' }}>
        Reportes
      </div>

      {isCmg && (
        <select
          value={tenantId}
          onChange={e => { setTenantId(e.target.value); setVehicleId('') }}
          style={{ ...selStyle, color: tenantId ? 'var(--text-default)' : 'var(--text-muted)' }}
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

      <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
        {(['dia', 'semana', 'mes'] as Period[]).map(p => (
          <button key={p} style={periodBtn(p)} onClick={() => setPeriod(p)}>
            {p === 'dia' ? 'Día' : p === 'semana' ? 'Semana' : 'Mes'}
          </button>
        ))}
      </div>

      <div style={{ marginLeft: 'auto' }}>{pdfSlot}</div>
    </div>
  )
}

// ── PDF Download button ───────────────────────────────────────────────────────

function PdfDownloadBtn({
  vehicleId, vehicles, isCmg, tenantId,
}: {
  vehicleId: string
  vehicles: VehicleOut[]
  isCmg: boolean
  tenantId: string
}) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i)
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ]

  async function download() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) })
      if (vehicleId) params.append('vehicle_ids', vehicleId)
      if (isCmg && tenantId) params.append('tenant_id', tenantId)
      const blob = await apiClient.getBlob(`/api/v1/reports/monthly?${params}`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `informe-${year}-${String(month).padStart(2, '0')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      setOpen(false)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error al generar el informe')
    } finally {
      setLoading(false)
    }
  }

  const selStyle: React.CSSProperties = {
    fontSize: 12, background: 'var(--bg-elevated)',
    border: '1px solid var(--bg-border)', borderRadius: 5, padding: '4px 8px',
    color: 'var(--text-default)',
  }

  return (
    <div style={{ position: 'relative' }}>
      <button style={{ ...btnSecondary, color: 'var(--accent-energy)', borderColor: 'var(--accent-energy)' }} onClick={() => setOpen(o => !o)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Informe PDF
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '110%', zIndex: 100,
          background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
          borderRadius: 8, padding: 14, minWidth: 240, boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-default)' }}>Selecciona período</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ ...selStyle, flex: 1 }}>
              {months.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            <select value={year} onChange={e => setYear(Number(e.target.value))} style={selStyle}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {vehicleId
              ? `Vehículo: ${vehicles.find(v => v.id === vehicleId)?.name ?? vehicleId}`
              : 'Todos los vehículos del tenant'}
          </div>
          <button
            style={{
              ...btnSecondary, justifyContent: 'center',
              background: 'var(--accent-energy)', color: '#fff',
              border: 'none', opacity: loading ? 0.6 : 1,
            }}
            onClick={download}
            disabled={loading}
          >
            {loading ? 'Generando…' : '⬇ Descargar PDF'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ ...card, flex: 1, minWidth: 130, position: 'relative', overflow: 'hidden' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase' as const }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent ?? 'var(--text-default)', fontFamily: 'var(--font-data)', letterSpacing: '-0.02em' }}>
        {value}
      </div>
      {accent && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: accent, opacity: 0.5, borderRadius: '0 0 8px 8px' }} />
      )}
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
  const isMobile = useIsMobile()
  const hours = PERIOD_HOURS[period]

  const { data: kpis = [] } = useQuery<KpiHour[]>({
    queryKey: [...keys.vehicleKpis(vehicleId), hours],
    queryFn: () => apiClient.get<KpiHour[]>(`/api/v1/vehicles/${vehicleId}/kpis?hours=${hours}`),
    enabled: Boolean(vehicleId),
    staleTime: 60_000,
  })

  const vehicleType = vehicleTypes.find(vt => vt.id === vehicleTypeId)
  const metrics = vehicleType?.historic_metrics ?? []

  // Split metrics by chart_type
  const lineMetrics = metrics.filter(m => !m.chart_type || m.chart_type === 'line')
  const donutMetrics = metrics.filter(m => m.chart_type === 'donut')

  if (!vehicleId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--text-muted)', fontSize: 13 }}>
        Selecciona un vehículo para ver el histórico
      </div>
    )
  }

  const totalEngMin = kpis.reduce((s, h) => s + (h.engine_on_minutes ?? 0), 0)
  const totalPtoMin = kpis.reduce((s, h) => s + (h.pto_active_minutes ?? 0), 0)
  const diasTrabajados = period === 'dia'
    ? (kpis.some(h => (h.engine_on_minutes ?? 0) > 0) ? 1 : 0)
    : new Set(kpis.filter(h => (h.engine_on_minutes ?? 0) > 0).map(h => h.bucket.slice(0, 10))).size
  const ptoPct = totalEngMin > 0 ? Math.round((totalPtoMin / totalEngMin) * 100) : null

  // Donut data — fixed Motor vs PTO
  const pieMotorPto = [
    { name: 'Motor sin PTO', value: Math.max(0, totalEngMin - totalPtoMin) },
    { name: 'PTO activo', value: totalPtoMin },
  ]
  const totalMinutes = hours * 60
  const pieDistribution = [
    { name: 'PTO', value: totalPtoMin },
    { name: 'Motor', value: Math.max(0, totalEngMin - totalPtoMin) },
    { name: 'Parado', value: Math.max(0, totalMinutes - totalEngMin) },
  ].filter(d => d.value > 0)

  // Donut data — configurable metrics with chart_type='donut'
  const customDonutData = donutMetrics.map(m => ({
    name: m.label,
    value: Math.round(
      kpis.reduce((s, h) => s + ((h[m.key as keyof KpiHour] as number) ?? 0), 0) * m.transform * 100
    ) / 100,
    color: m.color,
    unit: m.unit,
  })).filter(d => d.value > 0)

  const pieColors1 = ['#78716C', '#F97316']
  const pieColors2 = ['#F97316', '#22C55E', '#3C3330']

  function handleCsvExport() {
    const rows = kpis.map(h => ({
      'Período': h.bucket,
      'Horas motor (min)': h.engine_on_minutes ?? 0,
      'Horas PTO (min)': h.pto_active_minutes ?? 0,
      'Presión media 1': h.avg_pressure_1 ?? '',
      'Presión máx 1': h.max_pressure_1 ?? '',
      'Temp. aceite media': h.avg_oil_temp ?? '',
      'Temp. aceite máx': h.max_oil_temp ?? '',
      'Registros': h.record_count ?? 0,
    }))
    exportToCsv(`historico-${vehicleId}-${period}.csv`, rows)
  }

  // Multi-series line chart — only line-type metrics
  const allLineMetrics = [
    ...lineMetrics,
    // Add motor/PTO as fallback only if no line metrics configured
    ...(lineMetrics.length === 0 && kpis.some(h => h.engine_on_minutes != null) && !lineMetrics.find(m => m.key === 'engine_on_minutes')
      ? [{ key: 'engine_on_minutes', label: 'H. Motor', color: '#22C55E', unit: 'min', transform: 1 }]
      : []),
    ...(lineMetrics.length === 0 && kpis.some(h => h.pto_active_minutes != null) && !lineMetrics.find(m => m.key === 'pto_active_minutes')
      ? [{ key: 'pto_active_minutes', label: 'H. PTO', color: '#F97316', unit: 'min', transform: 1 }]
      : []),
  ]
  const lineData = buildMultiSeriesData(kpis, period, allLineMetrics)

  const tooltipStyle = {
    contentStyle: {
      background: 'var(--bg-elevated)',
      border: '1px solid var(--bg-border)',
      borderRadius: 6,
      fontSize: 11,
    },
    labelStyle: { color: 'var(--text-muted)' },
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* KPI row */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <KpiCard label="Días operativos" value={String(diasTrabajados)} accent="var(--accent-ok)" />
        <KpiCard label="Total horas motor" value={totalEngMin > 0 ? fmtHours(totalEngMin) : '—'} accent="var(--accent-info)" />
        <KpiCard label="Total horas PTO" value={totalPtoMin > 0 ? fmtHours(totalPtoMin) : '—'} accent="var(--accent-energy)" />
        <KpiCard label="% PTO / Motor" value={ptoPct != null ? `${ptoPct}%` : '—'} accent={ptoPct != null && ptoPct > 80 ? 'var(--accent-warn)' : undefined} />
      </div>

      {/* Export + multi-series line chart */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-default)' }}>
            Desempeño histórico — {PERIOD_LABELS[period]}
          </div>
          <button style={btnSecondary} onClick={handleCsvExport} disabled={kpis.length === 0}>
            ⬇ CSV
          </button>
        </div>

        {lineData.length === 0 ? (
          <div style={{ height: isMobile ? 140 : 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12, gap: 6 }}>
            {metrics.length === 0 ? (
              <>
                <span>Sin métricas de línea configuradas.</span>
                <span style={{ fontSize: 11, opacity: 0.7 }}>
                  Ve a <strong style={{ color: 'var(--accent-energy)' }}>Tipos de vehículo</strong> y añade métricas con tipo gráfico Línea o Barra.
                </span>
              </>
            ) : (
              'Sin datos para este período'
            )}
          </div>
        ) : (
          <div style={{ height: isMobile ? 160 : 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineData} margin={{ top: 4, right: 16, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(87,83,78,0.3)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#78716C' }} />
                <YAxis tick={{ fontSize: 10, fill: '#78716C' }} />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }} />
                {allLineMetrics.map((m, i) => (
                  <Line
                    key={m.key}
                    type="monotone"
                    dataKey={m.key}
                    name={m.label}
                    stroke={m.color || CHART_COLORS[i % CHART_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Two fixed donut charts — Motor vs PTO */}
      {(totalEngMin > 0 || totalPtoMin > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>

          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-default)', marginBottom: 8 }}>
              Motor vs PTO
            </div>
            <div style={{ height: isMobile ? 150 : 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieMotorPto}
                    cx="50%" cy="50%"
                    innerRadius={55} outerRadius={80}
                    dataKey="value"
                    paddingAngle={2}
                  >
                    {pieMotorPto.map((_, i) => (
                      <Cell key={i} fill={pieColors1[i % pieColors1.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(v: number) => [fmtHours(v), '']}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-default)', marginBottom: 8 }}>
              Distribución del tiempo
            </div>
            <div style={{ height: isMobile ? 150 : 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieDistribution}
                    cx="50%" cy="50%"
                    innerRadius={55} outerRadius={80}
                    dataKey="value"
                    paddingAngle={2}
                  >
                    {pieDistribution.map((_, i) => (
                      <Cell key={i} fill={pieColors2[i % pieColors2.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(v: number) => [fmtHours(v), '']}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>
      )}

      {/* Configurable donut charts — metrics with chart_type='donut' */}
      {donutMetrics.length > 0 && customDonutData.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-default)', marginBottom: 12 }}>
            Distribución de actividades
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(donutMetrics.length, 3)}, 1fr)`, gap: 12 }}>
            {customDonutData.map((d, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ height: 140 }}>
                  <ResponsiveContainer width={140} height={140}>
                    <PieChart>
                      <Pie
                        data={[d, { name: '', value: Math.max(0, customDonutData.reduce((s, x) => s + x.value, 0) - d.value) }]}
                        cx="50%" cy="50%"
                        innerRadius={42} outerRadius={60}
                        dataKey="value"
                        startAngle={90}
                        endAngle={-270}
                        paddingAngle={2}
                      >
                        <Cell fill={d.color} />
                        <Cell fill="var(--bg-elevated)" />
                      </Pie>
                      <Tooltip
                        {...tooltipStyle}
                        formatter={(v: number) => [`${v} ${d.unit}`, d.name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-default)', textAlign: 'center' }}>{d.name}</div>
                <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-data)', color: d.color }}>
                  {d.value} <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{d.unit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
  const isMobile = useIsMobile()

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
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 12, height: isMobile ? undefined : '100%' }}>

      <div style={{ ...card, width: isMobile ? '100%' : 210, flexShrink: 0, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
              <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 360 }}>
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
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ width: isMobile ? '100%' : 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {selectedPlan && (
          <>
            <div style={card}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Estado</div>
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

// ── RUTAS tab ─────────────────────────────────────────────────────────────────

function RutasTab({ vehicleId }: { vehicleId: string }) {
  const isMobile = useIsMobile()
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)

  const from = `${date}T00:00:00Z`
  const to = `${date}T23:59:59Z`

  const { data: track = [], isFetching } = useQuery<TrackPoint[]>({
    queryKey: [...keys.vehicleTrack(vehicleId), date],
    queryFn: () => apiClient.get<TrackPoint[]>(
      `/api/v1/vehicles/${vehicleId}/track?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    ),
    enabled: Boolean(vehicleId),
    staleTime: 120_000,
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapRef.current = L.map(containerRef.current, { center: [40.416775, -3.70379], zoom: 12 })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(mapRef.current)
    return () => { mapRef.current?.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.eachLayer(layer => { if (!(layer instanceof L.TileLayer)) map.removeLayer(layer) })

    const valid = track.filter(p => p.lat != null && p.lon != null)
    if (valid.length === 0) return

    const latlngs = valid.map(p => [p.lat!, p.lon!] as [number, number])
    L.polyline(latlngs, { color: '#10b981', weight: 4, opacity: 0.9 }).addTo(map)

    L.circleMarker(latlngs[0], {
      radius: 7, fillColor: '#22C55E', color: '#fff', weight: 2, fillOpacity: 1,
    }).bindTooltip('Inicio').addTo(map)

    L.circleMarker(latlngs[latlngs.length - 1], {
      radius: 7, fillColor: '#38BDF8', color: '#fff', weight: 2, fillOpacity: 1,
    }).bindTooltip('Fin').addTo(map)

    try { map.fitBounds(L.latLngBounds(latlngs).pad(0.15)) } catch { /* ignorar */ }
  }, [track])

  if (!vehicleId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--text-muted)', fontSize: 13 }}>
        Selecciona un vehículo para ver rutas
      </div>
    )
  }

  const validPoints = track.filter(p => p.lat != null && p.lon != null)
  const noData = !isFetching && validPoints.length === 0

  // Route stats
  const stats = (() => {
    if (validPoints.length < 2) return null
    let distM = 0
    for (let i = 1; i < validPoints.length; i++) {
      distM += haversineM(validPoints[i - 1].lat!, validPoints[i - 1].lon!, validPoints[i].lat!, validPoints[i].lon!)
    }
    const durationMs = new Date(validPoints[validPoints.length - 1].time).getTime() - new Date(validPoints[0].time).getTime()
    const durationMin = durationMs / 60000
    const distKm = distM / 1000
    const avgKmh = durationMin > 0 ? (distKm / durationMin) * 60 : 0
    return { distKm, durationMin, avgKmh }
  })()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Fecha</label>
        <input
          type="date"
          value={date}
          max={today}
          onChange={e => setDate(e.target.value)}
          style={{
            fontSize: 12, background: 'var(--bg-elevated)',
            border: '1px solid var(--bg-border)', borderRadius: 5,
            padding: '5px 8px', color: 'var(--text-default)',
          }}
        />
        {isFetching && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Cargando…</span>}
        {stats && (
          <div style={{ display: 'flex', gap: 16, marginLeft: 8 }}>
            <StatChip icon="📍" label="Distancia" value={`${stats.distKm.toFixed(1)} km`} />
            <StatChip icon="⚡" label="Vel. media" value={`${stats.avgKmh.toFixed(0)} km/h`} />
            <StatChip icon="⏱" label="Duración" value={fmtHours(stats.durationMin)} />
          </div>
        )}
      </div>

      {noData ? (
        <div style={{
          height: 380, background: 'var(--bg-elevated)', borderRadius: 8,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8, color: 'var(--text-muted)', fontSize: 13,
        }}>
          <svg width={36} height={36} viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 32 Q14 20 20 24 Q26 28 32 8"/>
            <circle cx="8" cy="32" r="2.5" fill="currentColor" stroke="none"/>
            <circle cx="32" cy="8" r="2.5" fill="currentColor" stroke="none"/>
          </svg>
          <span>Sin datos de ruta para este día</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>El vehículo no registró posiciones GPS el {date}</span>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <div ref={containerRef} style={{ width: '100%', height: isMobile ? 280 : 440, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bg-border)' }} />
          <div style={{
            position: 'absolute', bottom: 12, right: 12, zIndex: 1000,
            background: 'rgba(28,25,23,0.92)', border: '1px solid var(--bg-border)',
            borderRadius: 6, padding: '8px 12px', fontSize: 11, color: 'var(--text-muted)',
            display: 'flex', flexDirection: 'column', gap: 4, backdropFilter: 'blur(4px)',
          }}>
            <span style={{ color: '#22C55E' }}>● Inicio</span>
            <span style={{ color: '#38BDF8' }}>● Fin</span>
            <span style={{ color: 'var(--text-muted)', marginTop: 2 }}>{validPoints.length} puntos GPS</span>
          </div>
        </div>
      )}
    </div>
  )
}

function StatChip({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
      borderRadius: 6, padding: '4px 10px',
    }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
        <div style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-data)', color: 'var(--text-default)' }}>{value}</div>
      </div>
    </div>
  )
}

// ── ALERTAS tab ───────────────────────────────────────────────────────────────

type Severity = 'all' | 'critical' | 'warning' | 'info'

function AlertasTab({ vehicleId }: { vehicleId: string }) {
  const [severityFilter, setSeverityFilter] = useState<Severity>('all')

  const { data: alerts = [] } = useQuery<AlertInstanceOut[]>({
    queryKey: [...keys.alerts(), 'reports', vehicleId],
    queryFn: () => apiClient.get<AlertInstanceOut[]>(`/api/v1/alerts?vehicle_id=${vehicleId}&limit=200`),
    enabled: Boolean(vehicleId),
    staleTime: 60_000,
  })

  const { data: rules = [] } = useQuery<RuleOut[]>({
    queryKey: keys.rules(),
    queryFn: () => apiClient.get<RuleOut[]>('/api/v1/rules'),
    staleTime: 300_000,
  })

  const ruleMap = new Map(rules.map(r => [r.id, r]))

  if (!vehicleId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--text-muted)', fontSize: 13 }}>
        Selecciona un vehículo para ver las alertas
      </div>
    )
  }

  const rows = alerts
    .filter(a => a.vehicle_id === vehicleId)
    .filter(a => severityFilter === 'all' || (ruleMap.get(a.rule_id)?.severity ?? 'info') === severityFilter)
    .sort((a, b) => (b.triggered_at > a.triggered_at ? 1 : -1))

  const statusColors: Record<string, string> = {
    firing: 'var(--accent-crit)',
    escalated: 'var(--accent-crit)',
    acknowledged: 'var(--accent-warn)',
    resolved: 'var(--accent-ok)',
  }
  const statusLabels: Record<string, string> = {
    firing: 'Activa', escalated: 'Escalada', acknowledged: 'Reconocida', resolved: 'Resuelta',
  }

  const severityColors: Record<string, string> = {
    critical: 'var(--accent-crit)',
    warning: 'var(--accent-warn)',
    info: 'var(--accent-info)',
  }
  const severityLabels: Record<string, string> = {
    critical: 'CRÍTICA', warning: 'AVISO', info: 'INFO',
  }

  function handleCsvExport() {
    const csvRows = rows.map(a => {
      const rule = ruleMap.get(a.rule_id)
      return {
        'Fecha': new Date(a.triggered_at).toLocaleString('es-ES'),
        'Regla': rule?.name ?? a.rule_id,
        'Severidad': rule?.severity ?? '—',
        'Estado': statusLabels[a.status] ?? a.status,
        'Resuelta': a.resolved_at ? new Date(a.resolved_at).toLocaleString('es-ES') : '',
      }
    })
    exportToCsv(`alertas-${vehicleId}.csv`, csvRows)
  }

  const severityFilterBtn = (s: Severity, color?: string): React.CSSProperties => ({
    padding: '4px 12px', fontSize: 11, fontWeight: 600,
    fontFamily: 'var(--font-ui)', border: `1px solid ${color ?? 'var(--bg-border)'}`,
    borderRadius: 20, cursor: 'pointer',
    background: severityFilter === s ? (color ?? 'var(--bg-elevated)') : 'transparent',
    color: severityFilter === s ? '#fff' : (color ?? 'var(--text-muted)'),
    transition: 'all 0.15s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 4 }}>Severidad:</span>
          <button style={severityFilterBtn('all')} onClick={() => setSeverityFilter('all')}>Todas</button>
          <button style={severityFilterBtn('critical', '#EF4444')} onClick={() => setSeverityFilter('critical')}>Crítica</button>
          <button style={severityFilterBtn('warning', '#EAB308')} onClick={() => setSeverityFilter('warning')}>Aviso</button>
          <button style={severityFilterBtn('info', '#38BDF8')} onClick={() => setSeverityFilter('info')}>Info</button>
        </div>
        <button style={btnSecondary} onClick={handleCsvExport} disabled={rows.length === 0}>
          ⬇ CSV
        </button>
      </div>

      <div style={{ ...card, overflowX: 'auto' }}>
        {rows.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '16px 0', textAlign: 'center' }}>
            Sin alertas registradas
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
            <thead>
              <tr>
                <th style={thStyle}>Fecha</th>
                <th style={thStyle}>Nombre regla</th>
                <th style={thStyle}>Severidad</th>
                <th style={thStyle}>Estado</th>
                <th style={thStyle}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => {
                const rule = ruleMap.get(a.rule_id)
                const sev = rule?.severity ?? 'info'
                const trigVal = a.trigger_value ? JSON.stringify(a.trigger_value) : '—'
                const valStr = trigVal.length > 24 ? trigVal.slice(0, 24) + '…' : trigVal
                return (
                  <tr key={a.id}>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-data)', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {new Date(a.triggered_at).toLocaleString('es-ES', {
                        day: '2-digit', month: '2-digit', year: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12 }}>
                      {rule?.name ?? (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>
                          {a.rule_id.slice(0, 8)}…
                        </span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                        background: `${severityColors[sev] ?? '#78716C'}22`,
                        color: severityColors[sev] ?? 'var(--text-muted)',
                      }}>
                        {severityLabels[sev] ?? sev.toUpperCase()}
                      </span>
                    </td>
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
                      {valStr}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const user = useAuthStore(s => s.user)
  const isCmg = user?.tenant_tier === 'cmg'
  const location = useLocation()

  const { tab, setTab } = useReportsTabStore()
  const [period, setPeriod] = useState<Period>('semana')
  const [vehicleId, setVehicleId] = useState('')
  const [tenantId, setTenantId] = useState('')

  // Initialize from navigation state (e.g. from VehicleDetailPage quick-access cards)
  useEffect(() => {
    const state = location.state as { vehicleId?: string; tab?: string } | null
    if (state?.vehicleId) setVehicleId(state.vehicleId)
    if (state?.tab && ['historico', 'mantenimiento', 'rutas', 'alertas'].includes(state.tab)) {
      setTab(state.tab as Parameters<typeof setTab>[0])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Queries ───────────────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Shell title="Reportes">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

        <SelectorBar
          isCmg={isCmg}
          tenants={tenants}
          tenantId={tenantId}
          setTenantId={setTenantId}
          vehicles={vehicles}
          vehicleId={vehicleId}
          setVehicleId={setVehicleId}
          period={period}
          setPeriod={setPeriod}
          pdfSlot={
            <PdfDownloadBtn
              vehicleId={vehicleId}
              vehicles={vehicles}
              isCmg={isCmg}
              tenantId={tenantId}
            />
          }
        />

        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
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
            <RutasTab vehicleId={vehicleId} />
          )}
          {tab === 'alertas' && (
            <AlertasTab vehicleId={vehicleId} />
          )}
        </div>
      </div>
    </Shell>
  )
}
