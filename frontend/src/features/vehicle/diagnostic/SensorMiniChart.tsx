import { useRef, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { SensorDef, VehicleStatus } from '../../../lib/types'
import { apiClient } from '../../../lib/apiClient'
import { buildSensorSeries, type AvlPoint } from '../../../lib/avlSeries'
import { sensorSeverity } from '../../../lib/sensorSeverity'
import { resolveRawValue, applyScaleOffset } from '../../../lib/sensorValue'

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
}

export function SensorMiniChart({ sensor, vehicleId, status, derived }: SensorMiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (!sensor.avl_id) return
    const el = containerRef.current
    if (!el) return
    // jsdom / SSR: activar inmediatamente
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
  const zone = sensorSeverity(sensor, scaled)
  const strokeColor = ZONE_COLOR[zone ?? 'ok'] ?? ZONE_COLOR.ok

  const { data: seriesRaw = [] } = useQuery<AvlPoint[]>({
    queryKey: ['avl-series', vehicleId, sensor.avl_id, 24],
    queryFn: () =>
      apiClient.get<AvlPoint[]>(
        `/api/v1/vehicles/${vehicleId}/avl-series?avl_id=${sensor.avl_id}&hours=24`,
      ),
    enabled: Boolean(sensor.avl_id) && inView,
    staleTime: 5 * 60_000,
  })

  if (!sensor.avl_id) return null

  const chartData = buildSensorSeries(seriesRaw, sensor.scale, sensor.offset)
  // gradientId único por sensor dentro del SVG
  const gradientId = `smg-${sensor.key.replace(/[^a-z0-9]/gi, '_')}`

  return (
    <div ref={containerRef} data-testid="sensor-mini-chart" style={{ height: 90, marginTop: 6 }}>
      {chartData.length >= 2 ? (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={strokeColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: 'var(--fg-dim)' }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <Tooltip
              contentStyle={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 6, fontSize: 11,
              }}
              itemStyle={{ color: 'var(--fg-primary)' }}
              formatter={(v: number) => [`${v}${sensor.unit ? ' ' + sensor.unit : ''}`, sensor.label]}
              labelFormatter={(l) => String(l)}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={strokeColor}
              strokeWidth={1.5}
              fill={`url(#${gradientId})`}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div
          data-testid="sensor-mini-chart-empty"
          style={{
            height: 90,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--fg-dim)',
            fontSize: 11,
          }}
        >
          Sin histórico
        </div>
      )}
    </div>
  )
}
