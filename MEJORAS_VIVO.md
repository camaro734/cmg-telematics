# Mejoras pantalla EN VIVO — SensorGrid

Archivo modificado: `frontend/src/features/vehicle/SensorGrid.tsx`

## Cambio 1 — Filtrado de valores imposibles en getSensorValue

Se añaden cuatro filtros aplicados tras obtener el valor del sensor:
- `value === 65535` → `null` (centinela CAN uint16 "sin dato")
- Sensores RPM (unidad o label) con `value > 9000` → `null` (imposible en maquinaria industrial)
- Sensores de presión bar (unidad o label contiene BAR/PRESION/PRESIÓN) con `value > 500` → `null`
- `value < 0` cuando `sensor.min == null || sensor.min >= 0` → `null` (negativo físicamente imposible)

## Cambio 2 — Conversión minutos → horas en sensores numéricos

Se añade el helper `isMinutesSensor(label)` que detecta labels con 'MIN' o 'MINUTOS'.
Cuando el sensor numérico es de minutos, se calcula `hoursValue = round(value / 60, 1 decimal)`
y se pasa `'h'` como unidad, en lugar de la unidad original del sensor.

## Cambio 3 — Separación visual: gauges arriba, numéricos abajo

El grid único se reemplaza por dos grupos dentro de un contenedor `flex column gap:16`:
- Grupo superior: sensores `circular`, `linear`, `battery` — grid `minmax(160px, 1fr)` gap 14
- Grupo inferior: sensores `numeric` y tipos no reconocidos — grid `minmax(120px, 1fr)` gap 12
Cada grupo solo se renderiza si tiene al menos un sensor.

## Cambio 4 — Truncar labels largos

Se añade el helper `truncateLabel(label)`: si `label.length > 20` retorna los primeros 19
caracteres seguidos de `…`; si no, retorna el label intacto.
Se aplica a todos los sensores (visuales y numéricos) antes de pasarlos a los componentes de gauge.

## Verificación

- `tsc -b --noEmit` → 0 errores, 0 advertencias
- Build Vite: 950 módulos transformados correctamente (fallo por permisos en /dist de Docker, no TypeScript)
