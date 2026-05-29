# Spec: Widgets de telemetría configurables por tipo de vehículo

**Fecha:** 2026-05-29
**Estado:** Aprobado

---

## 1. Objetivo

Reemplazar el panel de telemetría compacto de VehicleDetailPage por un sistema de widgets visuales configurables desde la UI de tipo de vehículo: gauges circulares, barras, cisternas animadas, semicírculos tipo velocímetro. Cada sensor tiene su tipo de visual, icono y color elegidos por el administrador desde VehicleTypesPage.

**Referencia visual:** `/opt/cmg-telematic1/temp/Captura de pantalla 2026-05-29 141524.png`

---

## 2. Cambios en SensorDef (frontend types.ts)

Extender la interfaz sin migración de BD (sensor_schema es JSONB):

```ts
export interface SensorDef {
  key: string
  label: string
  unit: string | null
  min?: number
  max?: number
  gauge_type: 'circular' | 'linear' | 'battery' | 'numeric' | 'led' | 'tank' | 'gauge_arc'
  warn_above?: number
  alert_above?: number
  warn_below?: number
  alert_below?: number
  avl_id?: number
  scale?: number
  offset?: number
  kpi_key?: string
  bit_index?: number
  visible_in_detail?: boolean
  // Nuevos campos:
  icon?: SensorIcon
  color?: string        // hex o var CSS — override del color por defecto
  widget_size?: 'sm' | 'md' | 'lg'
}

export type SensorIcon =
  | 'pressure' | 'temperature' | 'fuel' | 'water' | 'engine'
  | 'speed' | 'voltage' | 'pump' | 'valve' | 'rpm' | 'flow'
```

---

## 3. Nuevos componentes

### 3.1 TankGauge (`shared/ui/gauges/TankGauge.tsx`)

Cisterna rectangular con nivel de líquido animado.

**Props:**
```ts
interface TankGaugeProps {
  value: number           // valor actual (0..max)
  max: number             // valor a 100%
  min?: number            // default 0
  label: string
  unit?: string
  warnAbove?: number
  alertAbove?: number
  color?: string          // default 'var(--info)'
  width?: number          // default 80
  height?: number         // default 100
}
```

**Visual SVG:**
- Contenedor rectangular con bordes redondeados (rx=6)
- Fondo vacío: `var(--bg-elevated)`
- Líquido: rectángulo que crece desde abajo, altura proporcional al porcentaje
- Ola SVG animada en la superficie del líquido (`@keyframes wave` usando path sinusoidal)
- Color del líquido: `--info` (azul) por defecto → `--warn` si > warnAbove → `--danger` si > alertAbove
- Valor centrado sobre el líquido en monospace
- Unidad pequeña debajo del valor
- Etiqueta debajo del tanque
- Líneas de calibración opcionales (25%, 50%, 75%)

**Animación:**
```css
@keyframes tank-wave {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
```
La ola es un path SVG que se repite x2 de ancho y se desplaza continuamente.

### 3.2 GaugeArc (`shared/ui/gauges/GaugeArc.tsx`)

Semicírculo tipo velocímetro (180°), más prominente que el CircularGauge actual (240°).

**Props:**
```ts
interface GaugeArcProps {
  value: number
  max: number
  min?: number
  label: string
  unit?: string
  warnAbove?: number
  alertAbove?: number
  color?: string
  size?: number           // default 120
}
```

**Visual:**
- Semicírculo inferior (180°) — el arco va de izquierda a derecha por abajo
- Track: `var(--border)`, grosor 10px
- Fill: color dinámico según thresholds
- Aguja: línea desde el centro al ángulo correspondiente (opcional)
- Valor grande en el centro
- Min/Max en los extremos del arco (pequeño, `--fg-dim`)
- Etiqueta + icono sobre el valor

### 3.3 SensorWidget (`features/vehicle/SensorWidget.tsx`)

Wrapper que selecciona qué componente renderizar según `gauge_type`.

```ts
interface SensorWidgetProps {
  sensor: SensorDef
  value: number | null
  size?: 'sm' | 'md' | 'lg'
}
```

**Mapeo:**
| gauge_type | Componente | Tamaño por defecto |
|---|---|---|
| `circular` | `CircularGauge` | md (80px) |
| `gauge_arc` | `GaugeArc` | md (120px) |
| `linear` | `LinearGauge` | sm (ancho completo) |
| `battery` | `BatteryGauge` | sm |
| `numeric` | `NumericDisplay` | sm |
| `led` | Punto + label On/Off | sm |
| `tank` | `TankGauge` | md (80×100px) |

Cada widget muestra:
- Icono SVG del sensor (de la librería de `SensorIconSet` — ver 3.4)
- El gauge en el centro
- Label + unidad debajo

### 3.4 SensorIconSet (`shared/ui/gauges/SensorIconSet.tsx`)

Exporta 11 iconos SVG inline, todos 20×20 stroke `currentColor`:

```tsx
export const SENSOR_ICONS: Record<SensorIcon, React.FC<{size?: number; color?: string}>> = {
  pressure:    () => <svg>/* manómetro circular con aguja */</svg>,
  temperature: () => <svg>/* termómetro */</svg>,
  fuel:        () => <svg>/* gota de combustible */</svg>,
  water:       () => <svg>/* ola de agua */</svg>,
  engine:      () => <svg>/* engranaje */</svg>,
  speed:       () => <svg>/* velocímetro */</svg>,
  voltage:     () => <svg>/* rayo */</svg>,
  pump:        () => <svg>/* bomba circular */</svg>,
  valve:       () => <svg>/* válvula */</svg>,
  rpm:         () => <svg>/* círculo con flechas */</svg>,
  flow:        () => <svg>/* flecha de flujo */</svg>,
}
```

---

## 4. VehicleDetailPage — nuevo layout del panel de telemetría

### 4.1 Barra de estado compacta (sustituye los StatusCard actuales)

```
[● En directo]  [Ignición ON/OFF]  [PTO ON/OFF]  [Velocidad XX km/h]
```

Fila horizontal con chips pequeños. Ignición y PTO como `<Chip dot>`.

### 4.2 Grid de widgets

```tsx
<div style={{
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
  gap: 12,
  padding: '12px 0',
}}>
  {sensorsForWidgets.map(sensor => (
    <SensorWidget key={sensor.key} sensor={sensor} value={getValue(sensor)} />
  ))}
</div>
```

`sensorsForWidgets` = `sensorSchema.filter(s => s.gauge_type !== 'led' && s.visible_in_detail !== false)`

Los sensores `led` siguen en la fila de estado compacta.

El tamaño de celda se ajusta automáticamente: `tank` y `gauge_arc` pueden ocupar 2 columnas si `widget_size === 'lg'`.

### 4.3 Controles de mando rediseñados

Cada DOUT como tarjeta:

```
┌──────────────────────────────────┐
│  [icono]  Toma de fuerza         │
│           ● ON     ○ OFF         │  ← estado con punto de color
│           Presión: 170 bar       │  ← valor del sensor asociado (si existe)
│                      [Activar]   │
└──────────────────────────────────┘
```

- Fondo `var(--bg-card)`, borde `var(--border)`
- Cuando activo: borde `var(--ok)`, fondo `var(--ok-soft)`
- Botón con ConfirmDialog (ya existe en el código)
- Si el `DoutSlot` tiene campo `sensor_key` → buscar ese sensor en el schema y mostrar su valor actual (configurado desde DoutConfigSection)

---

## 5. VehicleTypeSensorsSection — configurador de widgets

Para cada sensor en la lista, añadir una fila de configuración visual expandible:

```
[key: presion_bomba] [label: Presión bomba] [unit: bar] [avl_id: 380]
▼ Visualización
  Tipo: [● Circular  ○ Arco  ○ Barra  ○ Cisterna  ○ Numérico  ○ LED]
  Icono: [⬤pressure  ○temp  ○fuel  ○water  ○engine  ○speed  ○voltage  ○pump  ○valve  ○rpm  ○flow]
  Color: [#1D9E75 ████] (input color, opcional)
  Tamaño: [○ Pequeño  ● Normal  ○ Grande]
```

Los selectores son botones radio visuales (sin `<input type="radio">` nativo feo), con el estilo del design system.

---

## 6. Archivos a crear/modificar

| Archivo | Acción |
|---|---|
| `frontend/src/shared/ui/gauges/TankGauge.tsx` | Crear |
| `frontend/src/shared/ui/gauges/GaugeArc.tsx` | Crear |
| `frontend/src/shared/ui/gauges/SensorIconSet.tsx` | Crear |
| `frontend/src/features/vehicle/SensorWidget.tsx` | Crear |
| `frontend/src/lib/types.ts` | Extender SensorDef + SensorIcon |
| `frontend/src/features/vehicle/VehicleDetailPage.tsx` | Modificar panel telemetría + DOUT |
| `frontend/src/features/settings/VehicleTypeSensorsSection.tsx` | Modificar para añadir config visual |

---

## 7. Qué NO cambia

- Backend, API, WebSocket — sin cambios
- Migración de BD — no necesaria (JSONB)
- Los sensores existentes que no tengan `icon` ni `color` muestran defaults razonables
- La lógica de `scale`, `offset`, `avl_id` — sin cambios
- CircularGauge, LinearGauge, BatteryGauge, NumericDisplay existentes — sin cambios internos
