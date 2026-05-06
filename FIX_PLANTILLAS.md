# Diagnóstico y Fix — Propagación de plantillas a vehículos

Fecha: 2026-04-30

---

## Bugs encontrados

### Bug 1 (CRÍTICO): apply-maintenance-templates nunca se llamaba

**Descripción:**
El endpoint `POST /api/v1/vehicle-types/{type_id}/apply-maintenance-templates` existía en el backend y
funcionaba correctamente, pero el frontend NUNCA lo llamaba. Al guardar o editar una plantilla de
mantenimiento en `VehicleTypesPage`, solo se actualizaba el campo `maintenance_templates` en
`vehicle_type` (vía `PATCH /maintenance-templates`), pero los vehículos ya existentes del tipo
no recibían los planes de mantenimiento correspondientes.

Los vehículos creados NUEVOS sí recibían los planes (porque `POST /vehicles` tiene lógica de
auto-creación en el backend). Solo los vehículos preexistentes quedaban sin planes.

**Causa:** Faltaba la llamada al endpoint en el `onSuccess` de `updateTemplatesMutation`.

**Archivo afectado:** `frontend/src/features/vehicles/VehicleTypesPage.tsx`

### Bug 2 (MODERADO): KPI_OPTIONS con campos que no existen en telemetry_1h

**Descripción:**
La lista `KPI_OPTIONS` en `VehicleTypesPage.tsx` incluía `distance_km`, `max_speed_kmh` y
`pto_cycles` como métricas seleccionables para configurar en el histórico de vehículos. Sin embargo,
la vista materializada `telemetry_1h` (TimescaleDB continuous aggregate) NO tiene esas columnas —
solo tiene `avg_pressure_1`, `max_pressure_1`, `avg_oil_temp`, `max_oil_temp`,
`pto_active_minutes`, `engine_on_minutes` y `record_count`.

Si un usuario configuraba esas métricas, el gráfico mostraba siempre 0 porque
`h['distance_km']` es `undefined` en todos los registros de `KpiHour`.

**Archivo afectado:** `frontend/src/features/vehicles/VehicleTypesPage.tsx`

### Bug 3 (MENOR): Cache invalidation insuficiente tras apply-maintenance-templates

**Descripción:**
El `applyTemplatesMutation` solo invalidaba `['maintenance']`, que cubre los queries de
`ReportsPage` y `MaintenancePage`. Pero `VehicleDetailPage` usa el query key
`['vehicles', id, 'maintenance']` para sus planes. Sin invalidar ese prefijo, la página de
detalle del vehículo no se actualizaba automáticamente.

**Archivo afectado:** `frontend/src/features/vehicles/VehicleTypesPage.tsx`

---

## Archivos modificados

### `frontend/src/features/vehicles/VehicleTypesPage.tsx`

**Cambios:**

1. Nuevo estado `applyResult` para feedback visual al usuario.

2. Nuevo `applyTemplatesMutation` que llama a `POST /api/v1/vehicle-types/{typeId}/apply-maintenance-templates`
   e invalida los query caches de mantenimiento en VehicleDetailPage y ReportsPage.

3. `updateTemplatesMutation.onSuccess` ahora llama automáticamente a `applyTemplatesMutation`
   tras guardar una plantilla, propagando los planes a todos los vehículos activos del tipo.

4. Botón manual "Aplicar a vehículos existentes" en la sección de plantillas de mantenimiento,
   con feedback que muestra cuántos planes se crearon (o que ya todos los tenían).

5. `KPI_OPTIONS` corregido: eliminados `distance_km`, `max_speed_kmh` y `pto_cycles` (que no
   existen en `telemetry_1h`); añadidos `avg_pressure_1` y `avg_oil_temp` que sí existen.

6. Función `selectType()` que limpia `applyResult` al cambiar de tipo de vehículo.

---

## El backend estaba correcto

El endpoint `apply-maintenance-templates` en `backend/app/api/v1/vehicles.py` funcionaba bien:
- Busca vehículos activos del tipo
- Para cada template, verifica si ya existe un plan con ese nombre en el vehículo
- Si no existe, crea el plan con los umbrales definidos
- Devuelve cuántos planes se crearon

No se modificó el backend.

---

## Flujo correcto tras el fix

```
Usuario añade/edita plantilla en VehicleTypesPage
  → PATCH /vehicle-types/{id}/maintenance-templates  (actualiza la plantilla)
  → POST /vehicle-types/{id}/apply-maintenance-templates  (propaga a vehículos existentes)
    → Crea MaintenancePlan para cada vehículo activo que no tenga ese plan
  → Invalida cache ['maintenance'] y ['vehicles']
    → VehicleDetailPage refetches → muestra planes nuevos en tab MANTENIMIENTO
    → ReportsPage refetches → muestra planes en tab mantenimiento
```

---

## Cómo verificar que el fix funciona

1. Ir a `/tipos-vehiculo`, seleccionar un tipo con vehículos asignados.

2. Añadir una nueva plantilla de mantenimiento (ej: "Cambio aceite hidráulico", 500 h PTO).

3. Al guardar, aparece el mensaje "Se crearon X planes de mantenimiento en vehículos existentes"
   (o "Todos los vehículos ya tienen estos planes" si ya existían).

4. Ir a `/vehicles/{id}` de un vehículo de ese tipo → tab MANTENIMIENTO → debe aparecer el plan.

5. Ir a `/reports` → seleccionar el vehículo → tab Mantenimiento → debe aparecer el plan.

También está disponible el botón manual "Aplicar a vehículos existentes" para forzar la
propagación en cualquier momento sin necesidad de editar la plantilla.

---

## Notas adicionales

- Los vehículos creados NUEVOS después de configurar plantillas siguen recibiendo planes
  automáticamente (lógica en `POST /vehicles`, sin cambios).
- La lógica de apply es idempotente: no duplica planes que ya existen (busca por nombre).
- Para métricas de KPIs personalizadas que no están en telemetry_1h (velocidad, distancia,
  odómetro), usar la funcionalidad de AVL ID con el campo "Señal FMC650" — esos datos
  se consultan via `/avl-series` directamente desde `telemetry_record`.
