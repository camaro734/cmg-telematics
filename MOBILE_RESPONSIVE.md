# Mobile Responsive — Resumen de implementación

**Fecha:** 2026-04-25  
**Breakpoint móvil:** < 768px  
**Hook compartido:** `frontend/src/lib/useIsMobile.ts`

---

## Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `frontend/src/styles/tokens.css` | Classes `.hide-mobile` / `.show-mobile`, `overflow-x: hidden` en body para móvil |
| `frontend/src/lib/useIsMobile.ts` | **Nuevo** — hook `useIsMobile(breakpoint?)` con listener de resize |
| `frontend/src/shared/ui/TopNav.tsx` | Hamburger menu colapsable en móvil, MobileDrawer con todos los módulos + admin + logout |
| `frontend/src/shared/ui/Shell.tsx` | `overflow: auto` en móvil (vs `hidden` desktop), `overflow-x: hidden` |
| `frontend/src/features/fleet/FleetDashboard.tsx` | Layout vertical en móvil: mapa arriba (50vh), cards en columna, incidencias apiladas |
| `frontend/src/features/fleet/VehicleCard.tsx` | Card horizontal en móvil (icono + texto + badge) vs cuadrada en desktop |
| `frontend/src/features/vehicle/VehicleDetailPage.tsx` | Tabs con scroll, panel live en columna, KPIs 2 cols, DOUT full-width, bottom section apilado |
| `frontend/src/features/reports/ReportsPage.tsx` | Gráficos más bajos, pie charts 1 col, mapa rutas 280px, tablas con scroll horizontal, MantenimientoTab vertical |
| `frontend/src/features/auth/LoginPage.tsx` | Ancho `min(380px, calc(100vw - 32px))`, padding con `clamp()` |

---

## Comportamiento por pantalla

### TopNav móvil
- Solo logo + botón hamburger (≡/✕)
- Al abrir: overlay oscuro + drawer deslizante con todos los módulos, sección Admin (si aplica) y footer con email + logout
- Se cierra automáticamente al navegar a otra ruta

### FleetDashboard móvil
- Mapa al 100% ancho, 50vh de alto mínimo
- Cards de vehículo: layout horizontal (icono, nombre, estado en línea)
- Incidencias activas en lista simple al final

### VehicleDetailPage móvil
- Tabs con overflow-x auto (scroll horizontal si no caben)
- Panel live: mapa + info arriba, KPIs + controles abajo (columna)
- KPI cards: 2 columnas
- Quick-access report cards: 2 columnas  
- Botones DOUT: ancho completo (1 columna)
- Bottom section: apilado verticalmente

### ReportsPage móvil
- Gráficas de línea: 160px alto (vs 240 desktop)
- Pie charts: 1 columna, 150px alto (vs 200 desktop)
- MantenimientoTab: columna vertical (sidebar arriba, detalle abajo)
- Mapa de rutas: 280px alto (vs 440 desktop)
- Tablas con `overflow-x: auto` y `minWidth` para scroll horizontal

### LoginPage móvil
- Formulario hasta el 100% del viewport menos 32px de margen
- Padding adaptable con `clamp()`

---

## Build
TypeScript: 0 errores (`tsc -b --noEmit`)  
Vite: ✓ 955 módulos, build en ~4.7s  
*(El `dist/` de producción requiere rebuild Docker ya que los archivos existentes son propiedad de root)*
