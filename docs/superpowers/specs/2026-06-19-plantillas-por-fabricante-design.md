# Plantillas (tipos de vehículo) por fabricante + bloqueo de alta de dispositivos

Fecha: 2026-06-19
Estado: aprobado por Carlos

## Problema

Los clientes fabricantes ya tienen acceso a las páginas de Vehículos y Dispositivos. Dos ajustes:

1. **No deben poder crear dispositivos nuevos.** Hoy ven el botón "+ Nuevo dispositivo" y el
   backend les permite el alta. Solo CMG debe poder crear dispositivos.
2. **Al crear un vehículo**, el desplegable de "tipo de vehículo" debe mostrar únicamente las
   plantillas que CMG les asigne (gestionado desde la página de Plantillas / `/tipos-vehiculo`).

## Decisiones (acordadas)

- La asignación se gestiona **en la página de Plantillas**: al editar cada tipo, se marca qué
  fabricantes lo usan.
- El filtrado afecta a **fabricantes y sus subclientes**. CMG y los clientes directos de CMG ven
  todas las plantillas.
- **Lista blanca estricta**: un fabricante sin asignaciones ve el desplegable vacío.

## Parte 1 — Bloquear alta de dispositivos a fabricantes

- **Backend** `backend/app/api/v1/devices.py::create_device`: el gate pasa de
  `("cmg", "manufacturer")` a **solo `cmg` admin**. Se elimina la rama `manufacturer` y su cálculo
  de `effective_tenant_id`. Cualquier no-CMG recibe `403`.
- **Frontend** `frontend/src/features/devices/DevicesPage.tsx`: el botón "+ Nuevo dispositivo" y el
  modal de alta pasan de `isAdmin` a `isCmg && isAdmin`.
- El fabricante **sigue** viendo la página y **sigue** pudiendo transferir dispositivos sueltos
  (endpoint distinto, no se toca).

## Parte 2 — Desplegable filtrado por plantillas asignadas

### Modelo de datos (migración 057, additive)

Tabla de asociación `vehicle_type_manufacturer`:
- `vehicle_type_id` UUID FK → `vehicle_type.id` ON DELETE CASCADE
- `tenant_id` UUID FK → `tenant.id` ON DELETE CASCADE (debe ser tier `manufacturer`)
- PK compuesta `(vehicle_type_id, tenant_id)`

Nuevo modelo `VehicleTypeManufacturer`, registrado en `app/models/__init__.py`.

### Filtrado en `GET /vehicle-types`

Resolver el "fabricante efectivo" del usuario:
- `cmg` → todas (sin filtro).
- `manufacturer` → su propio `tenant_id`.
- `client`/`subclient` → su `parent_manufacturer_id` (si es `None` → cliente directo de CMG → todas).

Con fabricante efectivo, devolver la **unión de**:
- tipos asignados a ese fabricante, **+**
- tipos que el tenant del usuario ya usa en vehículos existentes (salvaguarda barata,
  `SELECT DISTINCT vehicle_type_id FROM vehicle WHERE tenant_id = ...`, para no romper la flota si
  CMG des-asigna un tipo en uso).

Fabricante nuevo sin vehículos → unión vacía (lista blanca estricta).

### Gestión (solo CMG)

- `PATCH /vehicle-types/{id}` acepta `manufacturer_ids: list[UUID] | None`. Si viene, reemplaza el
  set de asignaciones (valida que cada id sea tier `manufacturer`).
- `VehicleTypeOut` expone `manufacturer_ids: list[UUID]` para pintar los checkboxes.

### Frontend

- `VehicleTypesPage.tsx` (solo CMG admin): nueva sección **"Fabricantes con acceso"** en el editor
  del tipo seleccionado; checkboxes con los tenants tier `manufacturer`, guardado vía
  `PATCH manufacturer_ids`. Sigue el patrón de las secciones existentes.
- `VehiclesPage.tsx`: sin cambios; ya consume `GET /vehicle-types`, ahora filtrado.

## Tests backend

- Creación de dispositivos: fabricante admin → 403; CMG admin → 201.
- Filtrado de tipos: fabricante ve solo asignados + en-uso; subcliente hereda
  `parent_manufacturer_id`; CMG ve todos; cliente directo de CMG ve todos.
- `PATCH manufacturer_ids`: valida tier manufacturer; reemplaza el set.

## Despliegue

Migración additive con `compose run --rm --no-deps`; rebuild de core-api y frontend (procedimiento
de la memoria de deploy). Requiere confirmación explícita por ser producción.
