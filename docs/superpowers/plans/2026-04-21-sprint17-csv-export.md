# Sprint 17 — Exportación CSV de Tablas Principales

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir botón "Exportar CSV" a CAN Scanner, ciclos de trabajo y logs de mantenimiento usando una utilidad genérica cliente-side. Sin cambios de backend.

**Architecture:** Utilidad `csvExport.ts` con una función pura que convierte un array de objetos planos a CSV y dispara la descarga vía Blob + `<a>` element. Cada página que necesita exportar construye los objetos planos y llama a la utilidad.

**Tech Stack:** TypeScript, Vitest, React Testing Library. No dependencias nuevas.

**Nota:** Las alertas ya tienen exportación CSV completa (backend `/alerts/export.csv` + botón en `AlertsPage.tsx`). Este sprint NO toca Alertas.

---

## Ficheros

| Fichero | Acción |
|---------|--------|
| `frontend/src/lib/csvExport.ts` | Crear — utilidad genérica |
| `frontend/src/lib/__tests__/csvExport.test.ts` | Crear — 6 tests unitarios |
| `frontend/src/features/diagnostics/CanScannerPage.tsx` | Modificar — botón exportar en tabla historial |
| `frontend/src/features/vehicle/WorkCyclesTab.tsx` | Modificar — botón exportar en tabla ciclos |
| `frontend/src/features/maintenance/MaintenancePlanDetailPage.tsx` | Modificar — botón exportar en sección logs |

---

### Task 1: csvExport.ts — utilidad + tests

**Files:**
- Create: `frontend/src/lib/csvExport.ts`
- Create: `frontend/src/lib/__tests__/csvExport.test.ts`

- [ ] **Step 1: Escribir tests que fallen**

```typescript
// frontend/src/lib/__tests__/csvExport.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToCsv } from '../csvExport'

describe('exportToCsv', () => {
  let createObjectURL: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>
  let anchorClick: ReturnType<typeof vi.fn>
  let appendChildSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:test-url')
    revokeObjectURL = vi.fn()
    anchorClick = vi.fn()
    Object.defineProperty(window, 'URL', {
      value: { createObjectURL, revokeObjectURL },
      writable: true,
    })
    // Stub createElement('a') to capture the anchor
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const a = origCreate('a') as HTMLAnchorElement
        a.click = anchorClick
        return a
      }
      return origCreate(tag)
    })
    appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('hace nada con array vacío', () => {
    exportToCsv('test.csv', [])
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(anchorClick).not.toHaveBeenCalled()
  })

  it('genera CSV con cabecera y fila simple', () => {
    exportToCsv('out.csv', [{ name: 'Alice', age: 30 }])
    expect(createObjectURL).toHaveBeenCalledOnce()
    const blob: Blob = createObjectURL.mock.calls[0][0]
    expect(blob.type).toBe('text/csv;charset=utf-8;')
    return blob.text().then(text => {
      expect(text).toBe('name,age\nAlice,30')
    })
  })

  it('escapa valores con coma usando comillas dobles', () => {
    exportToCsv('out.csv', [{ city: 'Valencia, España' }])
    const blob: Blob = createObjectURL.mock.calls[0][0]
    return blob.text().then(text => {
      expect(text).toContain('"Valencia, España"')
    })
  })

  it('escapa comillas internas duplicándolas', () => {
    exportToCsv('out.csv', [{ note: 'say "hello"' }])
    const blob: Blob = createObjectURL.mock.calls[0][0]
    return blob.text().then(text => {
      expect(text).toContain('"say ""hello"""')
    })
  })

  it('convierte null y undefined a cadena vacía', () => {
    exportToCsv('out.csv', [{ a: null, b: undefined, c: 0 }])
    const blob: Blob = createObjectURL.mock.calls[0][0]
    return blob.text().then(text => {
      expect(text).toBe('a,b,c\n,,0')
    })
  })

  it('dispara click en anchor con filename y revoca URL', () => {
    exportToCsv('datos.csv', [{ x: 1 }])
    expect(appendChildSpy).toHaveBeenCalled()
    expect(anchorClick).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url')
  })
})
```

- [ ] **Step 2: Verificar que los tests fallan**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run src/lib/__tests__/csvExport.test.ts 2>&1 | head -30
```

Resultado esperado: error `Cannot find module '../csvExport'`

- [ ] **Step 3: Crear la utilidad**

```typescript
// frontend/src/lib/csvExport.ts
type CsvValue = string | number | boolean | null | undefined

function escapeCsv(value: CsvValue): string {
  if (value == null) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function exportToCsv(filename: string, rows: Record<string, CsvValue>[]): void {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(h => escapeCsv(row[h])).join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: Verificar que los tests pasan**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run src/lib/__tests__/csvExport.test.ts
```

Resultado esperado: `6 passed`

- [ ] **Step 5: Commit**

```bash
cd /opt/cmg-telematic1 && git add frontend/src/lib/csvExport.ts frontend/src/lib/__tests__/csvExport.test.ts && git commit -m "feat: add csvExport utility with unit tests"
```

---

### Task 2: CAN Scanner — botón exportar

**Files:**
- Modify: `frontend/src/features/diagnostics/CanScannerPage.tsx`

El historial AVL tiene columnas: time, lat, lon, speed_kmh, heading, altitude_m, ignition, pto_active, ext_voltage_mv, y columnas dinámicas de `can_data`. El botón se muestra solo cuando `records.length > 0`.

- [ ] **Step 1: Añadir import y handler de exportación**

En `CanScannerPage.tsx`, añadir en la línea 1 del bloque de imports (tras los imports existentes):

```typescript
import { exportToCsv } from '../../lib/csvExport'
```

Dentro del componente `CanScannerPage`, después de la línea que define `allCanKeys` (busca la línea `const allCanKeys = ...`), añadir el handler:

```typescript
function handleExport() {
  const rows = records.map(r => {
    const row: Record<string, string | number | boolean | null | undefined> = {
      time: r.time,
      lat: r.lat,
      lon: r.lon,
      speed_kmh: r.speed_kmh,
      heading: r.heading,
      altitude_m: r.altitude_m,
      ignition: r.ignition,
      pto_active: r.pto_active,
      ext_voltage_mv: r.ext_voltage_mv,
    }
    for (const key of Array.from(allCanKeys).sort()) {
      const meta = AVL_NAMES[key]
      const header = meta ? `${meta.name} (${key})` : key
      row[header] = r.can_data[key] ?? null
    }
    return row
  })
  const date = new Date().toISOString().slice(0, 10)
  exportToCsv(`can_scan_${vehicleId}_${date}.csv`, rows)
}
```

- [ ] **Step 2: Añadir el botón en el toolbar**

En el toolbar (div que contiene los selects de tenant y vehículo y el botón de auto-refresh), añadir el botón de exportar justo antes del cierre del div de controles. Busca el bloque que termina el row de controles — el botón irá a la derecha tras el toggle de auto-refresh.

Añadir tras el último botón del toolbar (tras el span/botón de auto-refresh):

```tsx
{records.length > 0 && (
  <button
    onClick={handleExport}
    style={{ padding: '6px 12px', background: 'var(--bg-elevated)', color: 'var(--text-base, #E7E5E4)', border: '1px solid var(--bg-border)', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}
  >
    Exportar CSV
  </button>
)}
```

- [ ] **Step 3: Verificar TypeScript**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | grep -i "can\|scanner\|csvExport" | head -20
```

Resultado esperado: sin errores en esos ficheros.

- [ ] **Step 4: Ejecutar suite completa**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run 2>&1 | tail -5
```

Resultado esperado: todos los tests pasan (sin regresión).

- [ ] **Step 5: Commit**

```bash
cd /opt/cmg-telematic1 && git add frontend/src/features/diagnostics/CanScannerPage.tsx && git commit -m "feat: add CSV export button to CAN Scanner history table"
```

---

### Task 3: WorkCyclesTab — botón exportar

**Files:**
- Modify: `frontend/src/features/vehicle/WorkCyclesTab.tsx`

La tabla de ciclos tiene: definición (lookup en defnMap), started_at, ended_at, duration_seconds, lat, lon, y las claves del JSONB `cycle_data` (variables por ciclo, se hace unión de todas).

- [ ] **Step 1: Añadir import**

En `WorkCyclesTab.tsx`, añadir en la línea 1 de imports:

```typescript
import { exportToCsv } from '../../lib/csvExport'
```

- [ ] **Step 2: Añadir handler de exportación**

Dentro del componente `WorkCyclesTab`, justo antes del `return`, añadir:

```typescript
function handleExport() {
  // Obtener todas las claves de cycle_data de todos los ciclos
  const allCycleKeys = Array.from(
    new Set(cycles.flatMap(c => Object.keys(c.cycle_data)))
  ).sort()
  
  const rows = cycles.map(cycle => {
    const row: Record<string, string | number | null | undefined> = {
      definition: defnMap[cycle.definition_id]?.name ?? cycle.definition_id,
      started_at: cycle.started_at,
      ended_at: cycle.ended_at,
      duration_seconds: cycle.duration_seconds,
      lat: cycle.lat,
      lon: cycle.lon,
    }
    for (const key of allCycleKeys) {
      const v = cycle.cycle_data[key]
      row[key] = v != null ? String(v) : null
    }
    return row
  })
  
  const date = new Date().toISOString().slice(0, 10)
  exportToCsv(`ciclos_${vehicleId}_${date}.csv`, rows)
}
```

- [ ] **Step 3: Añadir el botón en los controles**

En el bloque de controles (el div con los inputs de fecha y el botón "Calcular ciclos"), añadir el botón al final del bloque, dentro del mismo div de controles:

```tsx
{cycles.length > 0 && (
  <button
    onClick={handleExport}
    style={{ padding: '6px 12px', background: 'var(--bg-elevated)', color: 'var(--text-base, #E7E5E4)', border: '1px solid var(--bg-border)', borderRadius: 5, fontSize: 13, cursor: 'pointer' }}
  >
    Exportar CSV
  </button>
)}
```

- [ ] **Step 4: Verificar TypeScript**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | grep -i "workCycles\|csvExport" | head -20
```

Resultado esperado: sin errores.

- [ ] **Step 5: Ejecutar suite completa**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run 2>&1 | tail -5
```

Resultado esperado: todos los tests pasan.

- [ ] **Step 6: Commit**

```bash
cd /opt/cmg-telematic1 && git add frontend/src/features/vehicle/WorkCyclesTab.tsx && git commit -m "feat: add CSV export button to work cycles table"
```

---

### Task 4: MaintenancePlanDetailPage — botón exportar

**Files:**
- Modify: `frontend/src/features/maintenance/MaintenancePlanDetailPage.tsx`

Los logs tienen: performed_at, performed_by_email, description, reset_counters (array → join con ";"), cost_eur.

- [ ] **Step 1: Añadir import**

En `MaintenancePlanDetailPage.tsx`, añadir en los imports:

```typescript
import { exportToCsv } from '../../lib/csvExport'
```

- [ ] **Step 2: Añadir handler de exportación**

Dentro del componente, justo antes del `return`, añadir:

```typescript
function handleExportLogs() {
  const rows = logs.map(log => ({
    performed_at: log.performed_at,
    performed_by: log.performed_by_email ?? '',
    description: log.description ?? '',
    reset_counters: log.reset_counters.join('; '),
    cost_eur: log.cost_eur,
  }))
  exportToCsv(`mantenimiento_${id}_logs.csv`, rows)
}
```

- [ ] **Step 3: Añadir el botón junto al título del historial**

En el fichero, busca la línea con el texto `HISTORIAL DE INTERVENCIONES`. El div contenedor tiene ese texto. Añadir un botón alineado a la derecha dentro de ese mismo div de cabecera, convirtiendo el div en un flex con space-between:

Localiza:
```tsx
<div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'var(--accent-off)', marginBottom: 8 }}>
  HISTORIAL DE INTERVENCIONES
</div>
```

Reemplazar por:
```tsx
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'var(--accent-off)' }}>
    HISTORIAL DE INTERVENCIONES
  </div>
  {logs.length > 0 && (
    <button
      onClick={handleExportLogs}
      style={{ padding: '4px 10px', background: 'var(--bg-elevated)', color: 'var(--text-base, #E7E5E4)', border: '1px solid var(--bg-border)', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}
    >
      Exportar CSV
    </button>
  )}
</div>
```

- [ ] **Step 4: Verificar TypeScript**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | grep -i "maintenance\|csvExport" | head -20
```

Resultado esperado: sin errores.

- [ ] **Step 5: Ejecutar suite completa**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run 2>&1 | tail -5
```

Resultado esperado: todos los tests pasan.

- [ ] **Step 6: Commit**

```bash
cd /opt/cmg-telematic1 && git add frontend/src/features/maintenance/MaintenancePlanDetailPage.tsx && git commit -m "feat: add CSV export button to maintenance intervention logs"
```

---

## Verificación end-to-end

```bash
# TypeScript
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit

# Tests
cd /opt/cmg-telematic1/frontend && npx vitest run

# Resultado esperado: todos los ficheros modificados sin error TS, suite verde
```

## Notas de implementación

- `exportToCsv` usa la primera fila para derivar las cabeceras — el orden de keys en el objeto importa. Construcción manual garantiza orden consistente.
- CAN Scanner: los headers de columnas CAN usan `"${meta.name} (${key})"` para legibilidad máxima (ej. `PTO State (avl_179)`)
- WorkCycles: `cycle_data` values son `unknown` en el tipo — se usa `String(v)` para serializar cualquier primitivo
- MaintenancePlanDetailPage: `reset_counters` es `string[]` — se une con "; " para preservar como campo único
- El botón solo se muestra cuando hay datos (`records/cycles/logs.length > 0`) para evitar exportar CSV vacíos
