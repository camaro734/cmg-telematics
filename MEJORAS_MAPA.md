# Mejoras de mapas Leaflet — CMG Telematics

## Fecha
2026-04-30

## Ficheros modificados
- `frontend/src/features/fleet/FleetMap.tsx`
- `frontend/src/features/vehicle/TrackMap.tsx`

## Cambios realizados

### MEJORA 1 — Tile layer CartoDB Dark Matter (ambos mapas)
- URL: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`
- Attribution completa con OpenStreetMap + CARTO
- subdomains: `'abcd'`, maxZoom: 19
- Sustituye el anterior OpenStreetMap estándar

### MEJORA 2 — Marcadores inteligentes en FleetMap.tsx
- **En movimiento** (speed_kmh > 2): punto pulsante cyan con animación CSS @keyframes `cmg-pulse-ring`
  - Si online: cyan (#38BDF8) con halo animado
  - Si offline: gris cálido (#78716C)
- **Parado** (speed_kmh <= 2): drop-pin SVG estilo Google Maps
  - Naranja (#F97316) si ignición ON
  - Amarillo (#EAB308) si ignición OFF
  - Sombra drop-shadow CSS inline
- CSS pulse inyectado una sola vez en el documento (id: `cmg-pulse-css`)

### MEJORA 3 — Marcador en TrackMap.tsx
- En movimiento: punto pulsante cyan animado (igual que FleetMap)
- Parado: chincheta naranja estática (#F97316)
- Comparte el mismo id de CSS para no duplicar estilos
- Mantenidos: polyline naranja del recorrido y marcador verde de inicio

### MEJORA 4 — Círculo de precisión GPS
- `L.circle` de 15 metros de radio en ambos mapas
- Solo visible cuando `status.online === true`
- fillColor: rgba(110,197,177,0.15) — teal translúcido
- strokeColor: rgba(110,197,177,0.4), weight: 1
- `interactive: false` para no capturar clics del usuario
- En FleetMap: se gestiona en el ref `circlesRef` y se actualiza junto al marcador
- Se elimina automáticamente cuando el vehículo pasa a offline

### MEJORA 5 — Popup mejorado en FleetMap.tsx
Contenido del popup:
- Nombre del vehículo en negrita (14px)
- Matrícula en gris si disponible
- Estado: "🚗 En movimiento — XX km/h" o "🅿️ Parado X min"
- Cálculo de tiempo parado: `Math.round((Date.now() - new Date(last_seen)) / 60000)`
  - Formatos: "Ahora mismo", "Parado 23 min", "Parado 2h 15min", "Parado 3h"
- Última señal formateada HH:MM
- Enlace "Ver detalle →" en naranja
- El popup se actualiza con `setContent()` sin reabrirse al cambiar datos

## Resultado del build

`npx tsc --noEmit` — sin errores TypeScript.

El build de Vite (`npm run build`) falla únicamente por permisos en `dist/assets/`
(carpeta propiedad de root, generada dentro del contenedor Docker). La compilación
TypeScript pasa completamente limpia. El build correcto se realiza dentro del
contenedor con `docker compose up --build frontend`.
