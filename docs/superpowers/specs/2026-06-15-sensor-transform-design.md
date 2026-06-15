# Transformación de sensores + arreglo del desplegable del popup de flota

**Fecha:** 2026-06-15
**Autor:** CMG Dev (Carlos) + Claude
**Estado:** Aprobado (pendiente de plan de implementación)

## Contexto

En `/fleet`, al seleccionar un vehículo en el mapa se abre el popup de Leaflet
con un botón **"Ver más ↓"** que despliega una sección. El usuario reporta que
"los valores no salen" en ese desplegable.

Además, los tipos de vehículo definen sensores con `scale`/`offset` lineales,
pero el equipo necesita configurar sensores cuya señal viene en un **rango**
(p. ej. 4-20 mA representado como `4000–20000` en crudo) y mapearla a un rango
físico (p. ej. `−1 a 10 bar` del sensor de vacío). Hoy eso obliga a calcular
`scale`/`offset` a mano.

### Causa raíz del bug (evidencia de producción, solo lectura)

- Tipo **cisterna**: 25 sensores, **0 con `show_in_popup=true`**.
- Vehículo cisterna vivo (`9130e55d`, señal de hoy) tiene `can_data` rico:
  `avl_146..154`, `avl_10309..10315` con valores reales.
- Los sensores **LED** del schema (`avl_383..389`: bomba, depresor, PTO, setas,
  pedal) **NO existen en `can_data`** (el dispositivo solo envía `avl_380/381`
  en ese rango) → resuelven a `null` → "—".
- El desplegable "Ver más" (`FleetMap.tsx:271`, función `buildPopupHtml`) está
  cableado para mostrar **solo "Equipo industrial"** = PTO + sensores
  `gauge_type==='led'`. Los sensores numéricos que **sí** tienen dato no se
  surfacean en el popup porque ninguno tiene `show_in_popup` y la sección
  "Ver más" ignora los no-LED.

Resultado: el desplegable solo muestra LEDs sin dato; los valores numéricos
reales nunca aparecen.

## Objetivos

1. **Bug:** el "Ver más" del popup del mapa muestra los sensores numéricos del
   tipo de vehículo con su valor ya transformado + unidad.
2. **Feature:** transformación **lineal por rango de dos puntos** configurable
   por sensor, derivando el mapeo `entrada → salida`, aplicada de forma
   consistente en frontend y backend (reportes/PDF).
3. Base de datos del schema **extensible** a transformaciones no lineales
   (tabla multipunto) sin migración futura.

## No-objetivos (YAGNI)

- Motor de expresiones libres (`(x-4000)/16000*11-1`).
- Tabla de calibración multipunto / interpolación no lineal (se deja la puerta
  abierta en el schema, no se implementa ahora).
- Sensores virtuales que combinan varios canales.
- Recorte (clamp) de valores fuera de rango — se muestra el valor extrapolado.

## Modelo de datos

Se añade a `SensorDef` un campo opcional `transform` como **unión etiquetada**:

```ts
type SensorTransform =
  | { type: 'linear_range'; in_min: number; in_max: number; out_min: number; out_max: number }
  // futuro (no en este alcance):
  // | { type: 'points'; points: [number, number][] }

interface SensorDef {
  // ...campos existentes...
  scale?: number      // modo legado (fallback)
  offset?: number     // modo legado (fallback)
  transform?: SensorTransform
}
```

- **Sin migración:** los sensores existentes (con `scale`/`offset`) siguen
  funcionando vía fallback. Los nuevos usan `transform`.
- `transform` es la **única fuente de verdad** cuando está presente.
- El campo se persiste en `vehicle_type.sensor_schema` (JSONB), aditivo.

## Matemática

Para `type: 'linear_range'`:

```
value = (raw - in_min) * (out_max - out_min) / (in_max - in_min) + out_min
```

Guardas:
- `raw == null` → `null`.
- `in_max == in_min` → `null` (evita división por cero).
- Valores `J1939_NA` / `invalid_values` → `null` (ya se filtran en
  `resolveRawValue`, **antes** de transformar; no cambia).
- **No se recorta** fuera de `[in_min, in_max]` (extrapolación lineal).

Equivalencia documentada (lineal ⇄ scale/offset):
```
scale  = (out_max - out_min) / (in_max - in_min)
offset = out_min - in_min * scale
```
Verificación del caso real: `4000 → −1 bar`, `20000 → 10 bar`
(`scale = 0.0006875`, `offset = −3.75`).

## Componentes

### Frontend — motor único

- **`lib/sensorValue.ts`**: nueva `applyTransform(raw, sensor): number | null`.
  Despacha por `sensor.transform?.type`; si no hay `transform`, cae a
  `applyScaleOffset(raw, sensor.scale, sensor.offset)`. `applyScaleOffset` se
  mantiene como primitiva lineal.
- Consumidores que pasan a usar `applyTransform`:
  - `features/vehicle/diagnostic/BlockDetailSection.tsx`
  - `features/vehicle/diagnostic/SensorMiniChart.tsx`
  - `features/vehicle/diagnostic/SensorDetailModal.tsx`
  - `lib/avlSeries.ts` (`buildSensorSeries` / `buildDerivativeSeries` pasan a
    recibir el objeto `sensor` y llaman a `applyTransform` internamente, en
    lugar de recibir `scale, offset` sueltos).
  - `features/fleet/FleetMap.tsx` (`sensorDisplayValue`, `sensorColor`).

### Frontend — editor (`features/vehicles/VehicleTypesPage.tsx`)

La ficha de sensor gana un selector de **modo de transformación**:
- **Escala/offset** (lo actual).
- **Rango lineal (4-20 mA / 0-10 V)**: cuatro campos
  *entrada min / entrada max → salida min / salida max* + unidad, con **vista
  previa en vivo**: `4000 → −1 bar · 20000 → 10 bar`.

`sensorDefToForm` / `formToSensorDef` serializan/deserializan `transform`.

### Frontend — arreglo del desplegable (`FleetMap.tsx`)

- La sección "Ver más" (`data-popup-section="more"`) pasa a listar **todos los
  sensores `visible_in_detail !== false`** del tipo, con su valor transformado
  (`applyTransform`) + unidad, y mantiene debajo el bloque de "Equipo
  industrial" (LEDs/PTO).
- El bloque compacto siempre visible (`sensorBlock`) sigue usando
  `show_in_popup` para los destacados.
- **Mejora colateral:** extraer `buildPopupHtml` (y helpers asociados) a
  `features/fleet/popupHtml.ts`, porque `FleetMap.tsx` ya supera el límite de
  500 líneas.

### Backend — motor espejo

- **`app/services/sensor_transform.py`**: `apply_transform(raw, sensor: dict)`
  con la misma matemática y guardas que el frontend. Type hints en toda función
  pública.
- **`app/schemas/vehicle.py`**: añadir modelo Pydantic `SensorTransform`
  (unión etiquetada) y validar `transform` si está presente dentro de
  `VehicleTypeSensorSchemaUpdate` (tolerante con el resto del dict).
- **Reportes/PDF:** auditar la generación de reportes y PDF (WeasyPrint) y
  aplicar `apply_transform` donde se rendericen valores de sensores. (Si hoy el
  PDF no muestra valores CAN, el módulo queda listo para cuando se añadan.)

## Superficies donde aparecen los valores transformados

- Popup del mapa (compacto `show_in_popup` + completo en "Ver más").
- Página de detalle de vehículo / `BlockDetailSection`.
- Mini-gráficas y `SensorDetailModal`.
- Reportes (frontend) y PDF (backend).

## Manejo de errores

- Entradas inválidas (`null`, división por cero, no-numérico) → `null` →
  se renderiza "—". Nunca lanza.
- `transform` malformado en JSONB → el backend lo rechaza en validación al
  guardar; en runtime el frontend cae a fallback/`null` sin romper.

## Testing

- **Frontend** `lib/__tests__/sensorValue.test.ts`: `applyTransform` —
  caso real 4-20 mA → −1..10 bar, `in_min==in_max`, `raw=null`, fuera de rango
  (extrapola), fallback a scale/offset.
- **Frontend** `avlSeries.test.ts`: series con `transform`.
- **Frontend**: test de `popupHtml` — el "Ver más" lista sensores numéricos con
  valor transformado.
- **Backend** `tests/test_sensor_transform.py`: paridad con el frontend usando
  el mismo caso real.

## Consideraciones de producción

- Servidor único = producción. Los cambios en `sensor_schema` son **aditivos**
  y retrocompatibles; no hay migración Alembic ni cambios de hypertables.
- Multi-tenant: la edición de tipos de vehículo ya pasa por los controles de
  permisos existentes; este diseño no los toca.

## Decisiones confirmadas

- Set del "Ver más": sensores `visible_in_detail` (no exigir `show_in_popup`).
- Fuera de rango: **no recortar** (mostrar valor extrapolado).
- Alcance: lineal 2 puntos + schema extensible.
- Consistencia: front + back unificado.
