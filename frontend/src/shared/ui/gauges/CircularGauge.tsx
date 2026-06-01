interface CircularGaugeProps {
  value: number | null
  min: number
  max: number
  unit: string
  label: string
  size?: number
  warnAbove?: number
  alertAbove?: number
  warnBelow?: number
  alertBelow?: number
  // Alias modernos (compatibles con diseño nuevo)
  warnThreshold?: number
  critThreshold?: number
  colorOverride?: string
}

// ── Speedometer moderno — arco de 240° con stroke-dasharray ─────────────────
//
// Geometría del arco:
//   - El arco completo abarca 240° (de -210° a +30° respecto al eje X positivo).
//   - Esto coloca el inicio en la esquina inferior-izquierda y el final en la
//     inferior-derecha, como un velocímetro real.
//   - Para un círculo completo: circumference = 2π·r
//   - Para un arco de 240°: arcLength = circumference × (240/360)
//   - El offset para el arco vacío: dashoffset = arcLength (oculta todo el arco)
//   - El arco SVG empieza a las 3 en punto (0°) y avanza en sentido horario.
//     Rotamos el grupo SVG -210° para que el inicio quede abajo-izquierda.
//
// Marcas de escala:
//   - TICK_COUNT marcas distribuidas uniformemente sobre los 240°
//   - Calculadas en coordenadas polares dentro del grupo rotado

const SWEEP_DEG = 240        // arco total en grados
const ROTATION_DEG = -210    // rotación para colocar inicio abajo-izquierda
const STROKE_W = 14          // grosor del arco (track y fill)
const TICK_COUNT = 5         // número de marcas en la escala

const cardStyle = {
  background: 'var(--bg-surface)',
  borderRadius: 10,
  padding: '10px 8px 6px',
  textAlign: 'center' as const,
  border: '1px solid var(--bg-elevated)',
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
}

// Calcula el color del arco según umbrales.
// Usa variables CSS del design system para que los tests de atributo stroke
// puedan comparar con 'var(--cmg-teal)', 'var(--warn)', etc.
function arcColor(
  value: number | null,
  warnAbove?: number,
  alertAbove?: number,
  warnBelow?: number,
  alertBelow?: number,
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

// Convierte grados polares a coordenadas cartesianas (origen en cx, cy)
function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = angleDeg * Math.PI / 180
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  }
}

// Divide un label largo en hasta 2 líneas para SVG
function splitSvgLabel(text: string, maxCharsPerLine = 15): [string, string | null] {
  const upper = text.toUpperCase()
  if (upper.length <= maxCharsPerLine) return [upper, null]
  // Buscar espacio cerca del punto medio
  const mid = Math.ceil(upper.length / 2)
  let breakAt = -1
  for (let i = mid; i >= 1; i--) {
    if (upper[i] === ' ') { breakAt = i; break }
  }
  if (breakAt === -1) {
    for (let i = mid + 1; i < upper.length; i++) {
      if (upper[i] === ' ') { breakAt = i; break }
    }
  }
  if (breakAt === -1) return [upper.slice(0, maxCharsPerLine), upper.slice(maxCharsPerLine)]
  return [upper.slice(0, breakAt), upper.slice(breakAt + 1)]
}

// Genera las marcas de escala como elementos SVG <line>
function ScaleTicks({ cx, cy, r, strokeW }: { cx: number; cy: number; r: number; strokeW: number }) {
  const marks = []
  // Las marcas se distribuyen de 0° a SWEEP_DEG dentro del espacio del grupo rotado.
  for (let i = 0; i <= TICK_COUNT; i++) {
    const angleDeg = (i / TICK_COUNT) * SWEEP_DEG
    const rOuter = r + strokeW / 2 + 4
    const rInner = r + strokeW / 2 + 1
    const outer = polar(cx, cy, rOuter, angleDeg)
    const inner = polar(cx, cy, rInner, angleDeg)
    marks.push(
      <line
        key={i}
        x1={inner.x.toFixed(2)} y1={inner.y.toFixed(2)}
        x2={outer.x.toFixed(2)} y2={outer.y.toFixed(2)}
        stroke="var(--border)"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    )
  }
  return <>{marks}</>
}

export default function CircularGauge({
  value, min, max, unit, label,
  size = 140,
  warnAbove, alertAbove, warnBelow, alertBelow,
  warnThreshold, critThreshold,
  colorOverride,
}: CircularGaugeProps) {
  // Soporte para alias modernos (warnThreshold → warnAbove, critThreshold → alertAbove)
  const effectiveWarnAbove = warnAbove ?? warnThreshold
  const effectiveAlertAbove = alertAbove ?? critThreshold

  // Normalize value: treat NaN as null so gauge renders in "no data" state
  const safeValue = value != null && !Number.isNaN(value) ? value : null
  // hasValue: true solo cuando hay un valor por encima del mínimo (evita arco vacío en value=min)
  const hasValue = safeValue != null && safeValue > min
  // Guard against min === max to avoid division by zero
  const range = max - min || 1
  const pct = safeValue != null ? Math.max(0, Math.min(1, (safeValue - min) / range)) : 0

  // ── Geometría SVG ──────────────────────────────────────────────────────────
  // viewBox fija a 160×160 para tener espacio para las marcas externas
  const VB = 160
  const cx = VB / 2   // 80
  const cy = VB / 2   // 80

  // Radio del arco: deja margen para las marcas (strokeW/2 + 8px) y el borde (4px)
  const r = cx - STROKE_W / 2 - 12

  // Circunferencia completa y longitud del arco de 240°
  const circumference = 2 * Math.PI * r
  const arcLength = circumference * (SWEEP_DEG / 360)

  // Dashoffset para el arco de valor:
  //   dashoffset = arcLength × (1 - pct)  →  pct=0 oculta todo, pct=1 muestra todo
  const valueDashOffset = arcLength * (1 - pct)

  const color = arcColor(safeValue, effectiveWarnAbove, effectiveAlertAbove, warnBelow, alertBelow, colorOverride)

  // ── Posiciones del texto min/max en los extremos del arco ─────────────────
  // Los extremos del arco (tras la rotación del grupo) están en:
  //   inicio: ROTATION_DEG grados desde eje X+
  //   fin:    ROTATION_DEG + SWEEP_DEG grados desde eje X+
  const minAngleFinal = ROTATION_DEG
  const maxAngleFinal = ROTATION_DEG + SWEEP_DEG
  const labelR = r + STROKE_W / 2 + 10
  const minPos = polar(cx, cy, labelR, minAngleFinal)
  const maxPos = polar(cx, cy, labelR, maxAngleFinal)

  // Formato del valor: entero → sin decimales; float → 1 decimal
  const displayValue = safeValue != null
    ? (Number.isInteger(safeValue) ? String(safeValue) : safeValue.toFixed(1))
    : '—'

  return (
    <div style={cardStyle}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${VB} ${VB}`}
        aria-label={label}
      >
        {/* ── Grupo rotado para orientar el arco (inicio: abajo-izquierda) ── */}
        <g transform={`rotate(${ROTATION_DEG} ${cx} ${cy})`}>

          {/* Track de fondo — arco completo de 240° */}
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke="var(--border)"
            strokeWidth={STROKE_W}
            strokeLinecap="round"
            strokeDasharray={`${arcLength.toFixed(2)} ${circumference.toFixed(2)}`}
            strokeDashoffset={0}
          />

          {/* Arco de valor — clase g-val para tests */}
          <circle
            className="g-val"
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={color}
            strokeWidth={STROKE_W}
            strokeLinecap="round"
            strokeDasharray={`${arcLength.toFixed(2)} ${circumference.toFixed(2)}`}
            strokeDashoffset={hasValue ? valueDashOffset.toFixed(2) : arcLength.toFixed(2)}
            style={{ transition: 'stroke-dashoffset 0.4s ease, stroke 0.3s ease' }}
          />

          {/* Marcas de escala */}
          <ScaleTicks cx={cx} cy={cy} r={r} strokeW={STROKE_W} />

        </g>

        {/* Punto central activo — clase g-dot para tests */}
        {hasValue && (
          <circle
            className="g-dot"
            cx={cx} cy={cy} r={4}
            fill={color}
            style={{ transition: 'fill 0.3s ease' }}
          />
        )}

        {/* ── Texto: valor principal ── */}
        <text
          x={cx} y={cy + 8}
          textAnchor="middle"
          fontSize="30"
          fontWeight="700"
          fill={safeValue != null ? '#FFFFFF' : 'var(--fg-dim)'}
          fontFamily="var(--font-mono)"
        >
          {displayValue}
        </text>

        {/* ── Texto: "/ max unidad" debajo del valor ── */}
        <text
          x={cx} y={cy + 22}
          textAnchor="middle"
          fontSize="9"
          fill="var(--offline)"
          fontFamily="var(--font-mono)"
        >
          {`/ ${max} ${unit}`}
        </text>

        {/* ── Etiquetas min/max en los extremos del arco ── */}
        <text
          x={minPos.x.toFixed(2)} y={(minPos.y + 3).toFixed(2)}
          textAnchor="middle"
          fontSize="9"
          fill="var(--offline)"
          fontFamily="var(--font-mono)"
        >
          {min}
        </text>
        <text
          x={maxPos.x.toFixed(2)} y={(maxPos.y + 3).toFixed(2)}
          textAnchor="middle"
          fontSize="9"
          fill="var(--offline)"
          fontFamily="var(--font-mono)"
        >
          {max}
        </text>

        {/* ── Label del sensor (abajo, 1 o 2 líneas) ── */}
        {(() => {
          const [line1, line2] = splitSvgLabel(label)
          const textProps = {
            textAnchor: 'middle' as const,
            fontSize: '8',
            fill: 'var(--fg-muted)',
            fontFamily: 'var(--font-sans)',
            letterSpacing: '0.8',
          }
          if (!line2) {
            return <text x={cx} y={VB - 8} {...textProps}>{line1}</text>
          }
          return (
            <>
              <text x={cx} y={VB - 18} {...textProps}>{line1}</text>
              <text x={cx} y={VB - 7} {...textProps}>{line2}</text>
            </>
          )
        })()}
      </svg>
    </div>
  )
}
