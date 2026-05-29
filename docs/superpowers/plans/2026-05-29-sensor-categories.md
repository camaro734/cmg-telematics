# Sensor Categories (máquina/chasis) + Counter + LED redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir categorías máquina/chasis a los sensores, nuevo tipo 'counter', LED rediseñado como píldora, y sección "Estado del chasis" en VehicleDetailPage.

**Architecture:** Frontend-only. `SensorDef.category` y `gauge_type: 'counter'` son campos JSONB — sin migración. VehicleDetailPage separa sensores por categoría mostrando los de chasis en una sección compacta de filas. SensorWidget añade el case `counter` y rediseña `led`. SensorIconSet añade 2 iconos.

**Tech Stack:** React 18 + Vite + TypeScript, CSS custom properties. NO docker ni alembic.

---

## Archivos a tocar

| Archivo | Cambio |
|---|---|
| `frontend/src/lib/types.ts` | `counter` en gauge_type, `category` en SensorDef, `counter`/`toggle` en SensorIcon |
| `frontend/src/shared/ui/gauges/SensorIconSet.tsx` | Añadir Counter y Toggle |
| `frontend/src/features/vehicle/SensorWidget.tsx` | Case `counter` + led rediseñado |
| `frontend/src/features/vehicle/VehicleDetailPage.tsx` | Separación maquina/chasis + sección chasis |
| `frontend/src/features/settings/VehicleTypeSensorsSection.tsx` | Selector Máquina/Chasis |

---

## Tarea 1: types.ts — counter, category, nuevos SensorIcon

**Files:**
- Modify: `frontend/src/lib/types.ts`

- [ ] **Paso 1: Localizar las líneas a modificar**

```bash
grep -n "gauge_type\|SensorIcon\|interface SensorDef\|category" \
  /opt/cmg-telematic1/frontend/src/lib/types.ts | head -15
```

- [ ] **Paso 2: Añadir 'counter' a gauge_type**

Buscar la línea con `gauge_type:` en `SensorDef` y reemplazar por:
```ts
  gauge_type: 'circular' | 'linear' | 'battery' | 'numeric' | 'led' | 'tank' | 'gauge_arc' | 'counter'
```

- [ ] **Paso 3: Añadir campo category a SensorDef**

Al final de la interfaz `SensorDef` (antes del `}`), añadir:
```ts
  category?: 'maquina' | 'chasis'
```

- [ ] **Paso 4: Añadir counter y toggle a SensorIcon**

Buscar `export type SensorIcon` y reemplazar con:
```ts
export type SensorIcon =
  | 'pressure' | 'temperature' | 'fuel' | 'water' | 'engine'
  | 'speed' | 'voltage' | 'pump' | 'valve' | 'rpm' | 'flow'
  | 'counter' | 'toggle'
```

- [ ] **Paso 5: Build**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -5
```
Resultado esperado: ✓ sin errores TypeScript.

- [ ] **Paso 6: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/lib/types.ts
git commit -m "feat(types): add counter gauge_type, category field, counter/toggle icons

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 2: SensorIconSet — iconos Counter y Toggle

**Files:**
- Modify: `frontend/src/shared/ui/gauges/SensorIconSet.tsx`

- [ ] **Paso 1: Leer los exports actuales**

```bash
grep -n "^function\|^export const\|SENSOR_ICONS" \
  /opt/cmg-telematic1/frontend/src/shared/ui/gauges/SensorIconSet.tsx | head -20
```

- [ ] **Paso 2: Añadir función Counter antes de SENSOR_ICONS**

Insertar antes de la línea `export const SENSOR_ICONS`:

```tsx
function Counter({ size = 20 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="7"/>
      <path d="M10 10 L13 7"/>
      <circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none"/>
      <line x1="5" y1="15" x2="6.5" y2="13.5" strokeWidth={1}/>
      <line x1="15" y1="15" x2="13.5" y2="13.5" strokeWidth={1}/>
      <line x1="10" y1="4" x2="10" y2="5.5" strokeWidth={1}/>
    </svg>
  )
}

function Toggle({ size = 20 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="16" height="6" rx="3"/>
      <circle cx="13.5" cy="10" r="2.2" fill="currentColor" stroke="none"/>
    </svg>
  )
}
```

- [ ] **Paso 3: Añadir counter y toggle a SENSOR_ICONS**

En el objeto `SENSOR_ICONS`, añadir al final:
```ts
  counter: Counter,
  toggle: Toggle,
```

- [ ] **Paso 4: Build**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -5
```

- [ ] **Paso 5: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/shared/ui/gauges/SensorIconSet.tsx
git commit -m "feat(ui): add Counter and Toggle SVG icons to SensorIconSet

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 3: SensorWidget — case counter + led rediseñado

**Files:**
- Modify: `frontend/src/features/vehicle/SensorWidget.tsx`

- [ ] **Paso 1: Leer los cases actuales de SensorWidget**

```bash
grep -n "case 'led'\|case 'numeric'\|case 'circular'\|switch\|SIZES" \
  /opt/cmg-telematic1/frontend/src/features/vehicle/SensorWidget.tsx | head -15
```

- [ ] **Paso 2: Reemplazar case 'led' con la versión píldora**

Buscar el bloque `case 'led':` completo y reemplazarlo con:

```tsx
    case 'led': {
      const on = scaled != null && scaled > 0
      return (
        <div style={{ ...cardStyle, flexDirection: 'row', justifyContent: 'space-between', width: '100%', padding: '8px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {icon}
            <span style={{ fontSize: 12, color: 'var(--fg-secondary)', fontWeight: 500, fontFamily: 'var(--font-sans)' }}>
              {sensor.label}
            </span>
          </div>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '3px 10px', borderRadius: 9999,
            fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-sans)',
            background: on ? 'var(--ok-soft)' : 'var(--offline-soft)',
            color: on ? 'var(--ok)' : 'var(--offline)',
            border: `1px solid ${on ? 'rgba(34,197,94,0.3)' : 'rgba(100,116,139,0.3)'}`,
            flexShrink: 0,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', display: 'inline-block', flexShrink: 0 }}/>
            {on ? 'ON' : 'OFF'}
          </span>
        </div>
      )
    }
```

- [ ] **Paso 3: Añadir case 'counter' antes del default**

Buscar `case 'circular':` (o el `default:`) e insertar ANTES:

```tsx
    case 'counter':
      return (
        <div style={{ ...cardStyle, minWidth: 80 }}>
          {icon}
          <div style={{ textAlign: 'center' as const }}>
            <div style={{
              fontSize: size > 80 ? 20 : 16, fontWeight: 700,
              fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)',
              letterSpacing: '-0.02em', lineHeight: 1,
            }}>
              {scaled != null
                ? scaled.toLocaleString('es-ES', { maximumFractionDigits: 1 })
                : '—'}
            </div>
            {sensor.unit && scaled != null && (
              <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginTop: 3, fontFamily: 'var(--font-sans)' }}>
                {sensor.unit}
              </div>
            )}
            <div style={{ fontSize: 10, color: 'var(--fg-dim)', marginTop: 2, fontFamily: 'var(--font-sans)' }}>
              {sensor.label}
            </div>
          </div>
        </div>
      )
```

- [ ] **Paso 4: Build y tests**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -5
npm run test -- --run 2>&1 | tail -4
```

- [ ] **Paso 5: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/vehicle/SensorWidget.tsx
git commit -m "feat(vehicle): add counter widget, redesign led as status pill

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 4: VehicleDetailPage — separación maquina/chasis

**Files:**
- Modify: `frontend/src/features/vehicle/VehicleDetailPage.tsx`

- [ ] **Paso 1: Añadir import de SensorIconComponent**

```bash
grep -n "SensorIconComponent\|SensorWidget\|import" \
  /opt/cmg-telematic1/frontend/src/features/vehicle/VehicleDetailPage.tsx | head -15
```

Si `SensorIconComponent` no está importado, añadirlo:
```tsx
import { SensorIconComponent } from '../../shared/ui/gauges/SensorIconSet'
```

- [ ] **Paso 2: Localizar el bloque del widget grid**

```bash
grep -n "widget grid\|sensorSchema.*filter\|machineSensors\|visible_in_detail\|SensorWidget key" \
  /opt/cmg-telematic1/frontend/src/features/vehicle/VehicleDetailPage.tsx | head -10
```

- [ ] **Paso 3: Sustituir el grid actual por la versión con separación maquina/chasis**

Localizar el bloque que contiene:
```tsx
  {status ? (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 10 }}>
      {sensorSchema
        .filter(s => s.visible_in_detail !== false)
        .map(s => {
          ...
          return <SensorWidget key={s.key} sensor={s} value={rawVal} />
        })}
    </div>
  ) : (
    <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Sin datos en vivo</div>
  )}
```

Reemplazarlo con:

```tsx
  {status ? (() => {
    const getRawVal = (s: typeof sensorSchema[number]): number | null =>
      s.avl_id != null
        ? ((status.can_data?.[`avl_${s.avl_id}`] as number | undefined) ?? null)
        : s.kpi_key ? (derivedValues?.[s.kpi_key] ?? null) : null

    const machineSensors = sensorSchema.filter(s =>
      s.visible_in_detail !== false &&
      (!s.category || s.category === 'maquina')
    )
    const chassisSensors = sensorSchema.filter(s =>
      s.visible_in_detail !== false && s.category === 'chasis'
    )
    const chassisHasData = chassisSensors.some(s => getRawVal(s) != null)

    return (
      <>
        {/* Grid de máquina */}
        {machineSensors.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 10 }}>
            {machineSensors.map(s => (
              <SensorWidget key={s.key} sensor={s} value={getRawVal(s)} />
            ))}
          </div>
        )}

        {/* Sección chasis — solo si hay datos */}
        {chassisHasData && chassisSensors.length > 0 && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--border-soft)', paddingTop: 10 }}>
            <p style={{
              fontSize: 10, fontWeight: 700, color: 'var(--fg-muted)',
              letterSpacing: '0.07em', textTransform: 'uppercase' as const,
              marginBottom: 6, margin: '0 0 8px',
            }}>
              Estado del chasis
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {chassisSensors.map(s => {
                const raw = getRawVal(s)
                const val = raw != null ? raw * (s.scale ?? 1) + (s.offset ?? 0) : null
                const display = val != null
                  ? (val % 1 === 0 ? val.toLocaleString('es-ES') : val.toFixed(1))
                  : '—'
                return (
                  <div
                    key={s.key}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '5px 8px', borderRadius: 6, background: 'transparent',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {s.icon && <SensorIconComponent icon={s.icon} size={13} color="var(--fg-dim)"/>}
                      <span style={{ fontSize: 12, color: 'var(--fg-tertiary)', fontFamily: 'var(--font-sans)' }}>
                        {s.label}
                      </span>
                    </div>
                    <span style={{
                      fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)',
                      color: val != null ? 'var(--fg-primary)' : 'var(--fg-dim)',
                    }}>
                      {display}
                      {s.unit && val != null && (
                        <span style={{ fontSize: 10, color: 'var(--fg-muted)', marginLeft: 4 }}>{s.unit}</span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </>
    )
  })() : (
    <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Sin datos en vivo</div>
  )}
```

- [ ] **Paso 4: Build y tests**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -8
npm run test -- --run 2>&1 | tail -4
```
Resultado esperado: ✓ sin errores TypeScript, tests pasan.

- [ ] **Paso 5: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/vehicle/VehicleDetailPage.tsx
git commit -m "feat(vehicle): separate machine/chassis sensors, add chassis status section

Sensors with category='chasis' appear in a compact row-based section
below the main widget grid. Section only shows when chassis data exists.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 5: VehicleTypeSensorsSection — selector Máquina/Chasis

**Files:**
- Modify: `frontend/src/features/settings/VehicleTypeSensorsSection.tsx`

- [ ] **Paso 1: Localizar el panel expandible de configuración visual**

```bash
grep -n "TAMAÑO\|widget_size\|ICONO\|SENSOR_ICONS\|expandedSensorKey" \
  /opt/cmg-telematic1/frontend/src/features/settings/VehicleTypeSensorsSection.tsx | head -10
```

- [ ] **Paso 2: Añadir el selector de CATEGORÍA en el panel expandible**

Dentro del panel expandible de cada sensor (`{expandedSensorKey === s.key && (...)`), localizar el bloque del selector de TAMAÑO (el último bloque antes del cierre del panel). Añadir DESPUÉS del bloque de tamaño:

```tsx
{/* Categoría */}
<div>
  <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)', letterSpacing: '0.05em', margin: '0 0 6px' }}>
    CATEGORÍA
  </p>
  <div style={{ display: 'flex', gap: 6 }}>
    {(['maquina', 'chasis'] as const).map(cat => (
      <button
        key={cat}
        type="button"
        onClick={() => updateSensorField(s, 'category', cat)}
        style={{
          padding: '4px 14px', fontSize: 11, fontWeight: 600,
          borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font-sans)',
          background: (s.category ?? 'maquina') === cat ? 'var(--cmg-teal-soft)' : 'var(--bg-card)',
          border: `1px solid ${(s.category ?? 'maquina') === cat ? 'var(--cmg-teal-line)' : 'var(--border)'}`,
          color: (s.category ?? 'maquina') === cat ? 'var(--cmg-teal)' : 'var(--fg-tertiary)',
          transition: 'all 0.15s',
        }}
      >
        {cat === 'maquina' ? 'Máquina' : 'Chasis'}
      </button>
    ))}
  </div>
  <p style={{ fontSize: 10, color: 'var(--fg-dim)', marginTop: 5, fontFamily: 'var(--font-sans)', lineHeight: 1.4 }}>
    Máquina: aparece en el grid principal de telemetría.<br/>
    Chasis: aparece en la sección "Estado del chasis" como lista compacta.
  </p>
</div>
```

- [ ] **Paso 3: Actualizar GAUGE_OPTIONS para incluir 'counter'**

Buscar:
```ts
const GAUGE_OPTIONS: SensorDef['gauge_type'][] = ['circular', 'gauge_arc', 'linear', 'tank', 'battery', 'numeric', 'led']
```
Reemplazar por:
```ts
const GAUGE_OPTIONS: SensorDef['gauge_type'][] = ['circular', 'gauge_arc', 'linear', 'tank', 'battery', 'numeric', 'counter', 'led']
```

Y en el `GAUGE_LABELS`, añadir:
```ts
counter: 'Contador',
```

- [ ] **Paso 4: Build y tests**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -8
npm run test -- --run 2>&1 | tail -4
```

- [ ] **Paso 5: Commit**

```bash
cd /opt/cmg-telematic1
git add frontend/src/features/settings/VehicleTypeSensorsSection.tsx
git commit -m "feat(settings): add Máquina/Chasis category selector per sensor

Sensors can be assigned to 'maquina' (main grid) or 'chasis' (compact
status list). Counter gauge type added to picker.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Verificación final

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -4
npm run test -- --run 2>&1 | tail -4
cd .. && git log --oneline -6
```

## Comprobación visual

| Acción | Qué verificar |
|---|---|
| Ajustes → Sensores → expandir sensor | Nuevo bloque "CATEGORÍA" con botones Máquina / Chasis visible |
| Cambiar tipo a "Contador" | Aparece en el picker de tipos |
| Asignar un sensor a Chasis y guardar | Sensor desaparece del grid principal en `/vehicles/:id` |
| Ir a `/vehicles/:id` | Si hay sensores chasis con datos, aparece sección "Estado del chasis" con filas compactas |
| LED sensor en el grid | Muestra píldora verde "● ON" o gris "○ OFF" en lugar de texto plano |
| Counter sensor en el grid | Muestra número grande con unidad centrado |
