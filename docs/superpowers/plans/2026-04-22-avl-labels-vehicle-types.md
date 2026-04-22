# AVL Labels + Gestión de Tipos de Vehículo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar nombres legibles para AVL IDs en el CAN Scanner (estándar Teltonika + personalizados por tipo de vehículo con soporte de extracción de bits) y añadir una página de gestión completa de tipos de vehículo.

**Architecture:** El diccionario estático `AVL_NAMES` cubre los ~50 IDs estándar Teltonika. El `sensor_schema` del `VehicleType` almacena mapeos propios CMG/IFM (incluyendo `bit_index` para extraer bits individuales de bytes de estado). El CAN Scanner combina ambas fuentes dando prioridad al schema. El backend añade dos endpoints nuevos (POST/PATCH vehicle-types) que solo el CMG admin puede invocar.

**Tech Stack:** FastAPI + SQLAlchemy async (backend), React 18 + TanStack Query + TypeScript (frontend), Docker Compose para despliegue.

---

## Mapa de ficheros

| Fichero | Acción | Responsabilidad |
|---|---|---|
| `backend/app/schemas/vehicle.py` | modificar | añadir `VehicleTypeCreate` + `VehicleTypeUpdate` |
| `backend/app/api/v1/vehicles.py` | modificar | añadir `POST /vehicle-types` + `PATCH /vehicle-types/{id}` |
| `frontend/src/lib/types.ts` | modificar | añadir `bit_index` a `SensorDef` |
| `frontend/src/features/diagnostics/CanScannerPage.tsx` | modificar | AVL_NAMES completo + resolución de etiquetas + bits |
| `frontend/src/features/vehicles/VehicleTypesPage.tsx` | crear | página CRUD de tipos + sensores |
| `frontend/src/App.tsx` | modificar | ruta `/tipos-vehiculo` |
| `frontend/src/shared/ui/Sidebar.tsx` | modificar | enlace "Tipos de Vehículo" para CMG admin |

---

## Task 1: Backend — schemas VehicleTypeCreate + VehicleTypeUpdate

**Files:**
- Modify: `backend/app/schemas/vehicle.py`

- [ ] **Paso 1: Añadir los dos schemas al final del fichero**

Abrir `backend/app/schemas/vehicle.py`. Añadir después de la clase `VehicleTypeSensorSchemaUpdate` (que termina en la línea ~91):

```python
class VehicleTypeCreate(BaseModel):
    name: str
    slug: str

class VehicleTypeUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
```

- [ ] **Paso 2: Verificar que el fichero es válido**

```bash
cd /opt/cmg-telematic1
docker-compose exec core-api python -c "from app.schemas.vehicle import VehicleTypeCreate, VehicleTypeUpdate; print('OK')"
```

Resultado esperado: `OK`

---

## Task 2: Backend — endpoints POST y PATCH /vehicle-types

**Files:**
- Modify: `backend/app/api/v1/vehicles.py`

- [ ] **Paso 1: Actualizar el import de schemas**

En `backend/app/api/v1/vehicles.py`, línea 12–15, reemplazar el bloque `from app.schemas.vehicle import (...)` por:

```python
from app.schemas.vehicle import (
    VehicleTypeOut, VehicleOut, VehicleCreate, VehicleUpdate, VehicleStatus,
    TelemetryPoint, TrackPoint, KpiHour, VehicleTypeSensorSchemaUpdate,
    VehicleTypeCreate, VehicleTypeUpdate,
)
```

- [ ] **Paso 2: Añadir POST /vehicle-types**

Insertar después del endpoint `update_vehicle_type_sensor_schema` (después de la línea 65, el `return vtype` del PATCH /sensor-schema):

```python
@router.post("/vehicle-types", response_model=VehicleTypeOut, status_code=201)
async def create_vehicle_type(
    body: VehicleTypeCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=403, detail="Solo CMG admin puede crear tipos de vehículo")
    dup = await db.execute(select(VehicleType).where(VehicleType.slug == body.slug))
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Ya existe un tipo con ese slug")
    vtype = VehicleType(name=body.name, slug=body.slug, sensor_schema=[])
    db.add(vtype)
    await db.commit()
    await db.refresh(vtype)
    return vtype
```

- [ ] **Paso 3: Añadir PATCH /vehicle-types/{type_id}**

Insertar a continuación del endpoint anterior:

```python
@router.patch("/vehicle-types/{type_id}", response_model=VehicleTypeOut)
async def update_vehicle_type(
    type_id: uuid.UUID,
    body: VehicleTypeUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=403, detail="Solo CMG admin puede modificar tipos de vehículo")
    vtype = await db.get(VehicleType, type_id)
    if not vtype:
        raise HTTPException(status_code=404, detail="Tipo de vehículo no encontrado")
    if body.name is not None:
        vtype.name = body.name
    if body.slug is not None:
        dup = await db.execute(
            select(VehicleType).where(VehicleType.slug == body.slug, VehicleType.id != type_id)
        )
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Ya existe un tipo con ese slug")
        vtype.slug = body.slug
    await db.commit()
    await db.refresh(vtype)
    return vtype
```

- [ ] **Paso 4: Rebuild y redeploy core-api**

```bash
cd /opt/cmg-telematic1
docker-compose build core-api && docker-compose up -d core-api
```

Esperar ~30 segundos y verificar:

```bash
docker-compose logs core-api --tail=20
```

Debe terminar con `Application startup complete.` sin errores.

- [ ] **Paso 5: Verificar endpoints con curl**

```bash
# Obtener token
TOKEN=$(curl -s -X POST https://cmgtrack.com/api/v1/auth/token \
  -d "username=admin@cmg.es&password=<password>" \
  -H "Content-Type: application/x-www-form-urlencoded" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Crear tipo de prueba
curl -s -X POST https://cmgtrack.com/api/v1/vehicle-types \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","slug":"test_tipo"}' | python3 -m json.tool
```

Resultado esperado: JSON con `id`, `name`, `slug`, `sensor_schema: []`

- [ ] **Paso 6: Commit**

```bash
git add backend/app/schemas/vehicle.py backend/app/api/v1/vehicles.py
git commit -m "feat: add POST/PATCH /vehicle-types endpoints for CMG admin"
```

---

## Task 3: Frontend — extender SensorDef con bit_index

**Files:**
- Modify: `frontend/src/lib/types.ts` (líneas 80–94)

- [ ] **Paso 1: Añadir bit_index a SensorDef**

En `frontend/src/lib/types.ts`, localizar la interfaz `SensorDef` (línea ~80). Reemplazar el bloque completo por:

```typescript
export interface SensorDef {
  key: string
  label: string
  unit: string | null
  min?: number
  max?: number
  gauge_type: 'circular' | 'linear' | 'battery' | 'numeric' | 'led'
  warn_above?: number
  alert_above?: number
  warn_below?: number
  alert_below?: number
  avl_id?: number
  scale?: number
  kpi_key?: string
  bit_index?: number
}
```

- [ ] **Paso 2: Verificar que TypeScript compila**

```bash
cd /opt/cmg-telematic1/frontend
npx tsc --noEmit 2>&1 | head -20
```

Resultado esperado: sin errores (o solo errores preexistentes no relacionados con SensorDef).

- [ ] **Paso 3: Commit**

```bash
git add frontend/src/lib/types.ts
git commit -m "feat: add bit_index to SensorDef for 1-byte bit extraction"
```

---

## Task 4: CAN Scanner — AVL_NAMES completo + resolución de etiquetas

**Files:**
- Modify: `frontend/src/features/diagnostics/CanScannerPage.tsx`

- [ ] **Paso 1: Completar AVL_NAMES con IDs estándar que faltan**

En `CanScannerPage.tsx`, reemplazar el bloque `const AVL_NAMES` (líneas 9–33) completo por:

```typescript
const AVL_NAMES: Record<string, { name: string; unit: string }> = {
  avl_1:   { name: 'DIN 1', unit: '0/1' },
  avl_2:   { name: 'DIN 2', unit: '0/1' },
  avl_3:   { name: 'DIN 3', unit: '0/1' },
  avl_4:   { name: 'DIN 4', unit: '0/1' },
  avl_6:   { name: 'Dallas Temp 5', unit: '°C ×0.1' },
  avl_8:   { name: 'Dallas Temp 6', unit: '°C ×0.1' },
  avl_9:   { name: 'AIN 1', unit: 'V ×0.001' },
  avl_10:  { name: 'AIN 2', unit: 'V ×0.001' },
  avl_11:  { name: 'AIN 3', unit: 'V ×0.001' },
  avl_14:  { name: 'Engine Worktime', unit: 'min' },
  avl_16:  { name: 'Total Mileage (counted)', unit: 'm' },
  avl_17:  { name: 'Fuel Consumed (counted)', unit: 'L ×0.1' },
  avl_18:  { name: 'Fuel Rate', unit: 'L/h ×0.1' },
  avl_19:  { name: 'AdBlue Level', unit: '%' },
  avl_20:  { name: 'AdBlue Level', unit: 'L ×0.1' },
  avl_21:  { name: 'GSM Signal', unit: '0–5' },
  avl_23:  { name: 'Engine Load', unit: '%' },
  avl_24:  { name: 'Speed (CAN)', unit: 'km/h' },
  avl_25:  { name: 'Engine Temp', unit: '°C ×0.1' },
  avl_30:  { name: 'Vehicle Speed', unit: 'km/h' },
  avl_31:  { name: 'Accelerator Pedal', unit: '%' },
  avl_33:  { name: 'Fuel Consumed', unit: 'L ×0.1' },
  avl_34:  { name: 'Fuel Level', unit: 'L ×0.1' },
  avl_35:  { name: 'Engine RPM', unit: 'rpm' },
  avl_36:  { name: 'Total Mileage', unit: 'm' },
  avl_37:  { name: 'Fuel Level', unit: '%' },
  avl_66:  { name: 'External Voltage', unit: 'mV' },
  avl_67:  { name: 'Battery Voltage', unit: 'mV' },
  avl_68:  { name: 'Battery Current', unit: 'mA' },
  avl_70:  { name: 'PCB Temperature', unit: '°C ×0.1' },
  avl_71:  { name: 'GNSS Status', unit: '0–5' },
  avl_72:  { name: 'Dallas Temp 1', unit: '°C ×0.1' },
  avl_73:  { name: 'Dallas Temp 2', unit: '°C ×0.1' },
  avl_74:  { name: 'Dallas Temp 3', unit: '°C ×0.1' },
  avl_75:  { name: 'Dallas Temp 4', unit: '°C ×0.1' },
  avl_78:  { name: 'iButton', unit: '' },
  avl_79:  { name: 'Brake Switch', unit: '0/1' },
  avl_80:  { name: 'Wheel Speed (CAN)', unit: 'km/h' },
  avl_81:  { name: 'Cruise Control', unit: '0/1' },
  avl_82:  { name: 'Clutch Switch', unit: '0/1' },
  avl_83:  { name: 'PTO State (alt)', unit: '0/1' },
  avl_84:  { name: 'Accel. Pedal Pos.', unit: '%' },
  avl_85:  { name: 'Engine Load', unit: '%' },
  avl_86:  { name: 'Total Fuel Used', unit: 'L' },
  avl_87:  { name: 'Fuel Level (J1939)', unit: '%' },
  avl_88:  { name: 'Engine RPM (J1939)', unit: 'rpm' },
  avl_104: { name: 'Engine Hours', unit: 'h' },
  avl_113: { name: 'Service Distance', unit: 'km' },
  avl_127: { name: 'Coolant Temp', unit: '°C' },
  avl_135: { name: 'Fuel Rate (J1939)', unit: 'L/h' },
  avl_139: { name: 'Gross Weight', unit: 'kg' },
  avl_176: { name: 'DTC Errors Count', unit: '' },
  avl_179: { name: 'PTO State', unit: '0/1' },
  avl_180: { name: 'Digital Output 2', unit: '0/1' },
  avl_181: { name: 'GNSS PDOP', unit: '×0.1' },
  avl_182: { name: 'GNSS HDOP', unit: '×0.1' },
  avl_199: { name: 'Trip Odometer', unit: 'm' },
  avl_200: { name: 'Sleep Mode', unit: '' },
  avl_205: { name: 'GSM Cell ID', unit: '' },
  avl_206: { name: 'GSM Area Code', unit: '' },
  avl_239: { name: 'Ignition', unit: '0/1' },
  avl_240: { name: 'Movement', unit: '0/1' },
  avl_245: { name: 'AIN 4', unit: 'V ×0.001' },
}
```

- [ ] **Paso 2: Actualizar imports del componente**

Al principio de `CanScannerPage.tsx`, la línea de imports de tipos:

```typescript
import type { TenantOut, VehicleOut, VehicleTypeOut, SensorDef } from '../../lib/types'
```

Y añadir import de queryKeys si no está:

```typescript
import { queryKeys } from '../../lib/queryKeys'
```

- [ ] **Paso 3: Añadir funciones auxiliares de resolución**

Justo antes de `interface CanRecord` (línea ~35), añadir:

```typescript
type ResolvedSensor = {
  label: string
  unit: string
  value: number
  isBit: boolean
  source: 'custom' | 'std' | 'raw'
}

function resolveDisplayItems(
  key: string,
  raw: number,
  sensorsByAvlId: Record<number, SensorDef[]>
): ResolvedSensor[] {
  const avlNum = parseInt(key.replace('avl_', ''))
  const customs = sensorsByAvlId[avlNum]
  if (customs?.length) {
    return customs.map(def => ({
      label: def.label,
      unit: def.unit ?? '',
      value: def.bit_index !== undefined ? (raw >> def.bit_index) & 1 : (def.scale !== undefined ? raw * def.scale : raw),
      isBit: def.bit_index !== undefined,
      source: 'custom' as const,
    }))
  }
  const std = AVL_NAMES[key]
  if (std) return [{ label: std.name, unit: std.unit, value: raw, isBit: false, source: 'std' as const }]
  return [{ label: key.toUpperCase(), unit: '', value: raw, isBit: false, source: 'raw' as const }]
}

function resolveColumnHeader(key: string, sensorsByAvlId: Record<number, SensorDef[]>): string {
  const avlNum = parseInt(key.replace('avl_', ''))
  const customs = sensorsByAvlId[avlNum]
  if (customs?.length === 1) return customs[0].label
  if (customs?.length) return `${customs[0].label} (+${customs.length - 1})`
  return AVL_NAMES[key]?.name ?? key
}
```

- [ ] **Paso 4: Añadir query de vehicle types y memo sensorsByAvlId**

Dentro del componente `CanScannerPage`, después del query de `vehicles` (línea ~78), añadir:

```typescript
const { data: vehicleTypes = [] } = useQuery<VehicleTypeOut[]>({
  queryKey: queryKeys.vehicleTypes(),
  queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
  staleTime: 60_000,
})

const selectedVehicle = vehicles.find(v => v.id === vehicleId)
const vehicleType = vehicleTypes.find(vt => vt.id === selectedVehicle?.vehicle_type_id)

const sensorsByAvlId = useMemo((): Record<number, SensorDef[]> => {
  const map: Record<number, SensorDef[]> = {}
  for (const s of (vehicleType?.sensor_schema ?? [])) {
    if (s.avl_id === undefined) continue
    if (!map[s.avl_id]) map[s.avl_id] = []
    map[s.avl_id].push(s as SensorDef)
  }
  return map
}, [vehicleType])
```

Añadir también `useMemo` al import de React al inicio si no está: `import { useState, useEffect, useRef, useMemo } from 'react'`

- [ ] **Paso 5: Actualizar la grid de datos live**

En el bloque `{/* CAN data grid */}` (línea ~239), reemplazar el interior del `allCanKeys.map(key => { ... })` por:

```typescript
{allCanKeys.map(key => {
  const raw = latest.can_data[key]
  const items = raw !== undefined ? resolveDisplayItems(key, raw, sensorsByAvlId) : []
  return items.map((item, itemIdx) => (
    <div key={`${key}-${itemIdx}`} style={{
      background: 'var(--bg-elevated)',
      border: `1px solid ${raw !== undefined
        ? item.source === 'custom' ? 'var(--accent-energy)'
        : item.source === 'std' ? 'var(--bg-border)'
        : 'var(--bg-border)'
        : 'var(--bg-border)'}`,
      borderRadius: 6,
      padding: '7px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{
          fontSize: 11, fontWeight: 600,
          color: item.source === 'custom' ? 'var(--accent-energy)'
               : item.source === 'std' ? 'var(--text-primary, #E7E5E4)'
               : 'var(--accent-off)',
        }}>
          {item.label}
        </span>
        <span style={{ fontSize: 10, color: 'var(--accent-off)', fontFamily: 'var(--font-data)' }}>
          {key}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {item.isBit ? (
          <span style={{
            fontSize: 12, fontWeight: 700,
            color: item.value === 1 ? 'var(--accent-ok)' : 'var(--accent-off)',
            fontFamily: 'var(--font-data)',
          }}>
            {item.value === 1 ? '● ON' : '○ OFF'}
          </span>
        ) : (
          <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-data)', color: 'var(--text-primary, #E7E5E4)' }}>
            {raw !== undefined ? item.value.toFixed(item.value % 1 !== 0 ? 2 : 0) : '—'}
          </span>
        )}
        {item.unit && <span style={{ fontSize: 10, color: 'var(--accent-off)' }}>{item.unit}</span>}
      </div>
    </div>
  ))
})}
```

- [ ] **Paso 6: Actualizar cabeceras de la tabla de histórico**

En el `<thead>` de la tabla (línea ~297), reemplazar las `<th>` de `allCanKeys`:

```typescript
{allCanKeys.map(k => (
  <th key={k} style={th} title={k}>
    {resolveColumnHeader(k, sensorsByAvlId)}
  </th>
))}
```

- [ ] **Paso 7: Actualizar el CSV export**

En la función `handleExport` (línea ~108), reemplazar:

```typescript
for (const key of allCanKeys) {
  const meta = AVL_NAMES[key]
  const header = meta ? `${meta.name} (${key})` : key
  row[header] = r.can_data[key] ?? null
}
```

Por:

```typescript
for (const key of allCanKeys) {
  const raw = r.can_data[key] ?? null
  const items = raw !== null ? resolveDisplayItems(key, raw, sensorsByAvlId) : []
  if (items.length <= 1) {
    const header = items[0]?.label ? `${items[0].label} (${key})` : key
    row[header] = items[0]?.isBit ? (items[0].value === 1 ? 'ON' : 'OFF') : (raw ?? null)
  } else {
    for (const item of items) {
      row[`${item.label} (${key})`] = item.isBit ? (item.value === 1 ? 'ON' : 'OFF') : item.value
    }
  }
}
```

- [ ] **Paso 8: Verificar TypeScript**

```bash
cd /opt/cmg-telematic1/frontend
npx tsc --noEmit 2>&1 | head -30
```

Sin errores nuevos.

- [ ] **Paso 9: Commit**

```bash
git add frontend/src/features/diagnostics/CanScannerPage.tsx
git commit -m "feat: complete AVL_NAMES + custom label resolution + bit extraction in CAN Scanner"
```

---

## Task 5: Frontend — VehicleTypesPage

**Files:**
- Create: `frontend/src/features/vehicles/VehicleTypesPage.tsx`

- [ ] **Paso 1: Crear el fichero**

Crear `frontend/src/features/vehicles/VehicleTypesPage.tsx` con el contenido completo:

```typescript
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { queryKeys } from '../../lib/queryKeys'
import type { VehicleTypeOut, SensorDef } from '../../lib/types'

// ── Form state types ───────────────────────────────────────────────────────

type TypeFormState = { name: string; slug: string }
const emptyTypeForm: TypeFormState = { name: '', slug: '' }

type SensorFormState = {
  avl_id: string; key: string; label: string; unit: string
  gauge_type: SensorDef['gauge_type']
  bit_index: string; scale: string; min: string; max: string
  warn_above: string; alert_above: string; warn_below: string; alert_below: string
}
const emptySensorForm: SensorFormState = {
  avl_id: '', key: '', label: '', unit: '', gauge_type: 'numeric',
  bit_index: '', scale: '', min: '', max: '',
  warn_above: '', alert_above: '', warn_below: '', alert_below: '',
}

function sensorDefToForm(def: SensorDef): SensorFormState {
  return {
    avl_id: def.avl_id?.toString() ?? '',
    key: def.key,
    label: def.label,
    unit: def.unit ?? '',
    gauge_type: def.gauge_type,
    bit_index: def.bit_index?.toString() ?? '',
    scale: def.scale?.toString() ?? '',
    min: def.min?.toString() ?? '',
    max: def.max?.toString() ?? '',
    warn_above: def.warn_above?.toString() ?? '',
    alert_above: def.alert_above?.toString() ?? '',
    warn_below: def.warn_below?.toString() ?? '',
    alert_below: def.alert_below?.toString() ?? '',
  }
}

function formToSensorDef(f: SensorFormState): SensorDef {
  const def: SensorDef = {
    avl_id: f.avl_id ? parseInt(f.avl_id) : undefined,
    key: f.key || f.label.toLowerCase().replace(/\s+/g, '_'),
    label: f.label,
    unit: f.unit || null,
    gauge_type: f.gauge_type,
  }
  if (f.gauge_type === 'led' && f.bit_index !== '') def.bit_index = parseInt(f.bit_index)
  if (f.gauge_type !== 'led' && f.scale !== '') def.scale = parseFloat(f.scale)
  if (['circular', 'linear'].includes(f.gauge_type)) {
    if (f.min !== '') def.min = parseFloat(f.min)
    if (f.max !== '') def.max = parseFloat(f.max)
  }
  if (f.gauge_type !== 'led') {
    if (f.warn_above !== '') def.warn_above = parseFloat(f.warn_above)
    if (f.alert_above !== '') def.alert_above = parseFloat(f.alert_above)
    if (f.warn_below !== '') def.warn_below = parseFloat(f.warn_below)
    if (f.alert_below !== '') def.alert_below = parseFloat(f.alert_below)
  }
  return def
}

// ── Shared styles ──────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--bg-border)',
  color: 'var(--text-primary, #E7E5E4)',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--accent-off)',
  fontWeight: 600,
  letterSpacing: '0.04em',
  marginBottom: 4,
  display: 'block',
}

const btnPrimary: React.CSSProperties = {
  background: 'var(--accent-energy)',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '7px 16px',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 600,
}

const btnSecondary: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary, #E7E5E4)',
  border: '1px solid var(--bg-border)',
  borderRadius: 6,
  padding: '7px 16px',
  fontSize: 13,
  cursor: 'pointer',
}

const GAUGE_TYPES: SensorDef['gauge_type'][] = ['circular', 'linear', 'battery', 'numeric', 'led']

// ── Component ──────────────────────────────────────────────────────────────

export default function VehicleTypesPage() {
  const qc = useQueryClient()

  const { data: vehicleTypes = [], isLoading } = useQuery<VehicleTypeOut[]>({
    queryKey: queryKeys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: 30_000,
  })

  const [selectedTypeId, setSelectedTypeId] = useState<string>('')
  const selectedType = vehicleTypes.find(vt => vt.id === selectedTypeId) ?? vehicleTypes[0]

  // ── Type modal state ──────────────────────────────────────────────────────
  const [showTypeModal, setShowTypeModal] = useState(false)
  const [editingType, setEditingType] = useState<VehicleTypeOut | null>(null)
  const [typeForm, setTypeForm] = useState<TypeFormState>(emptyTypeForm)

  function openNewType() {
    setEditingType(null)
    setTypeForm(emptyTypeForm)
    setShowTypeModal(true)
  }

  function openEditType(vt: VehicleTypeOut) {
    setEditingType(vt)
    setTypeForm({ name: vt.name, slug: vt.slug })
    setShowTypeModal(true)
  }

  const createTypeMutation = useMutation({
    mutationFn: (body: { name: string; slug: string }) =>
      apiClient.post<VehicleTypeOut>('/api/v1/vehicle-types', body),
    onSuccess: (newType) => {
      qc.invalidateQueries({ queryKey: queryKeys.vehicleTypes() })
      setSelectedTypeId(newType.id)
      setShowTypeModal(false)
    },
  })

  const updateTypeMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; slug?: string } }) =>
      apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.vehicleTypes() })
      setShowTypeModal(false)
    },
  })

  function saveType() {
    if (!typeForm.name.trim() || !typeForm.slug.trim()) return
    if (editingType) {
      updateTypeMutation.mutate({ id: editingType.id, body: typeForm })
    } else {
      createTypeMutation.mutate(typeForm)
    }
  }

  // ── Sensor modal state ────────────────────────────────────────────────────
  const [showSensorModal, setShowSensorModal] = useState(false)
  const [editingSensorIdx, setEditingSensorIdx] = useState<number | null>(null)
  const [sensorForm, setSensorForm] = useState<SensorFormState>(emptySensorForm)

  function openNewSensor() {
    setEditingSensorIdx(null)
    setSensorForm(emptySensorForm)
    setShowSensorModal(true)
  }

  function openEditSensor(def: SensorDef, idx: number) {
    setEditingSensorIdx(idx)
    setSensorForm(sensorDefToForm(def))
    setShowSensorModal(true)
  }

  const updateSchemaMutation = useMutation({
    mutationFn: ({ typeId, schema }: { typeId: string; schema: SensorDef[] }) =>
      apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${typeId}/sensor-schema`, { sensor_schema: schema }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.vehicleTypes() })
      setShowSensorModal(false)
    },
  })

  function saveSensor() {
    if (!selectedType || !sensorForm.label.trim()) return
    const def = formToSensorDef(sensorForm)
    const current = selectedType.sensor_schema as SensorDef[]
    let next: SensorDef[]
    if (editingSensorIdx === null) {
      next = [...current, def]
    } else {
      next = current.map((s, i) => i === editingSensorIdx ? def : s)
    }
    updateSchemaMutation.mutate({ typeId: selectedType.id, schema: next })
  }

  function deleteSensor(idx: number) {
    if (!selectedType) return
    const current = selectedType.sensor_schema as SensorDef[]
    updateSchemaMutation.mutate({
      typeId: selectedType.id,
      schema: current.filter((_, i) => i !== idx),
    })
  }

  const typeError = createTypeMutation.error?.message ?? updateTypeMutation.error?.message ?? null
  const sensorError = updateSchemaMutation.error?.message ?? null

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Shell title="Tipos de Vehículo">
      <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

        {/* Left panel — type list */}
        <div style={{
          width: 220, flexShrink: 0,
          borderRight: '1px solid var(--bg-border)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-surface)',
        }}>
          <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--bg-border)' }}>
            <button style={{ ...btnPrimary, width: '100%', fontSize: 12 }} onClick={openNewType}>
              + Nuevo tipo
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {isLoading && <div style={{ padding: '12px', fontSize: 12, color: 'var(--accent-off)' }}>Cargando…</div>}
            {vehicleTypes.map(vt => (
              <div
                key={vt.id}
                onClick={() => setSelectedTypeId(vt.id)}
                style={{
                  padding: '8px 14px',
                  cursor: 'pointer',
                  fontSize: 13,
                  color: (selectedType?.id === vt.id) ? 'var(--accent-energy)' : 'var(--text-primary, #E7E5E4)',
                  background: (selectedType?.id === vt.id) ? 'color-mix(in srgb, var(--accent-energy) 10%, transparent)' : 'transparent',
                  borderLeft: (selectedType?.id === vt.id) ? '2px solid var(--accent-energy)' : '2px solid transparent',
                }}
              >
                <div style={{ fontWeight: 600 }}>{vt.name}</div>
                <div style={{ fontSize: 10, color: 'var(--accent-off)', marginTop: 2, fontFamily: 'var(--font-data)' }}>{vt.slug}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel — sensors */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!selectedType ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-off)', fontSize: 13 }}>
              Selecciona un tipo de vehículo
            </div>
          ) : (
            <>
              {/* Type header */}
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--bg-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary, #E7E5E4)' }}>{selectedType.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--accent-off)', fontFamily: 'var(--font-data)', marginTop: 2 }}>slug: {selectedType.slug}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={btnSecondary} onClick={() => openEditType(selectedType)}>Editar tipo</button>
                  <button style={btnPrimary} onClick={openNewSensor}>+ Añadir sensor</button>
                </div>
              </div>

              {/* Sensor table */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
                {(selectedType.sensor_schema as SensorDef[]).length === 0 ? (
                  <div style={{ color: 'var(--accent-off)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>
                    No hay sensores configurados. Pulsa "+ Añadir sensor" para mapear un AVL ID.
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-elevated)' }}>
                        {['AVL ID', 'Nombre', 'Unidad', 'Gauge', 'Bit / Scale', 'Key', ''].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '7px 10px', color: 'var(--accent-off)', fontWeight: 600, borderBottom: '1px solid var(--bg-border)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedType.sensor_schema as SensorDef[]).map((def, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--bg-elevated)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-data)', color: 'var(--accent-energy)' }}>
                            {def.avl_id !== undefined ? `avl_${def.avl_id}` : '—'}
                          </td>
                          <td style={{ padding: '6px 10px', color: 'var(--text-primary, #E7E5E4)', fontWeight: 600 }}>{def.label}</td>
                          <td style={{ padding: '6px 10px', color: 'var(--accent-off)' }}>{def.unit ?? '—'}</td>
                          <td style={{ padding: '6px 10px', color: 'var(--accent-off)' }}>{def.gauge_type}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-data)', color: 'var(--accent-info, #38BDF8)' }}>
                            {def.bit_index !== undefined ? `bit ${def.bit_index}` : def.scale !== undefined ? `×${def.scale}` : '—'}
                          </td>
                          <td style={{ padding: '6px 10px', color: 'var(--accent-off)', fontFamily: 'var(--font-data)', fontSize: 11 }}>{def.key}</td>
                          <td style={{ padding: '6px 10px', display: 'flex', gap: 6 }}>
                            <button
                              onClick={() => openEditSensor(def, idx)}
                              style={{ ...btnSecondary, padding: '3px 10px', fontSize: 11 }}
                            >✎</button>
                            <button
                              onClick={() => deleteSensor(idx)}
                              style={{ ...btnSecondary, padding: '3px 10px', fontSize: 11, color: 'var(--accent-crit, #EF4444)' }}
                            >✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Modal: Tipo ─────────────────────────────────────────────── */}
      {showTypeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 10, padding: 24, width: 360, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary, #E7E5E4)' }}>
              {editingType ? 'Editar tipo de vehículo' : 'Nuevo tipo de vehículo'}
            </div>
            <div>
              <label style={labelStyle}>NOMBRE</label>
              <input style={inputStyle} value={typeForm.name} onChange={e => setTypeForm(f => ({ ...f, name: e.target.value }))} placeholder="Barredora Municipal" />
            </div>
            <div>
              <label style={labelStyle}>SLUG (identificador interno)</label>
              <input style={inputStyle} value={typeForm.slug} onChange={e => setTypeForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, '_') }))} placeholder="barredora_municipal" />
            </div>
            {typeError && <div style={{ fontSize: 12, color: 'var(--accent-crit, #EF4444)' }}>{typeError}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => setShowTypeModal(false)}>Cancelar</button>
              <button style={btnPrimary} onClick={saveType} disabled={!typeForm.name.trim() || !typeForm.slug.trim()}>
                {editingType ? 'Guardar' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Sensor ───────────────────────────────────────────── */}
      {showSensorModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', padding: 20 }}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 10, padding: 24, width: 480, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary, #E7E5E4)' }}>
              {editingSensorIdx === null ? 'Nuevo sensor CAN' : 'Editar sensor CAN'}
            </div>

            {/* Row: AVL ID + Gauge type */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>AVL ID</label>
                <input type="number" min="1" max="65535" style={inputStyle} value={sensorForm.avl_id}
                  onChange={e => setSensorForm(f => ({ ...f, avl_id: e.target.value }))} placeholder="200" />
              </div>
              <div>
                <label style={labelStyle}>TIPO DE GAUGE</label>
                <select style={inputStyle} value={sensorForm.gauge_type}
                  onChange={e => setSensorForm(f => ({ ...f, gauge_type: e.target.value as SensorDef['gauge_type'], bit_index: '' }))}>
                  {GAUGE_TYPES.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>

            {/* Row: Nombre + Unidad */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>NOMBRE (label)</label>
                <input style={inputStyle} value={sensorForm.label}
                  onChange={e => setSensorForm(f => ({ ...f, label: e.target.value }))} placeholder="Presión Hidráulica" />
              </div>
              <div>
                <label style={labelStyle}>UNIDAD</label>
                <input style={inputStyle} value={sensorForm.unit}
                  onChange={e => setSensorForm(f => ({ ...f, unit: e.target.value }))} placeholder="bar" />
              </div>
            </div>

            {/* Key */}
            <div>
              <label style={labelStyle}>KEY (interno — se genera del nombre si se deja vacío)</label>
              <input style={inputStyle} value={sensorForm.key}
                onChange={e => setSensorForm(f => ({ ...f, key: e.target.value }))} placeholder="hydraulic_pressure" />
            </div>

            {/* Bit index (solo LED) */}
            {sensorForm.gauge_type === 'led' && (
              <div>
                <label style={labelStyle}>BIT INDEX (0–7) — bit del byte AVL a extraer</label>
                <input type="number" min="0" max="7" style={inputStyle} value={sensorForm.bit_index}
                  onChange={e => setSensorForm(f => ({ ...f, bit_index: e.target.value }))} placeholder="0" />
              </div>
            )}

            {/* Scale (no LED) */}
            {sensorForm.gauge_type !== 'led' && (
              <div>
                <label style={labelStyle}>MULTIPLICADOR (scale) — ej: 0.1 si el FMC650 envía ×10</label>
                <input type="number" step="any" style={inputStyle} value={sensorForm.scale}
                  onChange={e => setSensorForm(f => ({ ...f, scale: e.target.value }))} placeholder="1" />
              </div>
            )}

            {/* Min/Max (circular y linear) */}
            {['circular', 'linear'].includes(sensorForm.gauge_type) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>MÍNIMO</label>
                  <input type="number" step="any" style={inputStyle} value={sensorForm.min}
                    onChange={e => setSensorForm(f => ({ ...f, min: e.target.value }))} placeholder="0" />
                </div>
                <div>
                  <label style={labelStyle}>MÁXIMO</label>
                  <input type="number" step="any" style={inputStyle} value={sensorForm.max}
                    onChange={e => setSensorForm(f => ({ ...f, max: e.target.value }))} placeholder="300" />
                </div>
              </div>
            )}

            {/* Warn/Alert (no LED) */}
            {sensorForm.gauge_type !== 'led' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                {[
                  { key: 'warn_above', label: 'WARN >' },
                  { key: 'alert_above', label: 'ALERT >' },
                  { key: 'warn_below', label: 'WARN <' },
                  { key: 'alert_below', label: 'ALERT <' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label style={{ ...labelStyle, fontSize: 10 }}>{label}</label>
                    <input type="number" step="any" style={{ ...inputStyle, fontSize: 12 }}
                      value={(sensorForm as Record<string, string>)[key]}
                      onChange={e => setSensorForm(f => ({ ...f, [key]: e.target.value }))}
                      placeholder="—" />
                  </div>
                ))}
              </div>
            )}

            {sensorError && <div style={{ fontSize: 12, color: 'var(--accent-crit, #EF4444)' }}>{sensorError}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => setShowSensorModal(false)}>Cancelar</button>
              <button style={btnPrimary} onClick={saveSensor} disabled={!sensorForm.label.trim() || !sensorForm.avl_id}>
                {editingSensorIdx === null ? 'Añadir' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}
```

- [ ] **Paso 2: Verificar TypeScript**

```bash
cd /opt/cmg-telematic1/frontend
npx tsc --noEmit 2>&1 | head -30
```

Sin errores nuevos.

- [ ] **Paso 3: Commit**

```bash
git add frontend/src/features/vehicles/VehicleTypesPage.tsx
git commit -m "feat: add VehicleTypesPage with full sensor CRUD and bit_index support"
```

---

## Task 6: Frontend — routing + sidebar

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/shared/ui/Sidebar.tsx`

- [ ] **Paso 1: Añadir import lazy en App.tsx**

En `frontend/src/App.tsx`, después de la línea `const VehiclesPage = lazy(...)` (línea ~21), añadir:

```typescript
const VehicleTypesPage = lazy(() => import('./features/vehicles/VehicleTypesPage'))
```

- [ ] **Paso 2: Añadir ruta en App.tsx**

Dentro del bloque `<Routes>` (después de la ruta `vehiculos`, línea ~66), añadir:

```tsx
<Route path="tipos-vehiculo" element={<VehicleTypesPage />} />
```

- [ ] **Paso 3: Añadir NavLink en Sidebar.tsx**

En `frontend/src/shared/ui/Sidebar.tsx`, después del bloque `{isCmg && isAdmin && (<NavLink to="/vehiculos"...)}` (línea ~72–76), añadir:

```tsx
{isCmg && isAdmin && (
  <NavLink to="/tipos-vehiculo" title="Tipos de Vehículo" style={navLinkStyle}>
    <IconVehiculos width={20} height={20}/>
  </NavLink>
)}
```

- [ ] **Paso 4: Verificar TypeScript**

```bash
cd /opt/cmg-telematic1/frontend
npx tsc --noEmit 2>&1 | head -20
```

Sin errores nuevos.

- [ ] **Paso 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/shared/ui/Sidebar.tsx
git commit -m "feat: add /tipos-vehiculo route and sidebar link"
```

---

## Task 7: Deploy frontend

- [ ] **Paso 1: Rebuild y redeploy frontend**

```bash
cd /opt/cmg-telematic1
docker-compose build frontend && docker-compose up -d frontend
```

- [ ] **Paso 2: Verificar que el contenedor arranca**

```bash
docker-compose logs frontend --tail=20
```

Sin errores de build.

- [ ] **Paso 3: Smoke test en producción**

```bash
# Verificar que la URL responde
curl -s -o /dev/null -w "%{http_code}" https://cmgtrack.com
```

Resultado esperado: `200`

- [ ] **Paso 4: Verificar flujo completo en el portal**

1. Ir a https://cmgtrack.com — login como admin@cmg.es
2. En el sidebar aparece el nuevo icono "Tipos de Vehículo" (admin CMG)
3. Navegar a `/tipos-vehiculo` → se ven los tipos existentes
4. Crear un tipo nuevo → aparece en la lista
5. Seleccionar el tipo → botón "+ Añadir sensor"
6. Añadir sensor con `gauge_type: led` → aparece campo "Bit index"
7. Añadir sensor con `gauge_type: circular` → no aparece Bit index, sí aparece Scale y Min/Max
8. En CAN Scanner → seleccionar vehículo de ese tipo → AVL_21 muestra "GSM Signal" en lugar de "avl_21"
9. Los sensores personalizados aparecen con borde naranja en la grid

---

## Notas de implementación

- **Sin migración de BD**: el campo `bit_index` se guarda en el JSONB `sensor_schema` existente. No requiere `alembic revision`.
- **Múltiples sensores por AVL ID**: si el tipo tiene 3 sensores con `avl_id: 202` (bits 0, 1, 2), el CAN Scanner muestra 3 tarjetas separadas para ese byte, cada una con su ON/OFF.
- **El icono de "Tipos de Vehículo" reutiliza `IconVehiculos`**: ambas páginas son de gestión de vehículos, es coherente.
