import type { SensorDef } from '../../../lib/types'
import { sensorSeverity } from '../../../lib/sensorSeverity'
import { formatSensorValue } from '../../../lib/sensorValue'

// Widget compacto para el valor en vivo de una tarjeta de sensor, elegido por
// `sensor.display_widget` (schema-driven, nada hardcodeado por nombre). SVG propio,
// tokens de la app. Rango del widget: display_min/display_max con fallback a min/max.
// Sin dato → gris neutro.

type WidgetType = NonNullable<SensorDef['display_widget']>

const ZONE_COLOR: Record<string, string> = {
  ok: 'var(--cmg-teal)',
  warn: 'var(--accent-warn)',
  crit: 'var(--accent-crit)',
  nodata: 'var(--offline)',
}

interface Props {
  sensor: SensorDef
  value: number | null   // valor ya escalado (unidad física)
  isStale?: boolean
}

function range(sensor: SensorDef): [number, number] {
  const min = sensor.display_min ?? sensor.min ?? 0
  const max = sensor.display_max ?? sensor.max ?? 100
  return max > min ? [min, max] : [min, min + 1]
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

function polarToXY(angleDeg: number, r: number, cx: number, cy: number) {
  const rad = ((180 - angleDeg) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) }
}

// ─── Gauge semicircular (cuentarrevoluciones) ─────────────────────────────────
function GaugeWidget({ sensor, value, color }: { sensor: SensorDef; value: number | null; color: string }) {
  const [min, max] = range(sensor)
  const size = 128
  const cx = size / 2
  const cy = size * 0.60
  const r = size * 0.40
  const STROKE = 9
  const pct = value != null ? clamp01((value - min) / (max - min)) : 0
  const start = polarToXY(0, r, cx, cy)
  const end = polarToXY(180, r, cx, cy)
  const fillPt = polarToXY(pct * 180, r, cx, cy)
  const needle = polarToXY(pct * 180, r * 0.80, cx, cy)
  const track = `M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`
  const fill = pct > 0 ? `M ${start.x} ${start.y} A ${r} ${r} 0 ${pct > 0.5 ? 1 : 0} 1 ${fillPt.x} ${fillPt.y}` : ''
  const disp = value != null ? (formatSensorValue(value) ?? '—') : '—'
  return (
    <svg width="100%" height={size * 0.66} viewBox={`0 0 ${size} ${size * 0.66}`} style={{ display: 'block', overflow: 'visible' }}>
      <path d={track} fill="none" stroke="var(--border)" strokeWidth={STROKE} strokeLinecap="round" />
      {fill && <path d={fill} fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round" style={{ transition: 'stroke 0.3s' }} />}
      <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={4.5} fill={color} />
      <text x={start.x} y={start.y + 12} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={8} fill="var(--fg-dim)">{min}</text>
      <text x={end.x} y={end.y + 12} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={8} fill="var(--fg-dim)">{max}</text>
      <text x={cx} y={cy - 4} textAnchor="middle" fontFamily="var(--font-mono)" fontWeight={700} fontSize={22} fill={value != null ? 'var(--fg-primary)' : 'var(--fg-dim)'}>{disp}</text>
      {sensor.unit && value != null && (
        <text x={cx} y={cy + 11} textAnchor="middle" fontFamily="var(--font-sans)" fontSize={9} fill="var(--fg-muted)">{sensor.unit}</text>
      )}
    </svg>
  )
}

// ─── Barra horizontal con valor ───────────────────────────────────────────────
function BarWidget({ sensor, value, color }: { sensor: SensorDef; value: number | null; color: string }) {
  const [min, max] = range(sensor)
  const pct = value != null ? clamp01((value - min) / (max - min)) * 100 : 0
  const disp = value != null ? (formatSensorValue(value) ?? '—') : '—'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sensor-hero)', fontWeight: 700, color: value != null ? color : 'var(--fg-dim)', lineHeight: 1 }}>
          {disp}
        </span>
        {sensor.unit && value != null && (
          <span style={{ fontSize: 'var(--fs-panel-label)', fontWeight: 600, color: 'var(--fg-tertiary)', fontFamily: 'var(--font-mono)' }}>{sensor.unit}</span>
        )}
      </div>
      <div style={{ position: 'relative', width: '100%', height: 9, background: 'var(--border)', borderRadius: 5, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: color, borderRadius: 5, transition: 'width 0.4s ease' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
        <span>{min}</span><span>{max}</span>
      </div>
    </div>
  )
}

// ─── Barra de temperatura con zonas verde/ámbar/rojo ──────────────────────────
function TempBarWidget({ sensor, value }: { sensor: SensorDef; value: number | null }) {
  const [min, max] = range(sensor)
  const span = max - min
  const pctOf = (v?: number) => (v == null ? null : clamp01((v - min) / span) * 100)
  const warn = pctOf(sensor.warn_above)
  const alert = pctOf(sensor.alert_above)
  // Gradiente por zonas: ok hasta warn, ámbar hasta alert, rojo después.
  const stops: string[] = []
  const okEnd = warn ?? 100
  stops.push(`var(--cmg-teal) 0%`, `var(--cmg-teal) ${okEnd}%`)
  if (warn != null) {
    const warnEnd = alert ?? 100
    stops.push(`var(--accent-warn) ${warn}%`, `var(--accent-warn) ${warnEnd}%`)
    if (alert != null) stops.push(`var(--accent-crit) ${alert}%`, `var(--accent-crit) 100%`)
  }
  const markerPct = value != null ? clamp01((value - min) / span) * 100 : null
  const zone = sensorSeverity(sensor, value) ?? 'nodata'
  const disp = value != null ? (formatSensorValue(value) ?? '—') : '—'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sensor-hero)', fontWeight: 700, color: value != null ? ZONE_COLOR[zone] : 'var(--fg-dim)', lineHeight: 1 }}>
          {disp}
        </span>
        {sensor.unit && value != null && (
          <span style={{ fontSize: 'var(--fs-panel-label)', fontWeight: 600, color: 'var(--fg-tertiary)', fontFamily: 'var(--font-mono)' }}>{sensor.unit}</span>
        )}
      </div>
      <div style={{ position: 'relative', width: '100%', height: 9, borderRadius: 5, overflow: 'hidden', background: value != null ? `linear-gradient(to right, ${stops.join(', ')})` : 'var(--border)', opacity: value != null ? 1 : 0.5 }}>
        {markerPct != null && (
          <div style={{ position: 'absolute', left: `calc(${markerPct}% - 1px)`, top: -1, height: 'calc(100% + 2px)', width: 2, background: 'var(--fg-primary)', boxShadow: '0 0 3px rgba(0,0,0,0.6)' }} />
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
        <span>{min}</span><span>{max}</span>
      </div>
    </div>
  )
}

/** ¿Este sensor usa un widget visual (no el número plano)? */
export function hasVisualWidget(sensor: SensorDef): boolean {
  const w = sensor.display_widget
  return w === 'gauge' || w === 'bar' || w === 'temp_bar'
}

export function LiveSensorWidget({ sensor, value, isStale }: Props) {
  const widget = sensor.display_widget as WidgetType | undefined
  const zone = isStale ? 'nodata' : (sensorSeverity(sensor, value) ?? (value != null ? 'ok' : 'nodata'))
  const color = ZONE_COLOR[zone] ?? ZONE_COLOR.nodata
  if (widget === 'gauge') return <GaugeWidget sensor={sensor} value={value} color={color} />
  if (widget === 'bar') return <BarWidget sensor={sensor} value={value} color={color} />
  if (widget === 'temp_bar') return <TempBarWidget sensor={sensor} value={value} />
  return null
}
