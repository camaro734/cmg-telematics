import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { KpiHour, VehicleTypeOut } from '../../lib/types'

type Period = 'dia' | 'semana' | 'mes'
const PERIOD_HOURS: Record<Period, number> = { dia: 24, semana: 168, mes: 720 }

function fmtH(min: number) {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${h}h ${String(m).padStart(2, '0')}m`
}

function buildEngPtoData(kpis: KpiHour[], period: Period) {
  if (period === 'dia') {
    return [...kpis].reverse().map(h => ({
      label: new Date(h.bucket).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
      motor: Math.round(((h.engine_on_minutes ?? 0) / 60) * 100) / 100,
      pto: Math.round(((h.pto_active_minutes ?? 0) / 60) * 100) / 100,
    }))
  }
  const byDay = new Map<string, { motor: number; pto: number }>()
  for (const h of kpis) {
    const day = h.bucket.slice(0, 10)
    const cur = byDay.get(day) ?? { motor: 0, pto: 0 }
    byDay.set(day, {
      motor: cur.motor + (h.engine_on_minutes ?? 0) / 60,
      pto: cur.pto + (h.pto_active_minutes ?? 0) / 60,
    })
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({
      label: day.slice(5).replace('-', '/'),
      motor: Math.round(v.motor * 100) / 100,
      pto: Math.round(v.pto * 100) / 100,
    }))
}

function buildKpiSeries(kpis: KpiHour[], key: string, transform: number, period: Period) {
  if (period === 'dia') {
    return [...kpis].reverse()
      .filter(h => h[key as keyof KpiHour] != null)
      .map(h => ({
        label: new Date(h.bucket).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        value: Math.round((Number(h[key as keyof KpiHour])) * transform * 100) / 100,
      }))
  }
  const byDay = new Map<string, number[]>()
  for (const h of kpis) {
    if (h[key as keyof KpiHour] == null) continue
    const day = h.bucket.slice(0, 10)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day)!.push(Number(h[key as keyof KpiHour]) * transform)
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, vals]) => ({
      label: day.slice(5).replace('-', '/'),
      value: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100,
    }))
}

function buildAvlSeries(
  raw: { bucket: string; value: number | null }[],
  transform: number,
  period: Period,
) {
  if (period === 'dia') {
    return raw
      .filter(d => d.value !== null)
      .map(d => ({
        label: new Date(d.bucket).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        value: Math.round(d.value! * transform * 100) / 100,
      }))
  }
  const byDay = new Map<string, number[]>()
  for (const d of raw) {
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

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '12px 14px', flex: 1, minWidth: 120,
    }}>
      <div style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color: accent ?? 'var(--fg-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

const chartCard: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '14px 16px',
}

const chartTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)',
  marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
}

const tooltipStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  borderRadius: 6, fontSize: 12,
}

export default function KpiChart({ vehicleId, vehicleTypeId }: { vehicleId: string; vehicleTypeId?: string }) {
  const [period, setPeriod] = useState<Period>('semana')
  const hours = PERIOD_HOURS[period]

  const { data: kpis = [], isLoading } = useQuery<KpiHour[]>({
    queryKey: [...keys.vehicleKpis(vehicleId), hours],
    queryFn: () => {
      const endDate = new Date()
      const startDate = new Date(endDate.getTime() - hours * 60 * 60 * 1000)
      return apiClient.get<KpiHour[]>(`/api/v1/vehicles/${vehicleId}/kpis?start=${encodeURIComponent(startDate.toISOString())}&end=${encodeURIComponent(endDate.toISOString())}`)
    },
    enabled: Boolean(vehicleId),
    staleTime: 60_000,
  })

  const { data: vehicleTypes = [] } = useQuery<VehicleTypeOut[]>({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: 300_000,
    enabled: Boolean(vehicleTypeId),
  })
  const vehicleType = vehicleTypes.find(vt => vt.id === vehicleTypeId)
  const metrics = vehicleType?.historic_metrics ?? []

  const avlMetrics = metrics.filter(m => m.avl_id !== undefined && m.avl_id !== null)
  const kpiMetrics = metrics.filter(m => m.avl_id === undefined || m.avl_id === null)
  const avlIds = avlMetrics.map(m => m.avl_id!)

  const { data: avlSeriesRaw } = useQuery<Record<string, { bucket: string; value: number | null }[]>>({
    queryKey: ['avl-series-multi', vehicleId, avlIds.join(','), hours],
    queryFn: async () => {
      const results: Record<string, { bucket: string; value: number | null }[]> = {}
      await Promise.all(avlIds.map(async avlId => {
        try {
          results[String(avlId)] = await apiClient.get(
            `/api/v1/vehicles/${vehicleId}/avl-series?avl_id=${avlId}&hours=${hours}`
          )
        } catch { results[String(avlId)] = [] }
      }))
      return results
    },
    enabled: Boolean(vehicleId) && avlIds.length > 0,
    staleTime: 60_000,
  })

  const totalEngMin = kpis.reduce((s, h) => s + (h.engine_on_minutes ?? 0), 0)
  const totalPtoMin = kpis.reduce((s, h) => s + (h.pto_active_minutes ?? 0), 0)
  const diasTrabajados = period === 'dia'
    ? (kpis.some(h => (h.engine_on_minutes ?? 0) > 0) ? 1 : 0)
    : new Set(kpis.filter(h => (h.engine_on_minutes ?? 0) > 0).map(h => h.bucket.slice(0, 10))).size
  const ptoPct = totalEngMin > 0 ? Math.round((totalPtoMin / totalEngMin) * 100) : null

  const engPtoData = buildEngPtoData(kpis, period)

  const periodBtn = (p: Period): React.CSSProperties => ({
    padding: '4px 12px', fontSize: 12, fontWeight: 600,
    border: '1px solid var(--border)', borderRadius: 20, cursor: 'pointer',
    background: period === p ? 'var(--cmg-teal)' : 'transparent',
    color: period === p ? '#fff' : 'var(--fg-muted)',
    transition: 'background 0.15s',
  })

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--fg-muted)', fontSize: 13 }}>
        Cargando…
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Period selector */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(['dia', 'semana', 'mes'] as Period[]).map(p => (
          <button key={p} style={periodBtn(p)} onClick={() => setPeriod(p)}>
            {p === 'dia' ? '24h' : p === 'semana' ? '7 días' : '30 días'}
          </button>
        ))}
      </div>

      {/* KPI summary */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <KpiCard label="Días operativos" value={String(diasTrabajados)} accent="var(--ok)" />
        <KpiCard label="Horas motor" value={fmtH(totalEngMin)} />
        <KpiCard label="Horas PTO" value={fmtH(totalPtoMin)} accent="var(--cmg-teal)" />
        <KpiCard
          label="Eficiencia PTO"
          value={ptoPct !== null ? `${ptoPct}%` : '—'}
          sub="tiempo PTO / motor"
          accent={ptoPct !== null ? (ptoPct > 50 ? 'var(--ok)' : 'var(--warn)') : undefined}
        />
      </div>

      {/* Motor / PTO chart */}
      {engPtoData.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)', color: 'var(--fg-muted)', fontSize: 13 }}>
          Sin datos para el período seleccionado
        </div>
      ) : (
        <div style={chartCard}>
          <div style={chartTitle}>Motor y PTO — horas</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={engPtoData} margin={{ top: 4, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--fg-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--fg-muted)' }} unit="h" />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}h`]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="motor" name="Motor" stroke="#38BDF8" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="pto" name="PTO" stroke="var(--energy-orange)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* KPI-based custom metrics (no avl_id) */}
      {kpiMetrics.map(metric => {
        const data = buildKpiSeries(kpis, metric.key, metric.transform ?? 1, period)
        if (!data.length) return null
        return (
          <div key={metric.key} style={chartCard}>
            <div style={chartTitle}>{metric.label}{metric.unit ? ` — ${metric.unit}` : ''}</div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data} margin={{ top: 4, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--fg-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--fg-muted)' }} unit={metric.unit ? ` ${metric.unit}` : ''} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="value" name={metric.label} stroke={metric.color ?? 'var(--energy-orange)'} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )
      })}

      {/* AVL series charts */}
      {avlMetrics.map(metric => {
        const raw = avlSeriesRaw?.[String(metric.avl_id!)] ?? []
        const data = buildAvlSeries(raw, metric.transform ?? 1, period)
        if (!data.length) return null
        return (
          <div key={`avl-${metric.avl_id}`} style={chartCard}>
            <div style={chartTitle}>{metric.label}{metric.unit ? ` — ${metric.unit}` : ''}</div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data} margin={{ top: 4, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--fg-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--fg-muted)' }} unit={metric.unit ? ` ${metric.unit}` : ''} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="value" name={metric.label} stroke={metric.color ?? '#38BDF8'} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )
      })}

    </div>
  )
}
