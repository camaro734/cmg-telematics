# Sprint 15 — Ciclos de Trabajo y Exportación CSV

**Fecha:** 2026-04-21
**Estado:** Aprobado

## Objetivo

Añadir un sistema genérico de ciclos de trabajo configurable por tipo de vehículo: registro de eventos operativos (activaciones PTO, pulsos de sensor, superación de umbrales, períodos de ignición) con métricas JSONB extensibles por ciclo. También incluye exportación CSV de alertas y logs de mantenimiento.

## Alcance

### Incluido
- Tabla `work_cycle_definition` — define qué es un ciclo para un `vehicle_type`, configurable por CMG admin y client admin
- Tabla `work_cycle` — almacena cada ciclo detectado con `cycle_data JSONB`
- Servicio `cycle_detector.py` — detección retroactiva desde `telemetry_record` para 4 tipos de trigger
- API CRUD para definiciones + endpoint de consulta + endpoint de cómputo bajo demanda
- Frontend: pestaña "Ciclos" en ficha de vehículo + sección "Definiciones de ciclos" en Ajustes
- Exportación CSV: `GET /api/v1/alerts/export.csv` y `GET /api/v1/maintenance/logs/export.csv`
- Botones de descarga CSV en AlertsPage y MaintenancePage

### Excluido
- Detección en tiempo real (deferred, requeriría nuevo suscriptor Redis Streams)
- Agregados de ciclos en `telemetry_1h`/`telemetry_1d`
- Vista móvil de ciclos
- Ciclos en el informe mensual PDF (se añade en sprint posterior)
- Exportación CSV de ciclos (suficiente con la UI por ahora)

## Arquitectura

```
VehicleType → WorkCycleDefinition (trigger_type, trigger_config, snapshot_fields, aggregate_fields)
                     ↓ POST /api/v1/work-cycles/compute (admin, bajo demanda)
              cycle_detector.py → query telemetry_record → agrupa por trigger_type → escribe WorkCycle
                     ↓
              GET /api/v1/work-cycles?vehicle_id=&from_dt=&to_dt= → WorkCycleOut[]
                     ↓
              WorkCyclesTab.tsx (en ficha de vehículo)
```

## Modelo de datos

### `work_cycle_definition`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID PK | |
| `vehicle_type_id` | UUID FK → vehicle_type | ON DELETE CASCADE |
| `tenant_id` | UUID FK → tenant (nullable) | NULL = definición global CMG; no-null = definición del cliente |
| `name` | varchar(100) | Nombre descriptivo, ej. "Ciclo bomba agua" |
| `trigger_type` | varchar(30) | Enum: `pto_change`, `threshold_exceeded`, `sensor_pulse`, `ignition_period` |
| `trigger_config` | JSONB | Parámetros según trigger_type (ver abajo) |
| `snapshot_fields` | JSONB (list[str]) | Campos de `can_data` a capturar al inicio y fin del ciclo |
| `aggregate_fields` | JSONB (list[str]) | Campos de `can_data` a agregar (sum/avg/max) durante el ciclo |
| `active` | bool | Para desactivar sin borrar |
| `created_at` | timestamptz | |

**trigger_config por trigger_type:**
- `pto_change`: `{}` (usa `telemetry_record.pto_active`)
- `threshold_exceeded`: `{"sensor": "hydraulic_pressure", "op": ">", "threshold": 280}`
- `sensor_pulse`: `{"sensor": "inductive_sensor", "min_gap_seconds": 30}`
- `ignition_period`: `{}` (usa `telemetry_record.ignition`)

### `work_cycle`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID PK | |
| `vehicle_id` | UUID FK → vehicle | ON DELETE CASCADE |
| `definition_id` | UUID FK → work_cycle_definition | ON DELETE CASCADE |
| `tenant_id` | UUID FK → tenant | ON DELETE CASCADE |
| `started_at` | timestamptz | Inicio del ciclo (indexed) |
| `ended_at` | timestamptz (nullable) | Fin del ciclo; null para trigger_type=sensor_pulse |
| `duration_seconds` | int (nullable) | ended_at - started_at en segundos |
| `cycle_data` | JSONB | Valores capturados: `{field_start, field_end, field_sum, field_avg, field_max}` |
| `lat` | numeric(9,6) (nullable) | Posición GPS al inicio del ciclo |
| `lon` | numeric(9,6) (nullable) | |

## Trigger types — lógica de detección

### `pto_change`
Agrupa períodos contiguos en `telemetry_record` donde `pto_active = true`.
Ejemplo: cisterna con bomba hidráulica activa.

### `threshold_exceeded`
Agrupa períodos contiguos donde `(can_data->>sensor)::float {op} threshold`.
Ejemplo: excavadora con presión hidráulica > 280 bar.

### `sensor_pulse`
Detecta registros individuales donde `can_data->>sensor` es truthy (`true`, `"1"`, `1`).
Deduplica pulsos dentro de `min_gap_seconds` (por defecto 30s) para evitar contar el mismo evento físico varias veces.
Ejemplo: camión de basura con sensor inductivo en compactador.

### `ignition_period`
Agrupa períodos contiguos donde `ignition = true`.
Ejemplo: hormigonera — jornada completa de trabajo con temp/humedad/RPM de tolva.

## Backend

### Endpoints — `backend/app/api/v1/work_cycles.py`

```
GET    /api/v1/work-cycles/definitions              → list[WorkCycleDefinitionOut]
POST   /api/v1/work-cycles/definitions              → WorkCycleDefinitionOut (admin)
PATCH  /api/v1/work-cycles/definitions/{id}         → WorkCycleDefinitionOut (admin, propio tenant)
DELETE /api/v1/work-cycles/definitions/{id}         → 204 (admin, propio tenant)

GET    /api/v1/work-cycles?vehicle_id&from_dt&to_dt → list[WorkCycleOut]
POST   /api/v1/work-cycles/compute                  → {"computed": N} (admin)
```

**Permisos definiciones:**
- CMG admin: CRUD completo; `tenant_id = null` (global)
- Client admin: CRUD solo de sus definiciones (`tenant_id = user.tenant_id`); puede leer las globales CMG (tenant_id=null)
- Cualquier autenticado: puede leer definiciones propias + globales

**Permisos ciclos:**
- CMG admin: ve todos
- Client admin / operator: solo vehículos de su tenant

### Servicio — `backend/app/services/cycle_detector.py`

`detect_and_store_cycles(db, vehicle_id, tenant_id, definition, from_dt, to_dt) → int`

1. Borra ciclos existentes para ese vehicle+definition+período (evita duplicados en recómputo)
2. Consulta `telemetry_record` para el período
3. Aplica algoritmo según `trigger_type`
4. Para cada ciclo: construye `cycle_data` a partir de `snapshot_fields` y `aggregate_fields`
5. Escribe filas `work_cycle` en bulk
6. Retorna número de ciclos detectados

### CSV export

**`GET /api/v1/alerts/export.csv`** — mismos filtros que `GET /api/v1/alerts` pero sin límite.
Columnas: `id, vehicle_id, rule_name, severity, triggered_at, resolved_at, status, trigger_value, ack_note`
Response: `StreamingResponse(text/csv)`, `Content-Disposition: attachment; filename="alertas.csv"`

**`GET /api/v1/maintenance/logs/export.csv`** — todos los logs del tenant.
Columnas: `id, vehicle_name, plan_name, performed_at, performed_by_email, description, cost_eur`
Response: `StreamingResponse(text/csv)`, `Content-Disposition: attachment; filename="mantenimiento.csv"`

## Frontend

### `WorkCyclesTab.tsx` — `frontend/src/features/vehicle/WorkCyclesTab.tsx`

Props: `{ vehicleId: string, vehicleTypeId: string, tenantId: string }`

- Selector de definición activa (useQuery definitions filtradas por vehicle_type_id)
- Selector de rango de fechas (from/to, por defecto mes actual)
- Botón "Calcular ciclos" → mutation POST /work-cycles/compute → invalida ciclos query
- Tabla de ciclos: Inicio | Fin | Duración | GPS | Datos del ciclo (expandible)
- Estado vacío: "No hay ciclos para este período. Pulsa 'Calcular ciclos' para detectarlos."

### `WorkCycleDefinitionsSection.tsx` — `frontend/src/features/settings/WorkCycleDefinitionsSection.tsx`

- Lista de definiciones del tenant (+ globales CMG si client admin)
- Botón "+ Nueva definición" → modal con: nombre, vehicle_type (select), trigger_type (select), trigger_config (campos dinámicos según tipo), snapshot_fields (input multi-tag), aggregate_fields (input multi-tag)
- Botón toggle activo/inactivo inline
- Sólo admin ve botones de crear/editar

### Modificaciones existentes

**`frontend/src/features/vehicle/VehiclePage.tsx`** — añadir pestaña "Ciclos" (junto a las existentes).

**`frontend/src/features/settings/SettingsPage.tsx`** — añadir sección "Ciclos de trabajo" con `WorkCycleDefinitionsSection`.

**`frontend/src/features/alerts/AlertsPage.tsx`** — añadir botón "Exportar CSV" que llama `apiClient.getBlob('/api/v1/alerts/export.csv?...')`.

**`frontend/src/features/maintenance/MaintenancePage.tsx`** — añadir botón "Exportar CSV" para logs.

## Tests

### Backend — `tests/api/test_work_cycles_api.py`

| Test | Descripción |
|------|-------------|
| `test_wc_unauthenticated` | Sin token → 403 |
| `test_wc_cmg_admin_creates_definition` | CMG admin POST → 201, tenant_id=null |
| `test_wc_client_admin_creates_definition` | Client admin POST → 201, tenant_id=user.tenant_id |
| `test_wc_non_admin_cannot_create` | Operator role POST → 403 |
| `test_wc_client_cannot_modify_global` | Client admin PATCH definición global CMG → 404 |
| `test_wc_list_cycles_scoped` | Client admin GET cycles → solo su tenant |
| `test_wc_compute_returns_count` | Admin POST /compute con mock detector → 200, {"computed": N} |

## Ficheros modificados/creados

| Fichero | Acción |
|---------|--------|
| `backend/alembic/versions/006_work_cycles.py` | Crear — migración |
| `backend/app/models/work_cycle.py` | Crear — WorkCycleDefinition + WorkCycle |
| `backend/app/schemas/work_cycle.py` | Crear — schemas Pydantic |
| `backend/app/services/cycle_detector.py` | Crear — lógica de detección |
| `backend/app/api/v1/work_cycles.py` | Crear — endpoints |
| `backend/app/api/v1/router.py` | Modificar — registrar work_cycles_router |
| `backend/app/api/v1/alerts.py` | Modificar — añadir export.csv |
| `backend/app/api/v1/maintenance.py` | Modificar — añadir logs/export.csv |
| `backend/tests/api/test_work_cycles_api.py` | Crear — 7 tests |
| `frontend/src/lib/types.ts` | Modificar — añadir WorkCycleDefinition, WorkCycle |
| `frontend/src/lib/queryKeys.ts` | Modificar — añadir workCycleDefinitions, workCycles |
| `frontend/src/features/vehicle/WorkCyclesTab.tsx` | Crear |
| `frontend/src/features/vehicle/VehiclePage.tsx` | Modificar — añadir pestaña Ciclos |
| `frontend/src/features/settings/WorkCycleDefinitionsSection.tsx` | Crear |
| `frontend/src/features/settings/SettingsPage.tsx` | Modificar — añadir sección ciclos |
| `frontend/src/features/alerts/AlertsPage.tsx` | Modificar — botón CSV |
| `frontend/src/features/maintenance/MaintenancePage.tsx` | Modificar — botón CSV |
