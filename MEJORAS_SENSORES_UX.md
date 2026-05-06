# Mejoras UX — Sección Telemetría En Vivo

**Fecha:** 2026-04-30
**Archivos modificados:**
- `frontend/src/features/vehicle/SensorGrid.tsx`
- `frontend/src/shared/ui/gauges/CircularGauge.tsx`
- `frontend/src/shared/ui/gauges/NumericDisplay.tsx`
- `frontend/src/shared/ui/gauges/LinearGauge.tsx`
- `frontend/src/shared/ui/gauges/BatteryGauge.tsx`

---

## Cambios implementados

### 1. Labels completos — sin truncamiento
**Problema:** `truncateLabel()` cortaba a 20 caracteres → "PICO MÁXIMO DE PRES…"
**Solución:**
- Eliminado `truncateLabel()` de SensorGrid. Los labels completos se pasan a los componentes.
- `CircularGauge`: nueva función `splitSvgLabel()` divide el label en 2 líneas SVG (≤15 chars/línea) usando el espacio más cercano al punto medio. Labels cortos: 1 línea en y=VB-8. Labels largos: línea 1 en y=VB-18, línea 2 en y=VB-7.
- `NumericDisplay`, `LinearGauge`, `BatteryGauge`: `wordBreak: 'break-word'`, `textAlign: 'center'`, `lineHeight: 1.35`. Cambiado `display: 'inline-flex'` → `flex` para que el grid controle el ancho.

### 2. Agrupación lógica de sensores
**Problema:** gauges, barras y números mezclados sin jerarquía.
**Solución:** `SensorGrid` ahora detecta y separa en 5 grupos con separadores visuales y títulos de sección:

| Grupo | Criterio | Componente |
|-------|----------|------------|
| Presiones y Niveles | `gauge_type = circular/linear/battery` | CircularGauge / LinearGauge / BatteryGauge |
| Indicadores | `gauge_type = led` | LedIndicator (badge ON/OFF) |
| Contadores de Tiempo | label contiene MIN / MINUTO | TimeCard |
| Contadores | label contiene CANTIDAD / VECES / CICLO / CONTAD | CounterCard |
| Valores | resto de sensores numéricos | NumericDisplay |

Los títulos de grupo solo se muestran cuando hay más de 1 grupo activo.

### 3. Formato correcto para sensores de tiempo
**Problema:** 54 minutos → "0.9 h" (dividiendo por 60 antes de mostrar).
**Solución:** función `formatMinutes(minutes)`:
- `< 60 min` → `"54 min"`
- `>= 60 min` → `"1h 23 min"` o `"2 h"` si no hay minutos extra
- La conversión anterior (value/60 → horas) se elimina; el valor bruto en minutos se pasa directamente.

### 4. CounterCard — contadores como enteros grandes
**Problema:** "CANTIDAD VECES NIVEL = 455" se mostraba como gauge circular o NumericDisplay pequeño.
**Solución:** nuevo componente `CounterCard`:
- Fondo `var(--bg-surface)` con borde `var(--bg-elevated)` para diferenciarlo de TimeCard.
- Valor: entero grande (font-size 34, blanco).
- Sin porcentaje, sin gauge visual.
- Label completo con word-wrap centrado.

### 5. LedIndicator — badges ON/OFF inline
**Solución:** nuevo componente `LedIndicator` en SensorGrid (por si llegan sensores led):
- Layout horizontal: label a la izquierda, badge ON/OFF a la derecha.
- Borde verde cuando activo, gris cuando inactivo.
- Compatible con `bit_index` para lectura de bit individual.

### 6. Consistencia visual
- Gauges circulares y lineales en la misma grid con `minmax(140px, 1fr)`.
- TimeCards: `minmax(150px, 1fr)`.
- CounterCards: `minmax(130px, 1fr)`.
- NumericDisplay: `minmax(110px, 1fr)`.
- Todos los `cardStyle` usan `display: flex` (no `inline-flex`) → el grid controla el ancho uniformemente.

---

## Build
`npm run build` — TypeScript sin errores, Vite build exitoso.
