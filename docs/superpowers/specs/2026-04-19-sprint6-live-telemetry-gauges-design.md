# Sprint 6 — Telemetría en vivo + Manómetros

## Objetivo

Activar el WebSocket de telemetría en tiempo real y construir un panel de manómetros SVG data-driven en la página de detalle de vehículo. Los gauges se renderizan a partir del `sensor_schema` del tipo de vehículo — sin hardcodear nada por cliente.

## Arquitectura

### Flujo de datos

```
Backend /ws/fleet (Redis Stream telemetry.raw)
  → wsClient.ts (reconexión automática)
  → queryClient.setQueryData('vehicles', id, 'status')
  → VehicleDetailPage re-render instantáneo

Polling REST /api/v1/vehicles/{id}/status (cada 30s)
  → heartbeat de consistencia
  → fallback automático si WS cae (polling cada 15s)
```

### Datos del sensor

Los sensores de cada tipo de vehículo se definen en `vehicle_type.sensor_schema` (JSONB). El frontend obtiene el schema con `GET /api/v1/vehicle-types` (endpoint ya existente) y renderiza el gauge correcto para cada sensor. Añadir un sensor nuevo = un INSERT en la tabla `vehicle_type` — sin tocar código frontend.

Estructura de cada sensor en `sensor_schema`:
```json
{
  "key": "hydraulic_pressure_1",
  "label": "Presión hidráulica 1",
  "unit": "bar",
  "min": 0,
  "max": 600,
  "gauge_type": "circular",
  "warn_above": 300,
  "alert_above": 400,
  "avl_id": 305
}
```

Campos soportados: `warn_above`, `alert_above`, `warn_below`, `alert_below` — para sensores que alertan tanto por exceso como por defecto.

### Datos CAN en Redis/BD

Los IO elements del Teltonika FMC650 se almacenan como `avl_{id}` en el JSONB `can_data`:
```json
{ "avl_305": 390, "avl_306": 530, "avl_308": 75.5 }
```

El frontend mapea `sensor.avl_id` → `can_data["avl_" + avl_id]` para obtener el valor en tiempo real.

---

## Tipos de vehículo y sensores

### Wasterent (vacuum-pressure)

| Sensor | AVL ID | Rango | Warn | Crit | Gauge |
|--------|--------|-------|------|------|-------|
| Presión hidráulica 1 | 305 | 0–600 bar | 300 | 400 | circular |
| Presión hidráulica 2 | 306 | 0–600 bar | 300 | 400 | circular |
| Temperatura hidráulica | 308 | 0–150 °C | 100 | 130 | circular |
| Presión retorno filtro | 309 | 0–20 bar | 6 | 10 | circular |
| Nivel aceite hidráulico | 307 | 0–100 % | — | — | linear (warn_below=20) |
| Ciclos vaciado contenedor | 310 | 0–9999 | — | — | numeric |
| Horas PTO hoy | — | acumulador | — | — | numeric |

### Vacuum/Pressure System (cistern)

| Sensor | AVL ID | Rango | Warn | Crit | Gauge |
|--------|--------|-------|------|------|-------|
| Presión agua | 331 | 0–250 bar | 200 | 230 | circular |
| Presión vacío | 332 | -1–10 bar | 8 | 9.5 | circular |
| Nivel agua cisterna | 330 | 0–100 % | — | — | linear (warn_below=10) |
| Horas bomba agua | 320 | acumulador | — | — | numeric |
| Horas depresor | 321 | acumulador | — | — | numeric |
| Horas PTO hoy | — | acumulador | — | — | numeric |

### Sensores comunes (todos los vehículos)

| Sensor | Fuente | Gauge |
|--------|--------|-------|
| Velocidad | `speed_kmh` | en cabecera |
| Ignición | `ignition` | LED en cabecera |
| PTO activo | `pto_active` | LED en cabecera |
| Batería | AVL 66 (`ext_voltage_mv` ÷ 1000) | battery (barra horizontal) |
| RPM motor | AVL 24 | circular (0–3000 rpm) |
| Temp. motor | AVL 70 | circular (0–120 °C, warn=90, crit=105) |

*Horas PTO hoy: suma de `pto_active_minutes` de `telemetry_1h` para el día actual. Se obtiene del endpoint `/api/v1/vehicles/{id}/kpis` — no es un AVL raw.

---

## Componentes frontend

### Gauges — `frontend/src/shared/ui/gauges/`

**`CircularGauge.tsx`**
- SVG 140×140, arco 270°, stroke 4px, strokeLinecap round
- Track: `--gauge-track` (gris oscuro)
- Valor: color dinámico — verde (`--accent-energy`) / amarillo (`--accent-warn`) / rojo (`--accent-crit`)
- Punto luminoso en el extremo del arco (`drop-shadow`)
- Centro: valor numérico + "/ max unidad"
- Label inferior: nombre del sensor en monospace pequeño
- Props: `value`, `min`, `max`, `warnAbove?`, `alertAbove?`, `warnBelow?`, `alertBelow?`, `unit`, `label`

**`BatteryGauge.tsx`**
- Barra horizontal estilo móvil (cuerpo + terminal positivo)
- Relleno: porcentaje del rango min–max, color dinámico
- Muestra voltaje en V y estado (OK / ADVERTENCIA / BAJA)
- Props: `value`, `min`, `max`, `warnBelow?`, `alertBelow?`, `label`

**`LinearGauge.tsx`**
- Barra vertical, relleno de abajo hacia arriba
- Línea de threshold visible si `warn_below` está definido
- Muestra porcentaje y estado
- Props: igual que BatteryGauge

**`NumericDisplay.tsx`**
- Tarjeta simple: número grande + unidad + label
- Sin lógica de color (contadores no tienen threshold)
- Props: `value`, `unit`, `label`

### `SensorGrid.tsx` — `frontend/src/features/vehicle/`

Recibe `sensorSchema: SensorDef[]` y `canData: Record<string, unknown>`. Para cada sensor del schema extrae el valor de `canData["avl_" + sensor.avl_id]` y renderiza el gauge correspondiente según `gauge_type`. Grid CSS `repeat(auto-fill, minmax(140px, 1fr))`.

### `VehicleDetailPage.tsx` — refactor con pestañas

```
<VehicleHeader/>          ← estado online, velocidad, ignición, PTO
<Tabs>
  <Tab label="EN VIVO">
    <div grid 2 columnas>
      <TrackMap/>           ← mapa recorrido hoy (ya existe)
      <SensorGrid/>         ← gauges data-driven
    </div>
  </Tab>
  <Tab label="HISTÓRICO">
    <KpiChart/>             ← gráficas Recharts últimas 24h
  </Tab>
</Tabs>
```

### `KpiChart.tsx` — `frontend/src/features/vehicle/`

- Recharts `ComposedChart` con `Line` + `Area`
- Datos: `GET /api/v1/vehicles/{id}/kpis` → `KpiHour[]`
- Gráficas: presión media, temperatura media, minutos PTO activo por hora
- Eje X: horas del día. Eje Y doble: presión (bar) a la izquierda, temperatura (°C) a la derecha
- Selector de rango: últimas 24h / 7 días / 30 días

### `wsClient.ts` — implementación real

```typescript
// Conecta a /ws/fleet?token=ACCESS_TOKEN
// Reconexión exponencial: 1s → 2s → 4s → max 30s
// onmessage: { type: "telemetry", data: VehicleStatus }
//   → queryClient.setQueryData(keys.vehicleStatus(vehicleId), data)
// onclose: inicia reconexión
// Limpieza: disconnect() en logout
```

La conexión se inicia en `RequireAuth` tras login. El `queryClient` se pasa al conectar.

---

## Cambios en datos (seed)

Actualizar `backend/app/seeds/initial.py` con los sensor_schema correctos para:
- `wasterent-vacuum` — sensores de Wasterent descritos arriba
- `vacuum-pressure` — sensores del Vacuum/Pressure System
- Copiar AVL IDs reales del proyecto anterior `/opt/cmg-telematics`

No hay cambios de schema en base de datos — `sensor_schema` ya es JSONB flexible.

---

## Testing

- `CircularGauge`: color correcto para valor OK / warn / crit / sin datos
- `BatteryGauge`: relleno proporcional, color por umbral
- `SensorGrid`: renderiza el gauge_type correcto para cada sensor del schema
- `wsClient`: reconexión tras close, no duplica conexiones, limpieza en logout
- `VehicleDetailPage`: muestra pestaña "En vivo" por defecto, cambia a "Histórico" sin re-fetch
- KPI chart: muestra "Sin datos" si no hay registros en el rango

---

## Archivos a crear / modificar

**Crear:**
- `frontend/src/shared/ui/gauges/CircularGauge.tsx`
- `frontend/src/shared/ui/gauges/BatteryGauge.tsx`
- `frontend/src/shared/ui/gauges/LinearGauge.tsx`
- `frontend/src/shared/ui/gauges/NumericDisplay.tsx`
- `frontend/src/shared/ui/Tabs.tsx`
- `frontend/src/features/vehicle/SensorGrid.tsx`
- `frontend/src/features/vehicle/KpiChart.tsx`

**Modificar:**
- `frontend/src/lib/wsClient.ts` — implementación real
- `frontend/src/lib/types.ts` — añadir `SensorDef`, `WsMessage`
- `frontend/src/features/auth/RequireAuth.tsx` — iniciar WS tras auth
- `frontend/src/features/vehicle/VehicleDetailPage.tsx` — pestañas + SensorGrid
- `frontend/src/features/vehicle/StatusPanel.tsx` — reemplazar por SensorGrid
- `backend/app/seeds/initial.py` — sensor_schema correctos con AVL IDs reales
