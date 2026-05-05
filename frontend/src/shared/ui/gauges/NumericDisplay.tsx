type NumericStatus = 'normal' | 'warn' | 'alert' | 'offline'
type NumericSize = 'sm' | 'md' | 'lg'

interface NumericDisplayProps {
  value: number | null | string
  unit: string
  label: string
  // Props modernas opcionales
  status?: NumericStatus
  size?: NumericSize
  precision?: number
}

// Tamaños de fuente por variante
const SIZE_MAP: Record<NumericSize, number> = {
  sm: 16,
  md: 22,
  lg: 28,
}

// Colores por estado — usan variables CSS del design system
const STATUS_COLOR: Record<NumericStatus, string> = {
  normal:  '#FFFFFF',
  warn:    'var(--accent-energy)',   // naranja
  alert:   'var(--accent-crit)',     // rojo
  offline: 'var(--accent-off)',      // gris cálido
}

// Estilos base de la tarjeta — border se calcula en render según status
const cardBaseStyle = {
  background: 'var(--bg-elevated)',
  borderRadius: 8,
  padding: '10px 14px',
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  gap: 4,
  minWidth: 90,
  position: 'relative' as const,
}

// Formatea el valor: entero → sin decimales, float → 1 decimal por defecto.
// Si se pasa un string, se devuelve tal cual.
// NaN se trata como sin datos para evitar mostrar "NaN" en pantalla.
function formatValue(value: number | null | string, precision?: number): string {
  if (value == null) return '—'
  if (typeof value === 'string') return value
  if (Number.isNaN(value)) return '—'
  if (precision != null) return value.toFixed(precision)
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(1)
}

export default function NumericDisplay({
  value, unit, label,
  status = 'normal',
  size = 'md',
  precision,
}: NumericDisplayProps) {
  const displayValue = formatValue(value, precision)
  const fontSize = SIZE_MAP[size]
  const valueColor = STATUS_COLOR[status]

  const isLive = value !== null && value !== undefined && !Number.isNaN(value)
  const borderColor = status === 'warn' ? 'color-mix(in srgb, var(--accent-warn) 30%, var(--bg-border))'
    : status === 'alert' ? 'color-mix(in srgb, var(--accent-crit) 30%, var(--bg-border))'
    : isLive ? 'color-mix(in srgb, var(--accent-info) 25%, var(--bg-border))'
    : 'var(--bg-border)'

  return (
    <div style={{ ...cardBaseStyle, border: `1px solid ${borderColor}` }} aria-label={label}>
      {/* Live indicator */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <div style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 9,
          color: 'var(--text-muted)',
          letterSpacing: '0.8px',
          textTransform: 'uppercase' as const,
          textAlign: 'center' as const,
          lineHeight: 1.35,
          wordBreak: 'break-word' as const,
          flex: 1,
        }}>
          {label}
        </div>
        {isLive && <span className="live-dot" />}
      </div>

      {/* Valor principal */}
      <div style={{
        fontFamily: 'var(--font-data)',
        fontSize,
        fontWeight: 700,
        color: valueColor,
        lineHeight: 1,
      }}>
        {displayValue}
      </div>

      {/* Unidad */}
      <div style={{
        fontFamily: 'var(--font-data)',
        fontSize: Math.round(fontSize * 0.42),
        color: 'var(--accent-off)',
        marginTop: 2,
      }}>
        {unit}
      </div>
    </div>
  )
}
