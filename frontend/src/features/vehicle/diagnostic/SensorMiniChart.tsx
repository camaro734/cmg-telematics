import { useRef, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { SensorDef, VehicleStatus } from '../../../lib/types'
import { apiClient } from '../../../lib/apiClient'
import {
  buildSensorSeries, buildDerivativeSeries, injectGaps,
  type AvlPoint, type ChartPointTime,
} from '../../../lib/avlSeries'
import { sensorSeverity } from '../../../lib/sensorSeverity'
import { resolveRawValue, applyTransform, formatSensorValue, isJ1939NA } from '../../../lib/sensorValue'

const ZONE_COLOR: Record<string, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  crit: 'var(--accent-crit)',
}

const ZONE_VALUE_COLOR: Record<string, string> = {
  crit: 'var(--accent-crit)',
  warn: 'var(--accent-warn)',
  ok: 'var(--fg-primary)',
  nodata: 'var(--fg-dim)',
}

interface SensorMiniChartProps {
  sensor: SensorDef
  vehicleId: string
  status: VehicleStatus
  derived: Record<string, number | null>
  isStale?: boolean
}

// Altura fija del sparkline — igual para todos los bloques
const SPARKLINE_H = 56
// Ventana histórica de la mini-tarjeta — 12h para que respire
const MINI_HOURS = 12

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  if (h >= 48) return `hace ${Math.floor(h / 24)}d`
  if (h >= 1)  return `hace ${h}h`
  if (m >= 1)  return `hace ${m}m`
  return 'hace <1m'
}

export function SensorMiniChart({ sensor, vehicleId, status, derived, isStale }: SensorMiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (!sensor.avl_id) return
    const el = containerRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); obs.disconnect() } },
      { threshold: 0.1 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [sensor.avl_id])

  const { data: seriesRaw = [] } = useQuery<AvlPoint[]>({
    queryKey: ['avl-series', vehicleId, sensor.avl_id, MINI_HOURS],
    queryFn: () =>
      apiClient.get<AvlPoint[]>(
        `/api/v1/vehicles/${vehicleId}/avl-series?avl_id=${sensor.avl_id}&hours=${MINI_HOURS}`,
      ),
    enabled: Boolean(sensor.avl_id) && inView,
    staleTime: 5 * 60_000,
  })

  if (!sensor.avl_id) return null

  const chartData: ChartPointTime[] = sensor.derivative
    ? buildDerivativeSeries(seriesRaw, sensor)
    : injectGaps(buildSensorSeries(seriesRaw, sensor), MINI_HOURS)

  // Para sensores derivativos el valor live es el último punto de la serie (tasa reciente)
  const lastChartPoint = chartData.reduceRight<ChartPointTime | null>(
    (acc, d) => acc ?? (d.value !== null ? d : null), null,
  )

  // Valor actual desde el status en vivo (solo para sensores no derivativos)
  const liveRaw = sensor.derivative ? null : resolveRawValue(sensor, status, derived)
  const liveScaled = sensor.derivative ? null : applyTransform(liveRaw, sensor)

  // Detectar centinela J1939 en el valor CAN en bruto (solo sensores no derivativos)
  const canRaw = (!sensor.derivative && sensor.avl_id != null)
    ? (status.can_data?.[`avl_${sensor.avl_id}`] as number | undefined) ?? null
    : null
  const isNA = canRaw !== null && isJ1939NA(canRaw)

  // Fallback: último punto histórico si el status no tiene dato CAN
  const lastHistorical = (!sensor.derivative && liveScaled === null && !isNA)
    ? lastChartPoint
    : null
  const lastHistoricalScaled = lastHistorical?.value ?? null

  const displayScaled = sensor.derivative
    ? (lastChartPoint?.value ?? null)
    : (liveScaled ?? lastHistoricalScaled)
  const displayFormatted = isNA ? 'N/D' : (displayScaled !== null ? (formatSensorValue(displayScaled) ?? '—') : '—')

  // Edad del último dato conocido (para mostrar cuando offline)
  const staleAgeLabel: string | null = (() => {
    if (!isStale) return null
    const ts = lastHistorical?.ts ?? null
    if (ts) return timeAgo(ts)
    const lastSeen = status.device_last_seen ?? status.last_seen
    if (lastSeen) return timeAgo(new Date(lastSeen).getTime())
    return null
  })()

  // Color según zona (apagado si offline o centinela J1939)
  const zone = sensorSeverity(sensor, liveScaled) ?? 'nodata'
  const valueColor = (isStale || isNA) ? ZONE_VALUE_COLOR.nodata : (ZONE_VALUE_COLOR[zone] ?? ZONE_VALUE_COLOR.nodata)
  const strokeColor = isStale ? 'var(--fg-dim)' : (ZONE_COLOR[zone ?? 'ok'] ?? ZONE_COLOR.ok)

  // Auto-zoom: dominio X sobre la extensión de los datos (sin margen fijo de 24h)
  const validPts = chartData.filter(d => d.value !== null)
  const hasData = validPts.length >= 2
  const sparkDomain: [number, number] = (() => {
    if (!hasData) return [Date.now() - MINI_HOURS * 3_600_000, Date.now()]
    const first = validPts[0].ts
    const last = validPts[validPts.length - 1].ts
    const pad = Math.max((last - first) * 0.05, 60_000)
    return [first - pad, last + pad]
  })()

  const gradientId = `smg-${sensor.key.replace(/[^a-z0-9]/gi, '_')}`

  return (
    <div ref={containerRef} data-testid="sensor-mini-chart">
      {/* Valor actual — layout fijo: siempre visible, nunca "—" si hay histórico */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-sensor-hero)',
          fontWeight: 'var(--fw-sensor-hero)' as React.CSSProperties['fontWeight'],
          color: valueColor,
          lineHeight: 1.1,
        }}>
          {displayFormatted}
        </span>
        {sensor.unit && displayScaled !== null && !isNA && (
          <span style={{ fontSize: 'var(--fs-panel-label)', fontWeight: 600, color: 'var(--fg-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {sensor.unit}
          </span>
        )}
        {staleAgeLabel && (
          <span style={{ fontSize: 10, color: 'var(--fg-dim)', fontFamily: 'var(--font-sans)', marginLeft: 2 }}>
            {staleAgeLabel}
          </span>
        )}
      </div>

      {/* Sparkline con altura fija — auto-zoom sobre los datos */}
      <div style={{ height: SPARKLINE_H, marginTop: 4 }}>
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={strokeColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={sparkDomain}
                hide
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 6, fontSize: 11,
                }}
                itemStyle={{ color: 'var(--fg-primary)' }}
                formatter={(v) => {
                  const val = v as number | null
                  if (val === null) return ['sin datos', sensor.label]
                  return [`${val}${sensor.unit ? ' ' + sensor.unit : ''}`, sensor.label]
                }}
                labelFormatter={(ts: number) =>
                  new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                }
              />
              <Area
                type={sensor.gauge_type === 'led' ? 'stepAfter' : 'monotone'}
                dataKey="value"
                stroke={strokeColor}
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div
            data-testid="sensor-mini-chart-empty"
            style={{
              height: SPARKLINE_H,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--fg-dim)', fontSize: 'var(--fs-meta)',
            }}
          >
            Sin histórico
          </div>
        )}
      </div>
    </div>
  )
}
