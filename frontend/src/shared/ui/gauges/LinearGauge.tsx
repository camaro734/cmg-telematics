interface LinearGaugeProps {
  value: number | null
  min: number
  max: number
  unit?: string
  label: string
  warnBelow?: number
  alertBelow?: number
  // Props modernas opcionales
  warnAbove?: number
  alertAbove?: number
  height?: number
  orientation?: 'horizontal' | 'vertical'
  colorOverride?: string
}

const cardStyle = {
  background: 'var(--bg-surface)',
  borderRadius: 8,
  padding: 8,
  border: '1px solid var(--bg-elevated)',
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  gap: 6,
}

function linearColor(
  value: number | null,
  warnBelow?: number,
  alertBelow?: number,
  warnAbove?: number,
  alertAbove?: number,
  colorOverride?: string,
): string {
  if (colorOverride) return colorOverride
  if (value == null) return 'var(--offline)'
  if (alertAbove != null && value >= alertAbove) return 'var(--danger)'
  if (warnAbove != null && value >= warnAbove) return 'var(--warn)'
  if (alertBelow != null && value <= alertBelow) return 'var(--danger)'
  if (warnBelow != null && value <= warnBelow) return 'var(--warn)'
  return 'var(--cmg-teal)'
}

function linearStatus(
  value: number | null,
  warnBelow?: number,
  alertBelow?: number,
  warnAbove?: number,
  alertAbove?: number,
): string {
  if (value == null) return '—'
  if (alertAbove != null && value >= alertAbove) return 'CRÍTICO'
  if (warnAbove != null && value >= warnAbove) return 'ALTO'
  if (alertBelow != null && value <= alertBelow) return 'CRÍTICO'
  if (warnBelow != null && value <= warnBelow) return 'BAJO'
  return 'OK'
}

// Barra vertical (orientación original — compatible hacia atrás)
function VerticalBar({
  pct, warnPct, color,
}: { pct: number; warnPct: number | null; color: string }) {
  return (
    <div
      style={{
        position: 'relative' as const,
        width: 32,
        height: 100,
        background: 'var(--border, #3C3330)',
        borderRadius: 4,
        border: '1px solid var(--border)',
        overflow: 'hidden' as const,
      }}
    >
      <div
        className="linear-fill"
        style={{
          position: 'absolute', bottom: 0, left: 0, width: '100%',
          height: `${pct}%`,
          background: color,
          transition: 'height 0.4s ease',
          borderRadius: '0 0 3px 3px',
        }}
      />
      {warnPct != null && (
        <div
          style={{
            position: 'absolute', bottom: `${warnPct}%`, left: 0, width: '100%',
            height: 1,
            background: 'var(--warn)',
            opacity: 0.7,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}

// Barra horizontal (orientación nueva)
function HorizontalBar({
  pct, warnPct, color, barHeight,
}: { pct: number; warnPct: number | null; color: string; barHeight: number }) {
  return (
    <div
      style={{
        position: 'relative' as const,
        width: '100%',
        height: barHeight,
        background: 'var(--border, #3C3330)',
        borderRadius: 4,
        overflow: 'hidden' as const,
      }}
    >
      <div
        className="linear-fill"
        style={{
          position: 'absolute', top: 0, left: 0, height: '100%',
          width: `${pct}%`,
          background: color,
          transition: 'width 0.4s ease',
          borderRadius: '3px 0 0 3px',
        }}
      />
      {warnPct != null && (
        <div
          style={{
            position: 'absolute', left: `${warnPct}%`, top: 0, height: '100%',
            width: 1,
            background: 'var(--warn)',
            opacity: 0.7,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}

export default function LinearGauge({
  value, min, max, label,
  unit: _unit = '',
  warnBelow, alertBelow,
  warnAbove, alertAbove,
  height = 8,
  orientation = 'vertical',
  colorOverride,
}: LinearGaugeProps) {
  if (import.meta.env.DEV && warnBelow != null && alertBelow != null && alertBelow >= warnBelow) {
    console.warn(`LinearGauge "${label}": alertBelow (${alertBelow}) must be < warnBelow (${warnBelow})`)
  }

  // Treat NaN as null so gauge renders in "no data" state
  const safeValue = value != null && !Number.isNaN(value) ? value : null
  const range = max - min
  const pct = safeValue == null || range === 0
    ? 0
    : Math.round(Math.max(0, Math.min(1, (safeValue - min) / range)) * 100)

  const color = linearColor(safeValue, warnBelow, alertBelow, warnAbove, alertAbove, colorOverride)
  const status = linearStatus(safeValue, warnBelow, alertBelow, warnAbove, alertAbove)

  // Posición del umbral de aviso en la barra (para la línea indicadora)
  const warnPct = warnBelow != null && range !== 0
    ? Math.round(Math.max(0, Math.min(1, (warnBelow - min) / range)) * 100)
    : warnAbove != null && range !== 0
      ? Math.round(Math.max(0, Math.min(1, (warnAbove - min) / range)) * 100)
      : null

  return (
    <div style={cardStyle} aria-label={label}>
      {/* Label superior — permite wrap a 2 líneas */}
      <div style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 9,
        color: 'var(--fg-muted)',
        letterSpacing: '0.8px',
        textTransform: 'uppercase' as const,
        textAlign: 'center' as const,
        lineHeight: 1.35,
        wordBreak: 'break-word' as const,
        width: '100%',
      }}>
        {label}
      </div>

      {/* Barra según orientación */}
      <div
        role="meter"
        aria-valuenow={safeValue ?? 0}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-label={label}
        style={orientation === 'horizontal' ? { width: '100%' } : undefined}
      >
        {orientation === 'horizontal' ? (
          <HorizontalBar pct={pct} warnPct={warnPct} color={color} barHeight={height} />
        ) : (
          <VerticalBar pct={pct} warnPct={warnPct} color={color} />
        )}
      </div>

      {/* Valor numérico */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 20,
        fontWeight: 700,
        color,
      }}>
        {safeValue != null ? `${pct}%` : '—'}
      </div>

      {/* Estado textual */}
      {safeValue != null && (
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          color,
          marginTop: 2,
        }}>
          {status}
        </div>
      )}
    </div>
  )
}
