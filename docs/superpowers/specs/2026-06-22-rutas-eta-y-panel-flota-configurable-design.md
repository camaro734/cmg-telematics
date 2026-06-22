# Diseño — Rutas + ETA en vivo y panel de flota configurable

Fecha: 2026-06-22
Autor: Carlos (CMG) + Claude
Estado: propuesta para revisión

## Resumen

Dos funcionalidades independientes sobre la pantalla de flota:

1. **Destino + ruta + ETA en vivo** (tipo Google Maps/Waze) — la oficina busca una
   ubicación, la asigna como destino a un vehículo, y ve el trazado de la ruta más la
   distancia y el tiempo restante actualizándose con la posición en vivo. Además, un modo
   de "ruta libre" para previsualizar la ruta entre dos puntos sin guardar nada.
2. **Panel lateral de flota configurable** — los datos que aparecen en el panel derecho
   al seleccionar un vehículo dejan de estar fijos y se eligen por tipo de vehículo desde
   la pantalla de Tipos/Sensores, reutilizando el mecanismo de flags que ya existe.

Los dos bloques son desplegables por separado. El Bloque 2 es de bajo riesgo; el Bloque 1
añade un contenedor de routing nuevo (Valhalla).

## Alcance (Fase 1)

- **Todo en la web.** La app móvil del conductor (recepción del destino + navegación
  turn-by-turn en cabina) queda para una Fase 2 posterior.
- **Cobertura del routing: Europa entera** (la flota opera en España y también, p. ej.,
  Italia).
- **Motor de rutas: Valhalla autoalojado** — los datos de ubicación no salen del servidor
  (coherente con la privacidad de ubicación, Feature 060).

## Decisiones tomadas (brainstorming)

| Decisión | Elección |
|---|---|
| Sentido de la ruta | Mezcla: vehículo→destino (seguimiento con ETA) **y** ruta libre punto a punto |
| Lado conductor | Web ahora; app móvil del conductor en Fase 2 |
| Motor de rutas | **Valhalla** autoalojado (se descartó OSRM por RAM inviable a escala continental) |
| Cobertura | **Europa entera** |
| Persistencia del destino | **Persistente en servidor** (BD), visible a todo el tenant y legible por la app móvil en Fase 2 |
| Infra | Valhalla en el **mismo VPS** (120 GB libres confirmados); build con borrado del `.pbf` tras generar teselas |

---

## Bloque 1 — Destino + ruta + ETA en vivo

### Por qué Valhalla y no OSRM

OSRM se eligió inicialmente, pero a escala europea su preprocesado
(`osrm-partition`/`osrm-customize`) carga la red entera en memoria y exige decenas de GB
de RAM — inviable en el VPS. Valhalla usa teselas mapeadas con `mmap`: build por lotes con
RAM modesta (~10–20 GB) y runtime con pocos GB residentes. Cobertura continental sin
reventar el servidor. Sigue siendo autoalojado: ninguna coordenada sale a terceros.

### Infraestructura

- Nuevo servicio **`valhalla`** en `docker-compose.yml` (imagen comunitaria
  `ghcr.io/gis-ops/docker-valhalla/valhalla` o equivalente), expuesto **solo en la red
  interna Docker** (`--network-alias valhalla`). **Nunca** publicado al exterior (regla de
  oro: no exponer servicios internos).
- Volumen dedicado para las teselas (`valhalla_tiles`).
- **Geocoding (buscar ubicación por nombre):** se reutiliza **Nominatim**, como en las
  órdenes de trabajo. No se añade dependencia nueva de geocoding.

#### Procedimiento de build de teselas (puntual, fuera de hora punta)

Disco: 193 GB totales, 120 GB libres. Runtime de Europa ~50–80 GB. El **pico durante el
build** (`.pbf` Europa ~28 GB + teselas ~80 GB ≈ ~108 GB) es el punto crítico.

Pasos obligatorios:

1. Descargar `europe-latest.osm.pbf` (~28 GB) de Geofabrik al volumen de build.
2. Generar teselas (`valhalla_build_tiles` / config + `valhalla_build_config`).
3. **Borrar el `.pbf` en cuanto las teselas estén generadas** (deja runtime ~80 GB).
4. Verificar `df -h` con margen antes y después.
5. Documentar el procedimiento en `docs/deploy.md`.

Deuda/seguimiento: las teselas (~80 GB) + crecimiento de la hypertable de telemetría irán
comiendo el margen libre. Re-evaluar disco en unos meses; mover Valhalla a host aparte es
trivial (solo un contenedor + volumen) si aprieta.

### Backend

#### Migración 061 (additive)

Tabla `vehicle_destination`:

| Columna | Tipo | Notas |
|---|---|---|
| `id` | PK | |
| `tenant_id` | FK tenant | índice `ix_vehicle_destination_tenant_id` |
| `vehicle_id` | FK vehicle | **único** — un destino activo por vehículo |
| `label` | text | texto de la ubicación buscada (dirección/nombre) |
| `lat` | float | |
| `lon` | float | |
| `status` | enum/text | `active` \| `arrived` \| `cancelled` |
| `assigned_by` | FK user | quién lo asignó |
| `assigned_at` | timestamptz | |
| `arrived_at` | timestamptz nullable | se rellena al detectar llegada |

#### Endpoints (todos con checklist multi-tenant del CLAUDE.md)

- `POST /api/v1/vehicles/{id}/destination` — body `{lat, lon, label}`. Crea/reemplaza el
  destino activo del vehículo. Valida que el usuario puede gestionar ese vehículo
  (`tenant_id` + jerarquía).
- `DELETE /api/v1/vehicles/{id}/destination` — cancela el destino activo
  (`status=cancelled`).
- `GET /api/v1/vehicles/{id}/destination` — devuelve el destino + **geometría de la ruta +
  distancia y duración restantes**, calculadas contra Valhalla desde la última posición
  conocida del vehículo en el momento de la petición.
- `GET /api/v1/geocode?q=…` — proxy a Nominatim (si no existe ya uno reutilizable).
- `GET /api/v1/route?from=lat,lon&to=lat,lon` — proxy a Valhalla; devuelve geometría
  (GeoJSON/polyline) + distancia + duración. Usado por el modo "ruta libre".

#### Cálculo de ETA en vivo

- El ETA restante se calcula **bajo demanda** en `GET destination`, no en el pipeline de
  ingest (el ingestor no se toca).
- Solo afecta a vehículos **con destino activo** (pocos), así que es barato incluso con
  N=1000 vehículos.
- El frontend refresca el destino/ruta del vehículo seleccionado cuando llega una nueva
  posición por WebSocket (o con un intervalo ligero de respaldo).
- **Detección de llegada:** si la posición del vehículo entra dentro de un radio `X` metros
  del destino (p. ej. 100 m), se marca `status=arrived` + `arrived_at`.
- El proxy a Valhalla aplica un `LIMIT`/timeout defensivo y `wait_for` acorde a las reglas
  de escalabilidad.

### Frontend (pantalla de flota)

Archivos implicados (ya localizados):
- `frontend/src/features/fleet/FleetDashboard.tsx` — orquesta mapa + paneles.
- `frontend/src/features/fleet/FleetMap.tsx` — mapa Leaflet, marcadores.
- `frontend/src/features/fleet/VehicleDetailPanel.tsx` — panel lateral derecho.

Cambios:
- **Caja de búsqueda de ubicación** en el mapa → llama a `GET /geocode` → muestra
  resultado(s) → al elegir, coloca un **marcador de destino** en el mapa.
- Con un vehículo seleccionado: botón **"Enviar destino a este vehículo"** → `POST
  destination`. Dibuja la **polyline de la ruta** vehículo→destino y muestra en el panel
  lateral **distancia + ETA restante**, refrescando con las posiciones en vivo.
- Botón para **cancelar/cambiar** el destino (`DELETE`).
- Modo **"ruta libre"**: el operador elige origen (clic en el mapa o un vehículo) y destino
  y previsualiza ruta/distancia/tiempo con `GET /route`, **sin guardar**.
- La geometría de Valhalla se pinta como **polyline a mano** sobre Leaflet (`L.geoJSON` /
  `L.polyline`). **No** se añade `leaflet-routing-machine` ni otras dependencias.

### Fuera de alcance (Fase 2)

- Recepción del destino y navegación turn-by-turn en la app móvil del conductor.
- ETA con tráfico en vivo (Valhalla da ETA por distancia/velocidad de vía, no tráfico real).

---

## Bloque 2 — Panel lateral de flota configurable

### Estado actual

- `VehicleDetailPanel.tsx` pinta **4 campos fijos (hardcoded)**: ignición, velocidad,
  tensión de batería, PTO.
- El **popup del mapa** (`popupHtml.ts`) ya pinta sensores según flags del `sensor_schema`
  (`show_in_popup`, `visible_in_detail`), editables en la pantalla de tipos de vehículo.
- El panel lateral es el único que **no** usa ese mecanismo.

### Cambios

- Añadir flag **`show_in_fleet_panel?: boolean`** a `SensorDef`
  (`frontend/src/lib/types.ts`). Como `sensor_schema` es JSONB, **no requiere migración de
  BD** (es additive dentro del JSON).
- En el editor de sensores (`VehicleTypesPage.tsx` y/o
  `settings/VehicleTypeSensorsSection.tsx`): un **checkbox "Mostrar en panel de flota"**
  junto a los `show_in_popup` / `visible_in_detail` existentes.
- `VehicleDetailPanel.tsx`: en vez de los 4 campos fijos, leer el `sensor_schema` del tipo
  de vehículo del vehículo seleccionado y pintar los sensores con
  `show_in_fleet_panel === true`, reutilizando `formatSensorValue` / `applyTransform`
  (la misma lógica del popup). Si esa lógica está embebida en `popupHtml.ts`, **extraerla a
  un helper compartido** para no duplicarla.
- **Fallback**: si ningún sensor del tipo tiene el flag activado, se mantienen los 4 campos
  actuales (ignición, velocidad, tensión, PTO). No se rompe la experiencia existente.

### Notas

- Es por tipo de vehículo (donde vive el `sensor_schema`), no por vehículo individual.
- Desplegable de forma independiente del Bloque 1.

---

## Validación

- **Backend (Bloque 1):**
  - `pytest backend/tests/test_vehicle_destination.py -xvs` (nuevo).
  - `curl -H "Authorization: Bearer $TOKEN" .../vehicles/{id}/destination` (POST/GET/DELETE).
  - `curl .../route?from=...&to=...` y `.../geocode?q=...`.
  - `alembic upgrade head` + verificar SQL de la migración 061.
  - Verificar que el contenedor `valhalla` responde solo en red interna y `df -h` tras build.
- **Frontend:** búsqueda → marca destino → envía a vehículo → ve ETA refrescándose con WS;
  modo ruta libre; cancelar destino.
- **Backend (Bloque 2):** sin migración. Verificar fallback (tipo sin flags → 4 campos).
- **Frontend (Bloque 2):** marcar sensores en Tipos → aparecen en el panel lateral de flota.

## Riesgos / deuda

- **Disco:** build de Valhalla Europa con pico ~108 GB sobre 120 GB libres. Mitigado
  borrando el `.pbf` tras generar teselas. Seguir de cerca el margen a futuro.
- **RAM build:** ~10–20 GB puntual. Hacerlo fuera de hora punta.
- Reutilizar/confirmar si ya existe un proxy de geocoding (órdenes de trabajo) antes de
  crear uno nuevo.
