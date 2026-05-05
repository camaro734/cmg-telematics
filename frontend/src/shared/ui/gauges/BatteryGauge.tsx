interface BatteryGaugeProps {
  value: number | null
  min: number
  max: number
  label: string
  unit?: string
  warnBelow?: number
  alertBelow?: number
  // Props modernas opcionales
  voltage?: number
  minVoltage?: number
  maxVoltage?: number
  charging?: boolean
  size?: number
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

function batteryColor(value: number | null, warnBelow?: number, alertBelow?: number): string {
  if (value == null) return 'var(--accent-off)'
  if (alertBelow != null && value <= alertBelow) return 'var(--accent-crit)'
  if (warnBelow != null && value <= warnBelow) return 'var(--accent-warn)'
  return 'var(--accent-energy)'
}

function batteryStatus(value: number | null, warnBelow?: number, alertBelow?: number): string {
  if (value == null) return '—'
  if (alertBelow != null && value <= alertBelow) return 'BAJA'
  if (warnBelow != null && value <= warnBelow) return 'ADVERTENCIA'
  return 'OK'
}

// Símbolo de rayo SVG para el estado "cargando"
function ChargingBolt() {
  return (
    <svg
      width="12" height="18"
      viewBox="0 0 12 18"
      style={{
        position: 'absolute' as const,
        left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)',
      }}
      aria-hidden="true"
    >
      <path
        d="M7 0L0 10h5l-2 8 9-12H7z"
        fill="#FFFFFF"
        opacity="0.9"
      />
    </svg>
  )
}

export default function BatteryGauge({
  value, min, max, label,
  unit = 'V',
  warnBelow, alertBelow,
  charging = false,
}: BatteryGaugeProps) {
  if (import.meta.env.DEV && warnBelow != null && alertBelow != null && alertBelow >= warnBelow) {
    console.warn(`BatteryGauge "${label}": alertBelow (${alertBelow}) must be < warnBelow (${warnBelow})`)
  }

  // Treat NaN as null so gauge renders in "no data" state
  const safeValue = value != null && !Number.isNaN(value) ? value : null
  const range = max - min
  const pct = safeValue == null || range === 0
    ? 0
    : Math.round(Math.max(0, Math.min(1, (safeValue - min) / range)) * 100)

  const color = batteryColor(safeValue, warnBelow, alertBelow)
  const status = batteryStatus(safeValue, warnBelow, alertBelow)
  const valueText = safeValue != null ? `${safeValue.toFixed(1)} ${unit}` : `— ${unit}`

  return (
    <div style={cardStyle} aria-label={label}>
      {/* Label superior — permite wrap a 2 líneas */}
      <div style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 9,
        color: 'var(--text-muted)',
        letterSpacing: '0.8px',
        textTransform: 'uppercase' as const,
        textAlign: 'center' as const,
        lineHeight: 1.35,
        wordBreak: 'break-word' as const,
        width: '100%',
      }}>
        {label}
      </div>

      {/* Cuerpo de la batería: rectángulo outline + terminal positivo */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div
          style={{
            position: 'relative' as const,
            width: 70, height: 26,
            border: '2px solid var(--bg-border)',
            borderRadius: 4,
            background: 'var(--bg-base)',
            overflow: 'hidden' as const,
          }}
          role="meter"
          aria-valuenow={safeValue ?? 0}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-label={label}
        >
          {/* Relleno proporcional — clase bat-fill para tests */}
          <div
            className="bat-fill"
            style={{
              width: `${pct}%`,
              height: '100%',
              background: color,
              transition: 'width 0.4s ease',
            }}
          />
          {/* Símbolo de carga cuando charging=true */}
          {charging && <ChargingBolt />}
        </div>
        {/* Terminal positivo */}
        <div style={{
          width: 4, height: 10,
          background: 'var(--bg-border)',
          borderRadius: '0 2px 2px 0',
        }} />
      </div>

      {/* Voltaje formateado */}
      <div style={{
        fontFamily: 'var(--font-data)',
        fontSize: 20,
        fontWeight: 700,
        color,
      }}>
        {valueText}
      </div>

      {/* Estado textual */}
      <div style={{
        fontFamily: 'var(--font-data)',
        fontSize: 9,
        color,
        marginTop: 4,
      }}>
        {status}
      </div>
    </div>
  )
}
