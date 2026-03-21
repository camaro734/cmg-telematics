# Agente Frontend — Next.js 16 + PWA

## Rol

Especialista en el frontend de CMG Telematics.
Directorio: `/opt/cmg-telematics/frontend/`
Backend API: se accede via proxy Next.js `/api/...` → `http://localhost:8010/api/...`
WebSocket: `ws://213.210.20.183/ws/fleet?token=<JWT>`

## Stack real instalado

```json
{
  "next": "16.2.0",
  "react": "19.2.4",
  "typescript": "5.x",
  "tailwindcss": "4.x",
  "recharts": "3.8.0",
  "leaflet": "1.9.4",
  "next-pwa": "5.6.0",
  "lucide-react": "0.577.0"
}
```

## Ciclo de trabajo OBLIGATORIO

```bash
cd /opt/cmg-telematics/frontend

# 1. Editar ficheros fuente
# 2. Build de producción (SIEMPRE — el servicio corre next start, no dev)
npm run build

# 3. Reiniciar servicio
systemctl restart cmg-telematics-frontend

# 4. Verificar
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/dashboard
journalctl -u cmg-telematics-frontend --since "1 minute ago"
```

> ⚠️ Los cambios NO se ven hasta hacer `npm run build` + restart. El modo dev no está en uso.

## Estructura de rutas (App Router) — IMPLEMENTADA

```
app/
├── page.tsx                    # / → redirect a /dashboard
├── layout.tsx                  # Root layout
├── globals.css                 # Variables CSS globales (--background, --sidebar, --accent, etc.)
├── login/
│   └── page.tsx                # Login con email + password
├── dashboard/
│   ├── layout.tsx              # → AppShell
│   └── page.tsx                # Dashboard: KPIs, FleetMap, sidebar flota, eventos recientes
├── vehicles/
│   ├── layout.tsx              # → AppShell
│   ├── page.tsx                # Lista de vehículos con búsqueda
│   └── [id]/
│       └── page.tsx            # Detalle: telemetría histórica (Recharts), mapa posición, trips, comandos DOUT, mantenimiento, eco-driving
├── map/
│   ├── layout.tsx              # → AppShell overflow="hidden"
│   └── page.tsx                # Mapa tiempo real full-screen con filtros
├── alerts/
│   ├── layout.tsx              # → AppShell
│   └── page.tsx                # Alertas activas + historial + acknowledge
├── trips/
│   ├── layout.tsx              # → AppShell
│   └── page.tsx                # Rutas/viajes con TripMap
├── analytics/
│   ├── layout.tsx              # → AppShell
│   └── page.tsx                # Analíticas de flota
├── maintenance/
│   ├── layout.tsx              # → AppShell
│   └── page.tsx                # Tareas de mantenimiento + logs
├── geofences/
│   ├── layout.tsx              # → AppShell
│   └── page.tsx                # Geocercas con GeofenceDrawMap
├── ecodriving/
│   ├── layout.tsx              # → AppShell
│   └── page.tsx                # Scores de conducción eficiente
├── profile/
│   ├── layout.tsx              # → AppShell
│   └── page.tsx                # Perfil usuario + cambio contraseña
└── admin/
    ├── layout.tsx              # → AppShell
    ├── tenants/page.tsx        # CRUD tenants (solo superadmin)
    ├── users/page.tsx          # CRUD usuarios
    ├── vehicles/page.tsx       # Admin vehículos + asignación dispositivos
    └── variable-maps/page.tsx  # Mapeo variables IO → unidades de negocio
```

## Componentes implementados

```
components/
├── AppShell.tsx          # Wrapper principal: Sidebar + AuthGuard + padding móvil
│                         # Props: overflow="auto"|"hidden" (usar hidden solo en /map)
├── AuthGuard.tsx         # Redirige a /login si no hay token JWT válido
├── Sidebar.tsx           # Navegación principal:
│                         #   Desktop (md+): sidebar izquierdo 220px
│                         #   Móvil: bottom tab bar 64px (5 tabs + sheet "Más")
├── FleetMap.tsx          # Mapa Leaflet con tiles CartoDB Voyager
│                         # Marcadores: icono camión SVG coloreado por estado
│                         # Popup: nombre, estado, velocidad, presión, última señal
├── TripMap.tsx           # Mapa ruta coloreada por velocidad (verde→rojo)
├── VehiclePositionMap.tsx # Mapa posición único vehículo con icono camión
├── GeofenceDrawMap.tsx   # Mapa interactivo para dibujar círculos/polígonos
├── StatCard.tsx          # Tarjeta KPI con título, valor, icono
├── Modal.tsx             # Modal genérico con overlay
└── Toast.tsx             # Notificación temporal (éxito/error/info)
```

## Navegación móvil — Bottom Tab Bar

El `Sidebar.tsx` implementa dos vistas según el breakpoint `md` (768px):

**Desktop (≥768px):** Sidebar izquierdo fijo 220px con todos los items

**Móvil (<768px):** Bottom tab bar fijo 64px en la parte inferior con:
- 4 tabs principales: **Flota** (dashboard) · **Vehículos** · **Mapa** · **Alertas** (con badge rojo)
- 1 tab **Más** → abre bottom sheet con:
  - Grid 3 columnas: Rutas, Analíticas, Mantenimiento, Geocercas, Eco-Driving
  - Sección Admin (solo admin/superadmin): Clientes, Usuarios, Dispositivos, Variables IO
  - Botón de logout

El `AppShell.tsx` añade `padding-bottom: 64px` en móvil para que el contenido no quede tapado.

## Mapas — Tiles CartoDB Voyager

Todos los componentes de mapa usan **CartoDB Voyager** (moderno, gratuito, sin API key):

```typescript
const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_ATTR = '&copy; OpenStreetMap &copy; CARTO';
// subdomains: 'abcd', maxZoom: 20
```

Aplica a: `FleetMap.tsx`, `TripMap.tsx`, `VehiclePositionMap.tsx`, `GeofenceDrawMap.tsx`

## Variables CSS globales (globals.css)

```css
:root {
  --background: #0f1117;    /* fondo general */
  --sidebar:    #1a1f2e;    /* fondo sidebar */
  --card:       #1e2532;    /* fondo tarjetas */
  --border:     rgba(255,255,255,0.08);
  --accent:     #1D9E75;    /* verde CMG brand */
  --muted:      #64748b;    /* texto secundario */
  --success:    #22c55e;
  --warning:    #f59e0b;
  --danger:     #ef4444;
}
```

## Proxy API (next.config.js)

El frontend hace `fetch('/api/...')` que Next.js redirige a `http://localhost:8010/api/...`:

```javascript
rewrites: [
  { source: '/api/:path*', destination: 'http://localhost:8010/api/:path*' },
  { source: '/health',     destination: 'http://localhost:8010/health' },
]
```

El WebSocket NO pasa por el proxy — conecta directamente a `ws://213.210.20.183/ws/fleet`.

## Librerías (lib/)

### api.ts
- `getFleet()` → GET /api/v1/dashboard/fleet
- `getLastTelemetry(vehicleId)` → GET /api/v1/vehicles/{id}/last
- `getTelemetryHistory(vehicleId, hours, bucket)` → GET /api/v1/vehicles/{id}/telemetry
- `sendCommand(imei, output, value)` → POST /api/v1/commands/send
- `alerts.activeCount()` → GET /api/v1/alerts/active/count
- `maintenance.summary()` → GET /api/v1/maintenance/summary
- `variableMaps.list({ vehicle_id? | tenant_id? })` → GET /api/v1/variable-maps
- `variableMaps.listResolved(vehicleId)` → GET /api/v1/variable-maps/resolved (plantilla + excepciones merged)
- y muchas más (ver api.ts completo)

### Variable Maps — arquitectura two-scope
- `VehicleAdminOut` incluye: `tenant_name`, `manufacturer_id`, `manufacturer_name`
- `VariableMapOut` incluye: `tenant_id`, `scope: "manufacturer" | "vehicle"`
- **Plantilla fabricante**: `tenant_id` set, `vehicle_id` null → aplica a todos sus vehículos
- **Excepción vehículo**: `vehicle_id` set, `tenant_id` null → anula plantilla para ese vehículo
- **Resolución**: `GET /resolved` → merge de ambos (excepción gana por io_key)

### websocket.ts
- `useFleetWebSocket(onTelemetry, onAlert)` → Hook que conecta a `/ws/fleet`, reconecta automáticamente tras 3s de desconexión

### toast.ts
- `useToast()` → Hook: `{ toasts, addToast, dismiss }`

## Reglas de diseño

- Mobile-first: todo debe funcionar bien en pantalla de 390px
- Nunca mostrar datos de otro tenant aunque el token lo permita
- Los toggles DOUT deben pedir confirmación siempre (modal) — parar una bomba hidráulica en campo es crítico
- Indicar siempre el tiempo desde la última actualización
- Si el dispositivo lleva más de 5 min sin datos: badge "Sin señal" (warning color)
- Areas táctiles mínimo 44px en móvil
- Todos los layouts usan `AppShell` — nunca incluir `Sidebar` + `AuthGuard` directamente en un layout

## Caché PWA — importante

El service worker cachea JS/CSS entre deploys. Si los usuarios ven versión antigua:
- Hacer hard-refresh: `Ctrl+Shift+R` (desktop)
- O: DevTools → Application → Service Workers → Unregister → recargar
