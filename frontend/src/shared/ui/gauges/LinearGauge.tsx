interface LinearGaugeProps {
  value: number | null
  min: number
  max: number
  unit: string
  label: string
  warnBelow?: number
  alertBelow?: number
}

// Estilos de la tarjeta definidos a nivel de módulo (no por render)
const cardStyle = {
  background: 'var(--bg-surface)',
  borderRadius: 8,
  padding: 8,
  border: '1px solid var(--bg-elevated)',
  display: 'inline-flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  gap: 6,
}

const barContainerStyle = {
  position: 'relative' as const,
  width: 32,
  height: 100,
  background: 'var(--gauge-track, #3C3330)',
  borderRadius: 4,
  border: '1px solid var(--bg-border)',
  overflow: 'visible' as const,
}

const barInnerStyle = {
  position: 'relative' as const,
  width: '100%',
  height: '100%',
  borderRadius: 4,
  overflow: 'hidden' as const,
}

function linearColor(value: number | null, warnBelow?: number, alertBelow?: number): string {
  if (value == null) return 'var(--accent-off)'
  if (alertBelow != null && value <= alertBelow) return 'var(--accent-crit)'
  if (warnBelow != null && value <= warnBelow) return 'var(--accent-warn)'
  return 'var(--accent-energy)'
}

function linearStatus(value: number | null, warnBelow?: number, alertBelow?: number): string {
  if (value == null) return '—'
  if (alertBelow != null && value <= alertBelow) return 'CRÍTICO'
  if (warnBelow != null && value <= warnBelow) return 'BAJO'
  return 'OK'
}

export default function LinearGauge({
  value, min, max, unit, label,
  warnBelow, alertBelow,
}: LinearGaugeProps) {
  // Guardia: rango cero evita división por cero
  const range = max - min
  const pct = value == null || range === 0
    ? 0
    : Math.round(Math.max(0, Math.min(1, (value - min) / range)) * 100)

  const color = linearColor(value, warnBelow, alertBelow)
  const status = linearStatus(value, warnBelow, alertBelow)
  const valueText = value != null ? `${pct}%` : '—'

  // Posición de la línea de advertencia como porcentaje desde el fondo
  const warnPct = warnBelow != null && range !== 0
    ? Math.round(Math.max(0, Math.min(1, (warnBelow - min) / range)) * 100)
    : null

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

      {/* Barra vertical */}
      <div style={barContainerStyle}>
        <div style={barInnerStyle}>
          {/* Relleno que crece desde abajo */}
          <div
            className="linear-fill"
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              width: '100%',
              height: `${pct}%`,
              background: color,
              transition: 'height 0.3s',
            }}
          />
        </div>

        {/* Línea de umbral de advertencia */}
        {warnPct != null && (
          <div
            style={{
              position: 'absolute',
              bottom: `${warnPct}%`,
              left: 0,
              width: '100%',
              height: 1,
              background: 'var(--accent-warn)',
              opacity: 0.7,
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      {/* Valor porcentual */}
      <div style={{
        fontFamily: 'var(--font-data)',
        fontSize: 20,
        fontWeight: 700,
        color,
      }}>
        {valueText}
      </div>

      {/* Estado — solo se muestra cuando hay valor */}
      {value != null && (
        <div style={{
          fontFamily: 'var(--font-data)',
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
