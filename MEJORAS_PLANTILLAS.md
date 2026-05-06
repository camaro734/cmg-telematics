# Mejoras en Plantillas de Vehículo

**Fecha:** 2026-04-26  
**Sprint:** 18

---

## TAREA 1 — Reglas de alerta como modal inline

### Cambios en `frontend/src/features/vehicles/VehicleTypesPage.tsx`

- **Eliminado** `useNavigate` y la navegación a `/rules/new` desde el botón "+ Nueva regla".
- **Añadido** estado `showRuleModal`, `ruleForm` (tipo `RuleFormState`).
- **Añadido** `createRuleMutation` (POST `/api/v1/rules`) y `deleteRuleMutation` (DELETE `/api/v1/rules/{id}`).
- **Añadido** `saveRule()` que construye el payload `RuleCreate` con:
  - `vehicle_filter.scope = 'type'` y `vehicle_type_id` del tipo activo
  - `condition.type = 'threshold'`, campo `avl_{avl_id}`, operador mapeado de `gt/lt/gte/lte/eq/neq`
  - `actions: [{ type: 'in_app' }]`, escalación vacía, `cooldown_minutes` configurable
- **Modal** con campos: nombre, señal AVL (selector `AVL_OPTIONS`), condición (6 operadores), umbral, severidad (info/aviso/crítica), cooldown.
- **Botón eliminar** (✕) en cada regla de la lista, con confirmación.

---

## TAREA 2 — Aplicar plantillas de mantenimiento a vehículos reales

### Cambios en `backend/app/api/v1/vehicles.py`

- **Nuevo endpoint:** `POST /api/v1/vehicle-types/{type_id}/apply-maintenance-templates`
  - Solo CMG admin.
  - Busca todos los vehículos activos (`active=True`) con ese `vehicle_type_id`.
  - Por cada vehículo × cada template: crea `MaintenancePlan` si no existe ya uno con ese nombre.
  - Devuelve `{ "created": N }`.

### Cambios adicionales en `frontend/src/features/vehicles/VehicleTypesPage.tsx`

- **Añadido** `applyTemplatesMutation` (POST al nuevo endpoint).
- **Modificado** `saveTemplate()`: encadena `applyTemplatesMutation` en el `onSuccess` de `updateTemplatesMutation`.
- **Mensaje** verde bajo el header de "Planes de mantenimiento": `"Plantilla guardada. N planes de mantenimiento creados."` (desaparece tras 6 s).

---

## Build

- `tsc -b --noEmit`: 0 errores.
- `vite build --outDir /tmp/cmg-dist`: compilado correctamente, `VehicleTypesPage` = 52.80 kB.
- El directorio `dist/` en producción requiere rebuild del contenedor (`docker compose up --build frontend`).
