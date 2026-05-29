# Rediseño Visual CMG Telematics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar el frontend de la paleta warm-brown a la paleta "sala de control fría" (azul-grises + teal #1D9E75), renombrando todos los tokens CSS de forma limpia (Option B: sin aliases permanentes).

**Architecture:** `tokens.css` se reemplaza en la Tarea 1 con los nuevos tokens + aliases temporales que mantienen CI verde. Las Tareas 2–6 migran los 80 archivos batch por batch eliminando referencias a nombres viejos. La Tarea 7 elimina los aliases y confirma CI limpio. `useAuthStore.ts` e `index.html` también se actualizan.

**Tech Stack:** React 18 + Vite, CSS custom properties, TypeScript, vitest (frontend), pytest (backend). Referencia visual: `/opt/cmg-telematic1/temp/design-system/`.

---

## Mapa de renombrado global

Aplicar estas sustituciones en todo archivo .tsx/.ts/.css que las contenga:

| Token viejo | Token nuevo |
|---|---|
| `--text-muted` | `--fg-muted` |
| `--bg-border` | `--border` |
| `--text-primary` | `--fg-primary` |
| `--accent-energy` | `--cmg-teal` |
| `--font-ui` | `--font-sans` |
| `--accent-off` | `--offline` |
| `--accent-crit` | `--danger` |
| `--font-data` | `--font-mono` |
| `--accent-ok` | `--ok` |
| `--accent-warn` | `--warn` |
| `--accent-info` | `--info` |
| `--text-dim` | `--fg-dim` |
| `--text-base` | `--fg-secondary` |
| `--text-secondary` | `--fg-secondary` |
| `--gauge-track` | `--border` |
| `--gauge-fill` | `--cmg-teal` |
| `--gauge-warn` | `--warn` |
| `--gauge-crit` | `--danger` |
| `--accent-orange` | `--warn` *(o eliminar si era solo decorativo)* |
| `--accent` | `--cmg-teal` |

**Regla adicional — `--bg-elevated`:** si el token se usa como fondo de una **tarjeta o panel de contenido**, reemplazar por `--bg-card`. Si es fondo de un **modal, dropdown o popover**, dejar `--bg-elevated`.

---

## Tarea 1: Fase 0 — tokens.css + fuente Inter Variable

**Files:**
- Modify: `frontend/src/styles/tokens.css`
- Modify: `frontend/index.html`
- Create: `frontend/public/fonts/InterVariable.ttf` *(copiar desde design-system)*

- [ ] **Paso 1: Copiar la fuente**

```bash
cp /opt/cmg-telematic1/temp/design-system/fonts/InterVariable.ttf \
   /opt/cmg-telematic1/frontend/public/fonts/InterVariable.ttf
```

Verificar que existe:
```bash
ls -lh /opt/cmg-telematic1/frontend/public/fonts/InterVariable.ttf
```
Resultado esperado: archivo ~3–4 MB presente.

- [ ] **Paso 2: Reemplazar tokens.css completo**

Reemplazar el contenido íntegro de `frontend/src/styles/tokens.css` con:

```css
/* ── Fuente local Inter Variable ────────────────────────────────────────── */
@font-face {
  font-family: "Inter";
  src: url("/fonts/InterVariable.ttf") format("truetype-variations"),
       url("/fonts/InterVariable.ttf") format("truetype");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
/* JetBrains Mono — Google Fonts (solo mono, Inter ya es local) */
@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap");

:root {
  /* ---------- Brand ---------- */
  --cmg-teal:        #1D9E75;
  --cmg-teal-hover:  #178A66;
  --cmg-teal-dark:   #0F5C42;
  --cmg-teal-soft:   rgba(29, 158, 117, 0.15);
  --cmg-teal-line:   rgba(29, 158, 117, 0.30);

  /* ---------- Background ---------- */
  --bg-base:         #0F1117;
  --bg-surface:      #1A1D27;
  --bg-card:         #1E2532;
  --bg-elevated:     #22263A;
  --bg-hover:        rgba(255, 255, 255, 0.04);
  --bg-active:       rgba(255, 255, 255, 0.06);

  /* ---------- Foreground / text ---------- */
  --fg-primary:      #F1F5F9;
  --fg-secondary:    #E2E8F0;
  --fg-tertiary:     #94A3B8;
  --fg-muted:        #64748B;
  --fg-dim:          #475569;

  /* ---------- Border / divider ---------- */
  --border:          #2D3148;
  --border-soft:     rgba(255, 255, 255, 0.08);
  --border-strong:   rgba(255, 255, 255, 0.16);

  /* ---------- Semantic / status ---------- */
  --ok:              #22C55E;
  --ok-soft:         rgba(34, 197, 94, 0.15);
  --warn:            #F59E0B;
  --warn-soft:       rgba(245, 158, 11, 0.15);
  --danger:          #EF4444;
  --danger-soft:     rgba(239, 68, 68, 0.15);
  --info:            #3B82F6;
  --info-soft:       rgba(59, 130, 246, 0.15);
  --offline:         #64748B;
  --offline-soft:    rgba(100, 116, 139, 0.15);

  /* ---------- Role chips ---------- */
  --role-superadmin: #F87171;
  --role-admin:      #60A5FA;
  --role-operator:   #FB923C;
  --role-viewer:     #94A3B8;
  --role-driver:     #22C55E;

  /* ---------- Typography ---------- */
  --font-sans:  "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif;
  --font-mono:  "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;

  --fs-2xs: 10px;
  --fs-xs:  11px;
  --fs-sm:  12px;
  --fs-md:  13px;
  --fs-base:14px;
  --fs-lg:  16px;
  --fs-xl:  18px;
  --fs-2xl: 22px;
  --fs-3xl: 24px;
  --fs-4xl: 30px;

  --fw-regular:  400;
  --fw-medium:   500;
  --fw-semibold: 600;
  --fw-bold:     700;

  --lh-tight:   1.2;
  --lh-snug:    1.35;
  --lh-normal:  1.5;

  /* ---------- Spacing — 4px base ---------- */
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-8:  32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  /* ---------- Radii ---------- */
  --r-sm:    4px;
  --r-md:    8px;
  --r-lg:    10px;
  --r-xl:    12px;
  --r-2xl:   16px;
  --r-pill:  9999px;

  /* ---------- Shadows ---------- */
  --shadow-sm:    0 1px 2px rgba(0,0,0,0.4);
  --shadow-md:    0 4px 12px rgba(0,0,0,0.5);
  --shadow-lg:    0 8px 32px rgba(0,0,0,0.6);
  --shadow-glow:  0 0 12px var(--cmg-teal-soft);
  --shadow-alert: 0 0 14px rgba(239, 68, 68, 0.40);

  /* ---------- Motion ---------- */
  --ease-out:   cubic-bezier(0.32, 0.72, 0, 1);
  --ease-std:   cubic-bezier(0.4, 0, 0.2, 1);
  --dur-fast:   150ms;
  --dur-base:   200ms;
  --dur-slow:   300ms;

  /* ---------- Touch / a11y ---------- */
  --touch-target: 44px;

  /* ---------- Layout ---------- */
  --sidebar-w: 0px;
  --topbar-h:  62px;

  /* ---------- Chart series (Recharts) ---------- */
  --chart-1: #1D9E75;
  --chart-2: #3B82F6;
  --chart-3: #F59E0B;
  --chart-4: #A78BFA;
  --chart-5: #34D399;
  --chart-6: #FB923C;

  /* ── ALIASES TEMPORALES — eliminar en Tarea 7 ───────────────────────── */
  --text-muted:     var(--fg-muted);
  --bg-border:      var(--border);
  --text-primary:   var(--fg-primary);
  --accent-energy:  var(--cmg-teal);
  --font-ui:        var(--font-sans);
  --accent-off:     var(--offline);
  --accent-crit:    var(--danger);
  --font-data:      var(--font-mono);
  --accent-ok:      var(--ok);
  --accent-warn:    var(--warn);
  --accent-info:    var(--info);
  --text-dim:       var(--fg-dim);
  --text-base:      var(--fg-secondary);
  --text-secondary: var(--fg-secondary);
  --gauge-track:    var(--border);
  --gauge-fill:     var(--cmg-teal);
  --gauge-warn:     var(--warn);
  --gauge-crit:     var(--danger);
  --accent:         var(--cmg-teal);
  --accent-orange:  #F59E0B;
  /* --bg-base, --bg-surface, --bg-elevated conservan nombre — nuevo valor arriba */
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body, #root {
  height: 100%;
  background: var(--bg-base);
  color: var(--fg-secondary);
  font-family: var(--font-sans);
  font-size: var(--fs-base);
  line-height: var(--lh-normal);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a { color: inherit; text-decoration: none; }
button { cursor: pointer; border: none; background: none; font: inherit; color: inherit; }
input { font: inherit; }

@keyframes live-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
.live-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--ok);
  animation: live-pulse 2s ease-in-out infinite;
}

/* ── Responsive utilities ──────────────────────────────────────────────── */
@media (max-width: 767px) {
  .hide-mobile { display: none !important; }
}
@media (min-width: 768px) {
  .show-mobile { display: none !important; }
}
@media (max-width: 767px) {
  html, body, #root { overflow-x: hidden; }
}

/* ── Typography classes ────────────────────────────────────────────────── */
.h1, h1 {
  font-size: var(--fs-3xl); font-weight: var(--fw-bold);
  line-height: var(--lh-tight); color: var(--fg-primary); letter-spacing: -0.01em;
}
.h2, h2 {
  font-size: var(--fs-xl); font-weight: var(--fw-semibold);
  line-height: var(--lh-snug); color: var(--fg-primary);
}
.h3, h3 {
  font-size: var(--fs-lg); font-weight: var(--fw-semibold);
  line-height: var(--lh-snug); color: var(--fg-primary);
}
.kpi-number {
  font-size: var(--fs-2xl); font-weight: var(--fw-bold);
  line-height: 1; letter-spacing: -0.02em; color: var(--fg-primary);
}
.kpi-label, .label-eyebrow {
  font-size: var(--fs-xs); font-weight: var(--fw-semibold);
  color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.06em;
}
.body    { font-size: var(--fs-base); color: var(--fg-secondary); }
.body-sm { font-size: var(--fs-sm);   color: var(--fg-tertiary); }
.caption { font-size: var(--fs-xs);   color: var(--fg-muted); }
.mono, code, .plate { font-family: var(--font-mono); font-size: var(--fs-sm); }
.plate   { font-weight: var(--fw-medium); color: var(--fg-tertiary); letter-spacing: 0.02em; }
```

- [ ] **Paso 3: Quitar Inter de Google Fonts en index.html**

En `frontend/index.html`, eliminar las tres líneas de Google Fonts y dejar solo JetBrains Mono. Reemplazar:

```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

Por:

```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
```

- [ ] **Paso 4: Verificar que el build no rompe**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -20
```

Resultado esperado: `✓ built in` sin errores CSS ni TypeScript.

- [ ] **Paso 5: Commit**

```bash
git add frontend/src/styles/tokens.css frontend/index.html frontend/public/fonts/InterVariable.ttf
git commit -m "style(tokens): adopt cold-palette design system + temp backwards-compat aliases

Inter Variable ahora se sirve localmente desde public/fonts/.
Aliases temporales mantienen CI verde durante la migración de nombres.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 2: Fase 1 — shared/ui átomos (Button, StatusBadge, Tabs, Toast, ConfirmDialog)

**Files:**
- Modify: `frontend/src/shared/ui/Button.tsx`
- Modify: `frontend/src/shared/ui/StatusBadge.tsx`
- Modify: `frontend/src/shared/ui/Tabs.tsx`
- Modify: `frontend/src/shared/ui/Toast.tsx`
- Modify: `frontend/src/shared/ui/ConfirmDialog.tsx`

- [ ] **Paso 1: Migrar Button.tsx**

En `frontend/src/shared/ui/Button.tsx` aplicar estas sustituciones (replace_all):
- `var(--font-ui)` → `var(--font-sans)`
- `var(--accent-energy)` → `var(--cmg-teal)`
- `var(--accent-crit)` → `var(--danger)`
- `var(--text-muted)` → `var(--fg-muted)`
- `var(--bg-border)` → `var(--border)`

Verificar:
```bash
grep -n "var(--accent-\|var(--text-muted\|var(--bg-border\|var(--font-ui\|var(--font-data" \
  frontend/src/shared/ui/Button.tsx
```
Resultado esperado: sin salida.

- [ ] **Paso 2: Migrar StatusBadge.tsx**

En `frontend/src/shared/ui/StatusBadge.tsx` aplicar:
- `var(--accent-ok)` → `var(--ok)`
- `var(--accent-off)` → `var(--offline)`
- `var(--accent-energy)` → `var(--cmg-teal)`
- `var(--accent-warn)` → `var(--warn)`
- `var(--accent-crit)` → `var(--danger)`
- `var(--font-ui)` → `var(--font-sans)`

También actualizar los colores de fondo hardcodeados de los status chips para usar los tokens soft:
- `rgba(34,197,94,0.15)` → `var(--ok-soft)`
- `rgba(120,113,108,0.2)` → `var(--offline-soft)`
- `rgba(234,179,8,0.15)` → `var(--warn-soft)`
- `rgba(239,68,68,0.15)` → `var(--danger-soft)`
- Los fondos `rgba(*,0.15)` de teal/energy → `var(--cmg-teal-soft)`

Verificar:
```bash
grep -n "var(--accent-\|var(--text-muted\|var(--font-ui" \
  frontend/src/shared/ui/StatusBadge.tsx
```
Resultado esperado: sin salida.

- [ ] **Paso 3: Migrar Tabs.tsx**

En `frontend/src/shared/ui/Tabs.tsx` aplicar:
- `var(--accent-energy)` → `var(--cmg-teal)`
- `var(--text-muted)` → `var(--fg-muted)`
- `var(--text-primary)` → `var(--fg-primary)`
- `var(--bg-border)` → `var(--border)`
- `var(--bg-elevated)` → `var(--bg-card)` *(si es fondo de panel, no modal)*
- `var(--font-ui)` → `var(--font-sans)`

Verificar:
```bash
grep -n "var(--accent-\|var(--text-muted\|var(--text-primary\|var(--bg-border\|var(--font-ui" \
  frontend/src/shared/ui/Tabs.tsx
```
Resultado esperado: sin salida.

- [ ] **Paso 4: Migrar Toast.tsx**

En `frontend/src/shared/ui/Toast.tsx` aplicar el mapa global completo. Los toasts usan `--accent-ok`, `--accent-warn`, `--accent-crit`, `--accent-info`. Reemplazos:
- `var(--accent-ok)` → `var(--ok)`
- `var(--accent-warn)` → `var(--warn)`
- `var(--accent-crit)` → `var(--danger)`
- `var(--accent-info)` → `var(--info)`
- `var(--bg-elevated)` → `var(--bg-elevated)` *(los toasts son modales flotantes, mantener elevated)*
- `var(--bg-border)` → `var(--border)`
- `var(--text-primary)` → `var(--fg-primary)`
- `var(--text-muted)` → `var(--fg-muted)`

Verificar:
```bash
grep -n "var(--accent-\|var(--text-muted\|var(--text-primary\|var(--bg-border\|var(--font-ui" \
  frontend/src/shared/ui/Toast.tsx
```
Resultado esperado: sin salida.

- [ ] **Paso 5: Migrar ConfirmDialog.tsx**

En `frontend/src/shared/ui/ConfirmDialog.tsx` aplicar el mapa global. El modal usa `--bg-elevated` (correcto, es un modal). Mantener `--bg-elevated` para el contenedor del modal. Reemplazar:
- `var(--accent-crit)` → `var(--danger)`
- `var(--accent-energy)` → `var(--cmg-teal)`
- `var(--accent-warn)` → `var(--warn)`
- `var(--text-primary)` → `var(--fg-primary)`
- `var(--text-muted)` → `var(--fg-muted)`
- `var(--bg-border)` → `var(--border)`
- `var(--font-ui)` → `var(--font-sans)`

Verificar:
```bash
grep -n "var(--accent-\|var(--text-muted\|var(--text-primary\|var(--bg-border\|var(--font-ui" \
  frontend/src/shared/ui/ConfirmDialog.tsx
```
Resultado esperado: sin salida.

---

## Tarea 3: Fase 1 — shared/ui chrome (Shell, Sidebar, TopNav, Topbar, SkeletonCard, CmgLogo, misceláneos)

**Files:**
- Modify: `frontend/src/shared/ui/Shell.tsx`
- Modify: `frontend/src/shared/ui/Sidebar.tsx`
- Modify: `frontend/src/shared/ui/TopNav.tsx`
- Modify: `frontend/src/shared/ui/Topbar.tsx`
- Modify: `frontend/src/shared/ui/SkeletonCard.tsx`
- Modify: `frontend/src/shared/ui/CmgLogo.tsx`
- Modify: `frontend/src/shared/ui/SectionErrorBoundary.tsx`
- Modify: `frontend/src/shared/ui/GeofenceMapEditor.tsx`

- [ ] **Paso 1: Migrar Shell.tsx**

Aplicar el mapa global. `Shell.tsx` define el layout raíz con sidebar y topbar; sus fondos son de chrome → usar `--bg-surface` (no `--bg-card`).
- `var(--bg-border)` → `var(--border)`
- `var(--font-ui)` → `var(--font-sans)`
- `var(--text-primary)` → `var(--fg-primary)`
- `var(--text-muted)` → `var(--fg-muted)`

- [ ] **Paso 2: Migrar Sidebar.tsx**

Tiene una línea especial: `color-mix(in srgb, var(--accent-energy) 15%, transparent)`. Reemplazar esa expresión completa por `var(--cmg-teal-soft)`. Luego aplicar el resto del mapa:
- `var(--accent-energy)` → `var(--cmg-teal)`
- `var(--text-muted)` → `var(--fg-muted)` (usos de `--text-muted` para ítem inactivo)
- `var(--bg-surface)` permanece (correcto para sidebar)
- `var(--bg-border)` → `var(--border)`
- `var(--accent-crit)` → `var(--danger)` (badge de alerta)
- `var(--bg-border)` → `var(--border)` (línea divisoria sidebar)

Verificar:
```bash
grep -n "var(--accent-\|var(--text-muted\|var(--bg-border\|color-mix" \
  frontend/src/shared/ui/Sidebar.tsx
```
Resultado esperado: sin salida.

- [ ] **Paso 3: Migrar TopNav.tsx** (71 usos de tokens — el mayor de shared/ui)

Aplicar todo el mapa global. Prioridades:
- `var(--accent-energy)` → `var(--cmg-teal)` (ítem activo, indicadores)
- `var(--text-muted)` → `var(--fg-muted)` o `var(--fg-tertiary)` según contexto (ítems inactivos → fg-tertiary; texto secundario → fg-muted)
- `var(--text-primary)` → `var(--fg-primary)`
- `var(--bg-border)` → `var(--border)`
- `var(--bg-elevated)` → `var(--bg-elevated)` *(dropdowns = elevated, correcto)*
- `var(--accent-crit)` → `var(--danger)`
- `var(--font-ui)` → `var(--font-sans)`

Verificar:
```bash
grep -n "var(--accent-\|var(--text-muted\|var(--text-primary\|var(--bg-border\|var(--font-ui\|var(--font-data" \
  frontend/src/shared/ui/TopNav.tsx
```
Resultado esperado: sin salida.

- [ ] **Paso 4: Migrar Topbar.tsx, SkeletonCard.tsx, CmgLogo.tsx, SectionErrorBoundary.tsx, GeofenceMapEditor.tsx**

Aplicar el mapa global a cada uno. En `GeofenceMapEditor.tsx` los fondos de panel son tarjeta → usar `--bg-card` si eran `--bg-elevated`.

Verificar todos de una:
```bash
grep -n "var(--accent-\|var(--text-muted\|var(--text-primary\|var(--bg-border\|var(--font-ui\|var(--font-data" \
  frontend/src/shared/ui/Topbar.tsx \
  frontend/src/shared/ui/SkeletonCard.tsx \
  frontend/src/shared/ui/CmgLogo.tsx \
  frontend/src/shared/ui/SectionErrorBoundary.tsx \
  frontend/src/shared/ui/GeofenceMapEditor.tsx
```
Resultado esperado: sin salida.

- [ ] **Paso 5: Commit Fase 1**

```bash
git add frontend/src/shared/ui/
git commit -m "style(shared): migrate shared UI atoms + chrome to new design tokens

Fase 1 completada: Button, StatusBadge, Tabs, Toast, ConfirmDialog,
Shell, Sidebar, TopNav, Topbar, SkeletonCard, CmgLogo, GeofenceMapEditor.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 4: Fase 1 — Gauges SVG

**Files:**
- Modify: `frontend/src/shared/ui/gauges/CircularGauge.tsx`
- Modify: `frontend/src/shared/ui/gauges/LinearGauge.tsx`
- Modify: `frontend/src/shared/ui/gauges/BatteryGauge.tsx`
- Modify: `frontend/src/shared/ui/gauges/NumericDisplay.tsx`

- [ ] **Paso 1: Migrar CircularGauge.tsx**

`CircularGauge.tsx` usa `--gauge-track`, `--gauge-fill`, `--gauge-warn`, `--gauge-crit` (cubiertos por alias) y también `--accent-energy`, `--accent-off`, `--font-data`, `--font-ui`, `--bg-border`. Reemplazos:

- `var(--gauge-track)` → `var(--border)`
- `var(--gauge-fill)` → `var(--cmg-teal)`
- `var(--gauge-warn)` → `var(--warn)`
- `var(--gauge-crit)` → `var(--danger)`
- `var(--accent-energy)` → `var(--cmg-teal)`
- `var(--accent-off)` → `var(--offline)`
- `var(--font-data)` → `var(--font-mono)`
- `var(--font-ui)` → `var(--font-sans)`
- `var(--bg-border)` → `var(--border)`
- `var(--bg-elevated)` → `var(--bg-card)` *(si fondo de contenedor gauge)*
- `var(--accent-warn)` → `var(--warn)`
- `var(--accent-crit)` → `var(--danger)`

La función `_colorForValue` devuelve strings como `'var(--accent-crit)'` etc. Actualizar también esos string literals.

- [ ] **Paso 2: Migrar LinearGauge.tsx, BatteryGauge.tsx, NumericDisplay.tsx**

Aplicar el mismo mapa a los tres archivos. Los tres usan subset de los tokens del gauge.

- [ ] **Paso 3: Verificar gauges**

```bash
grep -rn "var(--accent-\|var(--gauge-\|var(--font-data\|var(--font-ui\|var(--bg-border\|var(--text-muted" \
  frontend/src/shared/ui/gauges/
```
Resultado esperado: sin salida.

- [ ] **Paso 4: Commit gauges**

```bash
git add frontend/src/shared/ui/gauges/
git commit -m "style(gauges): migrate SVG gauges to new design tokens

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 5: Fase 2 — Flota (FleetDashboard, FleetMap, VehicleCard, VehicleList, VehicleRow, VehicleDeviceSection)

**Files:**
- Modify: `frontend/src/features/fleet/FleetDashboard.tsx`
- Modify: `frontend/src/features/fleet/FleetMap.tsx`
- Modify: `frontend/src/features/fleet/VehicleCard.tsx`
- Modify: `frontend/src/features/fleet/VehicleList.tsx`
- Modify: `frontend/src/features/fleet/VehicleRow.tsx`
- Modify: `frontend/src/features/fleet/VehicleDeviceSection.tsx`

- [ ] **Paso 1: Migrar los 6 archivos de flota**

Para cada archivo aplicar el mapa global. Notas específicas:
- `VehicleCard.tsx`: los fondos de tarjeta `--bg-elevated` → `--bg-card`; el borde de tarjeta seleccionada debe ser `1px solid var(--cmg-teal)` con fondo `var(--cmg-teal-soft)`
- `FleetMap.tsx`: los popups del mapa son floating → `--bg-elevated` (correcto)
- `FleetDashboard.tsx`: sidebar lateral de flota es panel de contenido → `--bg-surface`

- [ ] **Paso 2: Verificar flota**

```bash
grep -rn "var(--accent-\|var(--text-muted\|var(--text-primary\|var(--bg-border\|var(--font-ui\|var(--font-data\|var(--gauge-" \
  frontend/src/features/fleet/
```
Resultado esperado: sin salida.

- [ ] **Paso 3: Commit flota**

```bash
git add frontend/src/features/fleet/
git commit -m "style(fleet): migrate fleet feature to new design tokens

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 6: Fase 2 — Detalle de vehículo

**Files:**
- Modify: `frontend/src/features/vehicle/VehicleDetailPage.tsx`
- Modify: `frontend/src/features/vehicle/VehicleHeader.tsx`
- Modify: `frontend/src/features/vehicle/StatusPanel.tsx`
- Modify: `frontend/src/features/vehicle/SensorGrid.tsx`
- Modify: `frontend/src/features/vehicle/KpiChart.tsx`
- Modify: `frontend/src/features/vehicle/TrackMap.tsx`
- Modify: `frontend/src/features/vehicle/WorkCyclesTab.tsx`

- [ ] **Paso 1: Migrar los 7 archivos de vehicle detail**

Aplicar el mapa global. Notas:
- `SensorGrid.tsx`: los paneles de sensor son tarjetas → `--bg-card` para fondos de card
- `KpiChart.tsx`: las series Recharts usan `--chart-1..6` que ya están en el nuevo tokens.css con valores actualizados. No hay renames de tokens aquí, solo verificar que `--chart-1` ahora es `#1D9E75` (teal) en lugar de `#00C8C8`.
- `VehicleDetailPage.tsx`: fondos de sección lateral → `--bg-surface`

- [ ] **Paso 2: Verificar vehicle**

```bash
grep -rn "var(--accent-\|var(--text-muted\|var(--text-primary\|var(--bg-border\|var(--font-ui\|var(--font-data\|var(--gauge-" \
  frontend/src/features/vehicle/
```
Resultado esperado: sin salida.

- [ ] **Paso 3: Commit vehicle**

```bash
git add frontend/src/features/vehicle/
git commit -m "style(vehicle): migrate vehicle detail feature to new design tokens

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 7: Fase 3 — Auth + Dashboard + Alertas

**Files:**
- Modify: `frontend/src/features/auth/LoginPage.tsx`
- Modify: `frontend/src/features/auth/RequireAuth.tsx`
- Modify: `frontend/src/features/dashboard/DashboardPage.tsx`
- Modify: `frontend/src/features/alerts/AlertsPage.tsx`
- Modify: `frontend/src/features/alerts/ActiveAlertsList.tsx`
- Modify: `frontend/src/features/alerts/AlertHistory.tsx`
- Modify: `frontend/src/features/alerts/AckModal.tsx`

- [ ] **Paso 1: Migrar LoginPage.tsx**

Notas especiales:
- La tarjeta de login (`background: var(--bg-surface)` con `border: var(--bg-elevated)`) es un card → fondo debe ser `--bg-card`, borde `--border`
- `var(--bg-elevated)` en los inputs (fondo de input) → mantener `--bg-elevated` (los inputs se elevan sobre el card)
- `var(--text-dim)` → `var(--fg-dim)` (labels de inputs)
- `var(--text-primary)` → `var(--fg-primary)` (texto de input)
- `var(--accent-energy)` → `var(--cmg-teal)` (botón submit)
- `var(--accent-off)` → `var(--offline)` (botón disabled)
- `var(--accent-crit)` → `var(--danger)` (error)
- `var(--text-muted)` → `var(--fg-muted)` (texto auxiliar)
- `var(--bg-border)` → `var(--border)` (borde inputs)
- `var(--font-ui)` → `var(--font-sans)`

- [ ] **Paso 2: Migrar RequireAuth.tsx, DashboardPage.tsx**

Aplicar mapa global. `DashboardPage.tsx` tiene KPI cards → fondos `--bg-card`.

- [ ] **Paso 3: Migrar los 4 archivos de alertas**

Aplicar mapa global. `AckModal.tsx` es un modal → fondo `--bg-elevated` (correcto). Las filas de alerta son tarjetas → `--bg-card`. El badge de severidad usa `--accent-crit` → `--danger`.

- [ ] **Paso 4: Verificar**

```bash
grep -rn "var(--accent-\|var(--text-muted\|var(--text-primary\|var(--bg-border\|var(--font-ui\|var(--font-data\|var(--text-dim" \
  frontend/src/features/auth/ \
  frontend/src/features/dashboard/ \
  frontend/src/features/alerts/
```
Resultado esperado: sin salida.

- [ ] **Paso 5: Commit**

```bash
git add frontend/src/features/auth/ frontend/src/features/dashboard/ frontend/src/features/alerts/
git commit -m "style(auth,dashboard,alerts): migrate to new design tokens

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 8: Fase 4 — Órdenes de trabajo + Mantenimiento

**Files:**
- Modify: `frontend/src/features/work-orders/WorkOrdersPage.tsx`
- Modify: `frontend/src/features/work-orders/WorkReportModal.tsx`
- Modify: `frontend/src/features/maintenance/MaintenancePage.tsx`
- Modify: `frontend/src/features/maintenance/MaintenancePlanDetailPage.tsx`
- Modify: `frontend/src/features/maintenance/MaintenancePlanFormPage.tsx`
- Modify: `frontend/src/features/maintenance/LogInterventionModal.tsx`
- Modify: `frontend/src/features/maintenance/ProgressBar.tsx`
- Modify: `frontend/src/features/maintenance/ThresholdBuilder.tsx`

- [ ] **Paso 1: Migrar los 8 archivos**

Aplicar mapa global. Notas:
- Modales (`WorkReportModal`, `LogInterventionModal`) → fondos `--bg-elevated`
- Páginas de lista/detalle → fondos de card `--bg-card`
- `ProgressBar.tsx` usa `--accent-energy` para barra de progreso → `--cmg-teal`; `--accent-warn` → `--warn`; `--accent-crit` → `--danger`

- [ ] **Paso 2: Verificar**

```bash
grep -rn "var(--accent-\|var(--text-muted\|var(--text-primary\|var(--bg-border\|var(--font-ui\|var(--font-data" \
  frontend/src/features/work-orders/ \
  frontend/src/features/maintenance/
```
Resultado esperado: sin salida.

- [ ] **Paso 3: Commit**

```bash
git add frontend/src/features/work-orders/ frontend/src/features/maintenance/
git commit -m "style(work-orders,maintenance): migrate to new design tokens

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 9: Fase 4 — Reglas + Reportes

**Files:**
- Modify: `frontend/src/features/rules/RulesPage.tsx`
- Modify: `frontend/src/features/rules/RuleFormPage.tsx`
- Modify: `frontend/src/features/rules/ConditionBuilder.tsx`
- Modify: `frontend/src/features/rules/ActionsList.tsx`
- Modify: `frontend/src/features/rules/EscalationBuilder.tsx`
- Modify: `frontend/src/features/rules/VehicleFilterPicker.tsx`
- Modify: `frontend/src/features/reports/ReportsPage.tsx`
- Modify: `frontend/src/features/reports/ReportFilters.tsx`

- [ ] **Paso 1: Migrar los 8 archivos**

Aplicar mapa global. `RuleFormPage.tsx` es la más grande — leer antes de editar para no perder el contexto de colores de severidad. Las rules usan `--accent-crit` → `--danger`, `--accent-warn` → `--warn`, `--accent-ok` → `--ok`.

- [ ] **Paso 2: Verificar**

```bash
grep -rn "var(--accent-\|var(--text-muted\|var(--text-primary\|var(--bg-border\|var(--font-ui\|var(--font-data" \
  frontend/src/features/rules/ \
  frontend/src/features/reports/
```
Resultado esperado: sin salida.

- [ ] **Paso 3: Commit**

```bash
git add frontend/src/features/rules/ frontend/src/features/reports/
git commit -m "style(rules,reports): migrate to new design tokens

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 10: Fase 5 — Admin / Clientes + Settings

**Files:**
- Modify: `frontend/src/features/clientes/TenantsPage.tsx`
- Modify: `frontend/src/features/clientes/TenantDetailPage.tsx`
- Modify: `frontend/src/features/clientes/TenantFormPage.tsx`
- Modify: `frontend/src/features/clientes/BrandTokensEditor.tsx`
- Modify: `frontend/src/features/clientes/GrantsSection.tsx`
- Modify: `frontend/src/features/clientes/UserFormModal.tsx`
- Modify: `frontend/src/features/settings/SettingsPage.tsx`
- Modify: `frontend/src/features/settings/UsersSection.tsx`
- Modify: `frontend/src/features/settings/NotificationSettings.tsx`
- Modify: `frontend/src/features/settings/VehicleTypeSensorsSection.tsx`
- Modify: `frontend/src/features/settings/WorkCycleDefinitionsSection.tsx`

- [ ] **Paso 1: Migrar los 11 archivos con el mapa global**

- [ ] **Paso 2: Actualizar BrandTokensEditor.tsx — caso especial**

`BrandTokensEditor.tsx` tiene además tokens en el estilo inline del input y del botón. Después del mapa global, el archivo ya no debe contener `var(--accent-energy)` ni otros tokens viejos.

- [ ] **Paso 3: Verificar**

```bash
grep -rn "var(--accent-\|var(--text-muted\|var(--text-primary\|var(--bg-border\|var(--font-ui\|var(--font-data" \
  frontend/src/features/clientes/ \
  frontend/src/features/settings/
```
Resultado esperado: sin salida.

- [ ] **Paso 4: Commit**

```bash
git add frontend/src/features/clientes/ frontend/src/features/settings/
git commit -m "style(admin,settings): migrate to new design tokens

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 11: Fase 5 — Vehicles + long tail + useAuthStore + App.tsx

**Files:**
- Modify: `frontend/src/features/vehicles/VehiclesPage.tsx`
- Modify: `frontend/src/features/vehicles/VehicleTypesPage.tsx`
- Modify: `frontend/src/features/vehicles/AlertRulesSection.tsx`
- Modify: `frontend/src/features/vehicles/DoutConfigSection.tsx`
- Modify: `frontend/src/features/vehicles/HistoricMetricsSection.tsx`
- Modify: `frontend/src/features/vehicles/MaintenanceTemplatesSection.tsx`
- Modify: `frontend/src/features/vehicles/PdfMetricsSection.tsx`
- Modify: `frontend/src/features/vehicles/WorkCycleDefsSection.tsx`
- Modify: `frontend/src/features/devices/DevicesPage.tsx`
- Modify: `frontend/src/features/geofences/GeofencesPage.tsx`
- Modify: `frontend/src/features/drivers/DriversPage.tsx`
- Modify: `frontend/src/features/diagnostics/CanScannerPage.tsx`
- Modify: `frontend/src/features/portal/ClientPortalPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/features/auth/useAuthStore.ts`

- [ ] **Paso 1: Migrar los 14 archivos de features con el mapa global**

- [ ] **Paso 2: Actualizar useAuthStore.ts — caso especial**

`useAuthStore.ts` inyecta y elimina `--accent-energy` directamente en el DOM. Hay dos líneas:

Línea ~88 (logout):
```typescript
document.documentElement.style.removeProperty('--accent-energy')
```
Cambiar a:
```typescript
document.documentElement.style.removeProperty('--cmg-teal')
```

Línea ~120 (applyBrandTokens):
```typescript
root.style.setProperty('--accent-energy', tokens.brand_color)
```
Cambiar a:
```typescript
root.style.setProperty('--cmg-teal', tokens.brand_color)
```

- [ ] **Paso 3: Verificar todo el long tail + useAuthStore**

```bash
grep -rn "var(--accent-\|var(--text-muted\|var(--text-primary\|var(--bg-border\|var(--font-ui\|var(--font-data\|var(--gauge-" \
  frontend/src/features/vehicles/ \
  frontend/src/features/devices/ \
  frontend/src/features/geofences/ \
  frontend/src/features/drivers/ \
  frontend/src/features/diagnostics/ \
  frontend/src/features/portal/ \
  frontend/src/App.tsx

grep -n "accent-energy" frontend/src/features/auth/useAuthStore.ts
```
Resultado esperado: sin salida en ambos comandos.

- [ ] **Paso 4: Commit**

```bash
git add frontend/src/features/vehicles/ \
        frontend/src/features/devices/ \
        frontend/src/features/geofences/ \
        frontend/src/features/drivers/ \
        frontend/src/features/diagnostics/ \
        frontend/src/features/portal/ \
        frontend/src/App.tsx \
        frontend/src/features/auth/useAuthStore.ts
git commit -m "style(vehicles,devices,portal,auth): migrate remaining features to new tokens

Incluye useAuthStore.ts: applyBrandTokens ahora inyecta --cmg-teal.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Tarea 12: Fase 6 — Limpieza final y cierre

**Files:**
- Modify: `frontend/src/styles/tokens.css` *(eliminar bloque de aliases)*

- [ ] **Paso 1: Verificar que cero archivos usan tokens viejos**

```bash
grep -rn \
  "var(--accent-energy)\|var(--accent-ok)\|var(--accent-warn)\|var(--accent-crit)\|var(--accent-info)\|var(--accent-off)\|var(--accent-orange)\|var(--accent)\b" \
  frontend/src --include="*.tsx" --include="*.ts" --include="*.css"
```
Resultado esperado: sin salida. Si aparece algún archivo → migrarlo antes de continuar.

```bash
grep -rn \
  "var(--text-muted)\|var(--text-primary)\|var(--text-dim)\|var(--text-base)\|var(--text-secondary)\|var(--bg-border)\|var(--font-ui)\|var(--font-data)\|var(--gauge-" \
  frontend/src --include="*.tsx" --include="*.ts" --include="*.css"
```
Resultado esperado: sin salida.

- [ ] **Paso 2: Eliminar el bloque de aliases de tokens.css**

En `frontend/src/styles/tokens.css`, eliminar el bloque completo que empieza con:
```
  /* ── ALIASES TEMPORALES — eliminar en Tarea 7 ───────────────────────── */
```
y termina con:
```
  /* --bg-base, --bg-surface, --bg-elevated conservan nombre — nuevo valor arriba */
```

- [ ] **Paso 3: Build final**

```bash
cd /opt/cmg-telematic1/frontend && npm run build 2>&1 | tail -20
```
Resultado esperado: `✓ built in` sin errores.

- [ ] **Paso 4: Tests frontend**

```bash
cd /opt/cmg-telematic1/frontend && npm run test -- --run 2>&1 | tail -30
```
Resultado esperado: todos los tests pasan. Si algún snapshot falla por cambio de token en un test, actualizarlo con `npm run test -- --run --update-snapshots`.

- [ ] **Paso 5: Actualizar CLAUDE.md sección 9B**

En `/opt/cmg-telematic1/CLAUDE.md` sección 9B, actualizar los tokens documentados para reflejar la nueva paleta. Buscar la sección que contiene `--accent-energy: #6EC5B1` (el teal claro anterior) y sustituir todo el bloque de CSS variables por los nuevos valores (`--cmg-teal: #1D9E75`, `--bg-base: #0F1117`, etc.).

- [ ] **Paso 6: Commit final**

```bash
git add frontend/src/styles/tokens.css CLAUDE.md
git commit -m "style(tokens): remove temp backwards-compat aliases — migration complete

Todos los 80 archivos migrados a nuevos nombres de token.
--cmg-teal #1D9E75 reemplaza --accent-energy #6EC5B1.
Inter Variable servido localmente.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Paso 7: Push a origin**

```bash
git push origin master
```

CI esperado: backend-tests ✓ · frontend-tests ✓ · smoke-test ✓

---

## Verificación post-migración

Abrir en el navegador y verificar visualmente:

| Pantalla | Qué comprobar |
|---|---|
| `/login` | Fondo `#0F1117`, card `#1E2532`, botón submit teal `#1D9E75` |
| `/fleet` | Sidebar `#1A1D27`, borde `#2D3148`, ítems inactivos `#94A3B8`, activo teal |
| `/vehicles/:id` | Gauges con track gris azulado, fill teal, warn ámbar, danger rojo |
| `/alerts` | Chips de severidad: danger rojo con fondo `danger-soft` |
| `/dashboard` | KPI cards `#1E2532`, gráficas con `--chart-1` teal |
| `/login` en tenant con brand_color | Color de botón submit refleja el brand_color del tenant (via `--cmg-teal`) |
