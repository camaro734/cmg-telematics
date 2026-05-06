# Mejoras: Estados Visuales de Flota

## Fecha: 2026-04-30

## Problema resuelto

- Contador "Activos" no filtraba por `last_seen` — usaba solo el campo `online` de Redis (que puede quedar obsoleto indefinidamente)
- Todos los vehículos tenían el mismo aspecto visual independientemente de su estado real
- Sin distinción entre en movimiento, parado con motor, y sin conexión

---

## 4 estados implementados

| Estado     | Color  | Condición                                                                 |
|------------|--------|---------------------------------------------------------------------------|
| `moving`   | Verde  | `isEffectivelyOnline` AND `speed_kmh > 2`                                 |
| `idle`     | Amarillo | `isEffectivelyOnline` AND `speed_kmh <= 2`                              |
| `offline`  | Gris   | `online=false` OR `(now - last_seen) > 5 minutos`                        |
| `alert`    | Rojo   | `isEffectivelyOnline` AND hay alertas firing para ese vehículo            |

La función `isEffectivelyOnline(status)` es la fuente de verdad: requiere `online=true` Y `last_seen` dentro de los últimos 5 minutos.

---

## Archivos modificados

### `VehicleCard.tsx`
- Nuevo tipo exportado `VehicleState = 'moving' | 'idle' | 'offline' | 'alert'`
- Nuevo componente `StateDot`: punto de color con anillo pulsante para estados activos (CSS `@keyframes cmg-card-pulse` inyectado una vez)
- Prop `vehicleState: VehicleState` añadida
- Desktop: dot movido a top-right con pulse; línea de estado debajo de la matrícula
- Mobile: reemplaza badge "Activo/Inactivo" por dot + texto contextual
- Textos contextuales:
  - `moving`: "35 km/h" en verde
  - `idle` + ignición: "Parado · motor ON" en amarillo
  - `idle` sin ignición: "Parado" en gris
  - `alert`: "⚠ Alerta" en rojo
  - `offline`: "Sin señal · 22h" en rojo
- Borde de la card refleja el estado (verde/amarillo/gris/rojo, naranja si seleccionada)

### `FleetDashboard.tsx`
- Añadida función `isEffectivelyOnline(status)` — fuente de verdad para online
- Añadida función `getVehicleState(vehicle, status, alerts)` que devuelve `VehicleState`
- Constante `STATE_ORDER` para ordenación: `alert=0, moving=1, idle=2, offline=3`
- `sortedVehicles`: lista ordenada por estado (alertas primero, luego en ruta, parados, offline)
- Contadores reemplazados:
  - Antes: `● Activos: N  ○ No activos: N`
  - Ahora: `● N en ruta  ◑ N parados  ○ N sin señal`
- Cabecera actualizada en ambas vistas (desktop y mobile)
- Prop `vehicleState` pasada a cada `VehicleCard`
- Prop `firingAlerts` pasada a `FleetMap`

### `FleetMap.tsx`
- Añadida función `isEffectivelyOnline(status)` — misma lógica de 5 minutos
- `makeMovingIcon()`: cambia de cyan (#38BDF8) a verde (#22C55E), sin parámetros
- `makeAlertIcon()`: nuevo — punto pulsante rojo (#EF4444)
- `makeOfflineIcon()`: nuevo — círculo gris SVG estático, sin animación
- `makeStoppedIcon(ignition)`: amarillo (#EAB308) si motor ON, naranja (#F97316) si OFF
- `makeVehicleIcon(status, hasAlert)`: despacha a los 4 iconos según estado
- Loop de marcadores: calcula `alertVehicleIds = new Set(...)` antes del loop
- Círculo de precisión GPS: solo aparece si `isEffectivelyOnline` (no solo `status.online`)
- `buildPopupHtml(vehicle, status, hasAlert)`: popup muestra estado correcto con emojis ⚫🔴🟢🟡
- Props: añadido `firingAlerts?: AlertInstanceOut[]`

---

## Validación

```
npx tsc -b --noEmit  →  Sin errores de TypeScript
```

El build de Vite falla por permisos en `dist/assets` (archivos de root generados dentro del contenedor Docker) — no relacionado con el código. Ejecutar desde dentro del contenedor: `docker exec cmg-frontend npm run build`.
