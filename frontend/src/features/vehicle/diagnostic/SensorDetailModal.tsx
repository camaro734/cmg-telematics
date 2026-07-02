import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import type { SensorDef } from '../../../lib/types'
import { apiClient } from '../../../lib/apiClient'
import {
  buildSensorSeries, buildDerivativeSeries, injectGaps, buildChartTicks,
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
// Sensores derivativos (tasa/hora): limitados a 24h porque usan datos raw
const RANGES_DERIVATIVE: { label: string; hours: number }[] = [
  { label: '6h',  hours: 6  },
  { label: '24h', hours: 24 },
]

function fmtTick(ts: number, hours: number): string {
  const d = new Date(ts)
  if (hours <= 24) return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
}

// Formatea una duración en ms a "Xh Ym" / "Xm" / "Xs" para el tiempo en ON.
function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000)
  if (totalMin <= 0) return ms > 0 ? '<1 min' : '0 min'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

function fmtTooltipLabel(ts: number, hours: number): string {
  const d = new Date(ts)
  if (hours <= 24) return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
}

// Dominio Y sensato para el sensor: ajusta el rango a los datos con ~12% de
// margen. NO fuerza el 0 como base cuando el dato vive lejos de cero (p.ej.
// 80-100 ºC ocupa toda la altura en vez de quedar aplastado arriba), pero
// tampoco baja de 0 si el dato es no-negativo (evita negativos espurios).
function niceYDomain(data: ChartPointTime[]): [number, number] {
  const vals = data.filter(d => d.value !== null).map(d => d.value as number)
  if (vals.length === 0) return [0, 100]
  const mx = Math.max(...vals)
  const mn = Math.min(...vals)
  if (mx === mn) {
    const p = Math.max(Math.abs(mx) * 0.1, 1)
    return [Math.floor(mn - p), Math.ceil(mx + p)]
  }
  const pad = (mx - mn) * 0.12
  let low = mn - pad
  const high = mx + pad
  if (mn >= 0 && low < 0) low = 0
  return [Math.floor(low), Math.ceil(high)]
}

function StatBox({ label, value, muted, accent }: { label: string; value: string; muted?: boolean; accent?: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
      background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 18px', minWidth: 92,
      border: '1px solid var(--border)',
      borderTop: `2px solid ${accent ?? 'var(--border)'}`,
    }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, lineHeight: 1,
        color: muted ? 'var(--fg-muted)' : (accent ?? 'var(--fg-primary)'),
      }}>
        {value}
      </span>
      <span style={{
        fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 600,
        letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-dim)',
      }}>
        {label}
      </span>
    </div>
  )
}

export function SensorDetailModal({ sensor, vehicleId, onClose }: SensorDetailModalProps) {
  const activeRanges = sensor.derivative ? RANGES_DERIVATIVE : RANGES
  const [hours, setHours] = useState(sensor.derivative ? 24 : 24)
  const isBoolean = sensor.gauge_type === 'led'
  const queryClient = useQueryClient()

  // Invalida la serie cuando llegan datos en vivo (solo rangos cortos ≤24h)
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

  // paddedData: null en domainStart + serie + null en domainEnd para forzar el dominio X completo.
  // Sensores derivativos usan buildDerivativeSeries (tasa 1h rodante); resto injectGaps normal.
  const { paddedData, domainStart, domainEnd } = useMemo(() => {
    const domainEnd = Date.now()
    const domainStart = domainEnd - hours * 60 * 60 * 1000
    const series = sensor.derivative
      ? buildDerivativeSeries(raw, sensor)
      : injectGaps(buildSensorSeries(raw, sensor), hours)
    const paddedData: ChartPointTime[] = [
      { ts: domainStart, label: '', value: null },
      ...series,
      { ts: domainEnd, label: '', value: null },
    ]
    return { paddedData, domainStart, domainEnd }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, hours, sensor.scale, sensor.offset, sensor.transform, sensor.derivative])

  const xTicks = useMemo(
    () => buildChartTicks(domainStart, domainEnd, hours),
    [domainStart, domainEnd, hours],
  )
  const yDomain = isBoolean ? ([0, 1] as [number, number]) : niceYDomain(paddedData)

  const hasData = paddedData.filter(d => d.value !== null).length >= 2
  const stats = computeSensorStats(paddedData, isBoolean)

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
          width: '90vw',
          maxWidth: 1000,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          maxHeight: '90vh',
          overflowY: 'auto',
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
              {activeRanges.map(r => (
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

        {/* Gráfica principal — mismo render que la mini pero a tamaño completo */}
        <div style={{ height: 310 }}>
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
              <AreaChart
                data={paddedData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
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
                  domain={[domainStart, domainEnd]}
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
                  width={44}
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
                  strokeWidth={2.5}
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
                  accent="var(--cmg-teal)"
                />
                <StatBox
                  label="Mín"
                  value={stats.min !== null ? `${stats.min}${unitLabel}` : '—'}
                />
                <StatBox
                  label="Máx"
                  value={stats.max !== null ? `${stats.max}${unitLabel}` : '—'}
                />
                <StatBox
                  label="Media activa"
                  value={stats.avgActive !== null ? `${stats.avgActive}${unitLabel}` : '—'}
                />
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
                <StatBox label="Veces en ON" value={String(stats.activations)} />
                <StatBox label="Tiempo en ON" value={fmtDuration(stats.activeMs)} />
                <StatBox label="% del tiempo ON" value={`${stats.pctActive}%`} muted />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
