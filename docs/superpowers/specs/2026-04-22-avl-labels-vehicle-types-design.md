# Spec: Etiquetas AVL + Gestión de Tipos de Vehículo

**Fecha:** 2026-04-22
**Sprint objetivo:** 18

---

## Resumen

Dos capacidades relacionadas:

1. **Etiquetas AVL en CAN Scanner** — resolver AVL IDs a nombres legibles, combinando un diccionario estático de IDs estándar Teltonika con mapeos personalizados por tipo de vehículo (señales IFM/CAN propias de CMG).
2. **Página "Tipos de Vehículo"** — CRUD completo de tipos de vehículo y de sus sensores CAN personalizados, incluyendo extracción de bits individuales de bytes de estado.

---

## Problema actual

- El CAN Scanner muestra `avl_21`, `avl_200`, `avl_202` sin nombre ni unidad.
- AVL_21 = 5 es "GSM Signal" según la referencia Teltonika, pero no está en el diccionario estático.
- Los AVL IDs configurados en Teltonika Configurator para señales IFM (presiones hidráulicas, estados válvulas, caudales) son propietarios de CMG y no tienen nombre en ningún sitio.
- No hay UI para gestionar los tipos de vehículo ni sus sensores.

---

## Arquitectura de resolución de etiquetas

```
can_data: { "avl_200": 512, "avl_202": 13, "avl_21": 5 }
                    ↓
1. sensor_schema del vehicle_type  ← mapeos propios CMG (prioridad)
2. AVL_NAMES estático (frontend)   ← ~50 IDs estándar Teltonika
3. Raw key                         ← avl_200 (si no hay match)
```

La resolución ocurre en frontend. No requiere cambios en el pipeline de ingestión.

---

## Extensión del tipo `SensorDef`

Se añade `bit_index` al tipo existente en `frontend/src/lib/types.ts`:

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
  bit_index?: number   // NUEVO: extrae el bit N (0–7) del byte AVL
}
```

**Semántica de `bit_index`:**
- Solo válido cuando `gauge_type = 'led'`
- Extrae el bit N del valor entero: `(raw >> bit_index) & 1`
- Permite que un único AVL ID de 8 bits represente hasta 8 señales on/off independientes

**Ejemplo con AVL_202 = 0b00001101 (= 13):**
```
SensorDef { avl_id: 202, label: "Válvula Principal",  bit_index: 0 } → 1 (ON)
SensorDef { avl_id: 202, label: "Válvula Retorno",    bit_index: 1 } → 0 (OFF)
SensorDef { avl_id: 202, label: "PTO Activo",         bit_index: 2 } → 1 (ON)
SensorDef { avl_id: 202, label: "Bomba Alta Presión", bit_index: 3 } → 1 (ON)
```

**Lógica de resolución de valor:**
```typescript
function resolveValue(raw: number, def: SensorDef): number {
  if (def.bit_index !== undefined) return (raw >> def.bit_index) & 1
  if (def.scale !== undefined) return raw * def.scale
  return raw
}
```

---

## Backend — cambios necesarios

El endpoint `PATCH /vehicle-types/{type_id}/sensor-schema` ya existe y es suficiente para actualizar sensores.

Faltan dos endpoints para gestionar el tipo en sí:

### `POST /api/v1/vehicle-types`
- Solo CMG admin
- Body: `{ name: string, slug: string }`
- Devuelve `VehicleTypeOut`

### `PATCH /api/v1/vehicle-types/{type_id}`
- Solo CMG admin
- Body: `{ name?: string, slug?: string }`
- Devuelve `VehicleTypeOut`

**Schema Pydantic nuevo:**
```python
class VehicleTypeCreate(BaseModel):
    name: str
    slug: str

class VehicleTypeUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
```

No se necesita migración de base de datos — `sensor_schema` ya existe como JSONB y acepta el nuevo campo `bit_index` sin cambios en el schema SQL.

---

## Frontend — Página "Tipos de Vehículo"

**Ruta:** `/tipos-vehiculo`
**Acceso:** Solo `tenant_tier === 'cmg'` y `role === 'admin'`

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  Tipos de Vehículo                    [+ Nuevo tipo]    │
├──────────────────┬──────────────────────────────────────┤
│                  │  Barredora Municipal                  │
│ Barredora Mun. ← │  slug: barredora                     │
│ Cisterna Vacuum  │  ─────────────────────────────────── │
│ Camión Hidráulic │  Sensores CAN personalizados          │
│                  │  [+ Añadir sensor]                    │
│ [+ Nuevo tipo]   │                                       │
│                  │  AVL  Nombre           Unidad  Gauge  │
│                  │  200  Pres. Hidráulica bar     circ.  │
│                  │  202⁰ Válvula Principal —      led    │
│                  │  202¹ Válvula Retorno   —      led    │
│                  │  202² PTO Activo        —      led    │
└──────────────────┴──────────────────────────────────────┘
```

El superíndice (²) en la tabla indica `bit_index`.

### Modal "Nuevo tipo / Editar tipo"
Campos: Nombre (texto), Slug (texto, validado como snake_case)

### Modal "Nuevo sensor / Editar sensor"

| Campo | Control | Visible cuando |
|---|---|---|
| AVL ID | número (1–1000) | siempre |
| Key | texto | siempre |
| Nombre (label) | texto | siempre |
| Unidad | texto | siempre |
| Tipo de gauge | select: circular/linear/battery/numeric/led | siempre |
| Bit index (0–7) | número | solo si gauge_type = 'led' |
| Scale | número decimal | solo si gauge_type ≠ 'led' |
| Min / Max | números | solo si gauge_type ∈ {circular, linear} |
| Warn above / Alert above | números | solo si gauge_type ≠ 'led' |
| Warn below / Alert below | números | solo si gauge_type ≠ 'led' |

### Sidebar
Nueva entrada en sección Admin (solo CMG admin):
```tsx
<NavLink to="/tipos-vehiculo">
  <IconVehiculos /> Tipos de Vehículo
</NavLink>
```

### Route en App.tsx
```tsx
<Route path="/tipos-vehiculo" element={<VehicleTypesPage />} />
```

---

## Frontend — CAN Scanner (mejoras)

### Cambios en `CanScannerPage.tsx`

1. **Completar `AVL_NAMES`** — añadir los ~40 IDs estándar que faltan de la referencia FMC650:
   - `avl_21`: GSM Signal (0–5)
   - `avl_30`: Vehicle Speed (km/h)
   - `avl_35`: Engine RPM (rpm)
   - `avl_37`: Fuel Level % (%)
   - `avl_71`: GNSS Status (0–5)
   - `avl_72`–`avl_75`: Dallas Temp 1–4 (°C ×0.1)
   - `avl_181`, `avl_182`: GNSS PDOP/HDOP (×0.1)
   - `avl_199`: Trip Odometer (m)
   - y resto del catálogo estándar FMC650

2. **Cargar sensor_schema del vehículo seleccionado:**
   ```typescript
   const { data: vehicleTypes } = useQuery(['vehicle-types'], ...)
   const vehicleType = vehicleTypes?.find(vt => vt.id === selectedVehicle?.vehicle_type_id)
   const sensorsByAvlId = useMemo(() =>
     Object.fromEntries(
       (vehicleType?.sensor_schema ?? [])
         .filter(s => s.avl_id !== undefined)
         .map(s => [s.avl_id!, s])
     ), [vehicleType])
   ```

3. **Función de resolución:**
   ```typescript
   function resolveLabel(key: string, sensorsByAvlId: Record<number, SensorDef>) {
     const avlNum = parseInt(key.replace('avl_', ''))
     const custom = sensorsByAvlId[avlNum]
     if (custom) return { name: custom.label, unit: custom.unit ?? '', source: 'custom' }
     const std = AVL_NAMES[key]
     if (std) return { ...std, source: 'std' }
     return { name: key, unit: '', source: 'raw' }
   }

   function resolveValue(raw: number, def?: SensorDef): number {
     if (!def) return raw
     if (def.bit_index !== undefined) return (raw >> def.bit_index) & 1
     if (def.scale !== undefined) return raw * def.scale
     return raw
   }
   ```

4. **Tabla del scanner** — columna "Fuente":
   - `custom` → badge naranja (`--accent-energy`)
   - `std` → badge gris (`--accent-off`)
   - `raw` → sin badge

5. **Sensores de bit** — en la columna "Valor":
   - Si `bit_index` definido → badge `ON` (verde) / `OFF` (gris)
   - Si no → número con unidad

---

## Archivos a crear/modificar

| Archivo | Acción |
|---|---|
| `frontend/src/features/vehicles/VehicleTypesPage.tsx` | crear |
| `frontend/src/features/diagnostics/CanScannerPage.tsx` | modificar |
| `frontend/src/lib/types.ts` | modificar — añadir `bit_index` a SensorDef |
| `frontend/src/shared/ui/Sidebar.tsx` | modificar — añadir enlace |
| `frontend/src/App.tsx` | modificar — añadir ruta |
| `backend/app/api/v1/vehicles.py` | modificar — añadir POST y PATCH vehicle-types |
| `backend/app/schemas/vehicle.py` | modificar — añadir VehicleTypeCreate, VehicleTypeUpdate |

---

## Fuera de alcance

- No se modifica el pipeline de ingestión (ingest-svc)
- No se añade traducción/localización de labels
- No se implementa exportación del sensor_schema
- El campo `bit_index` no afecta a los gauges del VehicleDetailPage (se puede hacer en sprint posterior)
