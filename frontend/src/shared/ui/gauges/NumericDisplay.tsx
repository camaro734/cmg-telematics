interface NumericDisplayProps {
  value: number | null
  unit: string
  label: string
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

// Formatea el valor: enteros sin decimales, floats con 1 decimal, null como guión
function formatValue(value: number | null): string {
  if (value == null) return '—'
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(1)
}

export default function NumericDisplay({ value, unit, label }: NumericDisplayProps) {
  const displayValue = formatValue(value)

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
        fontSize: 34,
        fontWeight: 700,
        color: 'var(--text-primary)',
        lineHeight: 1,
      }}>
        {displayValue}
      </div>

      {/* Unidad */}
      <div style={{
        fontFamily: 'var(--font-data)',
        fontSize: 9,
        color: 'var(--text-secondary)',
        marginTop: 6,
      }}>
        {unit}
      </div>
    </div>
  )
}
