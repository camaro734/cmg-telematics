# Frontend Sprint 5 — Design Spec

**Goal:** Deliver a working React + Vite frontend for CMG Telematics 2 covering authentication, fleet overview (split view), and basic vehicle detail page. No gauges, no WebSocket live, no KPI charts — those are Sprint 6.

**Architecture:** Feature-based folder structure. Each feature (`auth`, `fleet`, `vehicle`) is self-contained with its own components, hooks, and queries. Shared primitives live in `shared/ui/`. API and WS clients live in `lib/`.

**Tech Stack:** React 18, Vite, TypeScript, React Query (TanStack v5), Zustand, Leaflet + react-leaflet, react-router-dom v6. No axios — native `fetch` wrapper.

---

## 1. Scope

### In scope (Sprint 5)

| Screen | Route | What it delivers |
|--------|-------|-----------------|
| Login | `/login` | Email + password form, JWT login, refresh on reload |
| Fleet | `/fleet` | 35/65 split: vehicle list (left) + Leaflet map (right) |
| Vehicle detail | `/vehicles/:id` | Today's track, real-time status, can_data as key/value |
| Shell | all auth routes | Sidebar (icon-only), topbar with tenant name + logout |

### Out of scope (Sprint 6+)

- SVG hydraulic gauges
- Recharts KPI history charts
- WebSocket live telemetry
- Alerts page
- Rules builder
- User management / forgot-password flow
- Drag-to-resize split panel

### Stub items (built in Sprint 5, functional in Sprint 6)

- Sidebar links: Alerts, Rules, Settings — visible but disabled
- `lib/wsClient.ts` — exports the interface used by Sprint 6, opens no connection

---

## 2. File Structure

```
frontend/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── .env.example              ← VITE_API_BASE_URL, VITE_WS_URL
└── src/
    ├── main.tsx              ← React root, QueryClientProvider, BrowserRouter
    ├── App.tsx               ← Route definitions, RequireAuth wrapper
    ├── styles/
    │   └── tokens.css        ← CSS custom properties from CLAUDE.md §9B
    ├── lib/
    │   ├── apiClient.ts      ← fetch wrapper with auth + refresh logic
    │   ├── queryKeys.ts      ← React Query key factories
    │   └── wsClient.ts       ← stub WebSocket interface for Sprint 6
    ├── features/
    │   ├── auth/
    │   │   ├── useAuthStore.ts     ← Zustand: tokens, user, login, logout, refresh
    │   │   ├── LoginPage.tsx       ← login form
    │   │   └── RequireAuth.tsx     ← route guard
    │   ├── fleet/
    │   │   ├── FleetPage.tsx       ← 35/65 split layout
    │   │   ├── VehicleList.tsx     ← left panel, polling list
    │   │   ├── VehicleRow.tsx      ← single row with status badge
    │   │   ├── FleetMap.tsx        ← right panel, Leaflet
    │   │   ├── useFleetStore.ts    ← Zustand: selectedVehicleId
    │   │   └── useVehicleStatuses.ts ← React Query polling for all statuses
    │   └── vehicle/
    │       ├── VehicleDetailPage.tsx ← page composition
    │       ├── VehicleHeader.tsx     ← name, plate, badge, back button
    │       ├── TrackMap.tsx          ← Leaflet with today's polyline
    │       └── StatusPanel.tsx       ← speed, ignition, PTO, can_data
    └── shared/
        └── ui/
            ├── StatusBadge.tsx   ← online/offline/pto badge
            ├── Shell.tsx         ← sidebar + topbar layout wrapper
            ├── Sidebar.tsx       ← icon-only navigation
            └── Topbar.tsx        ← tenant name, user email, logout
```

---

## 3. Auth Layer

### Zustand store — `useAuthStore`

```ts
interface AuthStore {
  accessToken: string | null
  user: CurrentUser | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  refresh: () => Promise<boolean>  // returns false if refresh fails
}
```

- `accessToken` lives in memory only — never written to localStorage
- Refresh token written to `localStorage` under key `cmg_refresh`
- On app mount: read `cmg_refresh`, call `POST /auth/refresh`, populate `accessToken` and `user`
- If refresh fails → clear localStorage → redirect to `/login`

### Route guard — `RequireAuth`

Wraps all authenticated routes. If `accessToken` is null and no refresh token in localStorage → immediate redirect to `/login`. Shows a loading spinner while refresh is in flight.

### Login page

- Centered card on `--bg-base` background
- CMG logo (or tenant logo if white-label applies at login — deferred to later)
- Email input + password input + "Iniciar sesión" button (orange, `--accent-energy`)
- Error message below button on 401: "Credenciales incorrectas"
- Below form: small text "¿Olvidaste tu contraseña? Contacta con tu administrador"
- On success: redirect to `/fleet`

### apiClient

- Base URL from `import.meta.env.VITE_API_BASE_URL`
- Every request gets `Authorization: Bearer <accessToken>` header
- On 401 response: call `refresh()` once, retry the original request
- If retry also 401: call `logout()` (clears tokens, redirects to `/login`)
- Exported as a singleton object with `get`, `post`, `put`, `delete` methods

---

## 4. Fleet Page

### Layout

Fixed split: left panel 35% width, right panel 65%. Divider is a 1px `--bg-border` line. No drag-to-resize in Sprint 5.

Both panels fill the full viewport height below the topbar.

### VehicleList (left panel)

- Fetches `GET /vehicles` once on mount (React Query, `staleTime: 5min`)
- For each vehicle in the list, fetches `GET /vehicles/:id/status` with `refetchInterval: 30_000`
- Renders a `VehicleRow` per vehicle, sorted: online first, then offline
- Clicking a row: sets `useFleetStore.selectedVehicleId`, navigates to `/vehicles/:id`
- Selected row gets highlighted background (`--bg-elevated`) and orange left border

### VehicleRow

Displays per vehicle:
- Left: colored dot (green = online, gray = offline, orange = PTO active)
- Center: vehicle name (bold) + license plate (dim)
- Right: speed in km/h if online, "Offline" + relative time if not
- PTO badge (orange pill "PTO") if `pto_active === true`

### FleetMap (right panel)

- Leaflet map, OpenStreetMap tiles
- One marker per vehicle that has `lat` and `lon` in its status
- Marker color matches `VehicleRow` dot color: green/gray/orange
- Clicking a marker: sets `useFleetStore.selectedVehicleId` (does NOT navigate — user must click row or use "Ver detalle" on the marker popup)
- Marker popup: vehicle name, speed, "Ver detalle →" link to `/vehicles/:id`
- When `selectedVehicleId` changes: map flies to that vehicle's position (if it has one)
- Initial bounds: fit all markers with `fitBounds`

### useFleetStore

```ts
interface FleetStore {
  selectedVehicleId: string | null
  setSelected: (id: string | null) => void
}
```

---

## 5. Vehicle Detail Page

### Route: `/vehicles/:id`

Fetches on mount:
- `GET /vehicles/:id` — vehicle metadata (name, plate, type)
- `GET /vehicles/:id/status` — real-time state, `refetchInterval: 15_000`
- `GET /vehicles/:id/track/today` — GPS polyline, fetched once (no polling; reloads on page refresh)

### VehicleHeader

- Back button "← Flota" (navigates to `/fleet`, restores `selectedVehicleId`)
- Vehicle name (large, `--font-ui`)
- License plate + vehicle type name (dim)
- Status badge: large pill — green "EN LÍNEA" / gray "OFFLINE"
- Last seen: "Última señal: hace 5 min" (relative time from `last_seen`)

### TrackMap

- Leaflet map, full width, fixed height 340px
- Orange polyline (`--accent-energy`) for today's track
- Current position marker (pulsing dot if online, static if offline)
- If `track` is empty: centered message "Sin actividad registrada hoy"
- Bounds fit the track polyline on load

### StatusPanel

Grid of cards (2 columns on desktop, 1 on mobile):

| Card | Field | Format |
|------|-------|--------|
| Velocidad | `speed_kmh` | `87 km/h` in `--font-data` |
| Ignición | `ignition` | green "ON" / gray "OFF" badge |
| PTO | `pto_active` | orange "ACTIVO" / gray "INACTIVO" |
| Voltaje ext. | `ext_voltage_mv` | `24.3 V` (divide by 1000) |

Below the cards: `can_data` section. Renders each key/value pair from the JSON object as a monospace row:
```
presion_1          142 bar
temp_aceite         78 °C
ciclos_pto         1243
```
If `can_data` is null or empty: "Sin datos CAN disponibles". No units inference in Sprint 5 — raw values only. Sprint 6 will use `vehicle_type.sensor_schema` to add units and gauge rendering.

---

## 6. Shell

### Sidebar

- Fixed left, 56px wide (icon-only, no labels)
- Top: CMG logo mark (orange square placeholder, 32px)
- Nav icons (from top): Fleet (active in Sprint 5), Alerts (stub, disabled), Rules (stub, disabled)
- Bottom: Settings icon (stub)
- Active icon: orange fill, `--accent-energy` background pill
- Disabled icons: `--accent-off` color, cursor not-allowed, tooltip on hover "Disponible en próxima versión"

### Topbar

- Height 48px, background `--bg-surface`, bottom border `--bg-border`
- Left: current page title ("Flota" or vehicle name)
- Right: tenant `brand_name` (stored in Zustand auth store after brand-tokens fetch on login) + user email + logout button

---

## 7. Design Tokens + White-label

`src/styles/tokens.css` defines all CSS custom properties from `CLAUDE.md §9B`:

```css
:root {
  --bg-base: #1C1917;
  --bg-surface: #292524;
  --bg-elevated: #3C3330;
  --bg-border: #57534E;
  --accent-energy: #F97316;
  --accent-ok: #22C55E;
  --accent-warn: #EAB308;
  --accent-crit: #EF4444;
  --accent-info: #38BDF8;
  --accent-off: #78716C;
  --font-data: 'JetBrains Mono', 'IBM Plex Mono', monospace;
  --font-ui: 'Inter', 'DM Sans', sans-serif;
  --gauge-track: #3C3330;
  --gauge-fill: #F97316;
  --gauge-warn: #EAB308;
  --gauge-crit: #EF4444;
}
```

On login success, after tokens are stored:
1. Fetch `GET /tenants/:tenant_id/brand-tokens` (tenant_id from JWT payload)
2. Merge returned `brand_tokens` object into `document.documentElement.style`
3. Example: `{ "--accent-energy": "#0EA5E9", "logo_url": "https://..." }` → overrides orange with blue for that tenant

This means white-label works without recompilation. Logo URL is stored in the Zustand auth store and rendered in the topbar.

---

## 8. Environment + Build

**`.env.example`:**
```
VITE_API_BASE_URL=http://localhost:8010
VITE_WS_URL=ws://localhost:8010
```

**Vite config:** proxy `/api` to `VITE_API_BASE_URL` in dev. In production, Caddy handles routing (frontend on `:3000`, backend on `:8010`).

**TypeScript:** strict mode. No `any` allowed in feature code (only in `lib/apiClient.ts` for raw JSON parsing).

**No tests in Sprint 5.** Sprint 5 is UI-only with polling — E2E tests (Playwright) are planned for after Sprint 6 when the live data layer stabilizes.

---

## 9. What Sprint 6 Adds to This Foundation

Sprint 6 will:
- Activate `wsClient.ts` (WebSocket connection to `/ws/fleet?token=...`)
- Replace the 30s polling in `VehicleList` with WS push updates
- Add SVG gauge components to `StatusPanel` using `vehicle_type.sensor_schema`
- Add Recharts KPI history charts to `VehicleDetailPage`
- Add drag-to-resize to the fleet split panel

No Sprint 5 file needs to be deleted or restructured for Sprint 6. Sprint 6 extends, not rewrites.
