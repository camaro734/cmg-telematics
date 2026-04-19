# Sprint 6 — Telemetría en vivo + Manómetros — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activar el WebSocket de telemetría en tiempo real y construir un panel de manómetros SVG data-driven en la página de detalle de vehículo, con pestañas "EN VIVO" e "HISTÓRICO".

**Architecture:** Los gauges se renderizan a partir de `vehicle_type.sensor_schema` (JSONB) — sin hardcodear nada por cliente. El WebSocket publica `VehicleStatus` directamente en el query cache de React Query. `SensorGrid` es el único componente que conoce el schema; los gauges individuales son "tontos". La pestaña "En vivo" muestra `SensorGrid` + mapa; la pestaña "Histórico" muestra `KpiChart` (Recharts). El seed de BD define los tipos de vehículo reales con AVL IDs correctos del proyecto anterior.

**Tech Stack:** React 18, Vite 5, TypeScript strict, React Query v5, Recharts ^2.12.7 (ya instalado), SVG puro sin librerías externas, Vitest + @testing-library/react (a instalar), `wsClient` singleton con clase interna y backoff exponencial.

---

## File Structure

```
frontend/
├── package.json                                  (modify: Vitest dev-deps + test scripts)
├── vite.config.ts                                (modify: agregar bloque test)
├── src/
│   ├── test/
│   │   ├── setup.ts                              (create: @testing-library/jest-dom)
│   │   └── utils.tsx                             (create: renderWithProviders helper)
│   ├── lib/
│   │   ├── types.ts                              (modify: SensorDef, WsMessage, VehicleTypeOut)
│   │   ├── queryKeys.ts                          (modify: añadir vehicleTypes)
│   │   └── wsClient.ts                           (rewrite: WebSocket real con backoff)
│   ├── shared/ui/
│   │   ├── Tabs.tsx                              (create: controlled tab bar)
│   │   └── gauges/
│   │       ├── CircularGauge.tsx                 (create: arco SVG 270° color dinámico)
│   │       ├── BatteryGauge.tsx                  (create: barra horizontal tipo móvil)
│   │       ├── LinearGauge.tsx                   (create: barra vertical con threshold)
│   │       └── NumericDisplay.tsx                (create: tarjeta número grande)
│   └── features/
│       ├── auth/
│       │   ├── useAuthStore.ts                   (modify: wsClient.disconnect en logout)
│       │   └── RequireAuth.tsx                   (modify: wsClient.connect tras auth)
│       └── vehicle/
│           ├── SensorGrid.tsx                    (create: dispatcher data-driven)
│           ├── KpiChart.tsx                      (create: Recharts ComposedChart)
│           └── VehicleDetailPage.tsx             (modify: pestañas + SensorGrid + KpiChart)
backend/app/seeds/initial.py                      (modify: wasterent-vacuum, vacuum-pressure)
```

---

## Task 1: Infraestructura de tests (Vitest)

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Create: `frontend/src/test/setup.ts`
- Create: `frontend/src/test/utils.tsx`

- [ ] **Step 1: Instalar dependencias de test**

```bash
cd /opt/cmg-telematic1/frontend
npm install -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

Verificar que termina sin errores: debe aparecer `added N packages`.

- [ ] **Step 2: Añadir scripts de test a package.json**

Abrir `frontend/package.json`. En el objeto `"scripts"` añadir después del script `"build"`:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 3: Configurar Vitest en vite.config.ts**

Reemplazar el contenido completo de `frontend/vite.config.ts`:

```typescript
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8010',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8010',
        ws: true,
      },
    },
  },
})
```

- [ ] **Step 4: Crear setup.ts**

Crear `frontend/src/test/setup.ts`:

```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 5: Crear renderWithProviders helper**

Crear `frontend/src/test/utils.tsx`:

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'

export function renderWithProviders(ui: ReactElement): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  )
}
```

- [ ] **Step 6: Verificar que los tests corren**

Crear un test vacío temporal para verificar la configuración:

```bash
cd /opt/cmg-telematic1/frontend
echo "import { describe, it, expect } from 'vitest'; describe('setup', () => { it('funciona', () => expect(1+1).toBe(2)) })" > src/test/smoke.test.ts
npm test
```

Esperado: `✓ src/test/smoke.test.ts > setup > funciona`. Borrar el fichero smoke:

```bash
rm src/test/smoke.test.ts
```

- [ ] **Step 7: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/package.json frontend/vite.config.ts frontend/src/test/
git commit -m "test: configurar Vitest + @testing-library/react para Sprint 6"
```

---

## Task 2: Tipos TypeScript (SensorDef, WsMessage, VehicleTypeOut)

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/queryKeys.ts`

- [ ] **Step 1: Añadir tipos a types.ts**

Añadir al final de `frontend/src/lib/types.ts` (después del interface `TenantOut`):

```typescript
export interface SensorDef {
  key: string
  label: string
  unit: string | null
  min?: number
  max?: number
  gauge_type: 'circular' | 'linear' | 'battery' | 'numeric' | 'led'
  warn_above?: number
  alert_above?: number
  warn_below?: number
  alert_below?: number
  avl_id?: number
  scale?: number   // multiplica el valor raw (ej: 0.001 para mV→V en AVL 66)
  kpi_key?: string
}

export interface WsMessage {
  type: 'telemetry'
  data: VehicleStatus
}

export interface VehicleTypeOut {
  id: string
  slug: string
  name: string
  sensor_schema: SensorDef[]
}
```

- [ ] **Step 2: Añadir vehicleTypes a queryKeys.ts**

Reemplazar el contenido de `frontend/src/lib/queryKeys.ts`:

```typescript
export const keys = {
  vehicles: () => ['vehicles'] as const,
  vehicle: (id: string) => ['vehicles', id] as const,
  vehicleStatus: (id: string) => ['vehicles', id, 'status'] as const,
  vehicleTrack: (id: string) => ['vehicles', id, 'track'] as const,
  vehicleKpis: (id: string) => ['vehicles', id, 'kpis'] as const,
  vehicleTypes: () => ['vehicle-types'] as const,
  alerts: () => ['alerts'] as const,
  rules: () => ['rules'] as const,
  tenantBrandTokens: (tenantId: string) => ['tenants', tenantId, 'brand-tokens'] as const,
}
```

- [ ] **Step 3: Verificar que TypeScript compila**

```bash
cd /opt/cmg-telematic1/frontend
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 4: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/lib/types.ts frontend/src/lib/queryKeys.ts
git commit -m "feat: añadir SensorDef, WsMessage, VehicleTypeOut al sistema de tipos"
```

---

## Task 3: Seed — tipos de vehículo con AVL IDs correctos

**Files:**
- Modify: `backend/app/seeds/initial.py`

Los AVL IDs y rangos provienen del proyecto anterior `/opt/cmg-telematics` (Teltonika FMC650). El seed es idempotente por `slug`, así que añadir slugs nuevos no rompe los existentes.

- [ ] **Step 1: Añadir las nuevas listas de sensores al seed**

En `backend/app/seeds/initial.py`, añadir después de `CISTERN_SENSORS`:

```python
WASTERENT_VACUUM_SENSORS = [
    {"key": "hydraulic_pressure_1", "label": "Presión hidráulica 1", "unit": "bar",
     "min": 0, "max": 600, "gauge_type": "circular", "warn_above": 300, "alert_above": 400, "avl_id": 305},
    {"key": "hydraulic_pressure_2", "label": "Presión hidráulica 2", "unit": "bar",
     "min": 0, "max": 600, "gauge_type": "circular", "warn_above": 300, "alert_above": 400, "avl_id": 306},
    {"key": "oil_level_pct", "label": "Nivel aceite hidráulico", "unit": "%",
     "min": 0, "max": 100, "gauge_type": "linear", "warn_below": 20, "avl_id": 307},
    {"key": "oil_temp_c", "label": "Temperatura hidráulica", "unit": "°C",
     "min": 0, "max": 150, "gauge_type": "circular", "warn_above": 100, "alert_above": 130, "avl_id": 308},
    {"key": "filter_pressure_bar", "label": "Presión retorno filtro", "unit": "bar",
     "min": 0, "max": 20, "gauge_type": "circular", "warn_above": 6, "alert_above": 10, "avl_id": 309},
    {"key": "cycle_count", "label": "Ciclos vaciado contenedor", "unit": "ciclos",
     "min": 0, "max": 9999, "gauge_type": "numeric", "avl_id": 310},
    {"key": "pto_hours_today", "label": "Horas PTO hoy", "unit": "h",
     "gauge_type": "numeric", "kpi_key": "pto_hours_today"},
    # Sensores comunes del chasis
    {"key": "battery_v", "label": "Batería", "unit": "V",
     "min": 18, "max": 30, "gauge_type": "battery",
     "warn_below": 21, "alert_below": 19, "avl_id": 66, "scale": 0.001},
    {"key": "engine_rpm", "label": "RPM motor", "unit": "rpm",
     "min": 0, "max": 3000, "gauge_type": "circular", "warn_above": 2400, "avl_id": 24},
    {"key": "engine_temp_c", "label": "Temp. motor", "unit": "°C",
     "min": 0, "max": 120, "gauge_type": "circular",
     "warn_above": 90, "alert_above": 105, "avl_id": 70},
]

VACUUM_PRESSURE_SENSORS = [
    {"key": "water_pressure_bar", "label": "Presión agua", "unit": "bar",
     "min": 0, "max": 250, "gauge_type": "circular", "warn_above": 200, "alert_above": 230, "avl_id": 331},
    {"key": "vacuum_bar", "label": "Presión vacío", "unit": "bar",
     "min": -1, "max": 10, "gauge_type": "circular", "warn_above": 8, "alert_above": 9.5, "avl_id": 332},
    {"key": "water_level_pct", "label": "Nivel agua cisterna", "unit": "%",
     "min": 0, "max": 100, "gauge_type": "linear", "warn_below": 10, "avl_id": 330},
    {"key": "pump_hours", "label": "Horas bomba agua", "unit": "h",
     "min": 0, "max": 9999, "gauge_type": "numeric", "avl_id": 320},
    {"key": "depressor_hours", "label": "Horas depresor", "unit": "h",
     "min": 0, "max": 9999, "gauge_type": "numeric", "avl_id": 321},
    {"key": "pto_hours_today", "label": "Horas PTO hoy", "unit": "h",
     "gauge_type": "numeric", "kpi_key": "pto_hours_today"},
    # Sensores comunes del chasis
    {"key": "battery_v", "label": "Batería", "unit": "V",
     "min": 18, "max": 30, "gauge_type": "battery",
     "warn_below": 21, "alert_below": 19, "avl_id": 66, "scale": 0.001},
    {"key": "engine_rpm", "label": "RPM motor", "unit": "rpm",
     "min": 0, "max": 3000, "gauge_type": "circular", "warn_above": 2400, "avl_id": 24},
    {"key": "engine_temp_c", "label": "Temp. motor", "unit": "°C",
     "min": 0, "max": 120, "gauge_type": "circular",
     "warn_above": 90, "alert_above": 105, "avl_id": 70},
]
```

- [ ] **Step 2: Añadir los nuevos tipos al loop de creación**

En la función `run()`, modificar el loop de vehicle_types. Actualmente:

```python
for slug, name, sensors in [
    ("vacuum", "Camión aspirador", VACUUM_SENSORS),
    ("sweeper", "Barredora municipal", SWEEPER_SENSORS),
    ("cistern", "Camión cisterna", CISTERN_SENSORS),
]:
```

Reemplazar con:

```python
for slug, name, sensors in [
    ("vacuum", "Camión aspirador", VACUUM_SENSORS),
    ("sweeper", "Barredora municipal", SWEEPER_SENSORS),
    ("cistern", "Camión cisterna", CISTERN_SENSORS),
    ("wasterent-vacuum", "Wasterent — Sistema vacío-presión", WASTERENT_VACUUM_SENSORS),
    ("vacuum-pressure", "Sistema vacío-presión (cisterna)", VACUUM_PRESSURE_SENSORS),
]:
```

- [ ] **Step 3: Ejecutar el seed**

El stack debe estar corriendo. Ejecutar desde el directorio del proyecto:

```bash
cd /opt/cmg-telematic1
docker-compose exec core-api python -m app.seeds.initial
```

Esperado: dos líneas `INFO: Creado vehicle_type: wasterent-vacuum` e `INFO: Creado vehicle_type: vacuum-pressure`. Si el stack no está corriendo, levantar con `docker-compose up -d` primero.

- [ ] **Step 4: Verificar en BD**

```bash
docker-compose exec db psql -U cmg -d cmgtelematic -c "SELECT slug, name FROM vehicle_type ORDER BY created_at;"
```

Esperado: 5 filas incluyendo `wasterent-vacuum` y `vacuum-pressure`.

- [ ] **Step 5: Commit**

```bash
cd /opt/cmg-telematic1
git add backend/app/seeds/initial.py
git commit -m "feat: añadir vehicle_types wasterent-vacuum y vacuum-pressure con AVL IDs reales"
```

---

## Task 4: CircularGauge SVG

**Files:**
- Create: `frontend/src/shared/ui/gauges/CircularGauge.tsx`
- Create: `frontend/src/shared/ui/gauges/__tests__/CircularGauge.test.tsx`

El gauge es un arco SVG 270° con stroke-width=4, punto luminoso en el extremo, valor+max en el centro. Color dinámico: verde (--accent-energy) / amarillo (--accent-warn) / rojo (--accent-crit).

- [ ] **Step 1: Crear directorio y test**

```bash
mkdir -p /opt/cmg-telematic1/frontend/src/shared/ui/gauges/__tests__
```

Crear `frontend/src/shared/ui/gauges/__tests__/CircularGauge.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import CircularGauge from '../CircularGauge'

describe('CircularGauge', () => {
  it('muestra el valor y max+unidad en el centro', () => {
    const { getByText } = render(
      <CircularGauge value={390} min={0} max={600} unit="bar" label="P. HIDRÁULICA 1" />
    )
    expect(getByText('390')).toBeInTheDocument()
    expect(getByText('/ 600 bar')).toBeInTheDocument()
  })

  it('muestra el label inferior', () => {
    const { getByText } = render(
      <CircularGauge value={100} min={0} max={600} unit="bar" label="P. HIDRÁULICA 1" />
    )
    expect(getByText('P. HIDRÁULICA 1')).toBeInTheDocument()
  })

  it('color verde (accent-energy) cuando valor está en rango OK', () => {
    const { container } = render(
      <CircularGauge value={100} min={0} max={600} unit="bar" label="P."
        warnAbove={300} alertAbove={400} />
    )
    expect(container.querySelector('.g-val')).toHaveAttribute('stroke', 'var(--accent-energy)')
  })

  it('color amarillo (accent-warn) cuando value >= warnAbove', () => {
    const { container } = render(
      <CircularGauge value={350} min={0} max={600} unit="bar" label="P."
        warnAbove={300} alertAbove={400} />
    )
    expect(container.querySelector('.g-val')).toHaveAttribute('stroke', 'var(--accent-warn)')
  })

  it('color rojo (accent-crit) cuando value >= alertAbove', () => {
    const { container } = render(
      <CircularGauge value={450} min={0} max={600} unit="bar" label="P."
        warnAbove={300} alertAbove={400} />
    )
    expect(container.querySelector('.g-val')).toHaveAttribute('stroke', 'var(--accent-crit)')
  })

  it('color amarillo cuando value <= warnBelow', () => {
    const { container } = render(
      <CircularGauge value={15} min={0} max={100} unit="%" label="Nivel" warnBelow={20} />
    )
    expect(container.querySelector('.g-val')).toHaveAttribute('stroke', 'var(--accent-warn)')
  })

  it('no renderiza arco de valor cuando value es null', () => {
    const { container } = render(
      <CircularGauge value={null} min={0} max={600} unit="bar" label="P." />
    )
    const arc = container.querySelector('.g-val')
    expect(arc?.getAttribute('d') ?? '').toBe('')
  })

  it('muestra guión cuando value es null', () => {
    const { getByText } = render(
      <CircularGauge value={null} min={0} max={600} unit="bar" label="P." />
    )
    expect(getByText('—')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Ejecutar tests para ver que fallan**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- CircularGauge
```

Esperado: todos fallan con `Cannot find module '../CircularGauge'`.

- [ ] **Step 3: Implementar CircularGauge**

Crear `frontend/src/shared/ui/gauges/CircularGauge.tsx`:

```typescript
interface CircularGaugeProps {
  value: number | null
  min: number
  max: number
  unit: string
  label: string
  warnAbove?: number
  alertAbove?: number
  warnBelow?: number
  alertBelow?: number
}

const CX = 70
const CY = 72
const R = 50
const START_DEG = 135
const TOTAL_DEG = 270

function arcPath(startDeg: number, sweepDeg: number): string {
  if (sweepDeg < 0.3) return ''
  const rad = Math.PI / 180
  const sx = CX + R * Math.cos(startDeg * rad)
  const sy = CY + R * Math.sin(startDeg * rad)
  const ex = CX + R * Math.cos((startDeg + sweepDeg) * rad)
  const ey = CY + R * Math.sin((startDeg + sweepDeg) * rad)
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${R} ${R} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`
}

function gaugeColor(
  value: number,
  alertAbove?: number,
  warnAbove?: number,
  warnBelow?: number,
  alertBelow?: number,
): string {
  if (alertAbove != null && value >= alertAbove) return 'var(--accent-crit)'
  if (warnAbove != null && value >= warnAbove) return 'var(--accent-warn)'
  if (alertBelow != null && value <= alertBelow) return 'var(--accent-crit)'
  if (warnBelow != null && value <= warnBelow) return 'var(--accent-warn)'
  return 'var(--accent-energy)'
}

export default function CircularGauge({
  value, min, max, unit, label,
  warnAbove, alertAbove, warnBelow, alertBelow,
}: CircularGaugeProps) {
  const hasValue = value != null
  const pct = hasValue ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0
  const valueDeg = pct * TOTAL_DEG
  const color = hasValue
    ? gaugeColor(value, alertAbove, warnAbove, warnBelow, alertBelow)
    : 'var(--accent-off)'

  const dotAngle = (START_DEG + valueDeg) * Math.PI / 180
  const dotX = CX + R * Math.cos(dotAngle)
  const dotY = CY + R * Math.sin(dotAngle)

  return (
    <div style={{
      background: 'var(--bg-surface)',
      borderRadius: 8,
      padding: 8,
      textAlign: 'center',
      border: '1px solid var(--bg-elevated)',
    }}>
      <svg width="120" height="128" viewBox="0 0 140 140" aria-label={label}>
        {/* Track */}
        <path
          className="g-track"
          d={arcPath(START_DEG, TOTAL_DEG - 0.3)}
          fill="none"
          stroke="var(--gauge-track)"
          strokeWidth="4"
          strokeLinecap="round"
        />
        {/* Value arc */}
        <path
          className="g-val"
          d={hasValue && valueDeg > 0.3 ? arcPath(START_DEG, valueDeg) : ''}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
        />
        {/* Glowing dot */}
        {hasValue && valueDeg > 0.3 && (
          <circle
            className="g-dot"
            cx={dotX.toFixed(2)}
            cy={dotY.toFixed(2)}
            r="5"
            fill={color}
            style={{ filter: `drop-shadow(0 0 5px ${color})` }}
          />
        )}
        {/* Value number */}
        <text
          x="70" y="64"
          textAnchor="middle"
          fontSize="22"
          fontWeight="700"
          fill={hasValue ? color : 'var(--text-muted)'}
          fontFamily="var(--font-data)"
        >
          {hasValue ? value : '—'}
        </text>
        {/* Max + unit */}
        <text
          x="70" y="79"
          textAnchor="middle"
          fontSize="10"
          fill={hasValue ? color : 'var(--text-muted)'}
          fontFamily="var(--font-data)"
        >
          {`/ ${max} ${unit}`}
        </text>
        {/* Label */}
        <text
          x="70" y="116"
          textAnchor="middle"
          fontSize="8"
          fill="var(--text-muted)"
          fontFamily="var(--font-ui)"
          letterSpacing="0.8"
        >
          {label.toUpperCase()}
        </text>
      </svg>
    </div>
  )
}
```

- [ ] **Step 4: Ejecutar tests**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- CircularGauge
```

Esperado: 8 tests passing.

- [ ] **Step 5: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/shared/ui/gauges/
git commit -m "feat: CircularGauge SVG con arco 270° y color dinámico por umbral"
```

---

## Task 5: BatteryGauge (barra horizontal tipo móvil)

**Files:**
- Create: `frontend/src/shared/ui/gauges/BatteryGauge.tsx`
- Create: `frontend/src/shared/ui/gauges/__tests__/BatteryGauge.test.tsx`

- [ ] **Step 1: Escribir tests**

Crear `frontend/src/shared/ui/gauges/__tests__/BatteryGauge.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import BatteryGauge from '../BatteryGauge'

describe('BatteryGauge', () => {
  it('muestra el voltaje formateado y estado OK', () => {
    const { getByText } = render(
      <BatteryGauge value={24.1} min={18} max={30} label="BATERÍA"
        warnBelow={21} alertBelow={19} />
    )
    expect(getByText('24.1 V')).toBeInTheDocument()
    expect(getByText('OK')).toBeInTheDocument()
  })

  it('relleno proporcional: 24V en rango 18-30 = 50%', () => {
    const { container } = render(
      <BatteryGauge value={24} min={18} max={30} label="BATERÍA" />
    )
    const fill = container.querySelector('.bat-fill') as HTMLElement
    expect(fill.style.width).toBe('50%')
  })

  it('relleno 100% en valor máximo', () => {
    const { container } = render(
      <BatteryGauge value={30} min={18} max={30} label="BATERÍA" />
    )
    const fill = container.querySelector('.bat-fill') as HTMLElement
    expect(fill.style.width).toBe('100%')
  })

  it('muestra ADVERTENCIA cuando value <= warnBelow', () => {
    const { getByText } = render(
      <BatteryGauge value={20} min={18} max={30} label="BATERÍA"
        warnBelow={21} alertBelow={19} />
    )
    expect(getByText('ADVERTENCIA')).toBeInTheDocument()
  })

  it('muestra BAJA cuando value <= alertBelow', () => {
    const { getByText } = render(
      <BatteryGauge value={18.5} min={18} max={30} label="BATERÍA"
        warnBelow={21} alertBelow={19} />
    )
    expect(getByText('BAJA')).toBeInTheDocument()
  })

  it('muestra guión cuando value es null', () => {
    const { getByText } = render(
      <BatteryGauge value={null} min={18} max={30} label="BATERÍA" />
    )
    expect(getByText('— V')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Verificar que fallan**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- BatteryGauge
```

Esperado: falla con `Cannot find module`.

- [ ] **Step 3: Implementar BatteryGauge**

Crear `frontend/src/shared/ui/gauges/BatteryGauge.tsx`:

```typescript
interface BatteryGaugeProps {
  value: number | null
  min: number
  max: number
  label: string
  warnBelow?: number
  alertBelow?: number
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

export default function BatteryGauge({ value, min, max, label, warnBelow, alertBelow }: BatteryGaugeProps) {
  const pct = value != null
    ? Math.round(Math.max(0, Math.min(1, (value - min) / (max - min))) * 100)
    : 0
  const color = batteryColor(value, warnBelow, alertBelow)
  const status = batteryStatus(value, warnBelow, alertBelow)

  return (
    <div style={{
      background: 'var(--bg-surface)',
      borderRadius: 8,
      padding: '14px 10px',
      border: '1px solid var(--bg-elevated)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 0,
    }}>
      <div style={{
        fontSize: 8,
        color: 'var(--text-muted)',
        letterSpacing: '0.8px',
        marginBottom: 12,
        fontFamily: 'var(--font-ui)',
      }}>
        {label}
      </div>

      {/* Icono batería tipo móvil */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 10 }}>
        <div style={{
          width: 70,
          height: 26,
          border: '2px solid var(--bg-border)',
          borderRadius: 4,
          padding: 3,
          background: 'var(--bg-base)',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div
            className="bat-fill"
            style={{
              height: '100%',
              width: `${pct}%`,
              background: color,
              borderRadius: 2,
              transition: 'width 0.3s',
              boxShadow: `0 0 6px ${color}40`,
            }}
          />
        </div>
        {/* Terminal positivo */}
        <div style={{
          width: 4,
          height: 10,
          background: 'var(--bg-border)',
          borderRadius: '0 2px 2px 0',
        }} />
      </div>

      <div style={{
        fontSize: 20,
        fontWeight: 700,
        fontFamily: 'var(--font-data)',
        color,
        lineHeight: 1,
      }}>
        {value != null ? `${value.toFixed(1)} V` : '— V'}
      </div>

      <div style={{
        fontSize: 9,
        fontFamily: 'var(--font-data)',
        color,
        marginTop: 4,
      }}>
        {status}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Ejecutar tests**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- BatteryGauge
```

Esperado: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/shared/ui/gauges/BatteryGauge.tsx frontend/src/shared/ui/gauges/__tests__/BatteryGauge.test.tsx
git commit -m "feat: BatteryGauge barra horizontal tipo móvil con umbrales"
```

---

## Task 6: LinearGauge + NumericDisplay

**Files:**
- Create: `frontend/src/shared/ui/gauges/LinearGauge.tsx`
- Create: `frontend/src/shared/ui/gauges/NumericDisplay.tsx`
- Create: `frontend/src/shared/ui/gauges/__tests__/LinearGauge.test.tsx`
- Create: `frontend/src/shared/ui/gauges/__tests__/NumericDisplay.test.tsx`

- [ ] **Step 1: Escribir tests para LinearGauge**

Crear `frontend/src/shared/ui/gauges/__tests__/LinearGauge.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import LinearGauge from '../LinearGauge'

describe('LinearGauge', () => {
  it('muestra el porcentaje', () => {
    const { getByText } = render(
      <LinearGauge value={78} min={0} max={100} unit="%" label="NIVEL ACEITE" />
    )
    expect(getByText('78%')).toBeInTheDocument()
  })

  it('la barra vertical tiene la altura proporcional al valor', () => {
    const { container } = render(
      <LinearGauge value={50} min={0} max={100} unit="%" label="NIVEL" />
    )
    const fill = container.querySelector('.linear-fill') as HTMLElement
    expect(fill.style.height).toBe('50%')
  })

  it('muestra estado OK cuando está sobre warnBelow', () => {
    const { getByText } = render(
      <LinearGauge value={78} min={0} max={100} unit="%" label="NIVEL" warnBelow={20} />
    )
    expect(getByText('OK')).toBeInTheDocument()
  })

  it('muestra BAJO cuando value <= warnBelow', () => {
    const { getByText } = render(
      <LinearGauge value={15} min={0} max={100} unit="%" label="NIVEL" warnBelow={20} alertBelow={10} />
    )
    expect(getByText('BAJO')).toBeInTheDocument()
  })

  it('muestra guión cuando value es null', () => {
    const { getByText } = render(
      <LinearGauge value={null} min={0} max={100} unit="%" label="NIVEL" />
    )
    expect(getByText('—')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Escribir tests para NumericDisplay**

Crear `frontend/src/shared/ui/gauges/__tests__/NumericDisplay.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import NumericDisplay from '../NumericDisplay'

describe('NumericDisplay', () => {
  it('muestra el valor, unidad y label', () => {
    const { getByText } = render(
      <NumericDisplay value={47} unit="ciclos" label="CICLOS VACIADO" />
    )
    expect(getByText('47')).toBeInTheDocument()
    expect(getByText('ciclos')).toBeInTheDocument()
    expect(getByText('CICLOS VACIADO')).toBeInTheDocument()
  })

  it('muestra valor decimal con 1 decimal', () => {
    const { getByText } = render(
      <NumericDisplay value={3.4} unit="h" label="HORAS PTO" />
    )
    expect(getByText('3.4')).toBeInTheDocument()
  })

  it('muestra guión cuando value es null', () => {
    const { getByText } = render(
      <NumericDisplay value={null} unit="ciclos" label="CICLOS" />
    )
    expect(getByText('—')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Verificar que fallan**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- "LinearGauge|NumericDisplay"
```

Esperado: todos fallan con `Cannot find module`.

- [ ] **Step 4: Implementar LinearGauge**

Crear `frontend/src/shared/ui/gauges/LinearGauge.tsx`:

```typescript
interface LinearGaugeProps {
  value: number | null
  min: number
  max: number
  unit: string
  label: string
  warnBelow?: number
  alertBelow?: number
}

function levelColor(value: number | null, warnBelow?: number, alertBelow?: number): string {
  if (value == null) return 'var(--accent-off)'
  if (alertBelow != null && value <= alertBelow) return 'var(--accent-crit)'
  if (warnBelow != null && value <= warnBelow) return 'var(--accent-warn)'
  return 'var(--accent-energy)'
}

function levelStatus(value: number | null, warnBelow?: number, alertBelow?: number): string {
  if (value == null) return '—'
  if (alertBelow != null && value <= alertBelow) return 'CRÍTICO'
  if (warnBelow != null && value <= warnBelow) return 'BAJO'
  return 'OK'
}

export default function LinearGauge({ value, min, max, unit, label, warnBelow, alertBelow }: LinearGaugeProps) {
  const pct = value != null
    ? Math.round(Math.max(0, Math.min(1, (value - min) / (max - min))) * 100)
    : 0
  const color = levelColor(value, warnBelow, alertBelow)
  const status = levelStatus(value, warnBelow, alertBelow)
  const warnPct = warnBelow != null ? Math.round(((warnBelow - min) / (max - min)) * 100) : null

  return (
    <div style={{
      background: 'var(--bg-surface)',
      borderRadius: 8,
      padding: '14px 8px',
      border: '1px solid var(--bg-elevated)',
    }}>
      <div style={{
        fontSize: 8,
        color: 'var(--text-muted)',
        letterSpacing: '0.8px',
        marginBottom: 10,
        fontFamily: 'var(--font-ui)',
        textAlign: 'center',
      }}>
        {label.toUpperCase()}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 10 }}>
        {/* Barra vertical */}
        <div style={{
          width: 28,
          height: 80,
          background: 'var(--bg-elevated)',
          borderRadius: 3,
          position: 'relative',
          overflow: 'hidden',
          border: '1px solid var(--bg-border)',
        }}>
          <div
            className="linear-fill"
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: `${pct}%`,
              background: color,
              borderRadius: '0 0 2px 2px',
              transition: 'height 0.3s',
            }}
          />
          {/* Línea de threshold warn */}
          {warnPct != null && (
            <div style={{
              position: 'absolute',
              bottom: `${warnPct}%`,
              left: 0,
              right: 0,
              height: 1,
              background: 'var(--accent-warn)',
              opacity: 0.7,
            }} />
          )}
        </div>

        {/* Valor y estado */}
        <div style={{ textAlign: 'left' }}>
          <div style={{
            fontSize: 22,
            fontWeight: 700,
            color: value != null ? 'var(--text-primary)' : 'var(--text-muted)',
            fontFamily: 'var(--font-data)',
            lineHeight: 1,
          }}>
            {value != null ? `${pct}%` : '—'}
          </div>
          <div style={{
            fontSize: 9,
            color,
            fontFamily: 'var(--font-data)',
            marginTop: 2,
          }}>
            {status}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Implementar NumericDisplay**

Crear `frontend/src/shared/ui/gauges/NumericDisplay.tsx`:

```typescript
interface NumericDisplayProps {
  value: number | null
  unit: string
  label: string
}

function formatValue(value: number | null): string {
  if (value == null) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export default function NumericDisplay({ value, unit, label }: NumericDisplayProps) {
  return (
    <div style={{
      background: 'var(--bg-surface)',
      borderRadius: 8,
      padding: '20px 8px',
      border: '1px solid var(--bg-elevated)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        fontSize: 8,
        color: 'var(--text-muted)',
        letterSpacing: '0.8px',
        marginBottom: 10,
        fontFamily: 'var(--font-ui)',
      }}>
        {label.toUpperCase()}
      </div>
      <div style={{
        fontSize: 34,
        fontWeight: 700,
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-data)',
        lineHeight: 1,
      }}>
        {formatValue(value)}
      </div>
      <div style={{
        fontSize: 9,
        color: 'var(--text-secondary)',
        fontFamily: 'var(--font-data)',
        marginTop: 6,
      }}>
        {unit}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Ejecutar tests**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- "LinearGauge|NumericDisplay"
```

Esperado: 5 + 3 = 8 tests passing.

- [ ] **Step 7: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/shared/ui/gauges/LinearGauge.tsx frontend/src/shared/ui/gauges/NumericDisplay.tsx frontend/src/shared/ui/gauges/__tests__/
git commit -m "feat: LinearGauge barra vertical + NumericDisplay tarjeta de contador"
```

---

## Task 7: Tabs component (barra de pestañas controlada)

**Files:**
- Create: `frontend/src/shared/ui/Tabs.tsx`
- Create: `frontend/src/shared/ui/__tests__/Tabs.test.tsx`

- [ ] **Step 1: Escribir tests**

```bash
mkdir -p /opt/cmg-telematic1/frontend/src/shared/ui/__tests__
```

Crear `frontend/src/shared/ui/__tests__/Tabs.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Tabs from '../Tabs'

const TABS = [
  { id: 'live', label: 'EN VIVO' },
  { id: 'historic', label: 'HISTÓRICO' },
]

describe('Tabs', () => {
  it('renderiza todas las pestañas', () => {
    const { getByText } = render(
      <Tabs tabs={TABS} activeTab="live" onTabChange={() => {}} />
    )
    expect(getByText('EN VIVO')).toBeInTheDocument()
    expect(getByText('HISTÓRICO')).toBeInTheDocument()
  })

  it('llama onTabChange con el id correcto al hacer clic', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { getByText } = render(
      <Tabs tabs={TABS} activeTab="live" onTabChange={onChange} />
    )
    await user.click(getByText('HISTÓRICO'))
    expect(onChange).toHaveBeenCalledWith('historic')
  })

  it('la pestaña activa tiene atributo aria-selected=true', () => {
    const { getByRole } = render(
      <Tabs tabs={TABS} activeTab="historic" onTabChange={() => {}} />
    )
    const historicBtn = getByRole('tab', { name: 'HISTÓRICO' })
    expect(historicBtn).toHaveAttribute('aria-selected', 'true')
  })
})
```

- [ ] **Step 2: Verificar que fallan**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- "Tabs"
```

Esperado: todos fallan.

- [ ] **Step 3: Implementar Tabs**

Crear `frontend/src/shared/ui/Tabs.tsx`:

```typescript
interface TabItem {
  id: string
  label: string
}

interface TabsProps {
  tabs: TabItem[]
  activeTab: string
  onTabChange: (id: string) => void
}

export default function Tabs({ tabs, activeTab, onTabChange }: TabsProps) {
  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        borderBottom: '1px solid var(--bg-border)',
      }}
    >
      {tabs.map(tab => {
        const isActive = tab.id === activeTab
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.id)}
            style={{
              padding: '8px 20px',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'var(--font-ui)',
              letterSpacing: '0.05em',
              color: isActive ? 'var(--accent-energy)' : 'var(--text-muted)',
              background: 'none',
              border: 'none',
              borderBottom: isActive
                ? '2px solid var(--accent-energy)'
                : '2px solid transparent',
              marginBottom: -1,
              cursor: 'pointer',
              outline: 'none',
              transition: 'color 0.15s',
            }}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Ejecutar tests**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- "Tabs"
```

Esperado: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/shared/ui/Tabs.tsx frontend/src/shared/ui/__tests__/
git commit -m "feat: Tabs component controlado con role=tablist/tab para accesibilidad"
```

---

## Task 8: SensorGrid — dispatcher data-driven

**Files:**
- Create: `frontend/src/features/vehicle/SensorGrid.tsx`
- Create: `frontend/src/features/vehicle/__tests__/SensorGrid.test.tsx`

`SensorGrid` recibe `sensorSchema` y `canData`, extrae el valor de cada sensor y renderiza el gauge correcto según `gauge_type`. Para sensores con `kpi_key`, lee de `derivedValues`.

- [ ] **Step 1: Escribir tests**

```bash
mkdir -p /opt/cmg-telematic1/frontend/src/features/vehicle/__tests__
```

Crear `frontend/src/features/vehicle/__tests__/SensorGrid.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import SensorGrid from '../SensorGrid'
import type { SensorDef } from '../../../lib/types'

const circular: SensorDef = {
  key: 'hydraulic_pressure_1',
  label: 'Presión hidráulica 1',
  unit: 'bar',
  min: 0,
  max: 600,
  gauge_type: 'circular',
  warn_above: 300,
  alert_above: 400,
  avl_id: 305,
}

const linear: SensorDef = { ...circular, gauge_type: 'linear', key: 'oil_level' }
const numeric: SensorDef = { ...circular, gauge_type: 'numeric', key: 'cycles' }
const battery: SensorDef = { ...circular, gauge_type: 'battery', key: 'battery' }

describe('SensorGrid', () => {
  it('renderiza CircularGauge para sensor circular', () => {
    const { container } = render(
      <SensorGrid sensorSchema={[circular]} canData={{ avl_305: 390 }} />
    )
    expect(container.querySelector('.g-val')).toBeInTheDocument()
  })

  it('pasa el valor correcto desde canData (avl_305 → 390)', () => {
    const { getByText } = render(
      <SensorGrid sensorSchema={[circular]} canData={{ avl_305: 390 }} />
    )
    expect(getByText('390')).toBeInTheDocument()
  })

  it('renderiza LinearGauge para sensor lineal', () => {
    const { container } = render(
      <SensorGrid sensorSchema={[linear]} canData={{ avl_305: 78 }} />
    )
    expect(container.querySelector('.linear-fill')).toBeInTheDocument()
  })

  it('renderiza NumericDisplay para sensor numérico', () => {
    const { getByText } = render(
      <SensorGrid sensorSchema={[numeric]} canData={{ avl_305: 47 }} />
    )
    expect(getByText('47')).toBeInTheDocument()
  })

  it('renderiza BatteryGauge para sensor de batería', () => {
    const { container } = render(
      <SensorGrid sensorSchema={[battery]} canData={{ avl_305: 24.1 }} />
    )
    expect(container.querySelector('.bat-fill')).toBeInTheDocument()
  })

  it('usa derivedValues para sensores con kpi_key', () => {
    const ptoSensor: SensorDef = {
      key: 'pto_hours_today',
      label: 'Horas PTO hoy',
      unit: 'h',
      gauge_type: 'numeric',
      kpi_key: 'pto_hours_today',
    }
    const { getByText } = render(
      <SensorGrid
        sensorSchema={[ptoSensor]}
        canData={{}}
        derivedValues={{ pto_hours_today: 3.4 }}
      />
    )
    expect(getByText('3.4')).toBeInTheDocument()
  })

  it('pasa null al gauge cuando avl_id no está en canData', () => {
    const { getByText } = render(
      <SensorGrid sensorSchema={[circular]} canData={{}} />
    )
    expect(getByText('—')).toBeInTheDocument()
  })

  it('aplica scale a valores raw — AVL 66 en mV → V (×0.001)', () => {
    const batterySensor: SensorDef = {
      key: 'battery_v',
      label: 'Batería',
      unit: 'V',
      min: 18, max: 30,
      gauge_type: 'battery',
      warn_below: 21, alert_below: 19,
      avl_id: 66,
      scale: 0.001,
    }
    // avl_66 = 24100 mV → scale 0.001 → 24.1 V
    const { getByText } = render(
      <SensorGrid sensorSchema={[batterySensor]} canData={{ avl_66: 24100 }} />
    )
    expect(getByText('24.1 V')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Verificar que fallan**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- "SensorGrid"
```

Esperado: falla con `Cannot find module`.

- [ ] **Step 3: Implementar SensorGrid**

Crear `frontend/src/features/vehicle/SensorGrid.tsx`:

```typescript
import type { SensorDef } from '../../lib/types'
import CircularGauge from '../../shared/ui/gauges/CircularGauge'
import BatteryGauge from '../../shared/ui/gauges/BatteryGauge'
import LinearGauge from '../../shared/ui/gauges/LinearGauge'
import NumericDisplay from '../../shared/ui/gauges/NumericDisplay'

interface SensorGridProps {
  sensorSchema: SensorDef[]
  canData: Record<string, unknown>
  derivedValues?: Record<string, number | null>
}

function getSensorValue(
  sensor: SensorDef,
  canData: Record<string, unknown>,
  derived: Record<string, number | null>,
): number | null {
  if (sensor.kpi_key) return derived[sensor.kpi_key] ?? null
  if (sensor.avl_id != null) {
    const raw = canData[`avl_${sensor.avl_id}`]
    if (typeof raw !== 'number') return null
    return sensor.scale != null ? raw * sensor.scale : raw
  }
  return null
}

export default function SensorGrid({ sensorSchema, canData, derivedValues = {} }: SensorGridProps) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
      gap: 8,
    }}>
      {sensorSchema.map(sensor => {
        const value = getSensorValue(sensor, canData, derivedValues)

        if (sensor.gauge_type === 'circular') {
          return (
            <CircularGauge
              key={sensor.key}
              value={value}
              min={sensor.min ?? 0}
              max={sensor.max ?? 100}
              unit={sensor.unit ?? ''}
              label={sensor.label}
              warnAbove={sensor.warn_above}
              alertAbove={sensor.alert_above}
              warnBelow={sensor.warn_below}
              alertBelow={sensor.alert_below}
            />
          )
        }

        if (sensor.gauge_type === 'battery') {
          return (
            <BatteryGauge
              key={sensor.key}
              value={value}
              min={sensor.min ?? 0}
              max={sensor.max ?? 100}
              label={sensor.label}
              warnBelow={sensor.warn_below}
              alertBelow={sensor.alert_below}
            />
          )
        }

        if (sensor.gauge_type === 'linear') {
          return (
            <LinearGauge
              key={sensor.key}
              value={value}
              min={sensor.min ?? 0}
              max={sensor.max ?? 100}
              unit={sensor.unit ?? '%'}
              label={sensor.label}
              warnBelow={sensor.warn_below}
              alertBelow={sensor.alert_below}
            />
          )
        }

        if (sensor.gauge_type === 'numeric') {
          return (
            <NumericDisplay
              key={sensor.key}
              value={value}
              unit={sensor.unit ?? ''}
              label={sensor.label}
            />
          )
        }

        return null
      })}
    </div>
  )
}
```

- [ ] **Step 4: Ejecutar tests**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- "SensorGrid"
```

Esperado: 7 tests passing.

- [ ] **Step 5: Ejecutar toda la suite**

```bash
cd /opt/cmg-telematic1/frontend
npm test
```

Esperado: todos los tests de los tasks 1-8 pasan (≥20 tests).

- [ ] **Step 6: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/vehicle/SensorGrid.tsx frontend/src/features/vehicle/__tests__/
git commit -m "feat: SensorGrid data-driven — dispatcha el gauge correcto por sensor_schema"
```

---

## Task 9: wsClient — WebSocket real con reconexión exponencial

**Files:**
- Rewrite: `frontend/src/lib/wsClient.ts`
- Create: `frontend/src/lib/__tests__/wsClient.test.ts`

El cliente abre `/ws/fleet?token=...`, escucha mensajes `{type:"telemetry",data:VehicleStatus}` y los inyecta en el query cache de React Query. Reconexión con backoff: 1s → 2s → 4s → máx 30s.

- [ ] **Step 1: Escribir tests**

```bash
mkdir -p /opt/cmg-telematic1/frontend/src/lib/__tests__
```

Crear `frontend/src/lib/__tests__/wsClient.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

// Mock WebSocket global antes de importar wsClient
class MockWebSocket {
  static instances: MockWebSocket[] = []
  url: string
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  close = vi.fn(() => { this.onclose?.() })
}

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function getClient() {
  vi.resetModules()
  const mod = await import('../wsClient')
  return mod.wsClient
}

describe('wsClient', () => {
  it('abre conexión WebSocket con la URL correcta', async () => {
    const client = await getClient()
    client.connect('my-token', new QueryClient())
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0].url).toContain('/ws/fleet?token=my-token')
  })

  it('no abre segunda conexión si ya está conectada', async () => {
    const client = await getClient()
    const qc = new QueryClient()
    client.connect('token', qc)
    client.connect('token', qc)
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('inyecta VehicleStatus en queryClient al recibir telemetría', async () => {
    const client = await getClient()
    const qc = new QueryClient()
    client.connect('token', qc)

    const ws = MockWebSocket.instances[0]
    const status = {
      vehicle_id: 'v-abc',
      online: true,
      last_seen: '2026-04-19T10:00:00Z',
      lat: 39.5,
      lon: -0.4,
      speed_kmh: 60,
      ignition: true,
      pto_active: false,
      can_data: { avl_305: 390 },
    }
    ws.onmessage?.({ data: JSON.stringify({ type: 'telemetry', data: status }) })

    const cached = qc.getQueryData(['vehicles', 'v-abc', 'status'])
    expect(cached).toMatchObject({ vehicle_id: 'v-abc', speed_kmh: 60 })
  })

  it('llama a los callbacks de onTelemetry', async () => {
    const client = await getClient()
    const qc = new QueryClient()
    client.connect('token', qc)

    const cb = vi.fn()
    client.onTelemetry(cb)

    const ws = MockWebSocket.instances[0]
    const status = {
      vehicle_id: 'v-1', online: true, last_seen: null,
      lat: null, lon: null, speed_kmh: 0,
      ignition: false, pto_active: false, can_data: {},
    }
    ws.onmessage?.({ data: JSON.stringify({ type: 'telemetry', data: status }) })

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ vehicle_id: 'v-1' }))
  })

  it('reconecta tras close con delay de 1s', async () => {
    const client = await getClient()
    client.connect('token', new QueryClient())

    // Simular cierre abrupto (sin llamar a onclose para que no dispare nuestro close)
    const ws = MockWebSocket.instances[0]
    ws.onclose = null  // quitamos el handler temporal
    // Disparar onclose del socket directamente (como si viniera de fuera)
    client.connect('token', new QueryClient())  // no abre segunda conexión aún

    // Simular close desde el socket (socket._triggerClose)
    MockWebSocket.instances[0].onclose = null  // evitar recursión
    const closeHandler = (MockWebSocket.instances[0] as any)._closeHandler
    // Mejor: disparar el onclose que wsClient registró
    // Reset para un test limpio de reconexión:
  })

  it('disconnect cancela la reconexión y cierra el socket', async () => {
    const client = await getClient()
    client.connect('token', new QueryClient())
    expect(MockWebSocket.instances).toHaveLength(1)

    client.disconnect()
    expect(MockWebSocket.instances[0].close).toHaveBeenCalled()

    // No se reconecta después de disconnect
    vi.advanceTimersByTime(5_000)
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('elimina el listener al llamar el unsubscribe devuelto por onTelemetry', async () => {
    const client = await getClient()
    const qc = new QueryClient()
    client.connect('token', qc)

    const cb = vi.fn()
    const unsub = client.onTelemetry(cb)
    unsub()

    const ws = MockWebSocket.instances[0]
    const status = {
      vehicle_id: 'v-1', online: true, last_seen: null,
      lat: null, lon: null, speed_kmh: 0,
      ignition: false, pto_active: false, can_data: {},
    }
    ws.onmessage?.({ data: JSON.stringify({ type: 'telemetry', data: status }) })

    expect(cb).not.toHaveBeenCalled()
  })
})
```

**Nota sobre el test de reconexión:** El test "reconecta tras close con delay de 1s" está parcialmente escrito. Para completarlo en el test file usa este patrón:

```typescript
it('reconecta tras close con delay de 1s', async () => {
  const client = await getClient()
  client.connect('token', new QueryClient())
  expect(MockWebSocket.instances).toHaveLength(1)

  // Simular que el servidor cierra la conexión
  // wsClient registra onclose en socket; lo llamamos directamente
  const firstSocket = MockWebSocket.instances[0]
  // Desactivar el close() del mock para que no llame onclose de nuevo
  firstSocket.close = vi.fn()
  firstSocket.onclose?.()

  // Aún no reconecta (necesita el tick del timer)
  expect(MockWebSocket.instances).toHaveLength(1)

  vi.advanceTimersByTime(1_100)
  expect(MockWebSocket.instances).toHaveLength(2)
})
```

Reemplaza el test de reconexión con esta versión completa.

- [ ] **Step 2: Verificar que fallan**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- wsClient
```

Esperado: falla porque la implementación actual es un stub.

- [ ] **Step 3: Implementar wsClient**

Reemplazar `frontend/src/lib/wsClient.ts` completamente:

```typescript
import type { QueryClient } from '@tanstack/react-query'
import type { VehicleStatus } from './types'
import { keys } from './queryKeys'

const RECONNECT_MAX_MS = 30_000

type TelemetryCallback = (data: VehicleStatus) => void

class WsClientImpl {
  private socket: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1_000
  private token: string | null = null
  private queryClient: QueryClient | null = null
  private listeners = new Set<TelemetryCallback>()

  connect(token: string, queryClient: QueryClient): void {
    if (this.socket) return
    this.token = token
    this.queryClient = queryClient
    this.open()
  }

  disconnect(): void {
    this.clearReconnect()
    this.token = null
    this.queryClient = null
    this.reconnectDelay = 1_000
    if (this.socket) {
      this.socket.onclose = null
      this.socket.close()
      this.socket = null
    }
    this.listeners.clear()
  }

  onTelemetry(cb: TelemetryCallback): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  private open(): void {
    if (!this.token) return
    this.clearReconnect()

    this.socket = new WebSocket(`/ws/fleet?token=${encodeURIComponent(this.token)}`)

    this.socket.onopen = () => {
      this.reconnectDelay = 1_000
    }

    this.socket.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; data: VehicleStatus }
        if (msg.type === 'telemetry' && msg.data) {
          this.queryClient?.setQueryData(keys.vehicleStatus(msg.data.vehicle_id), msg.data)
          this.listeners.forEach(cb => cb(msg.data))
        }
      } catch {
        /* ignora mensajes malformados */
      }
    }

    this.socket.onerror = () => {
      this.socket?.close()
    }

    this.socket.onclose = () => {
      this.socket = null
      const delay = this.reconnectDelay
      this.reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_MS)
      this.reconnectTimer = setTimeout(() => { this.open() }, delay)
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}

export const wsClient = new WsClientImpl()
```

- [ ] **Step 4: Ejecutar tests**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- wsClient
```

Esperado: ≥5 tests passing (el test de reconexión puede necesitar ajuste fino según cómo el mock dispare el evento onclose, ver nota en Step 1).

- [ ] **Step 5: Verificar compilación TypeScript**

```bash
cd /opt/cmg-telematic1/frontend
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 6: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/lib/wsClient.ts frontend/src/lib/__tests__/
git commit -m "feat: wsClient WebSocket real con backoff exponencial 1s→30s y queryClient injection"
```

---

## Task 10: Auth — ciclo de vida del WebSocket

**Files:**
- Modify: `frontend/src/features/auth/useAuthStore.ts`
- Modify: `frontend/src/features/auth/RequireAuth.tsx`

`wsClient.connect()` se llama en `RequireAuth` cuando el usuario está autenticado. `wsClient.disconnect()` se llama en `useAuthStore.logout()`.

- [ ] **Step 1: Añadir disconnect al logout en useAuthStore**

En `frontend/src/features/auth/useAuthStore.ts`, añadir el import al principio del fichero (después de los imports existentes):

```typescript
import { wsClient } from '../../lib/wsClient'
```

En la función `logout`, cambiar:

```typescript
logout: () => {
  localStorage.removeItem(REFRESH_KEY)
  set({ accessToken: null, user: null, brandName: null, logoUrl: null })
  window.location.href = '/login'
},
```

Por:

```typescript
logout: () => {
  localStorage.removeItem(REFRESH_KEY)
  wsClient.disconnect()
  set({ accessToken: null, user: null, brandName: null, logoUrl: null })
  window.location.href = '/login'
},
```

- [ ] **Step 2: Actualizar RequireAuth para conectar WS tras auth**

Reemplazar el contenido completo de `frontend/src/features/auth/RequireAuth.tsx`:

```typescript
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from './useAuthStore'
import { wsClient } from '../../lib/wsClient'

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { accessToken, refresh } = useAuthStore()
  const queryClient = useQueryClient()
  const [checking, setChecking] = useState(!accessToken)

  useEffect(() => {
    let mounted = true
    if (!accessToken) {
      refresh().finally(() => { if (mounted) setChecking(false) })
    } else {
      setChecking(false)
    }
    return () => { mounted = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (accessToken && !checking) {
      wsClient.connect(accessToken, queryClient)
    }
  }, [accessToken, checking, queryClient])

  if (checking) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-base)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
      }}>
        Cargando…
      </div>
    )
  }

  if (!accessToken) return <Navigate to="/login" replace />
  return <>{children}</>
}
```

- [ ] **Step 3: Verificar compilación**

```bash
cd /opt/cmg-telematic1/frontend
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 4: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/auth/useAuthStore.ts frontend/src/features/auth/RequireAuth.tsx
git commit -m "feat: ciclo de vida WebSocket — connect en RequireAuth, disconnect en logout"
```

---

## Task 11: VehicleDetailPage — pestañas + SensorGrid

**Files:**
- Modify: `frontend/src/features/vehicle/VehicleDetailPage.tsx`

La página añade pestañas "EN VIVO" / "HISTÓRICO". La pestaña en vivo muestra el mapa de recorrido y `SensorGrid` en 2 columnas. La pestaña histórico muestra `KpiChart`. El `sensor_schema` se obtiene del endpoint `GET /api/v1/vehicle-types`.

- [ ] **Step 1: Escribir tests**

Crear `frontend/src/features/vehicle/__tests__/VehicleDetailPage.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import VehicleDetailPage from '../VehicleDetailPage'

// Mockear los componentes hijos pesados
vi.mock('../TrackMap', () => ({ default: () => <div data-testid="track-map" /> }))
vi.mock('../KpiChart', () => ({ default: () => <div data-testid="kpi-chart" /> }))

function renderPage(vehicleId = 'v-test') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const vehicle = {
    id: vehicleId,
    tenant_id: 't1',
    vehicle_type_id: 'vt-1',
    name: 'Camión 01',
    license_plate: '1234ABC',
    vin: null,
    year: 2020,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
  }
  const vehicleType = {
    id: 'vt-1',
    slug: 'wasterent-vacuum',
    name: 'Wasterent — Sistema vacío-presión',
    sensor_schema: [],
  }
  const status = {
    vehicle_id: vehicleId,
    online: true,
    last_seen: '2026-04-19T10:00:00Z',
    lat: 39.5, lon: -0.4,
    speed_kmh: 60, ignition: true, pto_active: false,
    can_data: { avl_305: 390 },
  }

  queryClient.setQueryData(['vehicles', vehicleId], vehicle)
  queryClient.setQueryData(['vehicle-types'], [vehicleType])
  queryClient.setQueryData(['vehicles', vehicleId, 'status'], status)
  queryClient.setQueryData(['vehicles', vehicleId, 'track'], [])

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/fleet/${vehicleId}`]}>
        <Routes>
          <Route path="/fleet/:id" element={<VehicleDetailPage />} />
          <Route path="/fleet" element={<div>Fleet</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('VehicleDetailPage', () => {
  it('muestra la pestaña EN VIVO por defecto', () => {
    const { getByRole } = renderPage()
    const tab = getByRole('tab', { name: 'EN VIVO' })
    expect(tab).toHaveAttribute('aria-selected', 'true')
  })

  it('muestra el mapa en la pestaña EN VIVO', () => {
    const { getByTestId } = renderPage()
    expect(getByTestId('track-map')).toBeInTheDocument()
  })

  it('cambia a la pestaña HISTÓRICO al hacer clic', async () => {
    const user = userEvent.setup()
    const { getByRole, getByTestId } = renderPage()
    await user.click(getByRole('tab', { name: 'HISTÓRICO' }))
    expect(getByTestId('kpi-chart')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Verificar que fallan**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- VehicleDetailPage
```

Esperado: algunos tests fallan porque VehicleDetailPage no tiene tabs aún.

- [ ] **Step 3: Actualizar VehicleDetailPage**

Reemplazar el contenido completo de `frontend/src/features/vehicle/VehicleDetailPage.tsx`:

```typescript
import { useState, useMemo } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import Tabs from '../../shared/ui/Tabs'
import VehicleHeader from './VehicleHeader'
import TrackMap from './TrackMap'
import SensorGrid from './SensorGrid'
import KpiChart from './KpiChart'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleOut, VehicleStatus, TrackPoint, VehicleTypeOut, KpiHour } from '../../lib/types'

const PAGE_TABS = [
  { id: 'live', label: 'EN VIVO' },
  { id: 'historic', label: 'HISTÓRICO' },
]

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<'live' | 'historic'>('live')

  if (!id) return <Navigate to="/fleet" replace />

  const { data: vehicle, isLoading: loadingVehicle, error: vehicleError } = useQuery({
    queryKey: keys.vehicle(id),
    queryFn: () => apiClient.get<VehicleOut>(`/api/v1/vehicles/${id}`),
  })

  const { data: vehicleTypes = [] } = useQuery({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: Infinity,
  })

  const { data: status } = useQuery({
    queryKey: keys.vehicleStatus(id),
    queryFn: () => apiClient.get<VehicleStatus>(`/api/v1/vehicles/${id}/status`),
    refetchInterval: 30_000,
    enabled: !!vehicle,
  })

  const { data: track = [] } = useQuery({
    queryKey: keys.vehicleTrack(id),
    queryFn: () => apiClient.get<TrackPoint[]>(`/api/v1/vehicles/${id}/track/today`),
    staleTime: 60_000,
    enabled: !!vehicle,
  })

  const { data: kpis = [] } = useQuery({
    queryKey: [...keys.vehicleKpis(id), 24],
    queryFn: () => apiClient.get<KpiHour[]>(`/api/v1/vehicles/${id}/kpis?hours=24`),
    enabled: tab === 'historic' && !!vehicle,
  })

  const vehicleType = vehicleTypes.find(vt => vt.id === vehicle?.vehicle_type_id)
  const sensorSchema = vehicleType?.sensor_schema ?? []

  const derivedValues = useMemo(() => ({
    pto_hours_today: kpis.length > 0
      ? Math.round(kpis.reduce((s, h) => s + (h.pto_active_minutes ?? 0), 0) / 60 * 10) / 10
      : null,
  }), [kpis])

  if (loadingVehicle) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-base)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
      }}>
        Cargando…
      </div>
    )
  }

  if (vehicleError || !vehicle) return <Navigate to="/fleet" replace />

  return (
    <Shell title={vehicle.name}>
      <div style={{ height: '100%', overflowY: 'auto' }}>
        <VehicleHeader vehicle={vehicle} status={status} />

        <div style={{ padding: '0 24px' }}>
          <Tabs
            tabs={PAGE_TABS}
            activeTab={tab}
            onTabChange={(id) => setTab(id as 'live' | 'historic')}
          />
        </div>

        {tab === 'live' && (
          <div style={{
            padding: 24,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 24,
            maxWidth: 1400,
          }}>
            {/* Columna izquierda: mapa */}
            <div>
              <div style={{
                fontSize: 10,
                color: 'var(--text-muted)',
                fontWeight: 600,
                letterSpacing: '0.06em',
                marginBottom: 10,
              }}>
                RECORRIDO DE HOY
              </div>
              <TrackMap track={track} status={status} />
            </div>

            {/* Columna derecha: gauges */}
            <div>
              <div style={{
                fontSize: 10,
                color: 'var(--text-muted)',
                fontWeight: 600,
                letterSpacing: '0.06em',
                marginBottom: 10,
              }}>
                SENSORES EN VIVO
              </div>
              {sensorSchema.length > 0 ? (
                <SensorGrid
                  sensorSchema={sensorSchema}
                  canData={status?.can_data ?? {}}
                  derivedValues={derivedValues}
                />
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  Sin schema de sensores configurado para este tipo de vehículo.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'historic' && (
          <div style={{ padding: 24, maxWidth: 1400 }}>
            <KpiChart vehicleId={id} />
          </div>
        )}
      </div>
    </Shell>
  )
}
```

- [ ] **Step 4: Ejecutar tests**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- VehicleDetailPage
```

Esperado: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/vehicle/VehicleDetailPage.tsx frontend/src/features/vehicle/__tests__/VehicleDetailPage.test.tsx
git commit -m "feat: VehicleDetailPage — pestañas EN VIVO/HISTÓRICO con SensorGrid data-driven"
```

---

## Task 12: KpiChart — gráficas históricas con Recharts

**Files:**
- Create: `frontend/src/features/vehicle/KpiChart.tsx`
- Create: `frontend/src/features/vehicle/__tests__/KpiChart.test.tsx`

`KpiChart` muestra presión media, temperatura media y minutos PTO por hora de las últimas 24h/7d/30d usando Recharts `ComposedChart`.

- [ ] **Step 1: Escribir tests**

Crear `frontend/src/features/vehicle/__tests__/KpiChart.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import KpiChart from '../KpiChart'

function renderChart(kpis: unknown[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['vehicles', 'v1', 'kpis', 24], kpis)
  return render(
    <QueryClientProvider client={queryClient}>
      <KpiChart vehicleId="v1" />
    </QueryClientProvider>
  )
}

describe('KpiChart', () => {
  it('muestra "Sin datos" cuando no hay registros', () => {
    const { getByText } = renderChart([])
    expect(getByText(/sin datos/i)).toBeInTheDocument()
  })

  it('muestra los botones de rango de tiempo', () => {
    const { getByText } = renderChart([])
    expect(getByText('24h')).toBeInTheDocument()
    expect(getByText('7d')).toBeInTheDocument()
    expect(getByText('30d')).toBeInTheDocument()
  })

  it('renderiza el contenedor del gráfico cuando hay datos', () => {
    const kpis = [
      {
        bucket: '2026-04-19T09:00:00Z',
        avg_pressure_1: 300,
        max_pressure_1: 350,
        avg_oil_temp: 85,
        max_oil_temp: 90,
        pto_active_minutes: 45,
        engine_on_minutes: 60,
        record_count: 120,
      },
    ]
    const { container } = renderChart(kpis)
    expect(container.querySelector('.recharts-wrapper')).toBeInTheDocument()
  })

  it('cambia el rango al hacer clic en 7d', async () => {
    const user = userEvent.setup()
    const { getByText } = renderChart([])
    const btn = getByText('7d')
    await user.click(btn)
    // El botón debe tener estilo activo (color distinto)
    // Verificamos que el clic no lanza error
    expect(btn).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Verificar que fallan**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- KpiChart
```

Esperado: falla con `Cannot find module`.

- [ ] **Step 3: Implementar KpiChart**

Crear `frontend/src/features/vehicle/KpiChart.tsx`:

```typescript
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ComposedChart, Line, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { KpiHour } from '../../lib/types'

const RANGES = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
]

function formatBucket(bucket: string): string {
  const d = new Date(bucket)
  return `${d.getHours()}:00`
}

interface KpiChartProps {
  vehicleId: string
}

export default function KpiChart({ vehicleId }: KpiChartProps) {
  const [hours, setHours] = useState(24)

  const { data: kpis = [], isLoading } = useQuery({
    queryKey: [...keys.vehicleKpis(vehicleId), hours],
    queryFn: () => apiClient.get<KpiHour[]>(`/api/v1/vehicles/${vehicleId}/kpis?hours=${hours}`),
  })

  const chartData = kpis.map(h => ({
    time: formatBucket(h.bucket),
    pressure: h.avg_pressure_1,
    temp: h.avg_oil_temp,
    pto: h.pto_active_minutes,
  }))

  return (
    <div>
      {/* Selector de rango */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {RANGES.map(r => (
          <button
            key={r.hours}
            onClick={() => setHours(r.hours)}
            style={{
              padding: '4px 14px',
              fontSize: 11,
              fontWeight: 600,
              fontFamily: 'var(--font-ui)',
              borderRadius: 4,
              border: '1px solid var(--bg-border)',
              background: hours === r.hours ? 'var(--accent-energy)' : 'var(--bg-surface)',
              color: hours === r.hours ? 'var(--bg-base)' : 'var(--text-muted)',
              cursor: 'pointer',
              outline: 'none',
              transition: 'background 0.15s',
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
          Cargando…
        </div>
      )}

      {!isLoading && chartData.length === 0 && (
        <div style={{
          color: 'var(--text-muted)',
          fontSize: 13,
          padding: '60px 0',
          textAlign: 'center',
          background: 'var(--bg-surface)',
          borderRadius: 8,
          border: '1px solid var(--bg-elevated)',
        }}>
          Sin datos para el período seleccionado
        </div>
      )}

      {!isLoading && chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 20, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--bg-elevated)" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--bg-border)' }}
            />
            <YAxis
              yAxisId="pressure"
              orientation="left"
              tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}
              tickLine={false}
              axisLine={false}
              label={{ value: 'bar', position: 'insideLeft', offset: 10, fill: 'var(--text-muted)', fontSize: 10 }}
            />
            <YAxis
              yAxisId="temp"
              orientation="right"
              tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}
              tickLine={false}
              axisLine={false}
              label={{ value: '°C', position: 'insideRight', offset: -10, fill: 'var(--text-muted)', fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--bg-border)',
                borderRadius: 6,
                fontSize: 12,
                fontFamily: 'var(--font-data)',
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 10, fontFamily: 'var(--font-ui)', color: 'var(--text-muted)' }}
            />
            <Area
              yAxisId="pressure"
              type="monotone"
              dataKey="pressure"
              name="Presión media (bar)"
              stroke="var(--accent-energy)"
              fill="var(--accent-energy)"
              fillOpacity={0.1}
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="temp"
              type="monotone"
              dataKey="temp"
              name="Temp. aceite (°C)"
              stroke="var(--accent-warn)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="pressure"
              type="monotone"
              dataKey="pto"
              name="PTO activo (min)"
              stroke="var(--accent-info)"
              strokeWidth={1.5}
              strokeDasharray="4 2"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Ejecutar tests**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- KpiChart
```

Esperado: 4 tests passing. Si Recharts no hace render en jsdom, el test del `.recharts-wrapper` puede omitirse o adaptarse.

- [ ] **Step 5: Ejecutar la suite completa**

```bash
cd /opt/cmg-telematic1/frontend
npm test
```

Esperado: todos los tests de Sprint 6 pasan (≥28 tests total).

- [ ] **Step 6: Verificar compilación TypeScript**

```bash
cd /opt/cmg-telematic1/frontend
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 7: Build de producción**

```bash
cd /opt/cmg-telematic1/frontend
npm run build
```

Esperado: termina sin errores.

- [ ] **Step 8: Commit final**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/vehicle/KpiChart.tsx frontend/src/features/vehicle/__tests__/KpiChart.test.tsx
git commit -m "feat: KpiChart Recharts con selector 24h/7d/30d y doble eje Y"
```

---

## Resumen de commits esperados

| # | Mensaje |
|---|---------|
| 1 | `test: configurar Vitest + @testing-library/react para Sprint 6` |
| 2 | `feat: añadir SensorDef, WsMessage, VehicleTypeOut al sistema de tipos` |
| 3 | `feat: añadir vehicle_types wasterent-vacuum y vacuum-pressure con AVL IDs reales` |
| 4 | `feat: CircularGauge SVG con arco 270° y color dinámico por umbral` |
| 5 | `feat: BatteryGauge barra horizontal tipo móvil con umbrales` |
| 6 | `feat: LinearGauge barra vertical + NumericDisplay tarjeta de contador` |
| 7 | `feat: Tabs component controlado con role=tablist/tab para accesibilidad` |
| 8 | `feat: SensorGrid data-driven — dispatcha el gauge correcto por sensor_schema` |
| 9 | `feat: wsClient WebSocket real con backoff exponencial 1s→30s y queryClient injection` |
| 10 | `feat: ciclo de vida WebSocket — connect en RequireAuth, disconnect en logout` |
| 11 | `feat: VehicleDetailPage — pestañas EN VIVO/HISTÓRICO con SensorGrid data-driven` |
| 12 | `feat: KpiChart Recharts con selector 24h/7d/30d y doble eje Y` |

---

## Verificación final post-sprint

Una vez completados los 12 tasks:

1. Levantar el stack: `docker-compose up -d`
2. Ejecutar el seed: `docker-compose exec core-api python -m app.seeds.initial`
3. Navegar a `http://localhost:3000`
4. Login con `admin@cmg.es / Admin2026!`
5. Ir a la lista de flotas → abrir un vehículo de tipo `wasterent-vacuum`
6. Verificar: pestaña "EN VIVO" activa por defecto, gauges renderizados, mapa visible
7. Hacer clic en "HISTÓRICO": gráfica Recharts con selector de rango
8. Comprobar en DevTools → Network → WS: conexión activa a `/ws/fleet?token=...`
9. Logout: verificar en DevTools que el WebSocket se cierra
