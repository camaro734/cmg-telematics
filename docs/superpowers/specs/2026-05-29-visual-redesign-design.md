# Spec: Rediseño visual completo — paleta "sala de control fría"

**Fecha:** 2026-05-29
**Autor:** Carlos / CMG Metalhidráulica
**Estado:** Aprobado por Carlos — listo para implementación

---

## 1. Objetivo

Migrar el frontend de la paleta industrial cálida (warm brown + naranja) a la paleta "sala de control fría" definida en `/opt/cmg-telematic1/temp/design-system/`. La fuente de verdad visual es ese directorio: `colors_and_type.css`, `README.md`, `preview/` y `ui_kits/web/`.

El cambio afecta exclusivamente a la capa visual (tokens CSS + referencias en componentes). No cambia ningún contrato de API, modelo de datos, lógica de negocio ni estructura de rutas.

---

## 2. Fuente de verdad del diseño

| Recurso | Ruta | Uso |
|---|---|---|
| Tokens completos | `temp/design-system/colors_and_type.css` | Copiar verbatim a `tokens.css` |
| README visual | `temp/design-system/README.md` | Reglas de uso: radios, sombras, hover, motion |
| UI kit web | `temp/design-system/ui_kits/web/` | Referencia de componentes (Sidebar, Button, Chip, Gauge…) |
| Preview cards | `temp/design-system/preview/*.html` | Referencia visual de cada token y componente |
| Fuente | `temp/design-system/fonts/InterVariable.ttf` | Copiar a `frontend/public/fonts/` |

**Regla:** el kit (`ui_kits/web/`) son **prototipos de referencia**, no código de producción. Se usa para entender el aspecto esperado, no para copiar JSX directamente.

---

## 3. Paleta nueva vs actual

### Fondos (warm brown → cool blue-grey)

| Token | Antes | Después |
|---|---|---|
| `--bg-base` | `#1C1917` | `#0F1117` |
| `--bg-surface` | `#292524` | `#1A1D27` |
| `--bg-card` | *(no existía)* | `#1E2532` |
| `--bg-elevated` | `#3C3330` | `#22263A` |
| `--bg-hover` | *(no existía)* | `rgba(255,255,255,0.04)` |
| `--bg-active` | *(no existía)* | `rgba(255,255,255,0.06)` |

### Acento de marca

| Token | Antes | Después |
|---|---|---|
| `--cmg-teal` | *(no existía; `--accent-energy: #6EC5B1`)* | `#1D9E75` |
| `--cmg-teal-hover` | — | `#178A66` |
| `--cmg-teal-dark` | — | `#0F5C42` |
| `--cmg-teal-soft` | — | `rgba(29,158,117,0.15)` |
| `--cmg-teal-line` | — | `rgba(29,158,117,0.30)` |

### Texto

| Token nuevo | Token viejo eliminado | Valor nuevo |
|---|---|---|
| `--fg-primary` | `--text-primary` | `#F1F5F9` |
| `--fg-secondary` | *(no había equiv. exacto)* | `#E2E8F0` |
| `--fg-tertiary` | `--text-dim` | `#94A3B8` |
| `--fg-muted` | `--text-muted` | `#64748B` |
| `--fg-dim` | — | `#475569` |

### Bordes

| Token nuevo | Token viejo eliminado | Valor |
|---|---|---|
| `--border` | `--bg-border` | `#2D3148` |
| `--border-soft` | — | `rgba(255,255,255,0.08)` |
| `--border-strong` | — | `rgba(255,255,255,0.16)` |

### Status semánticos

| Token nuevo | Token viejo eliminado |
|---|---|
| `--ok` | `--accent-ok` |
| `--warn` | `--accent-warn` |
| `--danger` | `--accent-crit` |
| `--info` | `--accent-info` |
| `--offline` | `--accent-off` |
| `--ok-soft` / `--warn-soft` / `--danger-soft` / `--info-soft` / `--offline-soft` | *(nuevos)* |

### Tipografía

| Token nuevo | Token viejo eliminado |
|---|---|
| `--font-sans` | `--font-ui` |
| `--font-mono` | `--font-data` |
| `--fs-*` (2xs…4xl) | `--text-xs…text-4xl` |
| `--fw-regular/medium/semibold/bold` | *(nuevos)* |
| `--lh-tight/snug/normal` | *(nuevos)* |

### Espaciado

| Token nuevo | Token viejo |
|---|---|
| `--space-1…16` | `--sp-1…8` |

### Tokens enteramente nuevos (sin equivalente actual)

`--r-sm/md/lg/xl/2xl/pill` · `--shadow-sm/md/lg/glow/alert` · `--ease-out/std` · `--dur-fast/base/slow` · `--touch-target` · `--role-superadmin/admin/operator/viewer/driver`

---

## 4. Tokens eliminados (no tienen equivalente en el nuevo sistema)

- `--accent-orange` (alias de `#F97316`) — el naranja de CAN/PTO pasa a `--warn` o inline en casos muy específicos
- `--text-default`, `--text-base` — aliases legacy, no se migran
- `--gauge-track`, `--gauge-fill`, `--gauge-warn`, `--gauge-crit` — los gauges usan directamente `--border`, `--cmg-teal`, `--warn`, `--danger`
- `--chart-1…6` — las series de gráficas se asignan con valores inline en los componentes Recharts

---

## 5. Fuente Inter Variable

- **Origen:** `temp/design-system/fonts/InterVariable.ttf`
- **Destino:** `frontend/public/fonts/InterVariable.ttf`
- **Declaración en tokens.css:**
  ```css
  @font-face {
    font-family: "Inter";
    src: url("/fonts/InterVariable.ttf") format("truetype-variations"),
         url("/fonts/InterVariable.ttf") format("truetype");
    font-weight: 100 900;
    font-style: normal;
    font-display: swap;
  }
  ```
- La ruta `/fonts/` funciona porque Vite sirve `public/` como raíz estática.

---

## 6. Estrategia de migración — Option B (rename limpio)

### Mecanismo de transición segura

`tokens.css` se reemplaza en la Fase 0 con el nuevo contenido **más aliases temporales** que mapean todos los nombres viejos a los nuevos valores. Esto mantiene el CI verde durante las Fases 1–5. En la Fase 6 se eliminan los aliases.

```css
/* ALIASES TEMPORALES — eliminar en Fase 6 */
:root {
  --text-muted:    var(--fg-muted);
  --bg-border:     var(--border);
  --text-primary:  var(--fg-primary);
  --accent-energy: var(--cmg-teal);
  --font-ui:       var(--font-sans);
  --accent-off:    var(--offline);
  --accent-crit:   var(--danger);
  --font-data:     var(--font-mono);
  --accent-ok:     var(--ok);
  --accent-warn:   var(--warn);
  --accent-info:   var(--info);
  --text-dim:      var(--fg-dim);
  --text-base:     var(--fg-secondary);
  --text-secondary: var(--fg-secondary);
  --gauge-track:   var(--border);
  --gauge-fill:    var(--cmg-teal);
  --gauge-warn:    var(--warn);
  --gauge-crit:    var(--danger);
  /* --bg-base, --bg-surface, --bg-elevated conservan el mismo nombre;
     solo cambia su valor en la declaración principal. No necesitan alias. */
}
```

### Regla de uso de `--bg-card` vs `--bg-elevated`

Al migrar cada componente:
- Fondo de **tarjeta/panel** → `--bg-card` (`#1E2532`)
- Fondo de **modal/dropdown** → `--bg-elevated` (`#22263A`)
- El criterio es elevación real, no el nombre que tenía antes.

---

## 7. Fases de implementación

### Fase 0 — Infraestructura tokens + fuente
**Archivos:** `tokens.css`, `frontend/public/fonts/InterVariable.ttf`
**Contiene:**
- Nuevo `tokens.css` completo (tokens del design system + aliases temporales)
- Copiar `InterVariable.ttf` a `public/fonts/`
- Quitar import de Google Fonts de `index.html` si existe
**Commit:** `style(tokens): adopt cold-palette design system + temp backwards-compat aliases`
**CI:** verde (los aliases mantienen todos los nombres viejos)
**Validar:** la app muestra fondos azul-gris fríos, fuente Inter Variable cargada

### Fase 1 — Chrome y átomos compartidos
**Archivos (~15):**
```
shared/ui/Button.tsx
shared/ui/StatusBadge.tsx
shared/ui/Tabs.tsx
shared/ui/Toast.tsx
shared/ui/ConfirmDialog.tsx
shared/ui/Shell.tsx
shared/ui/Sidebar.tsx
shared/ui/TopNav.tsx
shared/ui/Topbar.tsx
shared/ui/SkeletonCard.tsx
shared/ui/CmgLogo.tsx
shared/ui/SectionErrorBoundary.tsx
shared/ui/GeofenceMapEditor.tsx
shared/ui/gauges/CircularGauge.tsx
shared/ui/gauges/LinearGauge.tsx
shared/ui/gauges/BatteryGauge.tsx
shared/ui/gauges/NumericDisplay.tsx
```
**Commit:** `style(shared): migrate shared UI atoms to new design tokens`
**CI:** verde tras cada archivo

### Fase 2 — Flota y detalle de vehículo
**Archivos (~13):**
```
features/fleet/FleetDashboard.tsx
features/fleet/FleetMap.tsx
features/fleet/VehicleCard.tsx
features/fleet/VehicleList.tsx
features/fleet/VehicleRow.tsx
features/fleet/VehicleDeviceSection.tsx
features/vehicle/VehicleDetailPage.tsx
features/vehicle/VehicleHeader.tsx
features/vehicle/StatusPanel.tsx
features/vehicle/SensorGrid.tsx
features/vehicle/KpiChart.tsx
features/vehicle/TrackMap.tsx
features/vehicle/WorkCyclesTab.tsx
```
**Commit:** `style(fleet): migrate fleet + vehicle detail to new design tokens`

### Fase 3 — Auth + Dashboard + Alertas
**Archivos (~7):**
```
features/auth/LoginPage.tsx
features/auth/RequireAuth.tsx
features/dashboard/DashboardPage.tsx
features/alerts/AlertsPage.tsx
features/alerts/ActiveAlertsList.tsx
features/alerts/AlertHistory.tsx
features/alerts/AckModal.tsx
```
**Commit:** `style(auth,dashboard,alerts): migrate to new design tokens`

### Fase 4 — OT + Mantenimiento + Reglas + Reportes
**Archivos (~17):**
```
features/work-orders/WorkOrdersPage.tsx
features/work-orders/WorkReportModal.tsx
features/maintenance/MaintenancePage.tsx
features/maintenance/MaintenancePlanDetailPage.tsx
features/maintenance/MaintenancePlanFormPage.tsx
features/maintenance/LogInterventionModal.tsx
features/maintenance/ProgressBar.tsx
features/maintenance/ThresholdBuilder.tsx
features/rules/RulesPage.tsx
features/rules/RuleFormPage.tsx
features/rules/ConditionBuilder.tsx
features/rules/ActionsList.tsx
features/rules/EscalationBuilder.tsx
features/rules/VehicleFilterPicker.tsx
features/reports/ReportsPage.tsx
features/reports/ReportFilters.tsx
```
**Commit:** `style(work-orders,maintenance,rules,reports): migrate to new design tokens`

### Fase 5 — Admin + Settings + long tail
**Archivos (~23):**
```
features/clientes/TenantsPage.tsx
features/clientes/TenantDetailPage.tsx
features/clientes/TenantFormPage.tsx
features/clientes/BrandTokensEditor.tsx   ← ver nota
features/clientes/GrantsSection.tsx
features/clientes/UserFormModal.tsx
features/settings/SettingsPage.tsx
features/settings/UsersSection.tsx
features/settings/NotificationSettings.tsx
features/settings/VehicleTypeSensorsSection.tsx
features/settings/WorkCycleDefinitionsSection.tsx
features/vehicles/VehiclesPage.tsx
features/vehicles/VehicleTypesPage.tsx
features/vehicles/AlertRulesSection.tsx
features/vehicles/DoutConfigSection.tsx
features/vehicles/HistoricMetricsSection.tsx
features/vehicles/MaintenanceTemplatesSection.tsx
features/vehicles/PdfMetricsSection.tsx
features/vehicles/WorkCycleDefsSection.tsx
features/devices/DevicesPage.tsx
features/geofences/GeofencesPage.tsx
features/drivers/DriversPage.tsx
features/diagnostics/CanScannerPage.tsx
features/portal/ClientPortalPage.tsx
App.tsx
```

**Nota BrandTokensEditor:** `applyBrandTokens` en `useAuthStore` inyecta `--accent-energy` como CSS variable. Actualizar a `--cmg-teal`. Los `brand_tokens` almacenados en base de datos contienen `brand_color` (hex), no nombres de token, por lo que el cambio es solo en el frontend.

**Commit:** `style(admin,settings,portal): migrate remaining files to new design tokens`

### Fase 6 — Limpieza final
**Acciones:**
1. Eliminar bloque de aliases temporales de `tokens.css`
2. Verificar con grep: `grep -r "var(--accent-\|var(--text-muted\|var(--bg-border\|var(--font-ui\|var(--font-data\|var(--gauge-" frontend/src` → debe devolver cero resultados
3. `npm run build` en frontend — sin errores
4. CI verde (backend + frontend + smoke)
5. Actualizar `CLAUDE.md` sección 9B con nueva paleta
**Commit:** `style(tokens): remove temp backwards-compat aliases — migration complete`

---

## 8. Reglas de implementación por componente

Al migrar cada archivo:

1. **`--bg-border` → `--border`** en todo el archivo (replace_all)
2. **`--text-muted` → `--fg-muted`** (replace_all)
3. **`--text-primary` → `--fg-primary`** para texto de alta importancia; `--fg-secondary` para texto de cuerpo normal
4. **`--accent-energy` → `--cmg-teal`** (replace_all)
5. **`--font-ui` → `--font-sans`**, **`--font-data` → `--font-mono`** (replace_all)
6. **`--accent-ok → --ok`**, **`--accent-warn → --warn`**, **`--accent-crit → --danger`**, **`--accent-info → --info`**, **`--accent-off → --offline`** (replace_all)
7. **Fondos de tarjetas:** si usaba `--bg-elevated` para el fondo de una card/panel → cambiar a `--bg-card`. Si es un modal/dropdown → dejar `--bg-elevated`.
8. **Hover states:** si hay `background: 'var(--bg-elevated)'` como hover → cambiar a `var(--bg-hover)`. Si hay color hardcodeado → reemplazar con el token semántico correspondiente.
9. **Bordes new:** añadir `--border-soft` en dividers entre filas; mantener `--border` entre regiones de layout.
10. **No añadir nuevas sombras** donde no las había. Solo usar `--shadow-sm/md/lg` donde ya existía un `box-shadow`.

---

## 9. Criterio de "done" por fase

- CI verde (vitest frontend + pytest backend)
- `grep -r "var(--<token_viejo>"` devuelve 0 en los archivos de esa fase
- `docker build frontend` sin errores de CSS

---

## 10. Qué NO cambia

- Lógica de negocio, hooks, queries, stores — ningún cambio
- Contratos API — ningún cambio
- Tests — no se espera que rompan por tokens CSS; si alguno falla es por snapshot, se actualiza
- Estructura de archivos — ningún archivo se crea ni mueve; solo ediciones inline
- Responsivo — el comportamiento mobile ya existente se conserva

---

## 11. Referencias

- Design system: `/opt/cmg-telematic1/temp/design-system/`
- Tokens fuente de verdad: `/opt/cmg-telematic1/temp/design-system/colors_and_type.css`
- UI kit web: `/opt/cmg-telematic1/temp/design-system/ui_kits/web/`
- README visual (reglas hover, motion, radios): `/opt/cmg-telematic1/temp/design-system/README.md`
