# DESIGN AUDIT — cmgtrack.com Frontend
**Fecha:** 2026-05-05
**Auditor:** Jon (subagente)
**Alcance:** /opt/cmg-telematic1/frontend/src/

---

## ✅ FIXES APLICADOS

### 1. Variables CSS faltantes en tokens.css
**Problema:** `var(--accent)`, `var(--text-default)`, `var(--text-base)` se usaban en 59+ lugares pero no estaban definidas.
**Fix:** Añadidas a tokens.css como aliases:
```css
--accent:        var(--accent-energy);   /* shorthand */
--accent-orange: #F97316;               /* naranja CAN/PTO */
--text-default:  var(--text-primary);   /* alias (legacy) */
--text-base:     var(--text-primary);   /* alias (legacy) */
```

### 2. Colores hardcodeados en VehicleCard.tsx
**Problema:** STATE_COLORS y stateLabel usaban #22C55E, #EAB308, #EF4444, #78716C, #57534E directamente.
**Fix:** Reemplazados por var(--accent-ok), var(--accent-warn), var(--accent-crit), var(--accent-off), var(--bg-border).

### 3. Colores hardcodeados en FleetDashboard.tsx
**Problema:** stateColor computations inline con hex en 4 lugares (mobile + desktop, list + card view).
**Fix:** Todos reemplazados por CSS vars.
También: contadores de flota (● en ruta, ◑ parados, ○ sin señal) ahora usan CSS vars.

### 4. SVG/Leaflet en FleetMap.tsx — constantes JS
**Problema:** Colores en strings SVG para iconos de Leaflet no pueden usar CSS vars.
**Fix:** Añadidas constantes T_OK, T_WARN, T_CRIT, T_ORANGE, T_INFO, T_OFF, T_ELEVATED, T_MUTED al principio del archivo.
Todos los iconos y popups ahora usan estas constantes vía interpolación de template literals.

### 5. SVG/Leaflet en TrackMap.tsx — constantes JS
**Mismo patrón que FleetMap.** Añadidas T_OK, T_ORANGE, T_INFO.
Iconos de inicio/fin de ruta y track ahora usan las constantes.

### 6. Colores redundantes en gauges/CircularGauge.tsx
**Problema:** #57534E, #3C3330, #78716C en atributos SVG JSX.
**Fix:** Reemplazados por var(--bg-border), var(--gauge-track), var(--accent-off). CSS vars funcionan en SVG JSX.

### 7. NumericDisplay.tsx
**Problema:** `color: '#78716C'` hardcodeado.
**Fix:** → `color: 'var(--accent-off)'`.

### 8. Fallbacks redundantes en VehicleTypesPage, WorkCycleDefsSection, CanScannerPage, etc.
**Problema:** Patrón `var(--text-primary, #E7E5E4)` con fallback innecesario (la var existe).
**Fix:** Simplificado a `var(--text-primary)`, `var(--accent-info)`, `var(--accent-crit)`.

### 9. Colores de ejes de gráficas en ReportsPage.tsx
**Problema:** Tick labels de XAxis/YAxis con `fill: '#78716C'`.
**Fix:** → `fill: 'var(--accent-off)'`.

### 10. Leyenda de ruta en ReportsPage.tsx
**Problema:** span de ● Inicio / ● Fin con hex hardcodeado.
**Fix:** → var(--accent-ok) y var(--accent-info).

---

## ⚠️ PENDIENTE (no arreglado — riesgo medio/alto)

### A. Colores de series Recharts (ReportsPage.tsx, KpiChart.tsx, VehicleTypesPage.tsx)
**Archivos:**
- `ReportsPage.tsx:63` — `CHART_COLORS = ['#F97316', '#22C55E', ...]`
- `ReportsPage.tsx:66` — `GROUP_COLORS = ['#F97316', ...]`
- `ReportsPage.tsx:553-554` — `pieColors1`, `pieColors2`
- `ReportsPage.tsx:575,578` — metric color configs
- `KpiChart.tsx:238-279` — `stroke="#38BDF8"`, `stroke="#F97316"`
- `VehicleTypesPage.tsx:150-153` — default metric colors

**Por qué pendiente:** Son colores de datos de gráficas. Recharts los usa en props de series (`stroke`, `fill` de `<Line>`, `<Bar>`, `<Cell>`). Si bien CSS vars funcionan en SVG, la consistencia visual entre series es más importante que usar tokens. Requieren revisión de paleta de datos dedicada.

**Recomendación:** Crear `CHART_PALETTE = [T_ORANGE, T_OK, T_INFO, T_WARN, T_CRIT]` como centralización mínima.

### B. Badges de severidad dinámicos en ReportsPage.tsx
**Líneas:** 906-907, 1303-1305, 1352, 1361
**Problema:** Usan `\`${colors[status] ?? '#78716C'}22\`` para generar rgba semitransparente (appending hex alpha).
**Por qué pendiente:** CSS vars no pueden usarse así en strings de template. Requeriría refactor a `color-mix()` o clases CSS predefinidas.
**Recomendación:** Crear clases CSS `.badge-crit`, `.badge-warn`, `.badge-info`, `.badge-off` con background/color predefinidos.

### C. BrandTokensEditor.tsx — color inicial
**Línea 18,21,25,26:** `'#F97316'` como color de marca por defecto.
**Por qué pendiente:** Es un valor por defecto de UX/dominio (color de marca del cliente), no un token de diseño. Correcto dejarlo como hex literal.

### D. StatusBadge.tsx — rgba hardcodeados
**Problema:** `bg: 'rgba(34,197,94,0.15)'` etc., aunque `color:` ya usa CSS vars.
**Recomendación:** Usar `color-mix(in srgb, var(--accent-ok) 15%, transparent)` en CSS moderno o mover a CSS classes.

### E. Componentes duplicados / unificación pendiente
**Problema detectado:** Existen patrones de badge de estado dispersos:
1. `StatusBadge.tsx` — componente unificado (bueno)
2. `FleetDashboard.tsx` → dots inline con `<span style={{ borderRadius: '50%', background: stateColor }}>`
3. `VehicleCard.tsx` → `StateDot` componente local
4. `FleetMap.tsx` → HTML strings para Leaflet (no puede unificarse)
**Recomendación:** Extender `StatusBadge` o crear `StateDot` en shared/ui/ y usarlo en FleetDashboard también.

### F. Inconsistencias de spacing
**Problema:** Padding varía sin sistema claro:
- Cards: `padding: '10px 12px'`, `padding: '12px 16px'`, `padding: '8px 14px'`
- Modales: mezclan `padding: 16`, `padding: 20`, `padding: 24`
- Row items: `padding: '5px 8px'`, `padding: '6px 10px'`, `padding: '7px 10px'`
**Recomendación:** Definir escala de spacing en tokens.css: `--sp-xs: 4px`, `--sp-sm: 8px`, `--sp-md: 12px`, `--sp-lg: 16px`, `--sp-xl: 24px`.

### G. Tipografía inconsistente
**Problema:** fontSize 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 26, 30, 34 todos en uso.
La escala razonable sería: 10, 12, 13, 14, 16, 18, 22 (eliminar 9, 11, 15, 20, 26, 30, 34).
**Recomendación:** Definir escala tipográfica en tokens: `--fs-xs: 10px`, `--fs-sm: 12px`, `--fs-base: 13px`, `--fs-md: 14px`, `--fs-lg: 16px`, `--fs-xl: 18px`, `--fs-2xl: 22px`.

### H. Botones sin estilo unificado
**Problema:** Múltiples patrones de botón primario:
1. `background: 'var(--accent-energy)', color: '#fff'` — LoginPage, DevicesPage
2. `background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)'` — botones secundarios
3. Botones inline con padding inconsistente: `padding: '4px 12px'`, `padding: '6px 14px'`, `padding: '5px 10px'`
**Recomendación:** Crear `Button` component en shared/ui/ con variantes `primary`, `secondary`, `danger`.

### I. var(--text-default) / var(--text-base) como debt técnico
**Problema:** 59 instancias del nombre incorrecto. Ahora funcionan gracias a aliases, pero idealmente deberían renombrarse a `var(--text-primary)`.
**Recomendación:** Refactor gradual para unificar a `var(--text-primary)` y eliminar los aliases.

### J. App.tsx error boundary hardcodeado
**Línea 12:** `background: '#1C1917', color: '#ef4444'`
**Estado:** Riesgo muy bajo, es solo el error boundary de desarrollo.
**Recomendación:** Cambiar a `var(--bg-base)` y `var(--accent-crit)`.

---

## 📊 RESUMEN ESTADÍSTICO

| Categoría | Antes | Después |
|-----------|-------|---------|
| Colores hex en style={} | ~90 | ~30 |
| Variables CSS no definidas (--text-default, --accent) | 59 | 0 (aliases añadidos) |
| Fallbacks redundantes `var(--X, #hex)` | ~20 | 0 |
| Constantes centralizadas para SVG/Leaflet | 0 | 2 archivos (T_* consts) |

**Riesgo de regresión visual:** Bajo. Todos los cambios son cosméticamente equivalentes (CSS vars resuelven a los mismos valores hex que se quitaron).

---

*Generado por Jon — subagente de auditoría de diseño*
