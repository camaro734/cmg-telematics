# Sprint 8 — Rule Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/rules` section: list of alert rules + create/edit form with condition builder, action list, and escalation steps.

**Architecture:** 7 new frontend components under `frontend/src/features/rules/`, one small backend addition in the rules-engine evaluator (vehicle_filter `scope: "type"`), and routing/sidebar activation. All CRUD is handled by the existing `/api/v1/rules` API.

**Tech Stack:** React 18 + TanStack Query v5, existing design tokens, Vitest + RTL for tests, Python asyncpg for rules-engine.

---

## File Structure

```
services/rules-engine/src/
  loader.py         — add load_vehicle_type_map()
  evaluator.py      — add vehicle_type_map param to process_message, handle scope:"type"
  main.py           — load vehicle_type_map, pass to process_message

tests/rules_engine/
  test_evaluator.py — add scope:"type" tests

frontend/src/lib/
  types.ts          — extend RuleOut + add ConditionDef, ActionDef, EscalationStep, VehicleFilter, RuleCreate
  queryKeys.ts      — add keys.rule(id)

frontend/src/features/rules/
  RulesPage.tsx           — list view: table + toggle + delete
  RuleFormPage.tsx        — create/edit form orchestrator
  VehicleFilterPicker.tsx — scope select (all/type/vehicle)
  ConditionBuilder.tsx    — dynamic condition fields + composite AND/OR
  ActionsList.tsx         — in_app, email, webhook toggles
  EscalationBuilder.tsx   — escalation steps list
  __tests__/
    RulesPage.test.tsx
    ConditionBuilder.test.tsx
    RuleFormPage.test.tsx

frontend/src/App.tsx          — add /rules, /rules/new, /rules/:id routes
frontend/src/shared/ui/Sidebar.tsx — activate /rules nav item
```

---

## Task 1: Rules-engine — vehicle_filter scope:"type"

**Files:**
- Modify: `services/rules-engine/src/loader.py`
- Modify: `services/rules-engine/src/evaluator.py`
- Modify: `services/rules-engine/src/main.py`
- Modify: `tests/rules_engine/test_evaluator.py`

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `tests/rules_engine/test_evaluator.py`:

```python
# --- vehicle_filter scope:"type" ---

async def test_process_message_scope_type_matches_vehicle():
    rule = make_rule(
        condition={"type": "threshold", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0},
        vehicle_filter={"scope": "type", "vehicle_type_id": "vtype-vacuum"},
    )
    msg = make_msg()
    redis = AsyncMock()
    redis.exists.return_value = 0
    redis.set.return_value = True
    vehicle_type_map = {"veh-1": "vtype-vacuum"}
    results = await process_message([rule], msg, redis, vehicle_type_map=vehicle_type_map)
    assert len(results) == 1


async def test_process_message_scope_type_skips_wrong_type():
    rule = make_rule(
        condition={"type": "threshold", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0},
        vehicle_filter={"scope": "type", "vehicle_type_id": "vtype-sweeper"},
    )
    msg = make_msg()
    redis = AsyncMock()
    redis.exists.return_value = 0
    vehicle_type_map = {"veh-1": "vtype-vacuum"}
    results = await process_message([rule], msg, redis, vehicle_type_map=vehicle_type_map)
    assert results == []


async def test_process_message_scope_type_skips_when_no_map():
    """When vehicle_type_map is not provided, scope:'type' rules are skipped."""
    rule = make_rule(
        condition={"type": "threshold", "field": "hydraulic_pressure_1", "op": ">", "value": 220.0},
        vehicle_filter={"scope": "type", "vehicle_type_id": "vtype-vacuum"},
    )
    msg = make_msg()
    redis = AsyncMock()
    redis.exists.return_value = 0
    results = await process_message([rule], msg, redis)
    assert results == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /opt/cmg-telematic1
python3 -m pytest tests/rules_engine/test_evaluator.py::test_process_message_scope_type_matches_vehicle -v
```

Expected: FAIL with `TypeError` (unexpected keyword argument `vehicle_type_map`)

- [ ] **Step 3: Add load_vehicle_type_map to loader.py**

In `services/rules-engine/src/loader.py`, add after the `load_rules` function:

```python
async def load_vehicle_type_map(conn: asyncpg.Connection) -> dict[str, str]:
    """Returns {vehicle_id: vehicle_type_id} for all active vehicles."""
    rows = await conn.fetch(
        "SELECT id::text, vehicle_type_id::text FROM vehicle WHERE active = true"
    )
    return {row["id"]: row["vehicle_type_id"] for row in rows}
```

- [ ] **Step 4: Update process_message in evaluator.py**

Replace the `process_message` function signature and the vehicle filter block:

```python
async def process_message(
    rules: list[Rule],
    msg: TelemetryMsg,
    redis: Any,
    vehicle_type_map: dict[str, str] | None = None,
) -> list[RuleMatch]:
    """
    Process a telemetry message against all applicable rules.

    Filters applied (in order):
    1. tenant_id match
    2. vehicle_filter scope
    3. cooldown check
    4. rule evaluation
    """
    matches: list[RuleMatch] = []

    for rule in rules:
        # 1. Tenant isolation
        if rule.tenant_id != msg.tenant_id:
            continue

        # 2. Vehicle filter
        scope = rule.vehicle_filter.get("scope", "all")
        if scope == "all":
            pass
        elif scope == "vehicle":
            if rule.vehicle_filter.get("vehicle_id") != msg.vehicle_id:
                continue
        elif scope == "type":
            if vehicle_type_map is None:
                logger.warning(
                    "vehicle_type_map not provided — skipping scope:type rule %s", rule.id
                )
                continue
            vehicle_type_id = vehicle_type_map.get(msg.vehicle_id)
            if vehicle_type_id != rule.vehicle_filter.get("vehicle_type_id"):
                continue
        else:
            logger.warning(
                "Unknown vehicle_filter scope %r for rule %s, skipping", scope, rule.id
            )
            continue

        # 3. Cooldown check
        in_cooldown = await is_in_cooldown(redis, rule.id, msg.vehicle_id)
        if in_cooldown:
            continue

        # 4. Evaluate rule
        match = await evaluate_rule(rule, msg, redis)
        if match is not None:
            await set_cooldown(redis, rule.id, msg.vehicle_id, rule.cooldown_minutes)
            matches.append(match)

    return matches
```

- [ ] **Step 5: Update main.py to load and pass vehicle_type_map**

In `services/rules-engine/src/main.py`:

1. Add import at top (after existing loader imports):
```python
from src.loader import load_rules, load_vehicle_type_map, Rule
```

2. Add global after `_rules`:
```python
_rules: list[Rule] = []
_vehicle_type_map: dict[str, str] = {}
```

3. Update `_reload_rules` to also refresh the vehicle map:
```python
async def _reload_rules(db_pool: asyncpg.Pool) -> None:
    global _rules, _vehicle_type_map
    try:
        async with db_pool.acquire() as conn:
            _rules = await load_rules(conn)
            _vehicle_type_map = await load_vehicle_type_map(conn)
        logger.info("Hot-reloaded %d rules, %d vehicles", len(_rules), len(_vehicle_type_map))
    except Exception as exc:
        logger.error("Rule reload failed: %s", exc)
```

4. Update the `process_message` call in `_process_stream`:
```python
matches = await process_message(_rules, msg, redis, vehicle_type_map=_vehicle_type_map)
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
python3 -m pytest tests/rules_engine/test_evaluator.py -v
```

Expected: all passing (was 18+ before, now +3 more)

- [ ] **Step 7: Run full backend test suite**

```bash
python3 -m pytest tests/ -q
```

Expected: all passing

- [ ] **Step 8: Commit**

```bash
git add services/rules-engine/src/loader.py services/rules-engine/src/evaluator.py services/rules-engine/src/main.py tests/rules_engine/test_evaluator.py
git commit -m "feat: rules-engine — vehicle_filter scope:type via vehicle_type_map cache"
```

---

## Task 2: Frontend types + queryKeys

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/queryKeys.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/rules/__tests__/types.test.ts`:

```typescript
import { describe, it, expectTypeOf } from 'vitest'
import type { RuleOut, RuleCreate, ConditionDef, ActionDef, EscalationStep, VehicleFilter } from '../../../lib/types'

describe('Rule types', () => {
  it('RuleOut has all required fields', () => {
    const rule = {} as RuleOut
    expectTypeOf(rule.id).toBeString()
    expectTypeOf(rule.name).toBeString()
    expectTypeOf(rule.condition).toMatchTypeOf<ConditionDef>()
    expectTypeOf(rule.actions).toMatchTypeOf<ActionDef[]>()
    expectTypeOf(rule.escalation).toMatchTypeOf<EscalationStep[]>()
    expectTypeOf(rule.vehicle_filter).toMatchTypeOf<VehicleFilter>()
    expectTypeOf(rule.cooldown_minutes).toBeNumber()
  })

  it('RuleCreate matches RuleOut fields', () => {
    const create = {} as RuleCreate
    expectTypeOf(create.name).toBeString()
    expectTypeOf(create.condition).toMatchTypeOf<ConditionDef>()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- --run src/features/rules/__tests__/types.test.ts
```

Expected: FAIL (types not defined yet)

- [ ] **Step 3: Replace RuleOut in types.ts and add rule interfaces**

In `frontend/src/lib/types.ts`, replace the existing minimal `RuleOut`:

```typescript
// Existing: export interface RuleOut { id: string; name: string; severity: ...; active: boolean }
```

With this full set of interfaces (add after `SettingsOut` at the end of the file):

```typescript
export type RuleSeverity = 'info' | 'warning' | 'critical'
export type ConditionOp = '>' | '<' | '>=' | '<=' | '==' | '!='

export interface ScheduleWindow {
  type: 'always'
}
export interface ScheduleTimeWindow {
  type: 'time_window'
  days: number[]
  start: string
  end: string
}

export interface ConditionDef {
  type: 'threshold' | 'threshold_sustained' | 'accumulation' | 'trend_rising' | 'schedule' | 'composite'
  field?: string
  op?: ConditionOp
  value?: number
  minutes?: number
  limit?: number
  threshold?: number
  window_minutes?: number
  expected_outside?: boolean
  schedule?: ScheduleWindow | ScheduleTimeWindow
  op_composite?: 'AND' | 'OR'
  conditions?: ConditionDef[]
}

export interface ActionDef {
  type: 'email' | 'webhook' | 'in_app' | 'push' | 'sms'
  recipients?: string[]
  url?: string
  method?: 'POST' | 'GET'
}

export interface EscalationStep {
  delay_minutes: number
  actions: ActionDef[]
}

export interface VehicleFilter {
  scope: 'all' | 'vehicle' | 'type'
  vehicle_id?: string
  vehicle_type_id?: string
}

export interface RuleOut {
  id: string
  tenant_id: string
  name: string
  description: string | null
  active: boolean
  severity: RuleSeverity
  vehicle_filter: VehicleFilter
  condition: ConditionDef
  actions: ActionDef[]
  escalation: EscalationStep[]
  cooldown_minutes: number
  created_at: string
}

export interface RuleCreate {
  name: string
  description?: string | null
  severity: RuleSeverity
  vehicle_filter: VehicleFilter
  condition: ConditionDef
  actions: ActionDef[]
  escalation: EscalationStep[]
  cooldown_minutes: number
  active: boolean
}
```

Also **remove** the old minimal `RuleOut` that was there before (it had only id, name, severity, active).

- [ ] **Step 4: Add rule(id) key to queryKeys.ts**

In `frontend/src/lib/queryKeys.ts`, add `rule` after `rules`:

```typescript
export const keys = {
  vehicles: () => ['vehicles'] as const,
  vehicle: (id: string) => ['vehicles', id] as const,
  vehicleStatus: (id: string) => ['vehicles', id, 'status'] as const,
  vehicleTrack: (id: string) => ['vehicles', id, 'track'] as const,
  vehicleKpis: (id: string) => ['vehicles', id, 'kpis'] as const,
  vehicleTypes: () => ['vehicle-types'] as const,
  alerts: () => ['alerts'] as const,
  rules: () => ['rules'] as const,
  rule: (id: string) => ['rules', id] as const,
  tenants: () => ['tenants'] as const,
  tenantBrandTokens: (tenantId: string) => ['tenants', tenantId, 'brand-tokens'] as const,
  settings: (tenantId?: string) => tenantId ? ['settings', tenantId] as const : ['settings'] as const,
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- --run src/features/rules/__tests__/types.test.ts
```

Expected: PASS

- [ ] **Step 6: Run full frontend test suite to check no regressions**

```bash
npm test -- --run
```

Expected: all passing (the minimal RuleOut fields id/name/severity/active still exist in the new full RuleOut)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/queryKeys.ts frontend/src/features/rules/__tests__/types.test.ts
git commit -m "feat: rule builder types — ConditionDef, ActionDef, EscalationStep, VehicleFilter, full RuleOut"
```

---

## Task 3: RulesPage (list view)

**Files:**
- Create: `frontend/src/features/rules/RulesPage.tsx`
- Create: `frontend/src/features/rules/__tests__/RulesPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/rules/__tests__/RulesPage.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import RulesPage from '../RulesPage'
import type { RuleOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('../../../features/auth/useAuthStore', () => ({
  useAuthStore: vi.fn(() => ({ user: { role: 'admin', tenant_tier: 'client' } })),
}))

import { apiClient } from '../../../lib/apiClient'

const mockRule: RuleOut = {
  id: 'r1', tenant_id: 't1', name: 'Presión alta', description: null,
  active: true, severity: 'critical',
  vehicle_filter: { scope: 'all' },
  condition: { type: 'threshold', field: 'hydraulic_pressure_1', op: '>', value: 220 },
  actions: [{ type: 'in_app' }], escalation: [],
  cooldown_minutes: 30, created_at: '2026-04-19T00:00:00Z',
}

function wrap(rules: RuleOut[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(['rules'], rules)
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RulesPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('RulesPage', () => {
  it('muestra mensaje vacío cuando no hay reglas', () => {
    vi.mocked(apiClient.get).mockResolvedValue([])
    wrap([])
    expect(screen.getByText(/Sin reglas configuradas/)).toBeInTheDocument()
  })

  it('muestra nombre y severidad de cada regla', () => {
    vi.mocked(apiClient.get).mockResolvedValue([mockRule])
    wrap([mockRule])
    expect(screen.getByText('Presión alta')).toBeInTheDocument()
    expect(screen.getByText('CRÍTICA')).toBeInTheDocument()
  })

  it('toggle activa/desactiva llama apiClient.put', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([mockRule])
    vi.mocked(apiClient.put).mockResolvedValue({ ...mockRule, active: false })
    wrap([mockRule])
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      '/api/v1/rules/r1', expect.objectContaining({ active: false })
    ))
  })

  it('botón eliminar muestra confirmación y llama apiClient.delete', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([mockRule])
    vi.mocked(apiClient.delete).mockResolvedValue(undefined)
    wrap([mockRule])
    fireEvent.click(screen.getByTitle('Eliminar regla'))
    expect(screen.getByText(/¿Eliminar/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Sí'))
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/rules/r1'))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --run src/features/rules/__tests__/RulesPage.test.tsx
```

Expected: FAIL (module not found)

- [ ] **Step 3: Create RulesPage.tsx**

Create `frontend/src/features/rules/RulesPage.tsx`:

```typescript
import type { CSSProperties } from 'react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { RuleOut } from '../../lib/types'

const SEVERITY_LABEL: Record<string, { label: string; color: string }> = {
  info:     { label: 'INFO',    color: 'var(--accent-info)' },
  warning:  { label: 'AVISO',   color: 'var(--accent-warn)' },
  critical: { label: 'CRÍTICA', color: 'var(--accent-crit)' },
}

const SCOPE_LABEL: Record<string, string> = {
  all:     'Todos',
  vehicle: 'Vehículo',
  type:    'Tipo',
}

const TD: CSSProperties = {
  padding: '10px 12px', fontFamily: 'var(--font-ui)', fontSize: 13,
  color: 'var(--text-primary)', borderBottom: '1px solid var(--bg-elevated)',
}
const TH: CSSProperties = {
  padding: '8px 12px', fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600,
  color: 'var(--text-muted)', borderBottom: '1px solid var(--bg-border)',
  letterSpacing: '0.05em', textAlign: 'left' as const,
}

export default function RulesPage() {
  const qc = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const { data: rules = [] } = useQuery({
    queryKey: keys.rules(),
    queryFn: () => apiClient.get<RuleOut[]>('/api/v1/rules'),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiClient.put<RuleOut>(`/api/v1/rules/${id}`, { active }),
    onSuccess: (updated) => {
      qc.setQueryData(keys.rules(), (prev: RuleOut[] = []) =>
        prev.map(r => r.id === updated.id ? updated : r)
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/rules/${id}`),
    onSuccess: (_, id) => {
      qc.setQueryData(keys.rules(), (prev: RuleOut[] = []) => prev.filter(r => r.id !== id))
      setConfirmDelete(null)
    },
  })

  return (
    <Shell title="Reglas">
      <div style={{ padding: 24, maxWidth: 1100, overflowY: 'auto', height: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
            REGLAS DE ALERTA
          </span>
          <Link
            to="/rules/new"
            style={{
              padding: '6px 16px', fontSize: 13, fontFamily: 'var(--font-ui)',
              background: 'var(--accent-energy)', border: 'none', borderRadius: 6,
              color: 'var(--bg-base)', textDecoration: 'none', fontWeight: 600,
            }}
          >
            + Nueva regla
          </Link>
        </div>

        {rules.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', fontSize: 13, padding: '20px 0' }}>
            Sin reglas configuradas. <Link to="/rules/new" style={{ color: 'var(--accent-energy)' }}>Crea la primera.</Link>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Nombre', 'Alcance', 'Tipo condición', 'Severidad', 'Activa', ''].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rules.map(rule => {
                  const sev = SEVERITY_LABEL[rule.severity] ?? { label: rule.severity, color: 'var(--text-muted)' }
                  const isConfirming = confirmDelete === rule.id
                  return (
                    <tr key={rule.id}>
                      <td style={TD}>
                        <Link to={`/rules/${rule.id}`} style={{ color: 'var(--accent-energy)', textDecoration: 'none' }}>
                          {rule.name}
                        </Link>
                      </td>
                      <td style={{ ...TD, color: 'var(--text-muted)' }}>
                        {SCOPE_LABEL[rule.vehicle_filter.scope] ?? rule.vehicle_filter.scope}
                      </td>
                      <td style={{ ...TD, color: 'var(--text-muted)' }}>
                        {rule.condition.type}
                      </td>
                      <td style={TD}>
                        <span style={{ color: sev.color, fontWeight: 600, fontSize: 11 }}>{sev.label}</span>
                      </td>
                      <td style={TD}>
                        <input
                          type="checkbox"
                          checked={rule.active}
                          onChange={() => toggleMutation.mutate({ id: rule.id, active: !rule.active })}
                          style={{ accentColor: 'var(--accent-energy)', cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                        {isConfirming ? (
                          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 12 }}>
                            ¿Eliminar?{' '}
                            <button onClick={() => deleteMutation.mutate(rule.id)} style={{ color: 'var(--accent-crit)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 12 }}>Sí</button>
                            {' / '}
                            <button onClick={() => setConfirmDelete(null)} style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 12 }}>No</button>
                          </span>
                        ) : (
                          <>
                            <Link to={`/rules/${rule.id}`} style={{ color: 'var(--text-muted)', marginRight: 12, fontSize: 13 }} title="Editar regla">✎</Link>
                            <button
                              onClick={() => setConfirmDelete(rule.id)}
                              style={{ color: 'var(--accent-crit)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}
                              title="Eliminar regla"
                            >✕</button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/features/rules/__tests__/RulesPage.test.tsx
```

Expected: 4 tests passing

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/rules/RulesPage.tsx frontend/src/features/rules/__tests__/RulesPage.test.tsx
git commit -m "feat: RulesPage — lista de reglas con toggle y delete"
```

---

## Task 4: ConditionBuilder

**Files:**
- Create: `frontend/src/features/rules/ConditionBuilder.tsx`
- Create: `frontend/src/features/rules/__tests__/ConditionBuilder.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/rules/__tests__/ConditionBuilder.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ConditionBuilder from '../ConditionBuilder'
import type { ConditionDef, SensorDef } from '../../../lib/types'

const sensors: SensorDef[] = [
  { key: 'hydraulic_pressure_1', label: 'Presión bomba', unit: 'bar', gauge_type: 'circular', min: 0, max: 300 },
  { key: 'oil_temp_c', label: 'Temperatura aceite', unit: '°C', gauge_type: 'circular', min: 0, max: 120 },
  { key: 'pto_active', label: 'PTO', unit: null, gauge_type: 'led' },
]

describe('ConditionBuilder', () => {
  it('renders threshold fields by default', () => {
    const cond: ConditionDef = { type: 'threshold', field: 'hydraulic_pressure_1', op: '>', value: 220 }
    render(<ConditionBuilder condition={cond} sensors={sensors} onChange={vi.fn()} />)
    expect(screen.getByDisplayValue('hydraulic_pressure_1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('>')).toBeInTheDocument()
    expect(screen.getByDisplayValue('220')).toBeInTheDocument()
  })

  it('renders sustained fields for threshold_sustained', () => {
    const cond: ConditionDef = { type: 'threshold_sustained', field: 'hydraulic_pressure_1', op: '>', value: 220, minutes: 5 }
    render(<ConditionBuilder condition={cond} sensors={sensors} onChange={vi.fn()} />)
    expect(screen.getByDisplayValue('5')).toBeInTheDocument()
    expect(screen.getByText(/minutos/)).toBeInTheDocument()
  })

  it('renders accumulation fields', () => {
    const cond: ConditionDef = { type: 'accumulation', field: 'hydraulic_pressure_1', limit: 100 }
    render(<ConditionBuilder condition={cond} sensors={sensors} onChange={vi.fn()} />)
    expect(screen.getByDisplayValue('100')).toBeInTheDocument()
    expect(screen.getByText(/alcanza/)).toBeInTheDocument()
  })

  it('renders composite with two sub-conditions', () => {
    const cond: ConditionDef = {
      type: 'composite', op_composite: 'AND',
      conditions: [
        { type: 'threshold', field: 'hydraulic_pressure_1', op: '>', value: 220 },
        { type: 'threshold', field: 'oil_temp_c', op: '>', value: 90 },
      ],
    }
    render(<ConditionBuilder condition={cond} sensors={sensors} onChange={vi.fn()} />)
    expect(screen.getByText('AND')).toBeInTheDocument()
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(2)
  })

  it('calls onChange when value changes', () => {
    const onChange = vi.fn()
    const cond: ConditionDef = { type: 'threshold', field: 'hydraulic_pressure_1', op: '>', value: 220 }
    render(<ConditionBuilder condition={cond} sensors={sensors} onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('220'), { target: { value: '250' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ value: 250 }))
  })

  it('añadir condición convierte a composite', () => {
    const onChange = vi.fn()
    const cond: ConditionDef = { type: 'threshold', field: 'hydraulic_pressure_1', op: '>', value: 220 }
    render(<ConditionBuilder condition={cond} sensors={sensors} onChange={onChange} />)
    fireEvent.click(screen.getByText(/Añadir condición/))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'composite' }))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --run src/features/rules/__tests__/ConditionBuilder.test.tsx
```

Expected: FAIL (module not found)

- [ ] **Step 3: Create ConditionBuilder.tsx**

Create `frontend/src/features/rules/ConditionBuilder.tsx`:

```typescript
import type { CSSProperties } from 'react'
import type { ConditionDef, SensorDef } from '../../lib/types'

const SELECT: CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
  borderRadius: 6, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
  fontSize: 13, padding: '6px 8px',
}
const INPUT: CSSProperties = {
  ...SELECT, width: 80,
}
const LABEL: CSSProperties = {
  fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-muted)',
}

const OPS = ['>', '<', '>=', '<=', '==', '!='] as const
const CONDITION_TYPES = [
  { value: 'threshold',           label: 'Umbral' },
  { value: 'threshold_sustained', label: 'Umbral sostenido' },
  { value: 'accumulation',        label: 'Acumulador' },
  { value: 'trend_rising',        label: 'Tendencia' },
  { value: 'schedule',            label: 'Horario' },
  { value: 'composite',           label: 'Combinada (AND/OR)' },
] as const

const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

interface Props {
  condition: ConditionDef
  sensors: SensorDef[]
  onChange: (cond: ConditionDef) => void
  depth?: number
}

function numericSensors(sensors: SensorDef[]): SensorDef[] {
  return sensors.filter(s => s.unit !== null)
}

function defaultCondition(type: ConditionDef['type'], sensors: SensorDef[]): ConditionDef {
  const firstKey = sensors[0]?.key ?? ''
  const firstNumericKey = numericSensors(sensors)[0]?.key ?? firstKey
  switch (type) {
    case 'threshold':           return { type, field: firstKey, op: '>', value: 0 }
    case 'threshold_sustained': return { type, field: firstKey, op: '>', value: 0, minutes: 5 }
    case 'accumulation':        return { type, field: firstNumericKey, limit: 100 }
    case 'trend_rising':        return { type, field: firstNumericKey, threshold: 1, window_minutes: 60 }
    case 'schedule':            return { type, field: firstKey, expected_outside: false, schedule: { type: 'always' } }
    case 'composite':
      return {
        type, op_composite: 'AND',
        conditions: [
          { type: 'threshold', field: firstKey, op: '>', value: 0 },
          { type: 'threshold', field: sensors[1]?.key ?? firstKey, op: '>', value: 0 },
        ],
      }
  }
}

function SimpleCondition({ condition, sensors, onChange }: { condition: ConditionDef; sensors: SensorDef[]; onChange: (c: ConditionDef) => void }) {
  const t = condition.type
  const sensorList = t === 'accumulation' || t === 'trend_rising' ? numericSensors(sensors) : sensors
  const unitLabel = sensors.find(s => s.key === condition.field)?.unit ?? ''

  const update = (patch: Partial<ConditionDef>) => onChange({ ...condition, ...patch })

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <select value={condition.field ?? ''} onChange={e => update({ field: e.target.value })} style={SELECT}>
        {sensorList.map(s => <option key={s.key} value={s.key}>{s.label || s.key}</option>)}
      </select>

      {(t === 'threshold' || t === 'threshold_sustained') && (
        <>
          <select value={condition.op ?? '>'} onChange={e => update({ op: e.target.value as ConditionDef['op'] })} style={{ ...SELECT, width: 60 }}>
            {OPS.map(op => <option key={op} value={op}>{op}</option>)}
          </select>
          <input type="number" value={condition.value ?? 0} onChange={e => update({ value: parseFloat(e.target.value) || 0 })} style={INPUT} />
          {unitLabel && <span style={LABEL}>{unitLabel}</span>}
        </>
      )}

      {t === 'threshold_sustained' && (
        <>
          <span style={LABEL}>durante</span>
          <input type="number" value={condition.minutes ?? 5} onChange={e => update({ minutes: parseInt(e.target.value) || 1 })} style={INPUT} min={1} />
          <span style={LABEL}>minutos</span>
        </>
      )}

      {t === 'accumulation' && (
        <>
          <span style={LABEL}>alcanza</span>
          <input type="number" value={condition.limit ?? 100} onChange={e => update({ limit: parseFloat(e.target.value) || 0 })} style={INPUT} />
          {unitLabel && <span style={LABEL}>{unitLabel}</span>}
        </>
      )}

      {t === 'trend_rising' && (
        <>
          <span style={LABEL}>pendiente &gt;</span>
          <input type="number" value={condition.threshold ?? 1} onChange={e => update({ threshold: parseFloat(e.target.value) || 0 })} style={INPUT} />
          <span style={LABEL}>en</span>
          <input type="number" value={condition.window_minutes ?? 60} onChange={e => update({ window_minutes: parseInt(e.target.value) || 1 })} style={INPUT} />
          <span style={LABEL}>min</span>
        </>
      )}

      {t === 'schedule' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginLeft: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {DAYS.map((d, i) => {
              const sched = condition.schedule
              const isTimeWindow = sched && 'days' in sched
              const active = isTimeWindow ? sched.days.includes(i) : true
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    const currentDays = isTimeWindow ? [...sched.days] : [0,1,2,3,4,5,6]
                    const newDays = active ? currentDays.filter(x => x !== i) : [...currentDays, i].sort()
                    update({ schedule: { type: 'time_window', days: newDays, start: isTimeWindow ? sched.start : '08:00', end: isTimeWindow ? sched.end : '18:00' } })
                  }}
                  style={{
                    width: 28, height: 28, borderRadius: 4, border: 'none', cursor: 'pointer',
                    background: active ? 'var(--accent-energy)' : 'var(--bg-elevated)',
                    color: active ? 'var(--bg-base)' : 'var(--text-muted)',
                    fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600,
                  }}
                >{d}</button>
              )
            })}
          </div>
          {condition.schedule && 'start' in condition.schedule && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="time" value={condition.schedule.start} onChange={e => update({ schedule: { ...condition.schedule as { type: 'time_window'; days: number[]; start: string; end: string }, start: e.target.value } })} style={{ ...SELECT, width: 110 }} />
              <span style={LABEL}>—</span>
              <input type="time" value={condition.schedule.end} onChange={e => update({ schedule: { ...condition.schedule as { type: 'time_window'; days: number[]; start: string; end: string }, end: e.target.value } })} style={{ ...SELECT, width: 110 }} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ConditionBuilder({ condition, sensors, onChange, depth = 0 }: Props) {
  const handleTypeChange = (newType: ConditionDef['type']) => {
    onChange(defaultCondition(newType, sensors))
  }

  const addComposite = () => {
    onChange({
      type: 'composite',
      op_composite: 'AND',
      conditions: [
        condition,
        defaultCondition('threshold', sensors),
      ],
    })
  }

  const removeComposite = () => {
    if (condition.type === 'composite' && condition.conditions?.length) {
      onChange(condition.conditions[0])
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          value={condition.type}
          onChange={e => handleTypeChange(e.target.value as ConditionDef['type'])}
          style={SELECT}
        >
          {CONDITION_TYPES.map(ct => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
        </select>
      </div>

      {condition.type === 'composite' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12, borderLeft: '2px solid var(--bg-border)' }}>
          <SimpleCondition
            condition={condition.conditions?.[0] ?? defaultCondition('threshold', sensors)}
            sensors={sensors}
            onChange={sub => onChange({ ...condition, conditions: [sub, condition.conditions?.[1] ?? defaultCondition('threshold', sensors)] })}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            {(['AND', 'OR'] as const).map(op => (
              <button
                key={op}
                type="button"
                onClick={() => onChange({ ...condition, op_composite: op })}
                style={{
                  padding: '3px 10px', border: 'none', borderRadius: 4, cursor: 'pointer',
                  fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 700,
                  background: condition.op_composite === op ? 'var(--accent-energy)' : 'var(--bg-elevated)',
                  color: condition.op_composite === op ? 'var(--bg-base)' : 'var(--text-muted)',
                }}
              >{op}</button>
            ))}
            <button
              type="button"
              onClick={removeComposite}
              style={{ padding: '3px 8px', border: 'none', borderRadius: 4, cursor: 'pointer', background: 'none', color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', fontSize: 11 }}
            >— quitar</button>
          </div>
          <SimpleCondition
            condition={condition.conditions?.[1] ?? defaultCondition('threshold', sensors)}
            sensors={sensors}
            onChange={sub => onChange({ ...condition, conditions: [condition.conditions?.[0] ?? defaultCondition('threshold', sensors), sub] })}
          />
        </div>
      ) : (
        <>
          <SimpleCondition condition={condition} sensors={sensors} onChange={onChange} />
          {depth === 0 && (
            <button
              type="button"
              onClick={addComposite}
              style={{ alignSelf: 'flex-start', padding: '4px 10px', fontSize: 12, fontFamily: 'var(--font-ui)', background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer' }}
            >+ Añadir condición AND/OR</button>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/features/rules/__tests__/ConditionBuilder.test.tsx
```

Expected: 6 tests passing

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/rules/ConditionBuilder.tsx frontend/src/features/rules/__tests__/ConditionBuilder.test.tsx
git commit -m "feat: ConditionBuilder — threshold/sustained/accumulation/trend/schedule/composite"
```

---

## Task 5: VehicleFilterPicker + ActionsList + EscalationBuilder

**Files:**
- Create: `frontend/src/features/rules/VehicleFilterPicker.tsx`
- Create: `frontend/src/features/rules/ActionsList.tsx`
- Create: `frontend/src/features/rules/EscalationBuilder.tsx`

- [ ] **Step 1: Create VehicleFilterPicker.tsx**

Create `frontend/src/features/rules/VehicleFilterPicker.tsx`:

```typescript
import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleFilter, VehicleTypeOut, VehicleOut } from '../../lib/types'

const SELECT: CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
  borderRadius: 6, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
  fontSize: 13, padding: '6px 8px', width: '100%', boxSizing: 'border-box' as const,
}

interface Props {
  value: VehicleFilter
  onChange: (f: VehicleFilter) => void
}

export default function VehicleFilterPicker({ value, onChange }: Props) {
  const { data: vehicleTypes = [] } = useQuery({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: Infinity,
    enabled: value.scope === 'type',
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: keys.vehicles(),
    queryFn: () => apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    staleTime: Infinity,
    enabled: value.scope === 'vehicle',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <select
        value={value.scope}
        onChange={e => {
          const scope = e.target.value as VehicleFilter['scope']
          onChange({ scope })
        }}
        style={SELECT}
      >
        <option value="all">Todos los vehículos</option>
        <option value="type">Por tipo de vehículo</option>
        <option value="vehicle">Vehículo específico</option>
      </select>

      {value.scope === 'type' && (
        <select
          value={value.vehicle_type_id ?? ''}
          onChange={e => onChange({ scope: 'type', vehicle_type_id: e.target.value })}
          style={SELECT}
        >
          <option value="">Selecciona un tipo…</option>
          {vehicleTypes.map(vt => <option key={vt.id} value={vt.id}>{vt.name}</option>)}
        </select>
      )}

      {value.scope === 'vehicle' && (
        <select
          value={value.vehicle_id ?? ''}
          onChange={e => onChange({ scope: 'vehicle', vehicle_id: e.target.value })}
          style={SELECT}
        >
          <option value="">Selecciona un vehículo…</option>
          {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create ActionsList.tsx**

Create `frontend/src/features/rules/ActionsList.tsx`:

```typescript
import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { ActionDef } from '../../lib/types'

const INPUT: CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
  borderRadius: 6, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
  fontSize: 13, padding: '6px 8px', flex: 1,
}
const BTN: CSSProperties = {
  padding: '4px 10px', fontSize: 12, fontFamily: 'var(--font-ui)',
  background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
  borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer',
}

interface Props {
  value: ActionDef[]
  onChange: (actions: ActionDef[]) => void
}

export default function ActionsList({ value, onChange }: Props) {
  const [emailDraft, setEmailDraft] = useState('')

  const hasInApp = value.some(a => a.type === 'in_app')
  const emailAction = value.find(a => a.type === 'email')
  const webhookAction = value.find(a => a.type === 'webhook')

  const setInApp = (checked: boolean) => {
    const filtered = value.filter(a => a.type !== 'in_app')
    onChange(checked ? [...filtered, { type: 'in_app' }] : filtered)
  }

  const addEmail = () => {
    const trimmed = emailDraft.trim()
    if (!trimmed || !trimmed.includes('@')) return
    const existing = emailAction?.recipients ?? []
    if (existing.includes(trimmed)) return
    const newRecipients = [...existing, trimmed]
    const filtered = value.filter(a => a.type !== 'email')
    onChange([...filtered, { type: 'email', recipients: newRecipients }])
    setEmailDraft('')
  }

  const removeEmail = (addr: string) => {
    const newRecipients = (emailAction?.recipients ?? []).filter(r => r !== addr)
    const filtered = value.filter(a => a.type !== 'email')
    onChange(newRecipients.length ? [...filtered, { type: 'email', recipients: newRecipients }] : filtered)
  }

  const setWebhook = (url: string) => {
    const filtered = value.filter(a => a.type !== 'webhook')
    onChange(url ? [...filtered, { type: 'webhook', url, method: 'POST' }] : filtered)
  }

  const LABEL_STYLE: CSSProperties = { fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <label style={LABEL_STYLE}>
        <input type="checkbox" checked={hasInApp} onChange={e => setInApp(e.target.checked)} style={{ accentColor: 'var(--accent-energy)' }} />
        Notificación in-app (siempre recomendado)
      </label>

      <div>
        <label style={LABEL_STYLE}>
          <input type="checkbox" checked={!!emailAction} onChange={e => { if (!e.target.checked) onChange(value.filter(a => a.type !== 'email')) }} style={{ accentColor: 'var(--accent-energy)' }} />
          Email
        </label>
        {emailAction && (
          <div style={{ marginTop: 8, paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {emailAction.recipients?.map(addr => (
              <div key={addr} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)', flex: 1 }}>{addr}</span>
                <button type="button" onClick={() => removeEmail(addr)} style={{ ...BTN, color: 'var(--accent-crit)' }}>✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="email"
                value={emailDraft}
                onChange={e => setEmailDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmail() } }}
                placeholder="destinatario@empresa.com"
                style={INPUT}
              />
              <button type="button" onClick={addEmail} style={BTN}>+</button>
            </div>
          </div>
        )}
      </div>

      <div>
        <label style={LABEL_STYLE}>
          <input type="checkbox" checked={!!webhookAction} onChange={e => { if (!e.target.checked) setWebhook('') }} style={{ accentColor: 'var(--accent-energy)' }} />
          Webhook
        </label>
        {webhookAction && (
          <div style={{ marginTop: 8, paddingLeft: 24 }}>
            <input
              type="url"
              value={webhookAction.url ?? ''}
              onChange={e => setWebhook(e.target.value)}
              placeholder="https://erp.empresa.com/api/alerts"
              style={{ ...INPUT, width: '100%', boxSizing: 'border-box' as const }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create EscalationBuilder.tsx**

Create `frontend/src/features/rules/EscalationBuilder.tsx`:

```typescript
import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { EscalationStep } from '../../lib/types'

const INPUT: CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
  borderRadius: 6, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
  fontSize: 13, padding: '6px 8px',
}

interface Props {
  value: EscalationStep[]
  onChange: (steps: EscalationStep[]) => void
}

export default function EscalationBuilder({ value, onChange }: Props) {
  const [drafts, setDrafts] = useState<string[]>(value.map(() => ''))

  const addStep = () => {
    const lastDelay = value[value.length - 1]?.delay_minutes ?? 0
    onChange([...value, { delay_minutes: lastDelay + 30, actions: [] }])
    setDrafts(prev => [...prev, ''])
  }

  const removeStep = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i))
    setDrafts(prev => prev.filter((_, idx) => idx !== i))
  }

  const updateDelay = (i: number, minutes: number) => {
    onChange(value.map((s, idx) => idx === i ? { ...s, delay_minutes: minutes } : s))
  }

  const addEmailToStep = (i: number, addr: string) => {
    if (!addr.trim() || !addr.includes('@')) return
    const step = value[i]
    const existing = step.actions.find(a => a.type === 'email')
    const filtered = step.actions.filter(a => a.type !== 'email')
    const newRecipients = [...(existing?.recipients ?? []), addr.trim()]
    onChange(value.map((s, idx) => idx === i ? { ...s, actions: [...filtered, { type: 'email', recipients: newRecipients }] } : s))
    setDrafts(prev => prev.map((d, idx) => idx === i ? '' : d))
  }

  const removeEmailFromStep = (stepIdx: number, addr: string) => {
    const step = value[stepIdx]
    const existing = step.actions.find(a => a.type === 'email')
    const newRecipients = (existing?.recipients ?? []).filter(r => r !== addr)
    const filtered = step.actions.filter(a => a.type !== 'email')
    onChange(value.map((s, idx) => idx === stepIdx
      ? { ...s, actions: newRecipients.length ? [...filtered, { type: 'email', recipients: newRecipients }] : filtered }
      : s
    ))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {value.map((step, i) => {
        const emailAction = step.actions.find(a => a.type === 'email')
        return (
          <div key={i} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 12, border: '1px solid var(--bg-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)' }}>Si no reconocida en</span>
              <input
                type="number"
                value={step.delay_minutes}
                onChange={e => updateDelay(i, parseInt(e.target.value) || 1)}
                style={{ ...INPUT, width: 70 }}
                min={1}
              />
              <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)' }}>minutos, enviar email a:</span>
              <button type="button" onClick={() => removeStep(i)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--accent-crit)', cursor: 'pointer', fontSize: 13 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 8 }}>
              {emailAction?.recipients?.map(addr => (
                <div key={addr} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)', flex: 1 }}>{addr}</span>
                  <button type="button" onClick={() => removeEmailFromStep(i, addr)} style={{ background: 'none', border: 'none', color: 'var(--accent-crit)', cursor: 'pointer', fontSize: 12 }}>✕</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="email"
                  value={drafts[i] ?? ''}
                  onChange={e => setDrafts(prev => prev.map((d, idx) => idx === i ? e.target.value : d))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmailToStep(i, drafts[i] ?? '') } }}
                  placeholder="supervisor@empresa.com"
                  style={{ ...INPUT, flex: 1 }}
                />
                <button type="button" onClick={() => addEmailToStep(i, drafts[i] ?? '')} style={{ ...INPUT, cursor: 'pointer' }}>+</button>
              </div>
            </div>
          </div>
        )
      })}
      <button
        type="button"
        onClick={addStep}
        style={{ alignSelf: 'flex-start', padding: '6px 14px', fontSize: 12, fontFamily: 'var(--font-ui)', background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer' }}
      >+ Añadir escalón</button>
    </div>
  )
}
```

- [ ] **Step 4: Run full frontend test suite (no new tests yet — covered in Task 6)**

```bash
npm test -- --run
```

Expected: all existing tests still passing

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/rules/VehicleFilterPicker.tsx frontend/src/features/rules/ActionsList.tsx frontend/src/features/rules/EscalationBuilder.tsx
git commit -m "feat: VehicleFilterPicker, ActionsList, EscalationBuilder components"
```

---

## Task 6: RuleFormPage (create + edit)

**Files:**
- Create: `frontend/src/features/rules/RuleFormPage.tsx`
- Create: `frontend/src/features/rules/__tests__/RuleFormPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/rules/__tests__/RuleFormPage.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import RuleFormPage from '../RuleFormPage'
import type { RuleOut, VehicleTypeOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}))
vi.mock('../../../features/auth/useAuthStore', () => ({
  useAuthStore: vi.fn(() => ({ user: { role: 'admin', tenant_tier: 'client' } })),
}))

import { apiClient } from '../../../lib/apiClient'

const mockVehicleType: VehicleTypeOut = {
  id: 'vt1', slug: 'vacuum', name: 'Camión aspirador',
  sensor_schema: [
    { key: 'hydraulic_pressure_1', label: 'Presión bomba', unit: 'bar', gauge_type: 'circular', min: 0, max: 300 },
  ],
}

const mockRule: RuleOut = {
  id: 'r1', tenant_id: 't1', name: 'Presión alta', description: null,
  active: true, severity: 'critical',
  vehicle_filter: { scope: 'all' },
  condition: { type: 'threshold', field: 'hydraulic_pressure_1', op: '>', value: 220 },
  actions: [{ type: 'in_app' }], escalation: [],
  cooldown_minutes: 30, created_at: '2026-04-19T00:00:00Z',
}

function wrapCreate() {
  vi.mocked(apiClient.get).mockResolvedValue([mockVehicleType])
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/rules/new']}>
        <Routes>
          <Route path="/rules/new" element={<RuleFormPage />} />
          <Route path="/rules" element={<div>Lista</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function wrapEdit() {
  vi.mocked(apiClient.get).mockImplementation((path: string) => {
    if (path.includes('/api/v1/rules/r1')) return Promise.resolve(mockRule)
    return Promise.resolve([mockVehicleType])
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(['rules', 'r1'], mockRule)
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/rules/r1']}>
        <Routes>
          <Route path="/rules/:id" element={<RuleFormPage />} />
          <Route path="/rules" element={<div>Lista</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('RuleFormPage', () => {
  it('muestra formulario de creación vacío', () => {
    wrapCreate()
    expect(screen.getByPlaceholderText(/nombre de la regla/i)).toBeInTheDocument()
    expect(screen.getByText('Guardar regla')).toBeInTheDocument()
  })

  it('submit en creación llama apiClient.post con payload correcto', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(mockRule)
    wrapCreate()
    fireEvent.change(screen.getByPlaceholderText(/nombre de la regla/i), { target: { value: 'Nueva regla' } })
    fireEvent.click(screen.getByText('Guardar regla'))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/rules',
      expect.objectContaining({ name: 'Nueva regla', condition: expect.objectContaining({ type: 'threshold' }) })
    ))
  })

  it('en modo edición pre-carga el nombre de la regla', async () => {
    wrapEdit()
    await waitFor(() => expect(screen.getByDisplayValue('Presión alta')).toBeInTheDocument())
  })

  it('submit en edición llama apiClient.put', async () => {
    vi.mocked(apiClient.put).mockResolvedValue(mockRule)
    wrapEdit()
    await waitFor(() => screen.getByDisplayValue('Presión alta'))
    fireEvent.click(screen.getByText('Guardar regla'))
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      '/api/v1/rules/r1', expect.objectContaining({ name: 'Presión alta' })
    ))
  })

  it('muestra error si nombre está vacío al guardar', async () => {
    wrapCreate()
    fireEvent.click(screen.getByText('Guardar regla'))
    expect(screen.getByText(/El nombre es obligatorio/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --run src/features/rules/__tests__/RuleFormPage.test.tsx
```

Expected: FAIL (module not found)

- [ ] **Step 3: Create RuleFormPage.tsx**

Create `frontend/src/features/rules/RuleFormPage.tsx`:

```typescript
import type { CSSProperties } from 'react'
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import ConditionBuilder from './ConditionBuilder'
import VehicleFilterPicker from './VehicleFilterPicker'
import ActionsList from './ActionsList'
import EscalationBuilder from './EscalationBuilder'
import type { RuleOut, RuleCreate, ConditionDef, ActionDef, EscalationStep, VehicleFilter, VehicleTypeOut, SensorDef } from '../../lib/types'

const SECTION: CSSProperties = {
  marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid var(--bg-border)',
}
const LABEL: CSSProperties = {
  fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600,
  color: 'var(--text-muted)', letterSpacing: '0.05em', display: 'block', marginBottom: 6,
}
const INPUT: CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)',
  borderRadius: 6, color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
  fontSize: 13, padding: '8px 10px', width: '100%', boxSizing: 'border-box' as const,
}
const SEV_BTN = (active: boolean, color: string): CSSProperties => ({
  padding: '6px 16px', fontSize: 12, fontFamily: 'var(--font-ui)', fontWeight: 600,
  border: `1px solid ${active ? color : 'var(--bg-border)'}`,
  borderRadius: 6, cursor: 'pointer',
  background: active ? color : 'var(--bg-elevated)',
  color: active ? 'var(--bg-base)' : 'var(--text-muted)',
})

const DEFAULT_CONDITION: ConditionDef = { type: 'threshold', field: '', op: '>', value: 0 }
const DEFAULT_FORM: RuleCreate = {
  name: '', description: null, severity: 'warning',
  vehicle_filter: { scope: 'all' },
  condition: DEFAULT_CONDITION,
  actions: [{ type: 'in_app' }],
  escalation: [],
  cooldown_minutes: 30,
  active: true,
}

function mergedSensors(vehicleTypes: VehicleTypeOut[]): SensorDef[] {
  const seen = new Set<string>()
  const result: SensorDef[] = []
  for (const vt of vehicleTypes) {
    for (const s of vt.sensor_schema) {
      if (!seen.has(s.key)) {
        seen.add(s.key)
        result.push(s)
      }
    }
  }
  return result
}

export default function RuleFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id && id !== 'new'
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [form, setForm] = useState<RuleCreate>(DEFAULT_FORM)
  const [nameError, setNameError] = useState('')
  const [apiError, setApiError] = useState('')

  const { data: existingRule } = useQuery({
    queryKey: keys.rule(id!),
    queryFn: () => apiClient.get<RuleOut>(`/api/v1/rules/${id}`),
    enabled: isEdit,
    staleTime: Infinity,
  })

  const { data: vehicleTypes = [] } = useQuery({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: Infinity,
  })

  useEffect(() => {
    if (existingRule) {
      setForm({
        name: existingRule.name,
        description: existingRule.description,
        severity: existingRule.severity,
        vehicle_filter: existingRule.vehicle_filter,
        condition: existingRule.condition,
        actions: existingRule.actions,
        escalation: existingRule.escalation,
        cooldown_minutes: existingRule.cooldown_minutes,
        active: existingRule.active,
      })
    }
  }, [existingRule?.id])

  const sensors: SensorDef[] = mergedSensors(vehicleTypes)

  const { mutate, isPending } = useMutation({
    mutationFn: () => isEdit
      ? apiClient.put<RuleOut>(`/api/v1/rules/${id}`, form)
      : apiClient.post<RuleOut>('/api/v1/rules', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.rules() })
      navigate('/rules')
    },
    onError: (err) => setApiError((err as Error).message),
  })

  const handleSubmit = () => {
    if (!form.name.trim()) {
      setNameError('El nombre es obligatorio')
      return
    }
    setNameError('')
    setApiError('')
    mutate()
  }

  const update = <K extends keyof RuleCreate>(key: K, val: RuleCreate[K]) =>
    setForm(prev => ({ ...prev, [key]: val }))

  return (
    <Shell title={isEdit ? 'Editar regla' : 'Nueva regla'}>
      <div style={{ padding: 24, maxWidth: 640, overflowY: 'auto', height: '100%' }}>

        {/* Identificación */}
        <div style={SECTION}>
          <div style={{ marginBottom: 12 }}>
            <label style={LABEL}>NOMBRE</label>
            <input
              type="text"
              value={form.name}
              onChange={e => { update('name', e.target.value); setNameError('') }}
              placeholder="Nombre de la regla"
              style={{ ...INPUT, borderColor: nameError ? 'var(--accent-crit)' : 'var(--bg-border)' }}
            />
            {nameError && <div style={{ color: 'var(--accent-crit)', fontSize: 11, fontFamily: 'var(--font-ui)', marginTop: 4 }}>{nameError}</div>}
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={LABEL}>DESCRIPCIÓN (opcional)</label>
            <input
              type="text"
              value={form.description ?? ''}
              onChange={e => update('description', e.target.value || null)}
              placeholder="Descripción de la regla (opcional)"
              style={INPUT}
            />
          </div>
          <div>
            <label style={LABEL}>SEVERIDAD</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => update('severity', 'info')} style={SEV_BTN(form.severity === 'info', 'var(--accent-info)')}>Info</button>
              <button type="button" onClick={() => update('severity', 'warning')} style={SEV_BTN(form.severity === 'warning', 'var(--accent-warn)')}>Aviso</button>
              <button type="button" onClick={() => update('severity', 'critical')} style={SEV_BTN(form.severity === 'critical', 'var(--accent-crit)')}>Crítica</button>
            </div>
          </div>
        </div>

        {/* Scope */}
        <div style={SECTION}>
          <label style={LABEL}>ALCANCE DE VEHÍCULOS</label>
          <VehicleFilterPicker
            value={form.vehicle_filter}
            onChange={f => update('vehicle_filter', f)}
          />
        </div>

        {/* Condición */}
        <div style={SECTION}>
          <label style={LABEL}>CONDICIÓN</label>
          <ConditionBuilder
            condition={form.condition}
            sensors={sensors}
            onChange={c => update('condition', c)}
          />
        </div>

        {/* Acciones */}
        <div style={SECTION}>
          <label style={LABEL}>ACCIONES</label>
          <ActionsList
            value={form.actions}
            onChange={a => update('actions', a)}
          />
        </div>

        {/* Escalación */}
        <div style={SECTION}>
          <label style={LABEL}>ESCALACIÓN</label>
          <EscalationBuilder
            value={form.escalation}
            onChange={e => update('escalation', e)}
          />
        </div>

        {/* Configuración */}
        <div style={{ marginBottom: 24 }}>
          <label style={LABEL}>CONFIGURACIÓN</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)' }}>No repetir antes de</span>
            <input
              type="number"
              value={form.cooldown_minutes}
              onChange={e => update('cooldown_minutes', parseInt(e.target.value) || 1)}
              style={{ ...INPUT, width: 80 }}
              min={1}
            />
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)' }}>minutos</span>
          </div>
          <label style={{ ...LABEL, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.active}
              onChange={e => update('active', e.target.checked)}
              style={{ accentColor: 'var(--accent-energy)' }}
            />
            Regla activa
          </label>
        </div>

        {apiError && <div style={{ color: 'var(--accent-crit)', fontSize: 12, fontFamily: 'var(--font-ui)', marginBottom: 12 }}>{apiError}</div>}

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            style={{
              padding: '8px 24px', fontSize: 13, fontFamily: 'var(--font-ui)', fontWeight: 600,
              background: 'var(--accent-energy)', border: 'none', borderRadius: 6,
              color: 'var(--bg-base)', cursor: isPending ? 'wait' : 'pointer',
            }}
          >{isPending ? 'Guardando…' : 'Guardar regla'}</button>
          <button
            type="button"
            onClick={() => navigate('/rules')}
            style={{ padding: '8px 16px', fontSize: 13, fontFamily: 'var(--font-ui)', background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer' }}
          >Cancelar</button>
        </div>
      </div>
    </Shell>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/features/rules/__tests__/RuleFormPage.test.tsx
```

Expected: 5 tests passing

- [ ] **Step 5: Run full frontend test suite**

```bash
npm test -- --run
```

Expected: all passing

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/rules/RuleFormPage.tsx frontend/src/features/rules/__tests__/RuleFormPage.test.tsx
git commit -m "feat: RuleFormPage — formulario create/edit con condición, acciones, escalación"
```

---

## Task 7: Routes + Sidebar activation

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/shared/ui/Sidebar.tsx`

- [ ] **Step 1: Add routes to App.tsx**

In `frontend/src/App.tsx`, add two lazy imports after `SettingsPage`:

```typescript
const RulesPage     = lazy(() => import('./features/rules/RulesPage'))
const RuleFormPage  = lazy(() => import('./features/rules/RuleFormPage'))
```

Add two routes in the inner `<Routes>` block, before the catch-all `*`:

```typescript
<Route path="rules"      element={<RulesPage />} />
<Route path="rules/:id"  element={<RuleFormPage />} />
```

Full updated `App.tsx`:

```typescript
import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './features/auth/LoginPage'
import RequireAuth from './features/auth/RequireAuth'

const FleetPage         = lazy(() => import('./features/fleet/FleetPage'))
const VehicleDetailPage = lazy(() => import('./features/vehicle/VehicleDetailPage'))
const AlertsPage        = lazy(() => import('./features/alerts/AlertsPage'))
const SettingsPage      = lazy(() => import('./features/settings/SettingsPage'))
const RulesPage         = lazy(() => import('./features/rules/RulesPage'))
const RuleFormPage      = lazy(() => import('./features/rules/RuleFormPage'))

function Loading() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-base)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-muted)',
    }}>
      Cargando…
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="fleet"        element={<FleetPage />} />
                <Route path="vehicles/:id" element={<VehicleDetailPage />} />
                <Route path="alerts"       element={<AlertsPage />} />
                <Route path="settings"     element={<SettingsPage />} />
                <Route path="rules"        element={<RulesPage />} />
                <Route path="rules/:id"    element={<RuleFormPage />} />
                <Route path="*"            element={<Navigate to="/fleet" replace />} />
              </Routes>
            </Suspense>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
```

- [ ] **Step 2: Activate /rules in Sidebar.tsx**

In `frontend/src/shared/ui/Sidebar.tsx`, change `active: false` to `active: true` for the rules item:

```typescript
const NAV_ITEMS = [
  { to: '/fleet',  Icon: IconFlota,   label: 'Flota',   active: true },
  { to: '/alerts', Icon: IconAlertas, label: 'Alertas', active: true },
  { to: '/rules',  Icon: IconReglas,  label: 'Reglas',  active: true },
]
```

- [ ] **Step 3: Run full frontend test suite**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- --run
```

Expected: all passing

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Production build**

```bash
npm run build 2>&1 | tail -5
```

Expected: build successful with no errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/shared/ui/Sidebar.tsx
git commit -m "feat: /rules routes + Sidebar — activa navegación a rule builder"
```

---

## Final verification

- [ ] Run full backend test suite:

```bash
cd /opt/cmg-telematic1
python3 -m pytest tests/ -q
```

Expected: all passing (52+3 = 55 tests)

- [ ] Run full frontend test suite:

```bash
cd frontend && npm test -- --run
```

Expected: all passing (76+ tests)

- [ ] TypeScript and build:

```bash
npx tsc --noEmit && npm run build
```

Expected: no errors
