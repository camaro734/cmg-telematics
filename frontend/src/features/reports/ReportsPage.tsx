import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useIsMobile } from '../../lib/useIsMobile'
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import Shell from '../../shared/ui/Shell'
import TrackMap from '../vehicle/TrackMap'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { exportToCsv } from '../../lib/csvExport'
import { useReportData, periodToHours, PERIOD_LABELS } from './useReportData'
import { SelectorBar, PdfDownloadBtn } from './ReportFilters'
import { Input } from '../../shared/ui/Input'
import type { Period } from './useReportData'
import type {
  VehicleTypeOut, KpiHour,
  AlertInstanceOut, MaintenancePlanOut, MaintenanceLogOut,
  TrackPoint, RuleOut,
} from '../../lib/types'

// ── Style constants ───────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '14px 16px',
}

const thStyle: React.CSSProperties = {
  padding: '6px 8px', fontSize: 11, fontWeight: 600, textAlign: 'left',
  borderBottom: '1px solid var(--border)', color: 'var(--fg-muted)',
}

const tdStyle: React.CSSProperties = {
  padding: '6px 8px', fontSize: 12,
  color: 'var(--fg-primary)', borderBottom: '1px solid var(--border)',
}

const btnSecondary: React.CSSProperties = {
  padding: '5px 12px', fontSize: 12, fontWeight: 600,
  fontFamily: 'var(--font-sans)', border: '1px solid var(--border)',
  borderRadius: 6, cursor: 'pointer',
  background: 'var(--bg-card)', color: 'var(--fg-primary)',
  display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
}

const CHART_COLORS = ['var(--energy-orange)', 'var(--ok)', 'var(--info)', 'var(--warn)', 'var(--chart-4)']

// Paleta para gráficos multi-serie agrupados
const GROUP_COLORS = ['var(--energy-orange)', 'var(--info)', 'var(--ok)', 'var(--warn)', 'var(--danger)', 'var(--chart-4)']

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

function buildAvlSeriesData(
  avlData: {bucket: string; value: number | null}[],
  period: Period,
  _metricKey: string,
  transform: number,
): {label: string; value: number}[] {
  if (!avlData.length) return []
  if (period === 'dia') {
    return avlData
      .filter(d => d.value !== null)
      .map(d => ({
        label: new Date(d.bucket).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        value: Math.round((d.value! * transform) * 100) / 100,
      }))
  }
  const byDay = new Map<string, number[]>()
  for (const d of avlData) {
    if (d.value === null) continue
    const day = d.bucket.slice(0, 10)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day)!.push(d.value * transform)
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, vals]) => ({
      label: day.slice(5).replace('-', '/'),
      value: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100,
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

/**
 * Merge múltiples series de {label, value} en un array combinado por label (outer join).
 * Devuelve [{label, key1: val, key2: val, ...}]
 */
function mergeSeriesByLabel(
  series: { key: string; data: { label: string; value: number }[] }[],
): Record<string, string | number>[] {
  const labelMap = new Map<string, Record<string, number>>()
  for (const s of series) {
    for (const pt of s.data) {
      if (!labelMap.has(pt.label)) labelMap.set(pt.label, {})
      labelMap.get(pt.label)![s.key] = pt.value
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

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ ...card, flex: 1, minWidth: 130, position: 'relative', overflow: 'hidden' }}>
      <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 6, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase' as const }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent ?? 'var(--fg-primary)', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>
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
  vehicleId, vehicleTypeId, vehicleTypes, period, customFrom, customTo,
}: {
  vehicleId: string
  vehicleTypeId: string
  vehicleTypes: VehicleTypeOut[]
  period: Period
  customFrom?: string
  customTo?: string
}) {
  const isMobile = useIsMobile()
  const hours = periodToHours(period, customFrom ?? '', customTo ?? '')

  const customQuerySuffix = period === 'custom' ? `${customFrom}_${customTo}` : hours

  const { data: kpis = [] } = useQuery<KpiHour[]>({
    queryKey: [...keys.vehicleKpis(vehicleId), customQuerySuffix],
    queryFn: () => {
      if (period === 'custom' && customFrom && customTo) {
        const start = encodeURIComponent(new Date(customFrom + 'T00:00:00').toISOString())
        const end = encodeURIComponent(new Date(customTo + 'T23:59:59').toISOString())
        return apiClient.get<KpiHour[]>(`/api/v1/vehicles/${vehicleId}/kpis?start=${start}&end=${end}`)
      }
      const endDate = new Date()
      const startDate = new Date(endDate.getTime() - hours * 60 * 60 * 1000)
      const startISO = encodeURIComponent(startDate.toISOString())
      const endISO = encodeURIComponent(endDate.toISOString())
      return apiClient.get<KpiHour[]>(`/api/v1/vehicles/${vehicleId}/kpis?start=${startISO}&end=${endISO}`)
    },
    enabled: Boolean(vehicleId),
    staleTime: 60_000,
  })

  const vehicleType = vehicleTypes.find(vt => vt.id === vehicleTypeId)
  const metrics = vehicleType?.historic_metrics ?? []

  // KpiHour column names — estas métricas vienen de telemetry_1h, nunca de avl-series
  const KPI_HOUR_KEYS = new Set(['engine_on_minutes', 'pto_active_minutes', 'avg_pressure_1', 'max_pressure_1', 'avg_oil_temp', 'max_oil_temp', 'record_count'])

  // Cargar series AVL — excluir columnas KPI conocidas aunque tengan avl_id configurado
  const avlMetrics = metrics.filter(m => m.avl_id !== undefined && m.avl_id !== null && !KPI_HOUR_KEYS.has(m.key))
  const avlIds = avlMetrics.map(m => m.avl_id!)

  const { data: avlSeriesRaw } = useQuery<Record<string, {bucket: string; value: number | null}[]>>({
    queryKey: ['avl-series-multi', vehicleId, avlIds.join(','), customQuerySuffix],
    queryFn: async () => {
      if (!avlIds.length) return {}
      const results: Record<string, {bucket: string; value: number | null}[]> = {}
      await Promise.all(avlIds.map(async avlId => {
        try {
          if (period === 'custom' && customFrom && customTo) {
            const start = encodeURIComponent(new Date(customFrom + 'T00:00:00').toISOString())
            const end = encodeURIComponent(new Date(customTo + 'T23:59:59').toISOString())
            results[avlId] = await apiClient.get(`/api/v1/vehicles/${vehicleId}/avl-series?avl_id=${avlId}&start=${start}&end=${end}`)
          } else {
            const endD = new Date()
            const startD = new Date(endD.getTime() - hours * 60 * 60 * 1000)
            results[avlId] = await apiClient.get(`/api/v1/vehicles/${vehicleId}/avl-series?avl_id=${avlId}&start=${encodeURIComponent(startD.toISOString())}&end=${encodeURIComponent(endD.toISOString())}`)
          }
        } catch { results[avlId] = [] }
      }))
      return results
    },
    enabled: Boolean(vehicleId) && avlIds.length > 0,
    staleTime: 60_000,
  })

  // Mapa avl_id -> datos de serie
  const avlDataMap = new Map<number, {bucket: string; value: number | null}[]>()
  avlMetrics.forEach(m => {
    const d = avlSeriesRaw?.[m.avl_id!]
    if (d) avlDataMap.set(m.avl_id!, d)
  })

  // Split metrics by chart_type
  const lineMetrics = metrics.filter(m => !m.chart_type || m.chart_type === 'line')
  const donutMetrics = metrics.filter(m => m.chart_type === 'donut')

  if (!vehicleId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--fg-muted)', fontSize: 13 }}>
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

  const pieColors1 = ['var(--offline)', 'var(--energy-orange)']
  const PIE_COLOR: Record<string, string> = {
    'PTO':    'var(--energy-orange)',
    'Motor':  'var(--ok)',
    'Parado': 'var(--offline)',
  }

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
      ? [{ key: 'engine_on_minutes', label: 'H. Motor', color: 'var(--ok)', unit: 'min', transform: 1 }]
      : []),
    ...(lineMetrics.length === 0 && kpis.some(h => h.pto_active_minutes != null) && !lineMetrics.find(m => m.key === 'pto_active_minutes')
      ? [{ key: 'pto_active_minutes', label: 'H. PTO', color: 'var(--energy-orange)', unit: 'min', transform: 1 }]
      : []),
  ]
  // KpiHour columns always use kpis[], even if avl_id is set in the metric config
  const kpiLineMetrics = allLineMetrics.filter(m => KPI_HOUR_KEYS.has(m.key) || !(m as any).avl_id)
  const avlLineMetrics = allLineMetrics.filter(m => !KPI_HOUR_KEYS.has(m.key) && (m as any).avl_id !== undefined)
  const lineData = buildMultiSeriesData(kpis, period, kpiLineMetrics)
  // Datos individuales por cada métrica AVL — se usan para agrupación o gráfico solitario
  const avlLineData = avlLineMetrics.map(m => ({
    metric: m,
    data: buildAvlSeriesData(
      avlDataMap.get((m as any).avl_id) ?? [],
      period,
      m.key,
      m.transform ?? 1,
    ),
  }))

  // Agrupar métricas AVL por campo group
  // Métricas con group definido y no vacío → gráfico combinado
  // Métricas sin group → gráfico individual (comportamiento anterior)
  type AvlLineDataItem = typeof avlLineData[number]
  const avlGrouped = (() => {
    const groups = new Map<string, AvlLineDataItem[]>()
    const singles: AvlLineDataItem[] = []
    for (const item of avlLineData) {
      const grp = (item.metric as any).group
      if (grp && typeof grp === 'string' && grp.trim()) {
        const key = grp.trim()
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(item)
      } else {
        singles.push(item)
      }
    }
    return { groups, singles }
  })()

  const tooltipStyle = {
    contentStyle: {
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      fontSize: 11,
      color: 'var(--fg-primary)',
    },
    labelStyle: { color: 'var(--fg-muted)' },
    itemStyle: { color: 'var(--fg-primary)' },
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* KPI row */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <KpiCard label="Días operativos" value={String(diasTrabajados)} accent="var(--ok)" />
        <KpiCard label="Total horas motor" value={totalEngMin > 0 ? fmtHours(totalEngMin) : '—'} accent="var(--info)" />
        <KpiCard label="Total horas PTO" value={totalPtoMin > 0 ? fmtHours(totalPtoMin) : '—'} accent="var(--cmg-teal)" />
        <KpiCard label="% PTO / Motor" value={ptoPct != null ? `${ptoPct}%` : '—'} accent={ptoPct != null && ptoPct > 80 ? 'var(--warn)' : undefined} />
      </div>

      {/* Export + multi-series line chart */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)' }}>
            Desempeño histórico — {PERIOD_LABELS[period]}
          </div>
          <button style={btnSecondary} onClick={handleCsvExport} disabled={kpis.length === 0}>
            ⬇ CSV
          </button>
        </div>

        {lineData.length === 0 ? (
          <div style={{ height: isMobile ? 140 : 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)', fontSize: 12, gap: 6 }}>
            {metrics.length === 0 ? (
              <>
                <span>Sin métricas de línea configuradas.</span>
                <span style={{ fontSize: 11, opacity: 0.7 }}>
                  Ve a <strong style={{ color: 'var(--cmg-teal)' }}>Plantillas</strong> y añade métricas con tipo gráfico Línea o Barra.
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
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--offline)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--offline)' }} />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--fg-muted)' }} />
                {kpiLineMetrics.map((m, i) => (
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
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-primary)', marginBottom: 8 }}>
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
                  <Legend wrapperStyle={{ fontSize: 11, color: 'var(--fg-muted)' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-primary)', marginBottom: 8 }}>
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
                    {pieDistribution.map((entry) => (
                      <Cell key={entry.name} fill={PIE_COLOR[entry.name] ?? 'var(--fg-dim)'} />
                    ))}
                  </Pie>
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(v: number) => [fmtHours(v), '']}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: 'var(--fg-muted)' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>
      )}

      {/* Gráficos de línea para métricas AVL agrupadas (multi-serie) */}
      {Array.from(avlGrouped.groups.entries()).map(([groupName, items]) => {
        const mergedData = mergeSeriesByLabel(
          items.map(it => ({ key: it.metric.key, data: it.data }))
        )
        const hasData = mergedData.length > 0
        const title = items.map(it => it.metric.label).join(' / ')
        const firstUnit = items[0]?.metric.unit ?? ''
        const allSameUnit = items.every(it => it.metric.unit === firstUnit)
        return (
          <div key={groupName} style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)', marginBottom: 10 }}>
              {title}{allSameUnit && firstUnit ? ` (${firstUnit})` : ''} — {PERIOD_LABELS[period]}
            </div>
            {!hasData ? (
              <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)', fontSize: 12 }}>
                Sin datos para este período
              </div>
            ) : (
              <div style={{ height: isMobile ? 160 : 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={mergedData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--offline)' }} />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--offline)' }}
                      unit={allSameUnit && firstUnit ? ` ${firstUnit}` : undefined}
                    />
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(v: number, name: string) => {
                        const item = items.find(it => it.metric.key === name)
                        const unit = item?.metric.unit ?? ''
                        const label = item?.metric.label ?? name
                        return [`${v}${unit ? ' ' + unit : ''}`, label]
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, color: 'var(--fg-muted)' }} />
                    {items.map((it, i) => (
                      <Line
                        key={it.metric.key}
                        type="monotone"
                        dataKey={it.metric.key}
                        name={it.metric.label}
                        stroke={(it.metric as any).color || GROUP_COLORS[i % GROUP_COLORS.length]}
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
        )
      })}

      {/* Gráficos de línea para métricas AVL individuales (sin group) */}
      {avlGrouped.singles.map(({ metric, data }) => (
        <div key={metric.key} style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)', marginBottom: 10 }}>
            {metric.label}{metric.unit ? ` (${metric.unit})` : ''} — {PERIOD_LABELS[period]}
          </div>
          {data.length === 0 ? (
            <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)', fontSize: 12 }}>
              Sin datos para este período
            </div>
          ) : (
            <div style={{ height: isMobile ? 160 : 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--offline)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--offline)' }} />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(v: number) => [`${v}${metric.unit ? ' ' + metric.unit : ''}`, metric.label]}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={metric.color || '#6EC5B1'}
                    strokeWidth={2}
                    dot={false}
                    name={metric.label}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      ))}

      {/* Configurable donut charts — metrics with chart_type='donut' */}
      {donutMetrics.length > 0 && customDonutData.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-primary)', marginBottom: 12 }}>
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
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-primary)', textAlign: 'center' }}>{d.name}</div>
                <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: d.color }}>
                  {d.value} <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{d.unit}</span>
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
    ok: 'var(--ok)',
    próximo: 'var(--warn)',
    vencido: 'var(--danger)',
  }
  const labels: Record<string, string> = {
    ok: 'OK',
    próximo: 'PRÓXIMO',
    vencido: 'VENCIDO',
  }
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
      background: `${colors[status] ?? '#64748B'}22`,
      color: colors[status] ?? 'var(--offline)',
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--fg-muted)', fontSize: 13 }}>
        Selecciona un vehículo para ver los planes de mantenimiento
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 12, height: isMobile ? undefined : '100%' }}>

      <div style={{ ...card, width: isMobile ? '100%' : 210, flexShrink: 0, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600, color: 'var(--fg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Planes de mantenimiento</span>
          <Link
            to="/maintenance"
            style={{ fontSize: 11, color: 'var(--cmg-teal)', textDecoration: 'none', whiteSpace: 'nowrap', marginLeft: 8 }}
          >
            Ver todo →
          </Link>
        </div>
        {plans.length === 0 ? (
          <div style={{ padding: 12, fontSize: 12, color: 'var(--fg-muted)' }}>Sin planes</div>
        ) : (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {plans.map(p => (
              <div
                key={p.id}
                onClick={() => setSelectedPlanId(p.id === selectedPlanId ? null : p.id)}
                style={{
                  padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                  background: p.id === selectedPlanId ? 'var(--bg-card)' : 'transparent',
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--fg-primary)', fontWeight: p.id === selectedPlanId ? 600 : 400 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 150, color: 'var(--fg-muted)', fontSize: 13 }}>
            Selecciona un plan
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)' }}>
              {selectedPlan.name} — Historial de intervenciones
            </div>
            {allLogs.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: '16px 0' }}>Sin intervenciones registradas</div>
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
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {log.performed_at ? new Date(log.performed_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'}
                      </td>
                      <td style={tdStyle}>{log.description ?? '—'}</td>
                      <td style={tdStyle}>
                        {log.document_url
                          ? <a href={log.document_url} target="_blank" rel="noreferrer" style={{ color: 'var(--info)', fontSize: 11 }}>Ver</a>
                          : <span style={{ color: 'var(--fg-muted)' }}>—</span>
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
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Estado</div>
              <StatusBadge status={selectedPlan.progress.status} />
            </div>
            {selectedPlan.progress.thresholds.map((t, i) => {
              const pct = Math.min(100, Math.round(t.pct))
              const barColor = t.pct >= 100
                ? 'var(--danger)'
                : t.pct >= (100 - selectedPlan.warn_before_pct)
                  ? 'var(--warn)'
                  : 'var(--ok)'
              const typeLabel: Record<string, string> = {
                pto_hours: 'Horas PTO',
                engine_hours: 'Horas motor',
                calendar_days: 'Días calendario',
              }
              return (
                <div key={i} style={card}>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 4 }}>
                    {typeLabel[t.type] ?? t.type}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
                    {Math.round(t.current)} / {t.limit}
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-card)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 0.3s' }} />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginTop: 2 }}>{pct}%</div>
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

  // Build local midnight timestamps to avoid off-by-one when user is not in UTC
  const from = new Date(`${date}T00:00:00`).toISOString()
  const to = new Date(`${date}T23:59:59`).toISOString()

  const { data: track = [], isFetching } = useQuery<TrackPoint[]>({
    queryKey: [...keys.vehicleTrack(vehicleId), date],
    queryFn: () => apiClient.get<TrackPoint[]>(
      `/api/v1/vehicles/${vehicleId}/track?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    ),
    enabled: Boolean(vehicleId),
    staleTime: 120_000,
  })

  if (!vehicleId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--fg-muted)', fontSize: 13 }}>
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
        <label style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Fecha</label>
        <Input type="date" size="sm" value={date} max={today} onChange={e => setDate(e.target.value)} />
        {isFetching && <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Cargando…</span>}
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
          height: 380, background: 'var(--bg-card)', borderRadius: 8,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8, color: 'var(--fg-muted)', fontSize: 13,
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
        <div style={{ height: isMobile ? 280 : 440 }}>
          <TrackMap track={track} status={undefined} emptyMessage="Sin recorrido para esta fecha" />
        </div>
      )}
    </div>
  )
}

function StatChip({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 6, padding: '4px 10px',
    }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 9, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
        <div style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)' }}>{value}</div>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--fg-muted)', fontSize: 13 }}>
        Selecciona un vehículo para ver las alertas
      </div>
    )
  }

  const rows = alerts
    .filter(a => a.vehicle_id === vehicleId)
    .filter(a => severityFilter === 'all' || (ruleMap.get(a.rule_id)?.severity ?? 'info') === severityFilter)
    .sort((a, b) => (b.triggered_at > a.triggered_at ? 1 : -1))

  const statusColors: Record<string, string> = {
    firing: 'var(--danger)',
    escalated: 'var(--danger)',
    acknowledged: 'var(--warn)',
    resolved: 'var(--ok)',
  }
  const statusLabels: Record<string, string> = {
    firing: 'Activa', escalated: 'Escalada', acknowledged: 'Reconocida', resolved: 'Resuelta',
  }

  const severityColors: Record<string, string> = {
    critical: 'var(--danger)',
    warning: 'var(--warn)',
    info: 'var(--info)',
  }
  const severityLabels: Record<string, string> = {
    critical: 'CRÍTICA', warning: 'AVISO', info: 'INFO',
  }

  function handleCsvExport() {
    const csvRows = rows.map(a => {
      const rule = ruleMap.get(a.rule_id)
      return {
        'Fecha': a.triggered_at ? new Date(a.triggered_at).toLocaleString('es-ES') : '—',
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
    fontFamily: 'var(--font-sans)', border: `1px solid ${color ?? 'var(--border)'}`,
    borderRadius: 20, cursor: 'pointer',
    background: severityFilter === s ? (color ?? 'var(--bg-card)') : 'transparent',
    color: severityFilter === s ? '#fff' : (color ?? 'var(--fg-muted)'),
    transition: 'all 0.15s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)', marginRight: 4 }}>Severidad:</span>
          <button style={severityFilterBtn('all')} onClick={() => setSeverityFilter('all')}>Todas</button>
          <button style={severityFilterBtn('critical', 'var(--danger)')} onClick={() => setSeverityFilter('critical')}>Crítica</button>
          <button style={severityFilterBtn('warning', 'var(--warn)')} onClick={() => setSeverityFilter('warning')}>Aviso</button>
          <button style={severityFilterBtn('info', 'var(--info)')} onClick={() => setSeverityFilter('info')}>Info</button>
        </div>
        <button style={btnSecondary} onClick={handleCsvExport} disabled={rows.length === 0}>
          ⬇ CSV
        </button>
      </div>

      <div style={{ ...card, overflowX: 'auto' }}>
        {rows.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: '16px 0', textAlign: 'center' }}>
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
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {a.triggered_at ? new Date(a.triggered_at).toLocaleString('es-ES', {
                        day: '2-digit', month: '2-digit', year: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      }) : '—'}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12 }}>
                      {rule?.name ?? (
                        <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                          {a.rule_id.slice(0, 8)}…
                        </span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                        background: `${severityColors[sev] ?? '#64748B'}22`,
                        color: severityColors[sev] ?? 'var(--fg-muted)',
                      }}>
                        {severityLabels[sev] ?? sev.toUpperCase()}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                        background: `${statusColors[a.status] ?? '#64748B'}22`,
                        color: statusColors[a.status] ?? 'var(--fg-muted)',
                      }}>
                        {statusLabels[a.status] ?? a.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
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
  const {
    isCmg, navigate, fromVehicleId,
    period, setPeriod,
    vehicleId, setVehicleId,
    tenantId, setTenantId,
    customFrom, setCustomFrom,
    customTo, setCustomTo,
    tab,
    tenants, vehicles, vehicleTypes,
    selectedVehicle,
  } = useReportData()

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
          customFrom={customFrom}
          customTo={customTo}
          setCustomFrom={setCustomFrom}
          setCustomTo={setCustomTo}
          onBack={fromVehicleId ? () => navigate(-1) : undefined}
          pdfSlot={
            <PdfDownloadBtn
              vehicleId={vehicleId}
              vehicles={vehicles}
              isCmg={isCmg}
              tenantId={tenantId || selectedVehicle?.tenant_id || ''}
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
              customFrom={customFrom}
              customTo={customTo}
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
