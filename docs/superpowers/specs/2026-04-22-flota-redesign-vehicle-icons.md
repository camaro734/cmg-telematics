# FlotaPage Rediseño + Iconos por Tipo de Vehículo — Spec

**Fecha:** 2026-04-22
**Estado:** Aprobado por usuario
**Sprint:** 18

---

## Objetivo

Rediseñar la FlotaPage para que siga el diseño Figma del cliente: grid de tarjetas de camiones con iconos PNG por tipo, mapa top-right, panel inferior con Servicios del día (placeholder) + Incidencias reales, y panel lateral al seleccionar un vehículo con datos básicos + estados CAN dinámicos del sensor_schema.

Añadir además un sistema de upload de icono PNG por tipo de vehículo, gestionado desde VehicleTypesPage por CMG admin.

---

## Arquitectura

### Backend

**Migración `007_vehicle_type_icon_url`**
- Añade columna `icon_url TEXT NULL` a tabla `vehicle_type`

**Almacenamiento de archivos**
- Los PNG se guardan en `/app/uploads/icons/{type_id}.png` dentro del contenedor core-api
- Volumen Docker `uploads_data` montado en `/app/uploads/` (persistente entre reinicios)
- FastAPI monta `StaticFiles` en `/uploads` → `app/uploads/`
- Caddy añade bloque explícito: `handle /uploads/* { reverse_proxy core-api:8010 }` antes del bloque catch-all del frontend — sin esto los iconos irían al nginx del frontend en lugar de al core-api

**Endpoint nuevo: `POST /api/v1/vehicle-types/{type_id}/icon`**
- Solo CMG admin
- Acepta `multipart/form-data` con campo `file` (PNG, max 2 MB)
- Valida `content_type == "image/png"`
- Guarda en `/app/uploads/icons/{type_id}.png` (sobrescribe si existe)
- Actualiza `vehicle_type.icon_url = "/uploads/icons/{type_id}.png"`
- Devuelve `VehicleTypeOut` actualizado

**Schema `VehicleTypeOut`** — añade `icon_url: str | None = None`

**`backend/app/main.py`** — añade `app.mount("/uploads", StaticFiles(directory="/app/uploads"), name="uploads")`

### Frontend

**`frontend/src/lib/types.ts`**
- `VehicleTypeOut`: añade `icon_url: string | null`

**`frontend/src/features/vehicles/VehicleTypesPage.tsx`**
- En el header del tipo seleccionado: miniatura del icono actual (40×40px, object-fit: contain) o placeholder gris
- Botón "Subir icono" → `<input type="file" accept="image/png">` oculto → al seleccionar archivo: POST multipart al endpoint → invalida query vehicleTypes

**`frontend/src/features/fleet/FleetPage.tsx`** — rediseño completo (ver layout)

**`frontend/src/features/fleet/VehicleList.tsx`** — reemplazar lista por grid de tarjetas (o mover lógica inline a FleetPage)

---

## Layout FlotaPage

```
┌──────────────────────────────────────────┬───────────────────────┐
│  FLOTA  • Activos (N) / No activos (M)   │                       │
│                                          │   MAPA LEAFLET        │
│  [Grid tarjetas — scroll vertical]       │   FleetMap sin cambios│
│  auto-fill minmax(160px, 1fr)            │                       │
│                                          │                       │
├──────────────┬───────────────────────────┴───────────────────────┤
│ Servicios    │  Incidencias (alertas firing)   │ Panel vehículo  │
│ del día      │  hora + regla + vehículo        │ (solo si hay    │
│ (placeholder)│  máx 5, scroll                 │  seleccionado)  │
└──────────────┴─────────────────────────────────┴─────────────────┘
```

- Top section: flex row, grid izq ~55% + mapa der ~45%, altura fija ~55vh
- Bottom section: flex row, altura ~45vh, overflow hidden
  - Sin selección: 2 columnas (Servicios + Incidencias) a 50/50
  - Con selección: 3 columnas (Servicios 25% + Incidencias 35% + Panel 40%)
  - Transición CSS suave al aparecer/desaparecer el panel

---

## Tarjetas de vehículo

Cada tarjeta (`VehicleCard`):
- Dimensiones: ~160×140px mínimo
- Borde 2px: `--accent-ok` (verde, online) / `--bg-border` (gris, offline) / `--accent-energy` (naranja, seleccionado)
- Fondo: `--bg-surface`
- Área imagen: 80px altura, centrada, `object-fit: contain`; si `vehicleType.icon_url` existe → `<img>`, si no → SVG genérico de camión
- Matrícula: texto 12px `--font-data`, centrado abajo
- Punto de estado: 8px círculo verde/gris bottom-right
- Click → selecciona vehículo (estado local en FleetPage)

---

## Panel de vehículo seleccionado

Al hacer click en una tarjeta, aparece el panel bottom-right con:

**Cabecera:**
- Empresa (tenant name, de lookup por `vehicle.tenant_id`)
- Conductor: "—" (no hay conductor asignado en el modelo actual)
- Enlace "Detalle →" a `/vehicles/:id`

**Ficha:**
- Tipo de vehículo: `vehicleType.name`
- Matrícula: `vehicle.license_plate ?? "—"`
- VIN: `vehicle.vin ?? "—"`

**Estados CAN** (lista vertical, cada ítem con label + badge ON/OFF):
1. **Ignición** (fijo) — de `vehicleStatus.ignition`
2. **PTO** (fijo) — de `vehicleStatus.pto_active`
3. Por cada `SensorDef` en `vehicleType.sensor_schema` con `gauge_type === 'led'` y `avl_id` definido:
   - Label: `def.label`
   - Valor: bit `(can_data[avl_{avl_id}] >> bit_index) & 1` si `bit_index` existe, o `can_data[avl_{avl_id}] === 1`
   - Badge: verde "Activo" / gris "Desactivado"

**Última señal:** `vehicleStatus.last_seen` formateado como tiempo relativo

---

## Incidencias

- Query: `GET /api/v1/alerts?status=firing` (endpoint existente)
- Muestra máx 5 alertas más recientes
- Cada ítem: hora relativa + nombre de regla + nombre de vehículo + botón "Detalles →" → `/alerts`
- Si 0 alertas: texto "Sin incidencias activas" en verde

---

## Servicios del día (placeholder)

- Sección con header "Servicios del día" + filtro de fecha (no funcional, UI only)
- Lista vacía con mensaje "Próximamente — configuración por cliente y tipo de vehículo"
- El modelo de datos y la lógica de ciclos automáticos se diseñará en un sprint posterior

---

## Ficheros afectados

| Fichero | Acción |
|---|---|
| `backend/alembic/versions/007_vehicle_type_icon_url.py` | crear |
| `backend/app/models/vehicle_type.py` | añadir `icon_url` |
| `backend/app/schemas/vehicle.py` | añadir `icon_url` a `VehicleTypeOut` |
| `backend/app/api/v1/vehicles.py` | añadir `POST /vehicle-types/{id}/icon` |
| `backend/app/main.py` | montar `StaticFiles` + crear dir uploads |
| `docker-compose.yml` | añadir volumen `uploads_data` en core-api |
| `Caddyfile` | añadir bloque `/uploads/*` |
| `frontend/src/lib/types.ts` | `icon_url` en `VehicleTypeOut` |
| `frontend/src/features/vehicles/VehicleTypesPage.tsx` | upload icono |
| `frontend/src/features/fleet/FleetPage.tsx` | rediseño completo |
| `frontend/src/features/fleet/VehicleList.tsx` | reemplazar por `VehicleCard` grid |

---

## Restricciones

- `FleetMap.tsx` no se toca — ya funciona con marcadores y WebSocket
- El WebSocket de estado en tiempo real no cambia
- Conductor: campo reservado para cuando el modelo tenga asignación de conductor
- No se implementa geofencing ni clustering de paradas en este sprint
- PNG máx 2 MB, solo PNG (no JPEG, no SVG) para consistencia de iconos
- Los iconos se sirven desde el mismo dominio (no CDN) — suficiente para <500 vehículos

---

## Notas de implementación

- `useVehicleStatuses` hook existente ya provee el `can_data` en tiempo real — reutilizar sin modificar
- La selección de vehículo es estado local en `FleetPage` (no Zustand) — `useState<string>('')`
- El lookup de tenant name para el panel: añadir query de tenants al FleetPage (ya existe en otros componentes)
- El panel bottom-right usa `transition: width 0.2s` para aparecer/desaparecer suavemente
