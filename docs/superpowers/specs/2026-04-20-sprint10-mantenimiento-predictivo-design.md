# Sprint 10 — Mantenimiento Predictivo
> Diseño aprobado: 2026-04-20

## Objetivo

Implementar el módulo de mantenimiento predictivo basado en ciclos hidráulicos reales.
Es el diferenciador clave de CMG frente a Samsara/Geotab: mantenimiento por horas PTO,
ciclos de motor y tiempo calendario — no por kilómetros.

---

## Decisiones de diseño

| Decisión | Elección | Motivo |
|----------|----------|--------|
| Ubicación UI | Página propia `/maintenance` | Vista global tipo "panel de taller"; más útil que tab por vehículo |
| Acumuladores | TimescaleDB (`telemetry_1h`) + `last_reset_at` desde `MaintenanceLog` | Persistente, sin estado extra, usa aggregates existentes |
| Redis | No usado para esta feature | Acumuladores Rules Engine son volátiles; no apropiados para histórico |
| Permisos log | `admin` o `permission_grant(resource_type='maintenance', 'log')` | CMG puede delegar registro de intervenciones a clientes sin ceder gestión de planes |
| Integración alertas | Fuera de scope (Sprint 11) | Desacoplar mantenimiento de rules-engine en primera iteración |

---

## Backend

### Modelos (ya existen — sin cambios en ORM)

```python
# backend/app/models/maintenance.py
class MaintenancePlan:
    id, vehicle_id, tenant_id, name
    trigger_condition: JSONB   # ver estructura abajo
    warn_before_pct: int       # default 10 — % antes del límite para estado "próximo"
    active: bool
    # next_due_at: no usado — el progreso se calcula dinámicamente

class MaintenanceLog:
    id, vehicle_id, plan_id
    performed_at: datetime
    performed_by: UUID | None  # FK user
    description: str | None
    reset_counters: ARRAY(String)  # contadores reseteados en esta intervención
    cost_eur: Decimal | None
    photo_urls: ARRAY(String) | None
```

### Estructura `trigger_condition` JSONB

```json
{
  "thresholds": [
    { "type": "pto_hours",     "value": 500  },
    { "type": "engine_hours",  "value": 1000 },
    { "type": "calendar_days", "value": 365  }
  ],
  "op": "OR"
}
```

Tipos soportados: `pto_hours`, `engine_hours`, `calendar_days`. `op: "OR"` significa que el primer umbral alcanzado determina el estado `vencido`.

### Cálculo de progreso

Para cada threshold del plan:

1. Buscar `performed_at` del `MaintenanceLog` más reciente de ese plan que incluya el tipo en `reset_counters`. Si no existe, usar `MaintenancePlan.created_at` como baseline.
2. Calcular valor acumulado desde el baseline:

| Tipo | Query sobre `telemetry_1h` |
|------|---------------------------|
| `pto_hours` | `SUM(pto_active_minutes) / 60.0 WHERE bucket >= baseline AND vehicle_id = ?` |
| `engine_hours` | `SUM(engine_on_minutes) / 60.0 WHERE bucket >= baseline AND vehicle_id = ?` |
| `calendar_days` | `(NOW() - baseline).days` — sin query |

3. Calcular porcentaje: `pct = current / limit * 100`
4. Determinar estado del plan (peor de todos los thresholds):
   - `ok` — todos los thresholds < `(100 - warn_before_pct)%`
   - `próximo` — alguno entre `(100 - warn_before_pct)%` y `100%`
   - `vencido` — alguno ≥ `100%`

### Endpoints

```
GET    /api/v1/maintenance/plans              — lista planes del tenant con progreso calculado
POST   /api/v1/maintenance/plans              — crear plan [admin]
GET    /api/v1/maintenance/plans/:id          — detalle + progreso
PUT    /api/v1/maintenance/plans/:id          — editar [admin]
DELETE /api/v1/maintenance/plans/:id          — borrar [admin]
POST   /api/v1/maintenance/plans/:id/logs     — registrar intervención [admin o granted]
GET    /api/v1/maintenance/plans/:id/logs     — historial de intervenciones
GET    /api/v1/vehicles/:id/maintenance       — planes de un vehículo (para badge)
```

### Permisos

- **Crear/editar/borrar planes:** `user.role == 'admin'`
- **Registrar intervención:** `user.role == 'admin'` **ó** existe `permission_grant` con `resource_type='maintenance'` y `'log' in allowed_actions` para el tenant del vehículo
- **Leer planes y progreso:** cualquier usuario autenticado del tenant (scope por `tenant_id`)

### Schemas Pydantic (nuevos)

```python
# backend/app/schemas/maintenance.py

class MaintenanceThreshold(BaseModel):
    type: Literal['pto_hours', 'engine_hours', 'calendar_days']
    value: float

class TriggerCondition(BaseModel):
    thresholds: list[MaintenanceThreshold]
    op: Literal['OR'] = 'OR'

class MaintenancePlanCreate(BaseModel):
    vehicle_id: UUID
    name: str
    trigger_condition: TriggerCondition
    warn_before_pct: int = 10
    active: bool = True

class MaintenancePlanUpdate(BaseModel):
    name: str | None = None
    trigger_condition: TriggerCondition | None = None
    warn_before_pct: int | None = None
    active: bool | None = None

class ThresholdProgress(BaseModel):
    type: str
    current: float
    limit: float
    pct: float        # 0–100+

class MaintenancePlanOut(BaseModel):
    id: UUID
    vehicle_id: UUID
    vehicle_name: str      # join en endpoint
    tenant_id: UUID
    name: str
    trigger_condition: TriggerCondition
    warn_before_pct: int
    active: bool
    progress: dict         # {status: ok|próximo|vencido, thresholds: [ThresholdProgress]}

class MaintenanceLogCreate(BaseModel):
    performed_at: datetime
    description: str | None = None
    reset_counters: list[str]
    cost_eur: float | None = None

class MaintenanceLogOut(BaseModel):
    id: UUID
    plan_id: UUID | None
    vehicle_id: UUID
    performed_at: datetime
    performed_by_email: str | None
    description: str | None
    reset_counters: list[str]
    cost_eur: float | None
```

---

## Frontend

### Rutas nuevas

```
/maintenance              → MaintenancePage
/maintenance/new          → MaintenancePlanFormPage
/maintenance/:id          → MaintenancePlanDetailPage
/maintenance/:id/edit     → MaintenancePlanFormPage (modo edición)
```

### Componentes

| Fichero | Responsabilidad |
|---------|----------------|
| `MaintenancePage.tsx` | Tabla global con filtro por vehículo y semáforo de estado |
| `MaintenancePlanRow.tsx` | Fila: vehículo, nombre, barra de progreso, estado badge, acciones |
| `ProgressBar.tsx` | Barra horizontal reutilizable — verde/naranja/rojo según estado |
| `MaintenancePlanFormPage.tsx` | Formulario crear/editar: nombre, vehículo, umbrales, warn_before_pct |
| `ThresholdBuilder.tsx` | Añadir/quitar umbrales (tipo + valor), patrón similar a ActionsList |
| `MaintenancePlanDetailPage.tsx` | Detalle del plan + tabla de intervenciones + botón "Registrar" |
| `LogInterventionModal.tsx` | Modal: fecha, descripción, coste, checkboxes para reset de contadores |

### Tipos nuevos en `types.ts`

```ts
export interface MaintenanceThreshold {
  type: 'pto_hours' | 'engine_hours' | 'calendar_days'
  value: number
}

export interface TriggerCondition {
  thresholds: MaintenanceThreshold[]
  op: 'OR'
}

export interface ThresholdProgress {
  type: string
  current: number
  limit: number
  pct: number
}

export interface MaintenanceProgress {
  status: 'ok' | 'próximo' | 'vencido'
  thresholds: ThresholdProgress[]
}

export interface MaintenancePlanOut {
  id: string
  vehicle_id: string
  vehicle_name: string
  tenant_id: string
  name: string
  trigger_condition: TriggerCondition
  warn_before_pct: number
  active: boolean
  progress: MaintenanceProgress
}

export interface MaintenancePlanCreate {
  vehicle_id: string
  name: string
  trigger_condition: TriggerCondition
  warn_before_pct: number
  active: boolean
}

export interface MaintenanceLogOut {
  id: string
  plan_id: string | null
  vehicle_id: string
  performed_at: string
  performed_by_email: string | null
  description: string | null
  reset_counters: string[]
  cost_eur: number | null
}

export interface MaintenanceLogCreate {
  performed_at: string
  description?: string
  reset_counters: string[]
  cost_eur?: number
}
```

### UX página global

```
┌─────────────────────────────────────────────────────────┐
│  MANTENIMIENTO          [+ Nuevo plan]      [Filtro ▾]  │
├────────────┬──────────┬───────────────────┬─────────────┤
│  Vehículo  │  Plan    │  Progreso          │  Estado     │
├────────────┼──────────┼───────────────────┼─────────────┤
│  WR-04     │ Aceite   │ ████████░░  82%    │  PRÓXIMO    │
│  WR-07     │ Filtros  │ ██████████  101%   │  VENCIDO    │
│  WR-12     │ Aceite   │ ███░░░░░░░  34%    │  OK         │
└────────────┴──────────┴───────────────────┴─────────────┘
```

### Badge en VehicleDetailPage

- Si el vehículo tiene planes en estado `vencido` o `próximo`: badge naranja/rojo junto al nombre
- Click → navega a `/maintenance?vehicle=:id`
- Sin tab nuevo — no altera la estructura actual de la página

---

## Testing

### Backend (pytest)

| Test | Qué verifica |
|------|-------------|
| `test_create_plan_admin` | Admin puede crear; operator recibe 403 |
| `test_progress_calculation` | Con telemetría seed, progreso calculado es correcto |
| `test_status_transitions` | Los tres estados se derivan correctamente de `warn_before_pct` |
| `test_log_intervention_admin` | Admin puede registrar intervención |
| `test_log_intervention_granted` | Usuario con `permission_grant` puede registrar |
| `test_log_intervention_denied` | Usuario sin grant recibe 403 |
| `test_progress_resets_after_log` | Tras log con `reset_counters`, progreso vuelve a ~0% |
| `test_vehicle_maintenance_endpoint` | `/vehicles/:id/maintenance` devuelve solo planes de ese vehículo |

### Frontend (Vitest + RTL)

| Test | Qué verifica |
|------|-------------|
| `MaintenancePage.test.tsx` | Renderiza tabla, estados con colores correctos |
| `MaintenancePlanFormPage.test.tsx` | Valida campos requeridos, añadir/quitar umbrales |
| `LogInterventionModal.test.tsx` | Submit llama a la API con contadores seleccionados |
| `ProgressBar.test.tsx` | Colores correctos: ok=verde, próximo=naranja, vencido=rojo |

---

## Fuera de scope (Sprint 11)

- Integración con rules-engine: alertas automáticas cuando un plan llega al umbral
- Fotos de intervención (`photo_urls`)
- Exportación PDF de historial de mantenimientos
- Plantillas de plan reutilizables por tipo de vehículo
