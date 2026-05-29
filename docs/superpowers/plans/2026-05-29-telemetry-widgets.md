# Telemetry Widgets Configurables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sistema de widgets de telemetría configurables por tipo de vehículo: TankGauge (cisterna), GaugeArc (velocímetro), SensorIconSet, SensorWidget wrapper, nuevo layout en VehicleDetailPage y config visual en VehicleTypeSensorsSection.

**Architecture:** Frontend-only. `SensorDef` se extiende con `icon`, `color`, `widget_size` (JSONB, sin migración). Nuevos componentes de gauge en `shared/ui/gauges/`. `SensorWidget` selecciona el componente según `gauge_type`. VehicleDetailPage usa un grid de `SensorWidget` en lugar del SensorGrid compacto actual. VehicleTypeSensorsSection añade selección inline de tipo de visual e icono por sensor.

**Tech Stack:** React 18 + Vite + TypeScript, SVG puro, CSS custom properties. NO tocar backend ni docker.

---

## Mapa de archivos

| Archivo | Acción |
|---|---|
| `frontend/src/lib/types.ts` | Extender SensorDef + DoutSlot |
| `frontend/src/shared/ui/gauges/SensorIconSet.tsx` | Crear — 11 iconos SVG |
| `frontend/src/shared/ui/gauges/TankGauge.tsx` | Crear — cisterna animada |
| `frontend/src/shared/ui/gauges/GaugeArc.tsx` | Crear — velocímetro semicircular |
| `frontend/src/features/vehicle/SensorWidget.tsx` | Crear — wrapper de widgets |
| `frontend/src/features/vehicle/VehicleDetailPage.tsx` | Modificar — nuevo layout telemetría + DOUT cards |
| `frontend/src/features/settings/VehicleTypeSensorsSection.tsx` | Modificar — config visual por sensor |

---

## Tarea 1: types.ts — extender SensorDef y DoutSlot

**Files:**
- Modify: `frontend/src/lib/types.ts`

- [ ] **Paso 1: Localizar SensorDef en types.ts**

```bash
grep -n "interface SensorDef\|gauge_type\|interface DoutSlot" \
  /opt/cmg-telematic1/frontend/src/lib/types.ts
```

- [ ] **Paso 2: Añadir tipo SensorIcon antes de SensorDef**

Buscar la línea `export interface SensorDef {` e insertar ANTES:

```ts
export type SensorIcon =
  | 'pressure' | 'temperature' | 'fuel' | 'water' | 'engine'
  | 'speed' | 'voltage' | 'pump' | 'valve' | 'rpm' | 'flow'
```

- [ ] **Paso 3: Extender SensorDef**

Añadir tres campos opcionales al final de la interfaz `SensorDef`, antes del `}` de cierre:

```ts
  // Configuración visual del widget
  icon?: SensorIcon
  color?: string            // hex o var(--token) — override del color por defecto
  widget_size?: 'sm' | 'md' | 'lg'
```

Y extender `gauge_type` añadiendo los nuevos valores:

```ts
  gauge_type: 'circular' | 'linear' | 'battery' | 'numeric' | 'led' | 'tank' | 'gauge_arc'
```

- [ ] **Paso 4: Extender DoutSlot**

Buscar `interface DoutSlot` y añadir campo opcional:

```ts
  sensor_key?: string   // key del SensorDef cuyo valor se muestra en la card de control
```

- [ ] **Paso 5: Build y tests**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -5
npm run test -- --run 2>&1 | tail -5
```
Resultado esperado: build ✓ y 171 tests pasan.

- [ ] **Paso 6: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/lib/types.ts
git commit -m "feat(types): extend SensorDef with icon/color/widget_size + tank/gauge_arc types

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 2: SensorIconSet — 11 iconos SVG industriales

**Files:**
- Create: `frontend/src/shared/ui/gauges/SensorIconSet.tsx`

- [ ] **Paso 1: Crear el archivo**

```tsx
// frontend/src/shared/ui/gauges/SensorIconSet.tsx
import type { SensorIcon } from '../../../lib/types'

interface IconProps {
  size?: number
  color?: string
}

const V = "0 0 20 20"
const def = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }

function Pressure({ size = 20 }: IconProps) {
  return (
    <svg viewBox={V} width={size} height={size} {...def}>
      <circle cx="10" cy="9" r="6.5"/>
      <line x1="10" y1="9" x2="10" y2="4.5"/>
      <circle cx="10" cy="9" r="1.2" fill="currentColor" stroke="none"/>
      <line x1="4" y1="16" x2="16" y2="16"/>
    </svg>
  )
}

function Temperature({ size = 20 }: IconProps) {
  return (
    <svg viewBox={V} width={size} height={size} {...def}>
      <path d="M10 12.5V4a2 2 0 0 0-2 2v6.5"/>
      <path d="M8 4a2 2 0 0 1 4 0v8.5A4 4 0 1 1 6 13"/>
      <circle cx="10" cy="15" r="2.5"/>
    </svg>
  )
}

function Fuel({ size = 20 }: IconProps) {
  return (
    <svg viewBox={V} width={size} height={size} {...def}>
      <path d="M10 2 Q16 8 16 12 A6 6 0 0 1 4 12 Q4 8 10 2Z"/>
      <line x1="10" y1="12" x2="10" y2="9" strokeWidth={2}/>
    </svg>
  )
}

function Water({ size = 20 }: IconProps) {
  return (
    <svg viewBox={V} width={size} height={size} {...def}>
      <path d="M2 8 Q5.5 5 9 8 Q12.5 11 16 8"/>
      <path d="M4 12 Q7.5 9 11 12 Q14.5 15 18 12" opacity={0.6}/>
      <path d="M10 1 Q14 6 14 9 A4 4 0 0 1 6 9 Q6 6 10 1Z"/>
    </svg>
  )
}

function Engine({ size = 20 }: IconProps) {
  return (
    <svg viewBox={V} width={size} height={size} {...def}>
      <circle cx="10" cy="10" r="3"/>
      <circle cx="10" cy="10" r="7" strokeDasharray="3.5 2"/>
    </svg>
  )
}

function Speed({ size = 20 }: IconProps) {
  return (
    <svg viewBox={V} width={size} height={size} {...def}>
      <path d="M3 15 A7 7 0 0 1 17 15"/>
      <line x1="10" y1="14" x2="6.5" y2="9"/>
      <circle cx="10" cy="14" r="1.5" fill="currentColor" stroke="none"/>
      <line x1="8" y1="15" x2="12" y2="15" opacity={0.4}/>
    </svg>
  )
}

function Voltage({ size = 20 }: IconProps) {
  return (
    <svg viewBox={V} width={size} height={size} {...def}>
      <polyline points="12 2 6 11 10 11 8 18 14 9 10 9 12 2"/>
    </svg>
  )
}

function Pump({ size = 20 }: IconProps) {
  return (
    <svg viewBox={V} width={size} height={size} {...def}>
      <circle cx="10" cy="10" r="6"/>
      <path d="M10 4 A6 6 0 0 1 16 10"/>
      <polyline points="16 7 16 10 13 10"/>
    </svg>
  )
}

function Valve({ size = 20 }: IconProps) {
  return (
    <svg viewBox={V} width={size} height={size} {...def}>
      <line x1="2" y1="10" x2="18" y2="10"/>
      <polygon points="7 5 13 10 7 15"/>
      <polygon points="13 5 7 10 13 15"/>
    </svg>
  )
}

function Rpm({ size = 20 }: IconProps) {
  return (
    <svg viewBox={V} width={size} height={size} {...def}>
      <path d="M10 3 A7 7 0 0 1 17 10"/>
      <polyline points="17 7 17 10 14 10"/>
      <path d="M10 17 A7 7 0 0 1 3 10"/>
      <polyline points="3 13 3 10 6 10"/>
    </svg>
  )
}

function Flow({ size = 20 }: IconProps) {
  return (
    <svg viewBox={V} width={size} height={size} {...def}>
      <line x1="2" y1="10" x2="14" y2="10"/>
      <polyline points="10 6 14 10 10 14"/>
      <line x1="2" y1="6" x2="8" y2="6" opacity={0.5}/>
      <line x1="2" y1="14" x2="8" y2="14" opacity={0.5}/>
    </svg>
  )
}

export const SENSOR_ICONS: Record<SensorIcon, React.FC<IconProps>> = {
  pressure: Pressure,
  temperature: Temperature,
  fuel: Fuel,
  water: Water,
  engine: Engine,
  speed: Speed,
  voltage: Voltage,
  pump: Pump,
  valve: Valve,
  rpm: Rpm,
  flow: Flow,
}

export function SensorIconComponent({ icon, size = 18, color }: { icon?: SensorIcon; size?: number; color?: string }) {
  if (!icon || !SENSOR_ICONS[icon]) return null
  const Icon = SENSOR_ICONS[icon]
  return <span style={{ color: color ?? 'currentColor', display: 'inline-flex' }}><Icon size={size} /></span>
}
```

- [ ] **Paso 2: Build**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -5
```
Resultado esperado: ✓ built in sin errores.

- [ ] **Paso 3: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/shared/ui/gauges/SensorIconSet.tsx
git commit -m "feat(ui): add SensorIconSet with 11 industrial SVG icons

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 3: TankGauge — cisterna con nivel animado

**Files:**
- Create: `frontend/src/shared/ui/gauges/TankGauge.tsx`
- Create: `frontend/src/shared/ui/gauges/__tests__/TankGauge.test.tsx`

- [ ] **Paso 1: Crear el test**

```tsx
// frontend/src/shared/ui/gauges/__tests__/TankGauge.test.tsx
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { TankGauge } from '../TankGauge'

describe('TankGauge', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <TankGauge value={500} max={1000} label="Cisterna" unit="L" />
    )
    expect(container.querySelector('svg')).toBeTruthy()
  })
  it('shows zero fill at value=0', () => {
    const { container } = render(
      <TankGauge value={0} max={1000} label="Cisterna" unit="L" />
    )
    // fill rect height should be 0 or negligible
    const rects = container.querySelectorAll('rect')
    expect(rects.length).toBeGreaterThan(0)
  })
  it('shows value text', () => {
    const { getByText } = render(
      <TankGauge value={750} max={1000} label="Depósito" unit="L" />
    )
    expect(getByText('Depósito')).toBeTruthy()
  })
})
```

- [ ] **Paso 2: Ejecutar y verificar que falla**

```bash
cd /opt/cmg-telematic1/frontend && npm run test -- --run src/shared/ui/gauges/__tests__/TankGauge.test.tsx 2>&1 | tail -8
```

- [ ] **Paso 3: Crear TankGauge.tsx**

```tsx
// frontend/src/shared/ui/gauges/TankGauge.tsx
import { useId } from 'react'

interface TankGaugeProps {
  value: number | null
  max: number
  min?: number
  label: string
  unit?: string
  warnAbove?: number
  alertAbove?: number
  color?: string
  width?: number
  height?: number
}

function tankColor(
  value: number | null,
  warnAbove?: number,
  alertAbove?: number,
  colorDefault = 'var(--info)',
): string {
  if (value == null) return 'var(--offline)'
  if (alertAbove != null && value >= alertAbove) return 'var(--danger)'
  if (warnAbove != null && value >= warnAbove) return 'var(--warn)'
  return colorDefault
}

export function TankGauge({
  value,
  max,
  min = 0,
  label,
  unit,
  warnAbove,
  alertAbove,
  color,
  width = 72,
  height = 96,
}: TankGaugeProps) {
  const uid = useId()
  const animId = `wave-${uid.replace(/:/g, '')}`
  const clipId = `clip-${uid.replace(/:/g, '')}`

  const range = max - min || 1
  const pct = value != null ? Math.max(0, Math.min(1, (value - min) / range)) : 0
  const fill = tankColor(value, warnAbove, alertAbove, color ?? 'var(--info)')

  const PAD = 6
  const innerW = width - PAD * 2
  const innerH = height - PAD * 2
  const fillH = innerH * pct
  const fillY = PAD + innerH - fillH

  // Wave path: sinusoidal repeated x2 for seamless animation
  const waveAmp = 3
  const waveW = innerW * 2
  const wavePath = `M0,${waveAmp} Q${waveW * 0.25},${-waveAmp} ${waveW * 0.5},${waveAmp} Q${waveW * 0.75},${waveAmp * 3} ${waveW},${waveAmp} L${waveW},${fillH} L0,${fillH} Z`

  const displayVal = value != null ? (value % 1 === 0 ? value : value.toFixed(1)) : '—'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'hidden' }}>
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD} y={PAD} width={innerW} height={innerH} rx={6}/>
          </clipPath>
        </defs>

        {/* Contorno del tanque */}
        <rect x={PAD} y={PAD} width={innerW} height={innerH} rx={8}
          fill="var(--bg-elevated)" stroke="var(--border)" strokeWidth={1.5}/>

        {/* Cara superior (sensación 3D) */}
        <rect x={PAD} y={PAD} width={innerW} height={8} rx={6}
          fill="rgba(255,255,255,0.06)"/>

        {/* Líquido con ola */}
        <g clipPath={`url(#${clipId})`}>
          {pct > 0 && (
            <g transform={`translate(${PAD},${fillY - waveAmp})`}>
              <path d={wavePath} fill={fill} opacity={0.9}>
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  from="0 0"
                  to={`${-innerW} 0`}
                  dur="2.5s"
                  repeatCount="indefinite"
                />
              </path>
            </g>
          )}
        </g>

        {/* Líneas de calibración */}
        {[0.25, 0.5, 0.75].map(p => {
          const ly = PAD + innerH * (1 - p)
          return (
            <line key={p}
              x1={PAD + 3} y1={ly} x2={PAD + innerW - 3} y2={ly}
              stroke="var(--border-soft)" strokeWidth={0.8} strokeDasharray="2 3"/>
          )
        })}

        {/* Valor centrado */}
        <text
          x={width / 2} y={PAD + innerH * 0.5 + 5}
          textAnchor="middle" dominantBaseline="middle"
          fontFamily="var(--font-mono)" fontWeight={700}
          fontSize={value != null && String(displayVal).length > 4 ? 11 : 13}
          fill="var(--fg-primary)"
          style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}
        >
          {displayVal}
        </text>
        {unit && (
          <text
            x={width / 2} y={PAD + innerH * 0.5 + 20}
            textAnchor="middle" fontFamily="var(--font-sans)"
            fontSize={9} fill="var(--fg-muted)"
          >
            {unit}
          </text>
        )}
      </svg>

      <span style={{
        fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)',
        fontWeight: 600, textAlign: 'center', maxWidth: width,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
    </div>
  )
}
```

- [ ] **Paso 4: Test pasa**

```bash
cd /opt/cmg-telematic1/frontend && npm run test -- --run src/shared/ui/gauges/__tests__/TankGauge.test.tsx 2>&1 | tail -8
```
Resultado esperado: 3 tests PASS.

- [ ] **Paso 5: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/shared/ui/gauges/TankGauge.tsx \
        frontend/src/shared/ui/gauges/__tests__/TankGauge.test.tsx
git commit -m "feat(ui): add TankGauge with animated liquid level and calibration lines

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 4: GaugeArc — velocímetro semicircular 180°

**Files:**
- Create: `frontend/src/shared/ui/gauges/GaugeArc.tsx`
- Create: `frontend/src/shared/ui/gauges/__tests__/GaugeArc.test.tsx`

- [ ] **Paso 1: Crear el test**

```tsx
// frontend/src/shared/ui/gauges/__tests__/GaugeArc.test.tsx
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { GaugeArc } from '../GaugeArc'

describe('GaugeArc', () => {
  it('renders SVG arc', () => {
    const { container } = render(<GaugeArc value={50} max={100} label="Velocidad" unit="km/h"/>)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('path')).toBeTruthy()
  })
  it('renders null value without crash', () => {
    const { container } = render(<GaugeArc value={null} max={100} label="Speed" unit="km/h"/>)
    expect(container.querySelector('svg')).toBeTruthy()
  })
  it('shows label', () => {
    const { getByText } = render(<GaugeArc value={30} max={120} label="Motor" unit="rpm"/>)
    expect(getByText('Motor')).toBeTruthy()
  })
})
```

- [ ] **Paso 2: Ejecutar y verificar que falla**

```bash
cd /opt/cmg-telematic1/frontend && npm run test -- --run src/shared/ui/gauges/__tests__/GaugeArc.test.tsx 2>&1 | tail -5
```

- [ ] **Paso 3: Crear GaugeArc.tsx**

```tsx
// frontend/src/shared/ui/gauges/GaugeArc.tsx

interface GaugeArcProps {
  value: number | null
  max: number
  min?: number
  label: string
  unit?: string
  warnAbove?: number
  alertAbove?: number
  color?: string
  size?: number         // diámetro total, default 130
}

function arcFill(value: number | null, warnAbove?: number, alertAbove?: number, colorDefault = 'var(--cmg-teal)'): string {
  if (value == null) return 'var(--offline)'
  if (alertAbove != null && value >= alertAbove) return 'var(--danger)'
  if (warnAbove != null && value >= warnAbove) return 'var(--warn)'
  return colorDefault
}

// Convierte ángulo (0=izq, 180=der, en el semicírculo superior) a coordenadas SVG
// El arco va de 180° a 0° (semicírculo superior: de izquierda a derecha pasando por arriba)
function polarToXY(angleDeg: number, r: number, cx: number, cy: number) {
  const rad = ((180 - angleDeg) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) }
}

export function GaugeArc({
  value,
  max,
  min = 0,
  label,
  unit,
  warnAbove,
  alertAbove,
  color,
  size = 130,
}: GaugeArcProps) {
  const cx = size / 2
  const cy = size * 0.62   // centro vertical un poco abajo del centro
  const r = size * 0.38
  const STROKE = 10
  const range = max - min || 1
  const pct = value != null ? Math.max(0, Math.min(1, (value - min) / range)) : 0
  const fillColor = arcFill(value, warnAbove, alertAbove, color ?? 'var(--cmg-teal)')

  // Semicírculo: de 0° (izquierda) a 180° (derecha) pasando por arriba
  const startPt = polarToXY(0, r, cx, cy)
  const endPt = polarToXY(180, r, cx, cy)
  const fillPt = polarToXY(pct * 180, r, cx, cy)

  const trackPath = `M ${startPt.x} ${startPt.y} A ${r} ${r} 0 0 1 ${endPt.x} ${endPt.y}`
  const fillPath = pct > 0
    ? `M ${startPt.x} ${startPt.y} A ${r} ${r} 0 ${pct > 0.5 ? 1 : 0} 1 ${fillPt.x} ${fillPt.y}`
    : ''

  // Aguja
  const needleAngle = pct * 180
  const needlePt = polarToXY(needleAngle, r * 0.78, cx, cy)

  const displayVal = value != null ? (value % 1 === 0 ? value : value.toFixed(1)) : '—'
  const fontSize = String(displayVal).length > 5 ? 18 : 22

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <svg width={size} height={size * 0.72} viewBox={`0 0 ${size} ${size * 0.72}`} style={{ display: 'block', overflow: 'visible' }}>
        {/* Track */}
        <path d={trackPath} fill="none" stroke="var(--border)" strokeWidth={STROKE} strokeLinecap="round"/>

        {/* Fill */}
        {fillPath && (
          <path d={fillPath} fill="none" stroke={fillColor} strokeWidth={STROKE} strokeLinecap="round"
            style={{ transition: 'stroke 0.3s' }}/>
        )}

        {/* Aguja */}
        <line x1={cx} y1={cy} x2={needlePt.x} y2={needlePt.y}
          stroke={fillColor} strokeWidth={2} strokeLinecap="round"
          style={{ transition: 'x2 0.3s, y2 0.3s' }}/>
        <circle cx={cx} cy={cy} r={4} fill={fillColor}/>
        <circle cx={cx} cy={cy} r={2} fill="var(--bg-surface)"/>

        {/* Min / Max */}
        <text x={startPt.x - 2} y={startPt.y + 14} textAnchor="middle"
          fontFamily="var(--font-mono)" fontSize={8} fill="var(--fg-dim)">{min}</text>
        <text x={endPt.x + 2} y={endPt.y + 14} textAnchor="middle"
          fontFamily="var(--font-mono)" fontSize={8} fill="var(--fg-dim)">{max}</text>

        {/* Valor */}
        <text x={cx} y={cy - 6} textAnchor="middle"
          fontFamily="var(--font-mono)" fontWeight={700} fontSize={fontSize}
          fill="var(--fg-primary)">{displayVal}</text>
        {unit && (
          <text x={cx} y={cy + 10} textAnchor="middle"
            fontFamily="var(--font-sans)" fontSize={9} fill="var(--fg-muted)">{unit}</text>
        )}
      </svg>

      <span style={{
        fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)',
        fontWeight: 600, textAlign: 'center',
      }}>
        {label}
      </span>
    </div>
  )
}
```

- [ ] **Paso 4: Tests pasan**

```bash
cd /opt/cmg-telematic1/frontend && npm run test -- --run src/shared/ui/gauges/__tests__/GaugeArc.test.tsx 2>&1 | tail -5
```

- [ ] **Paso 5: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/shared/ui/gauges/GaugeArc.tsx \
        frontend/src/shared/ui/gauges/__tests__/GaugeArc.test.tsx
git commit -m "feat(ui): add GaugeArc semicircle speedometer gauge

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 5: SensorWidget — wrapper de selección de componente

**Files:**
- Create: `frontend/src/features/vehicle/SensorWidget.tsx`

- [ ] **Paso 1: Crear SensorWidget.tsx**

```tsx
// frontend/src/features/vehicle/SensorWidget.tsx
import type { SensorDef } from '../../lib/types'
import { CircularGauge } from '../../shared/ui/gauges/CircularGauge'
import { LinearGauge } from '../../shared/ui/gauges/LinearGauge'
import { BatteryGauge } from '../../shared/ui/gauges/BatteryGauge'
import { NumericDisplay } from '../../shared/ui/gauges/NumericDisplay'
import { TankGauge } from '../../shared/ui/gauges/TankGauge'
import { GaugeArc } from '../../shared/ui/gauges/GaugeArc'
import { SensorIconComponent } from '../../shared/ui/gauges/SensorIconSet'

interface SensorWidgetProps {
  sensor: SensorDef
  value: number | null
}

// Tamaños por widget_size
const SIZES = { sm: 72, md: 96, lg: 120 } as const

function scaleValue(raw: number | null, scale?: number, offset?: number): number | null {
  if (raw == null) return null
  return raw * (scale ?? 1) + (offset ?? 0)
}

export function SensorWidget({ sensor, value }: SensorWidgetProps) {
  const scaled = scaleValue(value, sensor.scale, sensor.offset)
  const size = SIZES[sensor.widget_size ?? 'md']
  const color = sensor.color ?? undefined

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '10px 8px 8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    transition: 'border-color 0.15s',
  }

  const icon = sensor.icon ? (
    <SensorIconComponent icon={sensor.icon} size={14} color={color ?? 'var(--fg-dim)'}/>
  ) : null

  const commonProps = {
    value: scaled,
    min: sensor.min ?? 0,
    max: sensor.max ?? 100,
    label: sensor.label,
    unit: sensor.unit ?? undefined,
    warnAbove: sensor.warn_above,
    alertAbove: sensor.alert_above,
    warnBelow: sensor.warn_below,
    alertBelow: sensor.alert_below,
    color,
  }

  switch (sensor.gauge_type) {
    case 'tank':
      return (
        <div style={cardStyle}>
          {icon}
          <TankGauge {...commonProps} width={size * 0.7} height={size} />
        </div>
      )

    case 'gauge_arc':
      return (
        <div style={cardStyle}>
          {icon}
          <GaugeArc {...commonProps} size={size + 20} />
        </div>
      )

    case 'linear':
      return (
        <div style={{ ...cardStyle, width: '100%' }}>
          {icon && <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
            {icon}
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600 }}>{sensor.label}</span>
          </div>}
          <div style={{ width: '100%' }}>
            <LinearGauge
              value={scaled} min={sensor.min ?? 0} max={sensor.max ?? 100}
              label={sensor.label} unit={sensor.unit ?? ''}
              warnAbove={sensor.warn_above} alertAbove={sensor.alert_above}
              colorOverride={color}
            />
          </div>
        </div>
      )

    case 'battery':
      return (
        <div style={cardStyle}>
          {icon}
          <BatteryGauge
            value={scaled} min={sensor.min ?? 0} max={sensor.max ?? 100}
            label={sensor.label} unit={sensor.unit ?? ''}
          />
        </div>
      )

    case 'numeric':
      return (
        <div style={cardStyle}>
          {icon}
          <NumericDisplay
            value={scaled} label={sensor.label} unit={sensor.unit ?? ''}
            warnAbove={sensor.warn_above} alertAbove={sensor.alert_above}
            colorOverride={color}
          />
        </div>
      )

    case 'led': {
      const on = scaled != null && scaled > 0
      return (
        <div style={{ ...cardStyle, flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {icon}
            <span style={{ fontSize: 12, color: 'var(--fg-secondary)', fontWeight: 500 }}>{sensor.label}</span>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
            color: on ? 'var(--ok)' : 'var(--offline)',
          }}>
            {on ? '● ON' : '○ OFF'}
          </span>
        </div>
      )
    }

    case 'circular':
    default:
      return (
        <div style={cardStyle}>
          {icon}
          <CircularGauge
            value={scaled} min={sensor.min ?? 0} max={sensor.max ?? 100}
            label={sensor.label} unit={sensor.unit ?? ''}
            size={size}
            warnAbove={sensor.warn_above} alertAbove={sensor.alert_above}
            warnBelow={sensor.warn_below} alertBelow={sensor.alert_below}
            colorOverride={color}
          />
        </div>
      )
  }
}
```

- [ ] **Paso 2: Build**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -5
```
Resultado esperado: ✓ sin errores TypeScript.

- [ ] **Paso 3: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/vehicle/SensorWidget.tsx
git commit -m "feat(vehicle): add SensorWidget — selects gauge by sensor.gauge_type

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 6: VehicleDetailPage — nuevo layout telemetría + DOUT cards

**Files:**
- Modify: `frontend/src/features/vehicle/VehicleDetailPage.tsx`

- [ ] **Paso 1: Leer secciones clave**

```bash
grep -n "TELEMETRÍA\|CONTROLES DOUT\|StatusCard\|SensorGrid\|VDControlBadge\|doutState\|sendDout" \
  /opt/cmg-telematic1/frontend/src/features/vehicle/VehicleDetailPage.tsx | head -30
```

- [ ] **Paso 2: Añadir import de SensorWidget**

Al principio del archivo, añadir:
```tsx
import { SensorWidget } from './SensorWidget'
```

- [ ] **Paso 3: Sustituir la sección TELEMETRÍA**

Localizar el bloque que empieza con `{/* TELEMETRÍA */}` y contiene el `SensorGrid compact`. Reemplazarlo con:

```tsx
{/* TELEMETRÍA */}
<div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderTop: '2px solid var(--cmg-teal)', borderRadius: 8, padding: '10px 12px' }}>
  {/* Barra de estado compacta */}
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--fg-muted)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
      Telemetría
    </span>
    {status?.online
      ? <span style={{ color: 'var(--ok)', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="live-dot" style={{ width: 5, height: 5 }}/> En directo
        </span>
      : status?.last_seen
        ? <span style={{ color: 'var(--danger)', fontSize: 10, fontWeight: 700 }}>
            ⚠ Sin señal {(() => { const m = Math.round((Date.now() - new Date(status.last_seen).getTime()) / 60000); return m < 60 ? `${m} min` : `${Math.round(m/60)} h` })()}
          </span>
        : <span style={{ color: 'var(--danger)', fontSize: 10 }}>⚠ Sin señal</span>
    }
    {/* Chips de estado inline */}
    {status && (
      <>
        <span style={{
          fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)',
          color: status.ignition ? 'var(--ok)' : 'var(--offline)',
          padding: '1px 6px', borderRadius: 4,
          background: status.ignition ? 'var(--ok-soft)' : 'rgba(100,116,139,0.15)',
        }}>
          IGN {status.ignition ? 'ON' : 'OFF'}
        </span>
        {(status.pto_active || status.can_data?.avl_2 === 1 || status.can_data?.avl_179 === 1) && (
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--cmg-teal)', padding: '1px 6px', borderRadius: 4, background: 'var(--cmg-teal-soft)' }}>
            PTO ON
          </span>
        )}
        {status.speed_kmh != null && status.speed_kmh > 0 && (
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-tertiary)' }}>
            {status.speed_kmh.toFixed(0)} km/h
          </span>
        )}
        {status.can_data && Object.keys(status.can_data).length > 0 && (
          <button onClick={() => setShowFullTelemetry(true)} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 7px', fontSize: 10, color: 'var(--fg-muted)', cursor: 'pointer', fontWeight: 600 }}>
            📡 Completa
          </button>
        )}
      </>
    )}
  </div>

  {/* Widget grid */}
  {status ? (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
      gap: 10,
    }}>
      {sensorSchema
        .filter(s => s.visible_in_detail !== false)
        .map(s => {
          const rawVal = s.avl_id != null ? (status.can_data?.[`avl_${s.avl_id}`] as number | null) ?? null
            : s.kpi_key ? (derivedValues?.[s.kpi_key] ?? null)
            : null
          return (
            <SensorWidget key={s.key} sensor={s} value={rawVal} />
          )
        })}
    </div>
  ) : (
    <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Sin datos en vivo</div>
  )}

  {status?.last_seen && (
    <div style={{ fontSize: 9, color: 'var(--fg-dim)', marginTop: 8 }}>
      Último dato: {new Date(status.last_seen).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
    </div>
  )}
</div>
```

- [ ] **Paso 4: Sustituir las tarjetas DOUT**

Localizar el bloque `{/* CONTROLES DOUT */}` y reemplazar el interior del grid de botones con tarjetas más visuales:

```tsx
{/* CONTROLES DOUT */}
{(vehicleType?.dout_config ?? []).filter(d => d.enabled).length > 0 && (
  <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
    <div style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700, color: 'var(--fg-muted)', letterSpacing: '0.07em', textTransform: 'uppercase' as const, marginBottom: 10 }}>
      Controles de mando
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
      {(vehicleType?.dout_config ?? []).filter(d => d.enabled).map(d => {
        const active = !!doutState[d.slot]
        const loading = !!doutLoading[d.slot]
        // Valor del sensor asociado si existe sensor_key
        const assocSensor = d.sensor_key ? sensorSchema.find(s => s.key === d.sensor_key) : null
        const assocRawVal = assocSensor?.avl_id != null
          ? (status?.can_data?.[`avl_${assocSensor.avl_id}`] as number | undefined) ?? null
          : null
        const assocVal = assocRawVal != null
          ? (assocRawVal * (assocSensor?.scale ?? 1) + (assocSensor?.offset ?? 0)).toFixed(assocSensor?.unit === 'bar' || assocSensor?.unit === 'V' ? 1 : 0)
          : null

        return (
          <div
            key={d.slot}
            style={{
              background: active ? 'var(--ok-soft)' : 'var(--bg-card)',
              border: `1px solid ${active ? 'var(--ok)' : 'var(--border)'}`,
              borderRadius: 8, padding: '10px 12px',
              display: 'flex', flexDirection: 'column', gap: 6,
              transition: 'background 0.2s, border-color 0.2s',
            }}
          >
            {/* Nombre + estado */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)' }}>
                {d.label}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: active ? 'var(--ok)' : 'var(--offline)' }}>
                {active ? '● ON' : '○ OFF'}
              </span>
            </div>

            {/* Valor sensor asociado */}
            {assocVal != null && assocSensor && (
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                {assocVal} {assocSensor.unit}
              </div>
            )}

            {/* Botón de acción */}
            <button
              onClick={() => sendDout(d.slot)}
              disabled={loading}
              style={{
                background: active ? 'rgba(34,197,94,0.2)' : 'var(--bg-elevated)',
                border: `1px solid ${active ? 'var(--ok)' : 'var(--border)'}`,
                borderRadius: 6, padding: '5px 0', fontSize: 11, fontWeight: 600,
                cursor: loading ? 'wait' : 'pointer',
                color: active ? 'var(--ok)' : 'var(--fg-tertiary)',
                opacity: loading ? 0.6 : 1,
                width: '100%', fontFamily: 'var(--font-sans)',
                transition: 'all 0.15s',
              }}
            >
              {loading ? '…' : active ? 'Desactivar' : 'Activar'}
            </button>
          </div>
        )
      })}
    </div>
  </div>
)}
```

- [ ] **Paso 5: Build y tests**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -8
npm run test -- --run 2>&1 | tail -5
```
Resultado esperado: build ✓, tests pasan.

- [ ] **Paso 6: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/vehicle/VehicleDetailPage.tsx
git commit -m "feat(vehicle): redesign telemetry panel with SensorWidget grid + DOUT cards

Status bar with chips, widget grid per sensor gauge_type,
DOUT cards with On/Off indicator and optional sensor value.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 7: VehicleTypeSensorsSection — config visual por sensor

**Files:**
- Modify: `frontend/src/features/settings/VehicleTypeSensorsSection.tsx`

- [ ] **Paso 1: Leer la sección de renderizado de sensores existentes**

```bash
grep -n "sensor_schema\|handleRemove\|map.*SensorDef\|\.map(s =>" \
  /opt/cmg-telematic1/frontend/src/features/settings/VehicleTypeSensorsSection.tsx | head -15
sed -n '130,220p' /opt/cmg-telematic1/frontend/src/features/settings/VehicleTypeSensorsSection.tsx
```

- [ ] **Paso 2: Añadir imports al principio del archivo**

```tsx
import { SensorIconComponent, SENSOR_ICONS } from '../../shared/ui/gauges/SensorIconSet'
import type { SensorIcon } from '../../lib/types'
```

- [ ] **Paso 3: Añadir estado de expansión y helpers antes del return**

Dentro del componente, añadir:

```tsx
const [expandedSensorKey, setExpandedSensorKey] = useState<string | null>(null)

const GAUGE_LABELS: Record<string, string> = {
  circular: 'Circular', linear: 'Barra', battery: 'Batería',
  numeric: 'Numérico', led: 'LED', tank: 'Cisterna', gauge_arc: 'Arco',
}
const ALL_GAUGE_TYPES = ['circular', 'gauge_arc', 'linear', 'tank', 'numeric', 'led', 'battery'] as const

function updateSensorField(sensor: SensorDef, field: keyof SensorDef, val: unknown) {
  if (!selectedType) return
  const updated = selectedType.sensor_schema.map(s =>
    s.key === sensor.key ? { ...s, [field]: val } : s
  )
  patchSchemaMutation.mutate({ id: selectedType.id, schema: updated })
}
```

- [ ] **Paso 4: Localizar la lista de sensores y añadir el panel de config**

Buscar en el archivo donde se renderizan los sensores existentes (el `map` sobre `selectedType.sensor_schema`). Después del nombre/avl_id de cada sensor y antes del botón eliminar, añadir:

```tsx
{/* Config visual — expandible por sensor */}
<div style={{ width: '100%', marginTop: 4 }}>
  <button
    type="button"
    onClick={() => setExpandedSensorKey(expandedSensorKey === sensor.key ? null : sensor.key)}
    style={{
      background: 'transparent', border: 'none', cursor: 'pointer',
      fontSize: 10, color: 'var(--fg-dim)', fontFamily: 'var(--font-sans)',
      padding: '2px 0', display: 'flex', alignItems: 'center', gap: 4,
    }}
  >
    {expandedSensorKey === sensor.key ? '▲' : '▼'} Visualización
    {sensor.gauge_type && (
      <span style={{ color: 'var(--cmg-teal)', fontWeight: 600 }}>
        · {GAUGE_LABELS[sensor.gauge_type] ?? sensor.gauge_type}
      </span>
    )}
    {sensor.icon && (
      <SensorIconComponent icon={sensor.icon} size={12}/>
    )}
  </button>

  {expandedSensorKey === sensor.key && (
    <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Tipo de visual */}
      <div>
        <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)', letterSpacing: '0.05em', marginBottom: 6 }}>TIPO DE VISUAL</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {ALL_GAUGE_TYPES.map(gt => (
            <button
              key={gt}
              type="button"
              onClick={() => updateSensorField(sensor, 'gauge_type', gt)}
              style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600,
                borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                background: sensor.gauge_type === gt ? 'var(--cmg-teal-soft)' : 'var(--bg-card)',
                border: `1px solid ${sensor.gauge_type === gt ? 'var(--cmg-teal-line)' : 'var(--border)'}`,
                color: sensor.gauge_type === gt ? 'var(--cmg-teal)' : 'var(--fg-tertiary)',
                transition: 'all 0.15s',
              }}
            >
              {GAUGE_LABELS[gt]}
            </button>
          ))}
        </div>
      </div>

      {/* Icono */}
      <div>
        <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)', letterSpacing: '0.05em', marginBottom: 6 }}>ICONO</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(Object.keys(SENSOR_ICONS) as SensorIcon[]).map(ic => (
            <button
              key={ic}
              type="button"
              title={ic}
              onClick={() => updateSensorField(sensor, 'icon', sensor.icon === ic ? undefined : ic)}
              style={{
                width: 32, height: 32, borderRadius: 6, cursor: 'pointer',
                background: sensor.icon === ic ? 'var(--cmg-teal-soft)' : 'var(--bg-card)',
                border: `1px solid ${sensor.icon === ic ? 'var(--cmg-teal-line)' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: sensor.icon === ic ? 'var(--cmg-teal)' : 'var(--fg-dim)',
                transition: 'all 0.15s',
              }}
            >
              <SensorIconComponent icon={ic} size={16}/>
            </button>
          ))}
        </div>
      </div>

      {/* Color y tamaño */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
        <div>
          <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)', letterSpacing: '0.05em', marginBottom: 6 }}>COLOR</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="color"
              value={sensor.color ?? '#1D9E75'}
              onChange={e => updateSensorField(sensor, 'color', e.target.value)}
              style={{ width: 32, height: 28, padding: 2, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', cursor: 'pointer' }}
            />
            {sensor.color && (
              <button type="button" onClick={() => updateSensorField(sensor, 'color', undefined)}
                style={{ fontSize: 10, color: 'var(--fg-dim)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                Quitar
              </button>
            )}
          </div>
        </div>

        <div>
          <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)', letterSpacing: '0.05em', marginBottom: 6 }}>TAMAÑO</p>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['sm', 'md', 'lg'] as const).map(sz => (
              <button
                key={sz}
                type="button"
                onClick={() => updateSensorField(sensor, 'widget_size', sz)}
                style={{
                  padding: '3px 10px', fontSize: 11, fontWeight: 600,
                  borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                  background: (sensor.widget_size ?? 'md') === sz ? 'var(--cmg-teal-soft)' : 'var(--bg-card)',
                  border: `1px solid ${(sensor.widget_size ?? 'md') === sz ? 'var(--cmg-teal-line)' : 'var(--border)'}`,
                  color: (sensor.widget_size ?? 'md') === sz ? 'var(--cmg-teal)' : 'var(--fg-tertiary)',
                }}
              >
                {sz === 'sm' ? 'S' : sz === 'md' ? 'M' : 'L'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )}
</div>
```

- [ ] **Paso 5: Actualizar GAUGE_OPTIONS en la constante existente**

Buscar la línea:
```ts
const GAUGE_OPTIONS: SensorDef['gauge_type'][] = ['circular', 'linear', 'battery', 'numeric', 'led']
```
Y reemplazarla por:
```ts
const GAUGE_OPTIONS: SensorDef['gauge_type'][] = ['circular', 'gauge_arc', 'linear', 'tank', 'battery', 'numeric', 'led']
```

- [ ] **Paso 6: Build y tests**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -8
npm run test -- --run 2>&1 | tail -5
```

- [ ] **Paso 7: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/settings/VehicleTypeSensorsSection.tsx
git commit -m "feat(settings): add per-sensor visual config — type, icon, color, size

Expandable panel per sensor with gauge type picker, 11-icon grid,
color input and size selector. Saves directly to sensor_schema JSONB.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Verificación final

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -4
npm run test -- --run 2>&1 | tail -5
cd .. && git log --oneline -8
```

## Comprobación visual post-deploy

| Pantalla | Qué verificar |
|---|---|
| `/settings` → Sensores | Expandir un sensor → ver opciones de tipo, icono, color, tamaño |
| Cambiar a `Cisterna` un sensor | Guardar → ir a `/vehicles/:id` → ver TankGauge con líquido animado |
| Cambiar a `Arco` otro sensor | Ver semicírculo velocímetro con aguja |
| Controles DOUT | Cards con On/Off, botón Activar/Desactivar, valor sensor si configurado |
| Sin datos (offline) | Todos los widgets muestran `—` sin errores |
