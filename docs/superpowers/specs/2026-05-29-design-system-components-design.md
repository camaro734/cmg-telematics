# Spec: Design System — Componentes y Layout (Bloques A–D)

**Fecha:** 2026-05-29
**Estado:** Aprobado por Carlos — listo para implementación
**Dependencia:** Requiere la migración de tokens previa (spec 2026-05-29-visual-redesign-design.md) ✅ completada

---

## 1. Contexto

Tras la migración de tokens CSS (Fase 1 del rediseño), el frontend tiene la paleta fría correcta pero mantiene componentes estructuralmente simplificados respecto al design system de referencia (`/opt/cmg-telematic1/temp/design-system/`).

Este spec cubre los 4 bloques de componentes pendientes, en orden de dependencia:

| Bloque | Contenido | Archivos clave |
|---|---|---|
| A | Chip, Sparkline, Button variantes | `shared/ui/Chip.tsx`, `shared/ui/Sparkline.tsx`, `shared/ui/Button.tsx` |
| B | Sidebar expandida | `shared/ui/Sidebar.tsx`, `shared/ui/Shell.tsx` |
| C | Topbar KPIs en vivo | `shared/ui/Topbar.tsx`, `shared/ui/TopNav.tsx` |
| D | Fleet "sala de control" | `features/fleet/FleetDashboard.tsx` + nuevos paneles |

**Referencia visual:** `/opt/cmg-telematic1/temp/design-system/ui_kits/web/` y `preview/`

---

## 2. Bloque A — Átomos base

### 2.1 Chip (`shared/ui/Chip.tsx`) — componente nuevo

```tsx
interface ChipProps {
  children: React.ReactNode
  color?: string          // CSS color o var(--token)
  soft?: boolean          // fondo semitransparente automático (color + '26')
  dot?: boolean           // StatusDot integrado a la izquierda
  size?: 'sm' | 'md'
  onClick?: () => void
}
```

**Estilos:**
- `sm`: `padding: 2px 7px`, `fontSize: 10px`, `borderRadius: 9999px`
- `md` (default): `padding: 3px 9px`, `fontSize: 11px`, `borderRadius: 9999px`
- `fontWeight: 600`
- Sin borde por defecto; cuando `soft=true`: borde `1px solid ${color}44`, fondo `${color}22`
- Sin `soft`: fondo `rgba(255,255,255,0.04)`, borde `1px solid var(--border)`
- `cursor: pointer` si tiene `onClick`

**StatusDot integrado:** si `dot=true`, añadir `<span>` de 5×5px circular con `background: color` antes del `children`.

**Uso previsto:**
- Chips de severidad en alertas: `<Chip color="var(--danger)" soft dot>ALTA</Chip>`
- Role badges en sidebar footer: `<Chip color="var(--role-admin)" soft>admin</Chip>`
- Status en topbar: `<Chip color="var(--ok)" soft dot>12 en línea</Chip>`
- Filtros en VehicleListPanel: `<Chip color="var(--cmg-teal)" soft onClick>En línea</Chip>`

### 2.2 Sparkline (`shared/ui/Sparkline.tsx`) — componente nuevo

```tsx
interface SparklineProps {
  values: number[]         // array de valores numéricos
  w?: number               // ancho SVG (default: 72)
  h?: number               // alto SVG (default: 24)
  color?: string           // color línea + gradiente (default: 'var(--cmg-teal)')
}
```

**Implementación SVG:**
- Normalizar values al rango [min, max] con padding de 2px
- Polyline sobre los puntos
- Polygon de gradiente fill: 25%→0% de opacidad del color
- `gradientId` único por instancia: `sg-${color.replace(/[^a-z0-9]/gi, '')}-${index}`
- Si `values.length < 2`: devolver `null`
- `overflow: visible` en el SVG para que la línea no se corte

### 2.3 Button — variantes y mejoras (`shared/ui/Button.tsx`)

**Variantes a añadir:**

```tsx
// Añadir a los estilos existentes:
secondary: {
  background: 'rgba(255,255,255,0.05)',
  color: 'var(--fg-tertiary)',
  border: '1px solid var(--border)'
},
teal: {
  background: 'var(--cmg-teal-soft)',
  color: 'var(--cmg-teal)',
  border: '1px solid var(--cmg-teal-line)'
},
```

**Tamaño `lg` a añadir:**
```tsx
lg: { padding: '12px 18px', fontSize: 14, borderRadius: 10, gap: 8 }
```

**Efecto press (añadir a todos los botones):**
```tsx
onMouseDown={e => { e.currentTarget.style.filter = 'brightness(0.92)' }}
onMouseUp={e => { e.currentTarget.style.filter = '' }}
onMouseLeave={e => { e.currentTarget.style.filter = '' }}
```

**Efecto hover (añadir a botón `primary`):**
```tsx
onMouseEnter={e => { e.currentTarget.style.background = 'var(--cmg-teal-hover)' }}
onMouseLeave={e => { e.currentTarget.style.background = 'var(--cmg-teal)' }}
```

---

## 3. Bloque B — Sidebar expandida

### 3.1 Estado de expansión

- `expanded: boolean` persistido en `localStorage` bajo la clave `cmg_sidebar_expanded`
- Default: `false` (colapsada) — salvo que el usuario lo haya cambiado
- La excepción es `/fleet`: siempre fuerza `expanded = false` al montar (ver Bloque D)

### 3.2 Dimensiones

| Estado | Ancho | Variable CSS |
|---|---|---|
| Colapsada | 64px | `--sidebar-w: 64px` |
| Expandida | 240px | `--sidebar-w: 240px` |

Transición: `width 200ms var(--ease-std)` en el elemento sidebar.

### 3.3 Estructura en modo expandido

```
┌──────────────────────────────┐
│  [Logo CMG Track]            │  ← logo + wordmark si expanded
│  ────────────────────────── │
│  [🔍 Buscar...]              │  ← search bar, solo en expanded
│  ────────────────────────── │
│  MONITORIZACIÓN              │  ← eyebrow label
│  [icono] Dashboard           │
│  [icono] Flota               │
│  [icono] Alertas     [3]     │  ← badge de contador
│  ────────────────────────── │
│  OPERACIONES                 │
│  [icono] Órdenes de trabajo  │
│  [icono] Conductores         │
│  ────────────────────────── │
│  ADMINISTRACIÓN              │  ← solo para admin
│  [icono] Clientes            │
│  [icono] Dispositivos        │
│  ...                         │
│                              │
│  [‹ colapsar]                │  ← toggle en footer
│  ────────────────────────── │
│  [AV] Alberto Vidal    admin │  ← avatar + nombre + role chip
│  [icono logout]              │
└──────────────────────────────┘
```

### 3.4 Modo colapsado (64px)

- Solo iconos centrados, sin labels
- Badge de contador visible sobre el icono
- Toggle se convierte en `›`
- Footer: solo avatar circular (iniciales)

### 3.5 Search bar

- Solo visible en modo expandido
- `<input placeholder="Buscar…" />` con icono lupa SVG a la izquierda (Lucide `Search`, 14px)
- Fondo `var(--bg-elevated)`, borde `var(--border)`, radius `var(--r-md)`
- Al escribir, filtrar los ítems de nav por label (client-side, sin API)
- Al colapsar la sidebar, limpiar el filtro

### 3.6 Footer de usuario

```tsx
// Visible en expanded:
<div style={{ avatar }}>AV</div>           // iniciales, 28px, bg --cmg-teal-soft
<span>{user.name}</span>                   // truncado con ellipsis
<Chip color="var(--role-admin)" soft size="sm">{user.role}</Chip>

// Visible en collapsed:
<div style={{ avatar }}>AV</div>           // solo avatar
```

Color del role chip: usar tokens `--role-admin`, `--role-operator`, `--role-viewer`, `--role-driver` ya definidos en tokens.css.

Botón logout: icono `LogOut` (Lucide), solo en expanded. Al hacer click → `useAuthStore.logout()`.

---

## 4. Bloque C — Topbar con KPIs en vivo

### 4.1 Chips de estado

Añadir en `Topbar.tsx` entre el logo/título y el área de usuario:

```tsx
<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
  <Chip color="var(--ok)" soft dot>{onlineCount} en línea</Chip>
  {movingCount > 0 && (
    <Chip color="var(--cmg-teal)" soft dot>{movingCount} en mov.</Chip>
  )}
  {activeAlertsCount > 0 && (
    <Chip color="var(--danger)" soft dot>{activeAlertsCount} alertas</Chip>
  )}
</div>
```

**Fuente de datos:**
- `onlineCount` y `movingCount`: derivados de `useVehicleStatuses()` existente (ya disponible en el store/cache de React Query)
- `activeAlertsCount`: nuevo query `useQuery({ queryKey: ['alerts', 'active', 'count'], queryFn: () => apiClient.get('/api/v1/alerts/active-count') })` — o reusar la query de alertas activas que ya existe en `AlertsPage`

**Visibilidad:** `hide-mobile` (ocultar en < 768px).

### 4.2 Indicador WebSocket

Dot de 6px con pulse animation:

```tsx
<div title={wsConnected ? 'Tiempo real activo' : 'Reconectando...'}>
  <span className="live-dot" style={{
    background: wsConnected ? 'var(--ok)' : 'var(--offline)'
  }} />
</div>
```

`wsConnected`: leer de `wsClient.isConnected()` o del estado del store existente.

---

## 5. Bloque D — Fleet "sala de control"

### 5.1 Auto-colapso de sidebar en /fleet

En `FleetDashboard.tsx`, al montar el componente:

```tsx
useEffect(() => {
  const prev = localStorage.getItem('cmg_sidebar_expanded')
  localStorage.setItem('cmg_sidebar_prev_state', prev ?? 'false')
  localStorage.setItem('cmg_sidebar_expanded', 'false')
  // Forzar actualización del estado en Shell/Sidebar
  window.dispatchEvent(new Event('cmg_sidebar_change'))
  return () => {
    // Restaurar al salir de /fleet
    const prevState = localStorage.getItem('cmg_sidebar_prev_state') ?? 'false'
    localStorage.setItem('cmg_sidebar_expanded', prevState)
    window.dispatchEvent(new Event('cmg_sidebar_change'))
  }
}, [])

// En Sidebar.tsx, el estado de expansión se lee así:
// const [expanded, setExpanded] = useState(() =>
//   localStorage.getItem('cmg_sidebar_expanded') === 'true')
// useEffect(() => {
//   const handler = () => setExpanded(localStorage.getItem('cmg_sidebar_expanded') === 'true')
//   window.addEventListener('cmg_sidebar_change', handler)
//   return () => window.removeEventListener('cmg_sidebar_change', handler)
// }, [])
```

**Botón "Menú"** en la esquina superior izquierda del mapa (sobre el mapa, z-index alto):
```tsx
<button onClick={toggleSidebar} style={{ position: 'absolute', top: 12, left: 12, zIndex: 1000 }}>
  ‹ Menú
</button>
```

### 5.2 Layout

```
┌─[sidebar 64px]─┬─────────────────────────────────┐
│                │  [VehicleListPanel overlay]      │
│                │  ┌──────────────────┐            │
│                │  │ 🔍 Buscar...     │            │
│                │  │ [Todos][Online][Mov] │         │
│                │  │ ─────────────── │            │
│                │  │ [VehicleRow]    │            │
│                │  │ [VehicleRow]    │            │
│                │  │ ...             │            │
│                │  └──────────────────┘            │
│                │         MAPA LEAFLET             │
│                │                 ┌──────────────┐ │
│                │                 │VehicleDetail │ │
│                │                 │Panel overlay │ │
│                │                 │              │ │
│                │                 └──────────────┘ │
└────────────────┴─────────────────────────────────┘
```

Los dos paneles son **`position: absolute`** sobre el mapa, NO desplazan el layout.

### 5.3 VehicleListPanel (`features/fleet/VehicleListPanel.tsx`) — nuevo componente

```tsx
interface VehicleListPanelProps {
  vehicles: VehicleWithStatus[]
  selectedId: string | null
  onSelect: (id: string) => void
}
```

**Estructura:**
- Posición: `position: absolute, top: 0, left: 0, height: 100%, width: 280px, zIndex: 400`
- Fondo: `var(--bg-surface)`, borde derecho `var(--border)`
- Colapso: botón `‹` en la esquina superior derecha del panel, animación `translateX(-100%)` en 200ms
- **Search:** input full-width con icono lupa, filtra por matrícula/nombre
- **Filtros:** 3 chips toggle — `Todos` / `En línea` / `En movimiento`
- **Lista de vehículos:** scroll vertical, cada fila:
  - StatusDot (color según estado)
  - Matrícula en monospace (`--font-mono`)
  - Nombre del vehículo
  - `<Sparkline values={last2hSpeeds} w={48} h={16} />` — últimas 2h de velocidad (de la cache existente o un campo en el status)
  - Velocidad actual `XX km/h` si `moving`
- Fila seleccionada: fondo `var(--cmg-teal-soft)`, borde izquierdo `2px solid var(--cmg-teal)`

**Datos de Sparkline:** usar los últimos valores de velocidad (`avl_24`) del cache de React Query `['vehicles', 'statuses', ...]` si el entry tiene un campo `speed_history: number[]`. Si el campo no existe o tiene menos de 2 valores, `Sparkline` retorna `null` automáticamente — la fila se muestra sin gráfico, sin error.

### 5.4 VehicleDetailPanel (`features/fleet/VehicleDetailPanel.tsx`) — nuevo componente

```tsx
interface VehicleDetailPanelProps {
  vehicleId: string | null   // null = panel oculto
  onClose: () => void
}
```

**Estructura:**
- Posición: `position: absolute, top: 0, right: 0, height: 100%, width: 320px, zIndex: 400`
- Slide-in: `translateX(0)` cuando `vehicleId != null`, `translateX(100%)` cuando null. Transición 250ms `var(--ease-out)`
- Fondo: `var(--bg-surface)`, borde izquierdo `var(--border)`
- **Header:** matrícula + nombre + botón `✕` para cerrar
- **Estado:** StatusDot + label + última señal (`hace X min`)
- **KPIs live** (del WS, igual que VehicleDetailPage):
  - Ignición (on/off)
  - Velocidad actual
  - RPM
  - Hasta 4 sensores CAN del sensor_schema del tipo de vehículo
- **Botón "Ver detalle →":** navega a `/vehicles/:id`
- **DOUT** (si el vehículo tiene DOUT configurado): botones de activar/desactivar, con ConfirmDialog

**Datos:** `useVehicleStatus(vehicleId)` ya existe. Para sensores CAN: `useSensorReadings(vehicleId)` o reusar SensorGrid en modo compacto.

---

## 6. Orden de implementación y criterios de done

### Orden recomendado (A → B → C → D)

Cada bloque es independiente de los siguientes excepto que B y C usan el componente `Chip` de A.

### Criterios de done por bloque

**Bloque A:**
- `Chip.tsx` exportado desde `shared/ui/`, con variantes `soft`, `dot`, sizes
- `Sparkline.tsx` exportado, retorna null si < 2 values
- `Button.tsx` con variantes `secondary` y `teal`, tamaño `lg`, efecto press brightness
- Tests unitarios para Chip y Sparkline
- `npm run build` sin errores

**Bloque B:**
- Sidebar toggle persistido en localStorage
- Transición `width` animada
- Labels, search y footer visibles en modo expandido
- Colapsada: solo iconos + badges
- CI verde

**Bloque C:**
- Chips de KPI visibles en Topbar con datos reales
- Dot WebSocket con pulse
- Chips ocultos en móvil
- CI verde

**Bloque D:**
- `/fleet` auto-colapsa sidebar al montar, la restaura al salir
- Botón "Menú" visible en el mapa
- VehicleListPanel visible con search + filtros
- VehicleDetailPanel slide-in al seleccionar vehículo
- Ambos paneles como overlay (mapa full-width siempre)
- CI verde

---

## 7. Qué NO cambia

- Backend, API, WebSocket — sin cambios
- Lógica de negocio, queries, stores — sin cambios
- Otras rutas (`/alerts`, `/maintenance`, `/work-orders`, etc.) — sin cambios
- El componente `VehicleDetailPage` (`/vehicles/:id`) — sin cambios (el panel D es una versión lite)

---

## 8. Referencias

- Referencia visual: `/opt/cmg-telematic1/temp/design-system/ui_kits/web/`
- Átomos: `atoms.jsx`, `Sidebar.jsx`, `Topbar.jsx`, `VehicleListPanel.jsx`, `VehicleDetailPanel.jsx`
- Tokens: `frontend/src/styles/tokens.css`
