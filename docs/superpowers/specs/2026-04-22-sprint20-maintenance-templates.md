# Sprint 20 — Plantillas de Mantenimiento + Workflow de Cumplimiento

**Fecha:** 2026-04-22
**Estado:** Aprobado por usuario
**Sprint:** 20

---

## Objetivo

Permitir que CMG defina plantillas de mantenimiento en cada tipo de vehículo. Al crear un vehículo, sus planes de mantenimiento se generan automáticamente. Cuando un plan vence, el sistema envía un email al tenant. El cliente sube un documento (factura/albarán) y puede resetear el contador. CMG puede ajustar umbrales por vehículo concreto.

---

## Flujo completo

```
CMG define plantillas en Tipos de Vehículo
      ↓
Se crea un vehículo tipo "Cisterna"
      ↓
Se auto-crean maintenance_plan rows desde las plantillas
      ↓
Sistema (tarea background) detecta plan próximo/vencido
      ↓
Email al notification_email del tenant
      ↓
Cliente entra a MaintenancePage → ve plan vencido
      ↓
Sube documento (factura PDF/imagen) → botón "Resetear" se activa
      ↓
Pulsa Resetear → se crea maintenance_log con document_url → contadores reseteados
      ↓ (opcional, solo CMG)
CMG puede editar umbrales del plan de un vehículo concreto (ej. 1000h → 500h)
```

---

## Arquitectura

### Backend

**Migración 009** — una sola migración que añade:
- `vehicle_type.maintenance_templates JSONB NOT NULL DEFAULT '[]'`
- `maintenance_log.document_url TEXT NULL`

**`vehicle_type.maintenance_templates`** — array de plantillas:
```json
[
  {
    "name": "Aceite transfer",
    "thresholds": [{"type": "pto_hours", "value": 1000}],
    "warn_before_pct": 10
  },
  {
    "name": "Revisión anual",
    "thresholds": [{"type": "calendar_days", "value": 365}],
    "warn_before_pct": 5
  }
]
```

Tipos de umbral: `pto_hours` | `engine_hours` | `calendar_days` (mismos que ya usa el sistema).

**Auto-copia en POST /vehicles:** tras insertar el vehículo, iterar sobre `vehicle_type.maintenance_templates` y crear un `MaintenancePlan` por cada plantilla con `vehicle_id` del vehículo recién creado.

**Endpoint nuevo:** `PATCH /api/v1/vehicle-types/{type_id}/maintenance-templates`
- Solo CMG admin
- Body: `{"templates": [...]}`
- Reemplaza el array completo
- Retorna `VehicleTypeOut` actualizado

**Endpoint nuevo:** `POST /api/v1/maintenance/plans/{plan_id}/complete`
- Multipart/form-data: `file` (imagen o PDF, max 5 MB), `description` (optional), `performed_at` (optional, default now)
- Si el usuario NO es CMG admin → `file` es requerido (sin documento no puede resetear)
- Si el usuario ES CMG admin → `file` es opcional
- Guarda en `/app/uploads/maintenance_docs/{log_id}{ext}`
- Crea `MaintenanceLog` con `document_url` y `reset_counters = [t.type for t in plan.trigger_condition.thresholds]`
- Para umbrales `calendar_days`: actualiza `plan.next_due_at = now + value days`
- Retorna `MaintenanceLogOut` con `document_url`

**Endpoint existente reutilizado:** `PUT /api/v1/maintenance/plans/{plan_id}`
- Solo CMG admin
- Body: `MaintenancePlanUpdate` (ya existe el schema, solo necesita un endpoint PATCH separado del PUT actual)
- Permite editar name, trigger_condition, warn_before_pct, active

**Tarea background de notificaciones:** `backend/app/core/maintenance_notifier.py`
- `asyncio.create_task` desde el lifespan (patrón ya existente)
- Bucle: dormir 4 horas, despertar, consultar planes activos
- Para cada plan: obtener `progress.status` ya computado en el endpoint GET
- Si status es `'próximo'` o `'vencido'` y la última notificación fue hace más de 24h:
  - Publicar al Redis stream `alerts.fire` con `actions: [{"type": "email", "recipients": [tenant.notification_email]}]`
  - Usar Redis key `maint:notified:{plan_id}:{status}` con TTL 23h para evitar spam
- Si el tenant no tiene `notification_email` → skip silencioso

**StaticFiles:** el volumen `uploads_data` ya está montado en `/app/uploads`. Solo crear subdirectorio `maintenance_docs` en el startup (mkdir).

### Frontend

**`VehicleTypesPage.tsx`** — dos secciones nuevas en el panel derecho (debajo de Sensores):

*Sección "Planes de mantenimiento" (CMG admin only):*
- Tabla: Nombre | Umbral | Valor | % Aviso
- Botón "Añadir plantilla" → modal con: nombre, tipo (selector pto_hours/engine_hours/calendar_days), valor numérico, % aviso previo
- Editar / Eliminar por fila
- Guardar: `PATCH /vehicle-types/{id}/maintenance-templates`
- Invalidar `keys.vehicleTypes()` al guardar

*Sección "Reglas de alerta" (CMG admin only):*
- Filtrar las reglas del store/query por `vehicle_filter.scope === 'type'` y `vehicle_filter.vehicle_type_id === selectedType.id`
- Lista: nombre de regla, severidad badge, estado activo/inactivo
- Botón "Nueva regla para este tipo" → navega a `/rules/new?type_id={selectedType.id}`

**`MaintenancePage.tsx`** — añadir workflow de cumplimiento:

El card/fila de cada plan muestra botón "Realizar mantenimiento" cuando `progress.status === 'próximo' || 'vencido'`.

Al pulsar: modal "Registrar mantenimiento":
- Input file: `accept="image/*,.pdf"` (si el usuario no es CMG admin → requerido, mostrar error si vacío)
- Textarea descripción (opcional)
- Botón "Confirmar y resetear contador"

Al confirmar:
1. `POST /api/v1/maintenance/plans/{plan_id}/complete` con FormData (file + description)
2. Invalidar `keys.maintenancePlans()` (o similar)
3. Cerrar modal, mostrar toast "Mantenimiento registrado"

El botón de reset NO aparece si `progress.status === 'ok'`.

**`RuleFormPage.tsx`** — leer query param `?type_id`:
- Si existe `type_id` en la URL → pre-rellenar `vehicle_filter` con `scope: 'type'` y `vehicle_type_id: type_id`
- No requiere cambio de lógica, solo leer `useSearchParams`

**`VehicleDetailPage.tsx`** — nueva pestaña "Mantenimiento" (CMG admin only):
- Lista los `maintenance_plan` del vehículo (ya hace `GET /vehicles/{id}/maintenance`)
- Cada plan muestra: nombre, umbral, progreso, estado
- Botón "Editar umbrales" (solo visible si CMG admin) → modal con campos editables: nombre, tipo umbral, valor, % aviso → `PUT /api/v1/maintenance/plans/{plan_id}` (endpoint existente)

---

## Schemas Pydantic nuevos / modificados

**`MaintenanceTemplateItem`** (nuevo):
```python
class MaintenanceTemplateItem(BaseModel):
    name: str
    thresholds: list[MaintenanceThreshold]  # ya existe MaintenanceThreshold
    warn_before_pct: int = 10
```

**`MaintenancePlanOut`** — añadir `document_url: str | None = None` al `MaintenanceLogOut`.

**`VehicleTypeOut`** — añadir `maintenance_templates: list[MaintenanceTemplateItem] = []`.

---

## Ficheros afectados

| Fichero | Acción |
|---|---|
| `backend/alembic/versions/009_maintenance_templates_and_doc.py` | Crear |
| `backend/app/models/vehicle_type.py` | Añadir `maintenance_templates` JSONB |
| `backend/app/models/maintenance.py` | Añadir `document_url` a `MaintenanceLog` |
| `backend/app/schemas/vehicle.py` | `VehicleTypeOut` + `MaintenanceTemplateItem` |
| `backend/app/schemas/maintenance.py` | `MaintenanceLogOut.document_url` |
| `backend/app/api/v1/vehicles.py` | PATCH maintenance-templates + auto-copy en POST /vehicles |
| `backend/app/api/v1/maintenance.py` | POST complete (nuevo) — PUT plan ya existe |
| `backend/app/core/maintenance_notifier.py` | Crear — tarea background |
| `backend/app/main.py` | mkdir maintenance_docs + lanzar tarea notifier |
| `frontend/src/lib/types.ts` | `MaintenanceTemplateItem`, campos nuevos |
| `frontend/src/features/vehicles/VehicleTypesPage.tsx` | Secciones Mantenimiento + Reglas |
| `frontend/src/features/maintenance/MaintenancePage.tsx` | Modal "Realizar mantenimiento" |
| `frontend/src/features/rules/RuleFormPage.tsx` | Leer `?type_id` query param |
| `frontend/src/features/vehicle/VehicleDetailPage.tsx` | Pestaña Mantenimiento + edit CMG |

---

## Restricciones

- `FleetMap.tsx` no se toca
- El documento es obligatorio para clientes (no CMG) al resetear
- CMG puede resetear sin documento
- CMG puede editar umbrales por vehículo; los clientes no
- Formatos aceptados: imagen (`image/*`) y PDF (`.pdf`), max 5 MB
- La tarea background usa Redis para anti-spam (TTL 23h por plan+status)
- Si el tenant no tiene `notification_email` configurado, el aviso se omite silenciosamente
- No se implementa un historial de documentos en este sprint (solo `document_url` en el log)
- El progreso de `pto_hours`/`engine_hours` ya lo computa el sistema existente — no se modifica esa lógica
