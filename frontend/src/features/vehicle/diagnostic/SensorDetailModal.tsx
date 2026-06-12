import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import type { SensorDef } from '../../../lib/types'
import { apiClient } from '../../../lib/apiClient'
import {
  buildSensorSeries, injectGaps, buildChartTicks,
  type AvlPoint, type ChartPointTime,
} from '../../../lib/avlSeries'
import { computeSensorStats } from '../../../lib/sensorStats'
import { wsClient } from '../../../lib/wsClient'

interface SensorDetailModalProps {
  sensor: SensorDef
  vehicleId: string
  onClose: () => void
}

const RANGES: { label: string; hours: number }[] = [
  { label: '6h',  hours: 6   },
  { label: '24h', hours: 24  },
  { label: '7d',  hours: 168 },
  { label: '30d', hours: 720 },
]

function fmtTick(ts: number, hours: number): string {
  const d = new Date(ts)
  if (hours <= 24) {
    return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
}

function fmtTooltipLabel(ts: number, hours: number): string {
  const d = new Date(ts)
  if (hours <= 24) {
    return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
  return d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
}

// Calcula dominio Y con cero como base y techo redondeado al múltiplo limpio.
// Garantiza padding superior ~10% y ticks que caen en valores redondos.
function niceYDomain(data: ChartPointTime[]): [number, number] {
  const vals = data.filter(d => d.value !== null).map(d => d.value as number)
  if (vals.length === 0) return [0, 100]
  const mx = Math.max(...vals)
  if (mx <= 0) return [Math.min(...vals) * 1.1, 1]
  const mag = Math.pow(10, Math.floor(Math.log10(mx)))
  const high = Math.ceil(mx * 1.1 / mag) * mag
  const mn = Math.min(...vals)
  const low = mn >= 0 ? 0 : Math.floor(mn / mag) * mag
  return [low, high]
}

function StatBox({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 16px', minWidth: 80,
    }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700,
        color: muted ? 'var(--fg-muted)' : 'var(--fg-primary)',
      }}>
        {value}
      </span>
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--fg-dim)' }}>
        {label}
      </span>
    </div>
  )
}

export function SensorDetailModal({ sensor, vehicleId, onClose }: SensorDetailModalProps) {
  const [hours, setHours] = useState(24)
  const isBoolean = sensor.gauge_type === 'led'
  const queryClient = useQueryClient()

  // Invalida la serie cuando llegan datos en vivo (solo en rangos cortos ≤24h)
  useEffect(() => {
    if (hours > 24 || sensor.avl_id == null) return
    return wsClient.onTelemetry(data => {
      if (data.vehicle_id === vehicleId) {
        void queryClient.invalidateQueries({
          queryKey: ['avl-series', vehicleId, sensor.avl_id, hours],
        })
      }
    })
  }, [hours, vehicleId, sensor.avl_id, queryClient])

  const { data: raw = [], isLoading } = useQuery<AvlPoint[]>({
    queryKey: ['avl-series', vehicleId, sensor.avl_id, hours],
    queryFn: () =>
      apiClient.get<AvlPoint[]>(
        `/api/v1/vehicles/${vehicleId}/avl-series?avl_id=${sensor.avl_id}&hours=${hours}`,
      ),
    staleTime: 60_000,
    enabled: sensor.avl_id != null,
  })

  const now = Date.now()
  const domainStart = now - hours * 60 * 60 * 1000

  const chartData: ChartPointTime[] = injectGaps(
    buildSensorSeries(raw, sensor.scale, sensor.offset),
    hours,
  )
  const hasData = chartData.filter(d => d.value !== null).length >= 2
  const stats = computeSensorStats(chartData, isBoolean)
  const xTicks = buildChartTicks(domainStart, now, hours)
  const yDomain = isBoolean ? ([0, 1] as [number, number]) : niceYDomain(chartData)

  const gradientId = `sdm-${sensor.key.replace(/[^a-z0-9]/gi, '_')}`
  const strokeColor = 'var(--cmg-teal)'
  const unitLabel = sensor.unit ? ` ${sensor.unit}` : ''

  return (
    <div
      data-testid="sensor-detail-modal-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        data-testid="sensor-detail-modal"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          width: '100%',
          maxWidth: 760,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Cabecera */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 700, color: 'var(--fg-primary)' }}>
              {sensor.label}
            </span>
            {sensor.unit && (
              <span style={{ marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--fg-dim)' }}>
                ({sensor.unit})
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {RANGES.map(r => (
                <button
                  key={r.hours}
                  onClick={() => setHours(r.hours)}
                  style={{
                    padding: '4px 10px', fontSize: 12, fontFamily: 'var(--font-sans)',
                    borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer',
                    background: hours === r.hours ? 'var(--cmg-teal)' : 'var(--bg-elevated)',
                    color: hours === r.hours ? '#fff' : 'var(--fg-muted)',
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              data-testid="sensor-detail-modal-close"
              onClick={onClose}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 20, color: 'var(--fg-dim)', lineHeight: 1, padding: '0 4px',
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Gráfico */}
        <div style={{ height: 280 }}>
          {isLoading ? (
            <div style={{
              height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--fg-dim)', fontFamily: 'var(--font-sans)', fontSize: 13,
            }}>
              Cargando…
            </div>
          ) : !hasData ? (
            <div style={{
              height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--fg-dim)', fontFamily: 'var(--font-sans)', fontSize: 13,
            }}>
              Sin datos en el período seleccionado
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={strokeColor} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="ts"
                  type="number"
                  scale="time"
                  domain={[domainStart, now]}
                  ticks={xTicks}
                  tick={{ fontSize: 10, fill: 'var(--fg-dim)' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(ts: number) => fmtTick(ts, hours)}
                />
                <YAxis
                  domain={yDomain}
                  tick={{ fontSize: 10, fill: 'var(--fg-dim)' }}
                  tickLine={false}
                  axisLine={false}
                  width={42}
                  tickCount={5}
                  tickFormatter={isBoolean ? (v: number) => (v === 1 ? 'ON' : v === 0 ? 'OFF' : '') : undefined}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
                  contentStyle={{
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    borderRadius: 6, fontSize: 12,
                  }}
                  itemStyle={{ color: 'var(--fg-primary)' }}
                  formatter={(v) => {
                    const val = v as number | null
                    if (val === null) return ['sin datos', sensor.label]
                    if (isBoolean) return [val === 1 ? 'ON' : 'OFF', sensor.label]
                    return [`${val}${unitLabel}`, sensor.label]
                  }}
                  labelFormatter={(ts: number) => fmtTooltipLabel(ts, hours)}
                />
                <Area
                  type={isBoolean ? 'stepAfter' : 'monotone'}
                  dataKey="value"
                  stroke={strokeColor}
                  strokeWidth={2}
                  fill={`url(#${gradientId})`}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Estadísticas */}
        {!isLoading && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {stats.kind === 'numeric' ? (
              <>
                <StatBox
                  label="Último"
                  value={stats.last !== null ? `${stats.last}${unitLabel}` : '—'}
                />
                <StatBox
                  label="Mín"
                  value={stats.min !== null ? `${stats.min}${unitLabel}` : '—'}
                />
                <StatBox
                  label="Máx"
                  value={stats.max !== null ? `${stats.max}${unitLabel}` : '—'}
                />
                {/* Media activa: excluye ceros de parado — nivel real de trabajo */}
                <StatBox
                  label="Media activa"
                  value={stats.avgActive !== null ? `${stats.avgActive}${unitLabel}` : '—'}
                />
                {/* Media total solo si difiere de la activa (mezcla parado + trabajo) */}
                {stats.avgActive !== null && stats.avg !== stats.avgActive && (
                  <StatBox
                    label="Media total"
                    value={stats.avg !== null ? `${stats.avg}${unitLabel}` : '—'}
                    muted
                  />
                )}
              </>
            ) : (
              <>
                <StatBox label="% activo" value={`${stats.pctActive}%`} />
                <StatBox label="Activaciones" value={String(stats.activations)} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
