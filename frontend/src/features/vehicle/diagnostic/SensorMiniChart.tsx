import { useRef, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { SensorDef, VehicleStatus } from '../../../lib/types'
import { apiClient } from '../../../lib/apiClient'
import {
  buildSensorSeries, injectGaps, buildChartTicks,
  type AvlPoint, type ChartPointTime,
} from '../../../lib/avlSeries'
import { sensorSeverity } from '../../../lib/sensorSeverity'
import { resolveRawValue, applyScaleOffset, formatSensorValue } from '../../../lib/sensorValue'

const ZONE_COLOR: Record<string, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  crit: 'var(--accent-crit)',
}

interface SensorMiniChartProps {
  sensor: SensorDef
  vehicleId: string
  status: VehicleStatus
  derived: Record<string, number | null>
  isStale?: boolean
}

const ZONE_VALUE_COLOR: Record<string, string> = {
  crit: 'var(--accent-crit)',
  warn: 'var(--accent-warn)',
  ok: 'var(--fg-primary)',
  nodata: 'var(--fg-dim)',
}

// Horas de la ventana fija de la mini-tarjeta
const MINI_HOURS = 24

export function SensorMiniChart({ sensor, vehicleId, status, derived, isStale }: SensorMiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (!sensor.avl_id) return
    const el = containerRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          obs.disconnect()
        }
      },
      { threshold: 0.1 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [sensor.avl_id])

  const raw = resolveRawValue(sensor, status, derived)
  const scaled = applyScaleOffset(raw, sensor.scale, sensor.offset)
  const zone = sensorSeverity(sensor, scaled) ?? 'nodata'
  const valueColor = isStale ? ZONE_VALUE_COLOR.nodata : (ZONE_VALUE_COLOR[zone] ?? ZONE_VALUE_COLOR.nodata)
  const formatted = formatSensorValue(scaled) ?? '—'
  const strokeColor = isStale ? 'var(--fg-dim)' : (ZONE_COLOR[zone ?? 'ok'] ?? ZONE_COLOR.ok)

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

  const now = Date.now()
  const domainStart = now - MINI_HOURS * 60 * 60 * 1000
  // Solo ticks de inicio y fin (sin etiquetas) para no saturar el espacio reducido
  const xTicks = [domainStart, now]

  const chartData: ChartPointTime[] = injectGaps(
    buildSensorSeries(seriesRaw, sensor.scale, sensor.offset),
    MINI_HOURS,
  )
  const hasData = chartData.filter(d => d.value !== null).length >= 2
  const gradientId = `smg-${sensor.key.replace(/[^a-z0-9]/gi, '_')}`

  return (
    <div ref={containerRef} data-testid="sensor-mini-chart">
      {/* Valor actual — layout unificado: siempre presente sobre la sparkline */}
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 4,
        fontFamily: 'var(--font-mono)', color: valueColor,
      }}>
        <span style={{ fontSize: 'var(--fs-sensor-hero)', fontWeight: 'var(--fw-sensor-hero)' as React.CSSProperties['fontWeight'], lineHeight: 1.1 }}>
          {formatted}
        </span>
        {sensor.unit && (
          <span style={{ fontSize: 'var(--fs-panel-label)', fontWeight: 600, color: 'var(--fg-tertiary)' }}>
            {sensor.unit}
          </span>
        )}
      </div>

      {/* Sparkline — 70px de alto, sin YAxis, XAxis mínimo (solo inicio/fin) */}
      <div style={{ height: 70, marginTop: 4 }}>
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
                domain={[domainStart, now]}
                ticks={xTicks}
                tick={{ fontSize: 8, fill: 'var(--fg-dim)' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(ts: number) =>
                  new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
                }
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 6, fontSize: 11,
                }}
                itemStyle={{ color: 'var(--fg-primary)' }}
                formatter={(v: number | null) =>
                  v === null
                    ? ['sin datos', sensor.label]
                    : [`${v}${sensor.unit ? ' ' + sensor.unit : ''}`, sensor.label]
                }
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
              height: 70,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--fg-dim)',
              fontSize: 'var(--fs-meta)',
            }}
          >
            Sin histórico
          </div>
        )}
      </div>
    </div>
  )
}
