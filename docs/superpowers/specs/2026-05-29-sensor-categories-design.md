# Spec: Categorías de sensores (máquina/chasis), counter gauge y LED rediseñado

**Fecha:** 2026-05-29
**Estado:** Aprobado

---

## 1. Cambios en tipos

### SensorDef — nuevos campos

```ts
// gauge_type: añadir 'counter'
gauge_type: 'circular' | 'linear' | 'battery' | 'numeric' | 'led' | 'tank' | 'gauge_arc' | 'counter'

// Categoría: a qué sección pertenece el sensor en el detalle del vehículo
category?: 'maquina' | 'chasis'   // default implícito: 'maquina'
```

### SensorIcon — 2 nuevos valores

```ts
export type SensorIcon =
  | 'pressure' | 'temperature' | 'fuel' | 'water' | 'engine'
  | 'speed' | 'voltage' | 'pump' | 'valve' | 'rpm' | 'flow'
  | 'counter'    // odómetro / contador numérico
  | 'toggle'     // interruptor on/off
```

---

## 2. SensorIconSet — 2 nuevos iconos

### `counter` — velocímetro/contador con manecilla
```tsx
function Counter({ size = 20 }: IconProps) {
  return <svg viewBox="0 0 20 20" width={size} height={size} fill="none"
    stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="10" cy="10" r="7"/>
    <path d="M10 10 L13 7"/>
    <circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none"/>
    <line x1="5" y1="15" x2="6.5" y2="13.5" strokeWidth={1}/>
    <line x1="15" y1="15" x2="13.5" y2="13.5" strokeWidth={1}/>
    <line x1="10" y1="4" x2="10" y2="5.5" strokeWidth={1}/>
  </svg>
}
```

### `toggle` — interruptor on/off con posición ON
```tsx
function Toggle({ size = 20 }: IconProps) {
  return <svg viewBox="0 0 20 20" width={size} height={size} fill="none"
    stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="16" height="6" rx="3"/>
    <circle cx="13.5" cy="10" r="2.2" fill="currentColor" stroke="none"/>
  </svg>
}
```

---

## 3. Nuevos widgets en SensorWidget

### `counter` — número grande con unidad

```tsx
case 'counter':
  return (
    <div style={cardStyle}>
      {icon}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: size > 80 ? 22 : 18, fontWeight: 700,
          fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)',
          letterSpacing: '-0.02em', lineHeight: 1,
        }}>
          {scaled != null ? scaled.toLocaleString('es-ES', { maximumFractionDigits: 1 }) : '—'}
        </div>
        {sensor.unit && (
          <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginTop: 3 }}>{sensor.unit}</div>
        )}
        <div style={{ fontSize: 10, color: 'var(--fg-dim)', marginTop: 2 }}>{sensor.label}</div>
      </div>
    </div>
  )
```

### `led` — rediseñado como píldora de estado

```tsx
case 'led': {
  const on = scaled != null && scaled > 0
  return (
    <div style={{ ...cardStyle, flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon}
        <span style={{ fontSize: 12, color: 'var(--fg-secondary)', fontWeight: 500 }}>{sensor.label}</span>
      </div>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 700,
        background: on ? 'var(--ok-soft)' : 'var(--offline-soft)',
        color: on ? 'var(--ok)' : 'var(--offline)',
        border: `1px solid ${on ? 'rgba(34,197,94,0.3)' : 'rgba(100,116,139,0.3)'}`,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }}/>
        {on ? 'ON' : 'OFF'}
      </span>
    </div>
  )
}
```

---

## 4. VehicleDetailPage — sección chasis

### Helper `getRawVal` (ya existe en VehicleDetailPage, reutilizar)

```ts
// Mismo helper que ya se usa en el grid actual:
const getRawVal = (s: SensorDef): number | null =>
  s.avl_id != null
    ? ((status?.can_data?.[`avl_${s.avl_id}`] as number | undefined) ?? null)
    : s.kpi_key ? (derivedValues?.[s.kpi_key] ?? null) : null
```

### Lógica de separación

```ts
const machineSensors = sensorSchema.filter(s =>
  s.visible_in_detail !== false &&
  (!s.category || s.category === 'maquina')
)

const chassisSensors = sensorSchema.filter(s =>
  s.visible_in_detail !== false &&
  s.category === 'chasis'
)

// Solo mostrar sección chasis si hay al menos un sensor con valor no null
const chassisHasData = chassisSensors.some(s => {
  const raw = s.avl_id != null ? (status?.can_data?.[`avl_${s.avl_id}`] as number | undefined) ?? null : null
  return raw != null
})
```

### Layout del tab "En vivo"

```tsx
{/* TELEMETRÍA */}
<div>
  {/* Barra de estado (sin cambios) */}
  ...

  {/* Grid de máquina */}
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 10 }}>
    {machineSensors.map(s => <SensorWidget key={s.key} sensor={s} value={getRawVal(s)} />)}
  </div>

  {/* Sección chasis — solo si hay datos */}
  {chassisHasData && chassisSensors.length > 0 && (
    <div style={{
      marginTop: 14, borderTop: '1px solid var(--border-soft)', paddingTop: 10,
    }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-muted)',
                  letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
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
            <div key={s.key} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '5px 8px', borderRadius: 6,
              background: 'transparent',
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
</div>
```

---

## 5. VehicleTypeSensorsSection — selector de categoría

En el panel expandible de cada sensor (junto a tipo, icono, color, tamaño), añadir:

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
        onClick={() => updateSensorField(sensor, 'category', cat)}
        style={{
          padding: '4px 12px', fontSize: 11, fontWeight: 600,
          borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font-sans)',
          background: (sensor.category ?? 'maquina') === cat ? 'var(--cmg-teal-soft)' : 'var(--bg-card)',
          border: `1px solid ${(sensor.category ?? 'maquina') === cat ? 'var(--cmg-teal-line)' : 'var(--border)'}`,
          color: (sensor.category ?? 'maquina') === cat ? 'var(--cmg-teal)' : 'var(--fg-tertiary)',
        }}
      >
        {cat === 'maquina' ? 'Máquina' : 'Chasis'}
      </button>
    ))}
  </div>
</div>
```

---

## 6. Archivos a modificar

| Archivo | Cambio |
|---|---|
| `frontend/src/lib/types.ts` | Añadir `counter` a gauge_type, `category` a SensorDef, `counter`/`toggle` a SensorIcon |
| `frontend/src/shared/ui/gauges/SensorIconSet.tsx` | Añadir iconos Counter y Toggle |
| `frontend/src/features/vehicle/SensorWidget.tsx` | Añadir case `counter`, rediseñar `led` |
| `frontend/src/features/vehicle/VehicleDetailPage.tsx` | Separar sensores por category, añadir sección chasis |
| `frontend/src/features/settings/VehicleTypeSensorsSection.tsx` | Añadir selector Máquina/Chasis |

---

## 7. Qué NO cambia

- Backend, migración, Redis — sin cambios (category es JSONB)
- Gauges existentes (circular, linear, tank, gauge_arc, battery, numeric) — sin cambios internos
- DOUT section — sin cambios
- Los sensores sin `category` se tratan como `maquina` (retrocompatibilidad)
