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
  sm: 20,
  md: 28,
  lg: 36,
}

// Colores por estado — usan variables CSS del design system
const STATUS_COLOR: Record<NumericStatus, string> = {
  normal:  '#FFFFFF',
  warn:    'var(--accent-energy)',   // naranja
  alert:   'var(--accent-crit)',     // rojo
  offline: 'var(--accent-off)',      // gris cálido
}

// Estilos de la tarjeta definidos a nivel de módulo (no por render)
const cardStyle = {
  background: 'var(--bg-surface)',
  borderRadius: 8,
  padding: '12px 16px',
  border: '1px solid var(--bg-elevated)',
  display: 'inline-flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  gap: 4,
  minWidth: 80,
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

  return (
    <div style={cardStyle} aria-label={label}>
      {/* Label superior */}
      <div style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 9,
        color: 'var(--text-muted)',
        letterSpacing: '0.8px',
        textTransform: 'uppercase' as const,
      }}>
        {label}
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
        fontSize: Math.round(fontSize * 0.35),
        color: '#78716C',
        marginTop: 4,
      }}>
        {unit}
      </div>
    </div>
  )
}
