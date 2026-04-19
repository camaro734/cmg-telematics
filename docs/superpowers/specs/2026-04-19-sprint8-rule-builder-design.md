# Sprint 8 — Rule Builder Design

## Goal

Build the `/rules` section of the frontend: list of alert rules + create/edit form for CMG technicians to configure rules for client fleets.

## Architecture

Three pages under `/rules`, five new frontend components, and one backend addition (vehicle_filter `scope: "type"`). All alert rule data is already persisted via the existing CRUD API at `/api/v1/rules`. The rules-engine hot-reloads within <1 second of any rule change via PostgreSQL NOTIFY/LISTEN.

**Tech stack:** React 18 + TanStack Query v5 + existing design tokens. No new dependencies.

---

## Pages

### `/rules` — RulesPage

Table listing all rules for the current tenant:

| Column | Source |
|--------|--------|
| Nombre | `rule.name` |
| Alcance | Derived from `rule.vehicle_filter`: "Todos" / type name / vehicle name |
| Condición | Short summary of `rule.condition.type` |
| Severidad | Badge: Info (accent-info) / Warning (accent-warn) / Critical (accent-crit) |
| Activa | Toggle → `PUT /api/v1/rules/:id` with `{ active: !current }` |
| Acciones | Edit icon → `/rules/:id` · Delete icon → confirm then `DELETE /api/v1/rules/:id` |

Header has a "Nueva regla" button → navigates to `/rules/new`.

Empty state: "Sin reglas configuradas. Crea la primera."

### `/rules/new` — RuleFormPage (create mode)

Form initialized with defaults:
- `vehicle_filter: { scope: "all" }`
- `condition: { type: "threshold" }`
- `severity: "warning"`
- `actions: [{ type: "in_app" }]`
- `escalation: []`
- `cooldown_minutes: 30`
- `active: true`

On submit → `POST /api/v1/rules` → redirect to `/rules`.

### `/rules/:id` — RuleFormPage (edit mode)

Same component as create. On mount → `GET /api/v1/rules/:id` → pre-populates all fields.

On submit → `PUT /api/v1/rules/:id` → redirect to `/rules`.

---

## Components

### RuleFormPage

Orchestrates the full form. Owns the rule state object and passes sub-objects to child components via props + onChange callbacks. Calls the API on submit.

**Form sections (vertical scroll):**

1. **Identificación** — nombre (required), descripción (optional), severidad (3 radio buttons: Info / Warning / Critical with matching colors)
2. **Scope de vehículos** — see VehicleFilterPicker below
3. **Condición** — see ConditionBuilder below
4. **Acciones** — see ActionsList below
5. **Escalación** — see EscalationBuilder below
6. **Configuración** — cooldown_minutes input + active toggle

### VehicleFilterPicker

Renders under the "Alcance de vehículos" label. Select with three options: "Todos los vehículos" / "Por tipo de vehículo" / "Vehículo específico".

- "Todos" → `{ scope: "all" }`
- "Por tipo" → shows second select populated from `GET /api/v1/vehicle-types` → `{ scope: "type", vehicle_type_id: "..." }`
- "Vehículo específico" → shows second select populated from `GET /api/v1/vehicles` → `{ scope: "vehicle", vehicle_id: "..." }`

The scope selection also controls which sensors are available in ConditionBuilder:
- `scope: "all"` → RuleFormPage calls `GET /api/v1/vehicle-types` (all types), merges their `sensor_schema` arrays deduplicating by `key`, passes result to ConditionBuilder
- `scope: "type"` → sensors from `GET /api/v1/vehicle-types/:id` → `sensor_schema`
- `scope: "vehicle"` → sensors from the vehicle's type, resolved via `GET /api/v1/vehicles/:id` → then the type's schema

A sensor is considered **numeric** if its schema entry has a non-null `unit` field and no `boolean: true` flag (e.g., `pto_active` is boolean, `hydraulic_pressure_1` is numeric). Accumulation and trend_rising condition types only show numeric sensors.

### ConditionBuilder

Renders different fields depending on `condition.type`. A type selector always appears first.

**threshold:**
```
[sensor ▼] [op ▼: > < >= <= == !=] [value] [unit label]
```

**threshold_sustained:**
```
[sensor ▼] [op ▼] [value] [unit] durante [minutes] min
```

**accumulation:**
```
[sensor ▼] alcanza [limit] [unit]
```
Sensor list is filtered to numeric fields only.

**trend_rising:**
```
[sensor ▼] pendiente > [threshold] [unit]/min en ventana [window_minutes] min
```

**schedule:**
```
[sensor ▼] fuera de horario:
Días: [L][M][X][J][V][S][D] (toggle buttons)
Horario: [HH:MM] — [HH:MM]
```

**composite (AND / OR):**
When the user clicks "+ Añadir condición AND / OR":
- A second ConditionBuilder block appears
- A pill selector between them: AND / OR
- Output: `{ type: "composite", op: "AND"|"OR", conditions: [cond1, cond2] }`
- Maximum two conditions (sufficient for all known CMG use cases; recursive nesting deferred to a future sprint if needed)

### ActionsList

Three optional action types shown as expandable rows:

- **In-app** — checkbox (checked by default). When checked → `{ type: "in_app" }` included in actions.
- **Email** — toggle to expand → text input for recipient + "+" button to add more. Multiple recipients allowed. Output: `{ type: "email", recipients: ["a@b.com", ...] }`
- **Webhook** — toggle to expand → URL input + method select (POST / GET). Output: `{ type: "webhook", url: "...", method: "POST" }`

### EscalationBuilder

A list of escalation steps. Each step has:
- "Si no reconocida en [N] minutos" — number input
- Email recipients for this escalation step (same UI as ActionsList email row)
- Delete button

"+ Añadir escalón" button appends a new step.

Output: `[{ delay_minutes: 10, actions: [{ type: "email", recipients: [...] }] }, ...]`

Steps are displayed in ascending order by `delay_minutes`.

---

## Backend Addition

### vehicle_filter scope: "type"

Add support for `{ "scope": "type", "vehicle_type_id": "uuid" }` in two places:

**`backend/app/api/v1/rules.py`** — `list_rules` already filters by tenant. No change needed to the endpoint itself; scope validation happens at save time.

**`services/rules-engine/src/evaluator.py`** — `_vehicle_matches_filter` function:

```python
def _vehicle_matches_filter(vehicle_filter: dict, vehicle: dict) -> bool:
    scope = vehicle_filter.get("scope", "all")
    if scope == "all":
        return True
    if scope == "vehicle":
        return str(vehicle["id"]) == str(vehicle_filter.get("vehicle_id"))
    if scope == "type":
        return str(vehicle["vehicle_type_id"]) == str(vehicle_filter.get("vehicle_type_id"))
    return True
```

This is the only evaluator change needed — the vehicle dict already contains `vehicle_type_id` from the telemetry processing path.

---

## Data Flow

```
Técnico rellena formulario
  → RuleFormPage composes JSON payload locally
  → POST /api/v1/rules (or PUT for edit)
  → Backend saves to alert_rule table
  → PostgreSQL NOTIFY trigger fires
  → rules-engine reloads rule in memory (<1s)
  → Redirect to /rules list
```

**Sensor list population:**
1. On VehicleFilterPicker change → RuleFormPage fetches the relevant vehicle type's `sensor_schema`
2. Passes sensor list to ConditionBuilder as prop
3. ConditionBuilder renders sensor select from that list

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Nombre vacío | Inline error below field, submit blocked |
| Valor de umbral no numérico | Inline error, submit blocked |
| Email destinatario inválido | Inline error on that input |
| API 422 | Show server detail message below submit button |
| API error de red | Toast "Error al guardar la regla" |
| Delete confirmation | Inline confirm "¿Eliminar esta regla?" Yes / No, no modal |

---

## Routing

`App.tsx` additions:
```typescript
const RulesPage     = lazy(() => import('./features/rules/RulesPage'))
const RuleFormPage  = lazy(() => import('./features/rules/RuleFormPage'))

<Route path="rules"      element={<RulesPage />} />
<Route path="rules/new"  element={<RuleFormPage />} />
<Route path="rules/:id"  element={<RuleFormPage />} />
```

`Sidebar.tsx`: change `active: false` to `active: true` for the `/rules` nav item.

---

## File Structure

```
frontend/src/features/rules/
  RulesPage.tsx
  RuleFormPage.tsx
  ConditionBuilder.tsx
  VehicleFilterPicker.tsx
  ActionsList.tsx
  EscalationBuilder.tsx
  __tests__/
    RulesPage.test.tsx
    RuleFormPage.test.tsx
    ConditionBuilder.test.tsx

services/rules-engine/src/evaluator.py   (modify: add scope "type")
tests/rules_engine/test_evaluator.py     (modify: add scope "type" test)
```

---

## Testing

### Frontend

- **RulesPage** — renders table from mocked rules list, toggle calls PUT, delete shows confirm then calls DELETE
- **RuleFormPage (create)** — submit with threshold condition calls POST with correct payload; submit with composite condition produces correct nested JSON
- **RuleFormPage (edit)** — loads existing rule data into form fields
- **ConditionBuilder** — renders correct fields for each of the 6 condition types; composite mode shows two condition blocks

### Backend

- **test_evaluator.py** — `scope: "type"` matches vehicle with matching `vehicle_type_id`, does not match vehicle with different type

---

## Out of Scope (this sprint)

- `trend_rising` condition: included in UI but its evaluator implementation is already marked as pending in rules-engine. The form saves it; the engine will skip evaluation until implemented.
- Push / SMS actions: not exposed in UI (backend stubs exist but channels not implemented).
- Sub-client permission scoping on rules (all rules are tenant-scoped for now).
- Rule duplication / clone button.
