# Work Cycle Definitions UI — Design Spec
Date: 2026-04-25

## Objetivo

Permitir a los administradores CMG crear, editar, borrar y activar/desactivar definiciones de ciclos de trabajo desde la página Tipos de Vehículo, sin necesidad de tocar la base de datos directamente.

## Componentes afectados

| Fichero | Acción |
|---|---|
| `frontend/src/features/vehicles/WorkCycleDefsSection.tsx` | Crear nuevo |
| `frontend/src/features/vehicles/VehicleTypesPage.tsx` | Añadir sección al panel derecho |

El backend no requiere cambios — todos los endpoints necesarios ya existen:
- `GET /api/v1/work-cycles/definitions?vehicle_type_id=<id>`
- `POST /api/v1/work-cycles/definitions`
- `PATCH /api/v1/work-cycles/definitions/<id>`
- `DELETE /api/v1/work-cycles/definitions/<id>`

## WorkCycleDefsSection.tsx

### Props

```ts
interface Props {
  typeId: string
  sensorSchema: SensorDef[]
}
```

`sensorSchema` viene de `selectedType.sensor_schema` en VehicleTypesPage, ya disponible.

### Tabla de definiciones

Columnas: **Nombre** | **Trigger** | **Config** | **Snapshot** | **Aggregate** | **Activo** | **Acciones**

- **Config**: resumen legible del trigger_config. Ej: `pto_active > 280`, `gap ≥ 30s`
- **Snapshot / Aggregate**: número de campos (`3 campos`, `—` si vacío)
- **Activo**: botón toggle que llama PATCH `{ active: !d.active }`
- **Acciones**: botón ✎ (abre modal en modo edición) + botón ✕ (DELETE sin modal de confirmación, mismo patrón que sensores/DOUT)

### Modal crear/editar

Un único modal reutilizable para crear y editar. Al abrir en modo edición, todos los campos se pre-rellenan con los valores actuales.

**Campos en orden:**

1. **Nombre** — `<input type="text">` requerido

2. **Tipo de trigger** — `<select>` con 4 opciones:
   - `pto_change` → "PTO activo"
   - `ignition_period` → "Período de ignición"
   - `threshold_exceeded` → "Umbral superado"
   - `sensor_pulse` → "Pulso de sensor"

3. **Config del trigger** — condicional:
   - `pto_change` / `ignition_period`: sin campos extra
   - `threshold_exceeded`:
     - Sensor: `<select>` con claves del sensorSchema + opción "Otro…" que muestra `<input>` manual
     - Operador: `<select>` con `>`, `>=`, `<`, `<=`
     - Umbral: `<input type="number">`
   - `sensor_pulse`:
     - Sensor: `<select>` con claves del sensorSchema + opción "Otro…" + `<input>` manual
     - Separación mínima (segundos): `<input type="number">` (default 30)

4. **Snapshot fields** — campos de los que captura valor al inicio y fin del ciclo:
   - Checkboxes con las claves del sensorSchema (ej. `hydraulic_pressure`, `pto_active`)
   - Input de texto libre para claves adicionales separadas por coma

5. **Aggregate fields** — campos de los que calcula suma/media/máx durante el ciclo:
   - Misma estructura que snapshot fields

**Acciones del modal**: Cancelar | Crear / Guardar (deshabilitado mientras isPending)

### Estado del formulario

```ts
type CycleDefForm = {
  name: string
  trigger_type: string
  sensor: string          // para threshold_exceeded y sensor_pulse
  sensorCustom: string    // input manual si no está en schema
  op: string              // para threshold_exceeded
  threshold: string       // para threshold_exceeded
  min_gap: string         // para sensor_pulse
  snapshotChecked: Set<string>   // claves del schema seleccionadas
  snapshotCustom: string         // texto libre, coma-separado
  aggregateChecked: Set<string>
  aggregateCustom: string
}
```

Al hacer submit, construye el payload:
- `trigger_config`: objeto con los campos relevantes según trigger_type
- `snapshot_fields`: union de snapshotChecked + snapshotCustom.split(',').map(trim).filter(Boolean)
- `aggregate_fields`: igual

## Integración en VehicleTypesPage.tsx

Añadir import y renderizar `<WorkCycleDefsSection>` como una sección más en el panel derecho, dentro del bloque `user?.tenant_tier === 'cmg' && user?.role === 'admin'`, después de la sección DOUT y antes de Reglas de alerta:

```tsx
{user?.tenant_tier === 'cmg' && user?.role === 'admin' && selectedType && (
  <WorkCycleDefsSection
    typeId={selectedType.id}
    sensorSchema={selectedType.sensor_schema as SensorDef[]}
  />
)}
```

## Estilos

Reutilizar los tokens y estilos existentes de VehicleTypesPage: `btnPrimary`, `btnSecondary`, `inputStyle`, `labelStyle`. La sección sigue el mismo patrón visual que las otras secciones (título uppercase en `var(--text-muted)` + botón "+ Añadir" a la derecha).

## Comportamiento de invalidación de caché

- Tras crear/editar/borrar/toggle: `queryClient.invalidateQueries({ queryKey: ['work-cycle-definitions', typeId] })`
- La pestaña CICLOS del VehicleDetailPage también usa `keys.workCycleDefinitions(vehicleTypeId)`, por lo que se actualizará automáticamente.

## Lo que NO hace esta UI

- No permite recalcular ciclos (eso está en la pestaña CICLOS del detalle de vehículo)
- No modifica la sección de Settings (WorkCycleDefinitionsSection) — sigue existiendo como vista global de solo lectura/toggle para CMG
