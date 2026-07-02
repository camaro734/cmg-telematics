import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
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
  const vals: number[] = []
  for (const d of data) {
    if (d.value === null) continue
    vals.push(d.value)
    // La banda min/máx puede exceder la media: incluirla para no recortarla.
    if (d.vmin != null) vals.push(d.vmin)
    if (d.vmax != null) vals.push(d.vmax)
  }
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

// Tooltip del bucket: hora + media (y min/máx de la banda si existe).
function BucketTooltip({ active, payload, hours, unitLabel, isBoolean }: {
  active?: boolean; payload?: any[]; hours: number; unitLabel: string; isBoolean: boolean
}) {
  if (!active || !payload?.length) return null
  const p = payload.find(x => x.dataKey === 'value') ?? payload[0]
  const row = p?.payload as ChartPointTime | undefined
  if (!row || row.value == null) return null
  const fmt = (v: number) => isBoolean ? (v === 1 ? 'ON' : 'OFF') : `${v}${unitLabel}`
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: 12, color: 'var(--fg-primary)' }}>
      <div style={{ color: 'var(--fg-muted)', marginBottom: 4, fontSize: 11 }}>{fmtTooltipLabel(row.ts, hours)}</div>
      <div>Media: <strong style={{ fontFamily: 'var(--font-mono)' }}>{fmt(row.value)}</strong></div>
      {!isBoolean && row.vmin != null && row.vmax != null && row.vmax !== row.vmin && (
        <div style={{ color: 'var(--fg-dim)', fontSize: 11, marginTop: 2 }}>
          mín {row.vmin}{unitLabel} · máx {row.vmax}{unitLabel}
        </div>
      )}
    </div>
  )
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

  // Serie + banda min/máx. El eje X se recorta a la extensión REAL de los datos
  // (no las 24h fijas): así no queda 80% vacío si solo hay 3h con datos.
  // Sensores derivativos usan buildDerivativeSeries (tasa 1h rodante); resto injectGaps normal.
  const { chartData, domainStart, domainEnd, hasBand } = useMemo(() => {
    const reqEnd = Date.now()
    const reqStart = reqEnd - hours * 60 * 60 * 1000
    const series = sensor.derivative
      ? buildDerivativeSeries(raw, sensor)
      : injectGaps(buildSensorSeries(raw, sensor), hours)
    // Cada punto lleva `band: [vmin, vmax]` para el Area de rango (solo si hay banda).
    let hasBand = false
    const chartData = series.map(d => {
      if (d.value !== null && d.vmin != null && d.vmax != null) {
        hasBand = true
        return { ...d, band: [d.vmin, d.vmax] as [number, number] }
      }
      return { ...d, band: undefined }
    })
    // Extensión real de los datos válidos → dominio X con ~3% de margen.
    const validTs = series.filter(d => d.value !== null).map(d => d.ts)
    let domainStart = reqStart
    let domainEnd = reqEnd
    if (validTs.length >= 2) {
      const first = validTs[0]
      const last = validTs[validTs.length - 1]
      const pad = Math.max((last - first) * 0.03, 60_000)
      domainStart = first - pad
      domainEnd = Math.min(reqEnd, last + pad)
    }
    return { chartData, domainStart, domainEnd, hasBand }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, hours, sensor.scale, sensor.offset, sensor.transform, sensor.derivative])

  const xTicks = useMemo(
    () => buildChartTicks(domainStart, domainEnd, hours),
    [domainStart, domainEnd, hours],
  )
  const paddedData = chartData
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
              <ComposedChart
                data={paddedData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={strokeColor} stopOpacity={0.22} />
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
                  content={<BucketTooltip hours={hours} unitLabel={unitLabel} isBoolean={isBoolean} />}
                />
                {/* Banda min-máx del bucket (relleno tenue, sin línea) — solo si el endpoint la sirve */}
                {!isBoolean && hasBand && (
                  <Area
                    type="monotone"
                    dataKey="band"
                    stroke="none"
                    fill={strokeColor}
                    fillOpacity={0.14}
                    isAnimationActive={false}
                    connectNulls={false}
                    activeDot={false}
                  />
                )}
                {/* Relleno degradado bajo la media */}
                <Area
                  type={isBoolean ? 'stepAfter' : 'monotone'}
                  dataKey="value"
                  stroke="none"
                  fill={`url(#${gradientId})`}
                  isAnimationActive={false}
                  connectNulls={false}
                  activeDot={false}
                />
                {/* Línea de la media (encima de la banda) */}
                <Line
                  type={isBoolean ? 'stepAfter' : 'monotone'}
                  dataKey="value"
                  stroke={strokeColor}
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              </ComposedChart>
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
