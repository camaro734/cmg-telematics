# Rediseno de Gauges SVG — CMG Track

## CircularGauge

**Archivo:** `frontend/src/shared/ui/gauges/CircularGauge.tsx`

**Props (compatibles hacia atras):**
- `value: number | null` — valor actual
- `min: number` — valor minimo del rango
- `max: number` — valor maximo del rango
- `unit: string` — unidad (ej. "bar", "rpm", "%")
- `label: string` — etiqueta del sensor
- `size?: number` — tamaño SVG en px (default 140)
- `warnAbove?: number` — umbral de aviso por exceso
- `alertAbove?: number` — umbral critico por exceso
- `warnBelow?: number` — umbral de aviso por defecto
- `alertBelow?: number` — umbral critico por defecto
- `warnThreshold?: number` — alias de warnAbove (nuevo API)
- `critThreshold?: number` — alias de alertAbove (nuevo API)
- `colorOverride?: string` — fuerza un color fijo independientemente del valor

**Cambios de diseno:**
- Antes: arco grueso usando paths SVG con dos radios (rOuter/rInner) + aguja triangular + pivote
- Ahora: arco limpio con `stroke-dasharray`/`stroke-dashoffset` sobre un circulo SVG
- Arco de 240° con strokeLinecap round — inicio abajo-izquierda, fin abajo-derecha
- Grosor del arco: 14px uniforme en track y fill
- Track de fondo: #3C3330 (bg-elevated del design system)
- Sin aguja, sin gradientes complejos
- Transicion CSS suave en dashoffset (0.4s ease) y en color del stroke (0.3s)
- Valor centrado: 30px, bold, blanco; "/ max unidad" en 9px gris
- 6 marcas de escala exteriores sutiles (#57534E)
- Punto central (g-dot) visible solo cuando hay valor activo
- Labels min/max en los extremos geometricos del arco

**Contratos de test mantenidos:**
- Clase `.g-val` en el circulo de valor con atributo `stroke` CSS variable
- Clase `.g-dot` presente/ausente segun `hasValue` (value != null && value > min)
- Texto `/ {max} {unit}` en elemento SVG separado
- Label transformado a mayusculas

---

## LinearGauge

**Archivo:** `frontend/src/shared/ui/gauges/LinearGauge.tsx`

**Props (compatibles hacia atras):**
- `value: number | null`
- `min: number`, `max: number`
- `unit?: string` — incluida en interfaz pero no mostrada en el porcentaje
- `label: string`
- `warnBelow?: number`, `alertBelow?: number` — umbrales por defecto
- `warnAbove?: number`, `alertAbove?: number` — umbrales por exceso (nuevo)
- `height?: number` — altura de la barra horizontal (default 8px)
- `orientation?: 'horizontal' | 'vertical'` — default 'vertical' (compatible)
- `colorOverride?: string` — fuerza color fijo

**Cambios de diseno:**
- Antes: solo orientacion vertical con barra de relleno ascendente
- Ahora: soporte para orientation horizontal con barra izquierda→derecha
- La orientacion 'vertical' es identica a la anterior (compatible hacia atras)
- Transicion CSS mejorada: `0.4s ease` en lugar de `0.3s`
- Soporte de umbrales por exceso ademas de los existentes por defecto
- El parametro `unit` se acepta pero no se renderiza (comportamiento anterior identico)

**Contratos de test mantenidos:**
- Clase `.linear-fill` con `style.height` proporcional en orientacion vertical
- Textos de estado: OK, BAJO, CRITICO, guion en null

---

## BatteryGauge

**Archivo:** `frontend/src/shared/ui/gauges/BatteryGauge.tsx`

**Props (compatibles hacia atras):**
- `value: number | null`
- `min: number`, `max: number`
- `label: string`
- `unit?: string` (default 'V')
- `warnBelow?: number`, `alertBelow?: number`
- `charging?: boolean` — muestra icono de rayo SVG (nuevo, no afecta tests)
- `voltage?: number`, `minVoltage?: number`, `maxVoltage?: number` — aliases opcionales
- `size?: number` — aceptado pero no afecta el layout actual

**Cambios de diseno:**
- Antes: cuerpo de bateria con div plano, sin icono de carga
- Ahora: cuerpo de bateria con `position: relative` para contener el rayo SVG
- Icono de rayo SVG puro cuando `charging=true` (sin librerias externas)
- Transicion CSS mejorada: `0.4s ease`
- Label con `textTransform: uppercase` explicito
- `position: relative` en el contenedor interior para el icono de carga

**Contratos de test mantenidos:**
- Clase `.bat-fill` con `style.width` proporcional al porcentaje
- Texto formateado: `${value.toFixed(1)} ${unit}` o `— ${unit}`
- Textos de estado: OK, ADVERTENCIA, BAJA, guion en null
- Warning en dev cuando alertBelow >= warnBelow

---

## NumericDisplay

**Archivo:** `frontend/src/shared/ui/gauges/NumericDisplay.tsx`

**Props (compatibles hacia atras):**
- `value: number | null | string` — acepta string ademas de number/null (nuevo)
- `unit: string`
- `label: string`
- `status?: 'normal' | 'warn' | 'alert' | 'offline'` (nuevo, default 'normal')
- `size?: 'sm' | 'md' | 'lg'` (nuevo, default 'md' = 28px)
- `precision?: number` — decimales forzados (nuevo)

**Cambios de diseno:**
- Antes: fuente fija 34px, color siempre --text-primary, unidad en div separado debajo
- Ahora: tamano configurable (sm/md/lg), color segun estado, unidad inline al valor
- Status 'normal': blanco; 'warn': naranja; 'alert': rojo; 'offline': gris
- Tamanos de fuente: sm=20px, md=28px, lg=36px
- La unidad se muestra al lado del valor en tamaño reducido (35% del valor)
- El valor legacy en 34px corresponde aproximadamente al nuevo 'md' (28px)

**Contratos de test mantenidos:**
- `getByText(value)` encuentra el valor formateado (entero sin decimales, float con 1)
- `getByText(unit)` encuentra la unidad en nodo separado
- `getByText(label)` encuentra el label
- Valor null muestra guion

---

## Decisiones de diseno

### Arco con stroke-dasharray vs path SVG
El diseno anterior usaba `thickArcPath()` con dos radios para crear un arco relleno, lo que generaba paths complejos y requeria calcular 4 puntos por arco. El nuevo enfoque con `stroke-dasharray`/`stroke-dashoffset` es mas simple, mas legible y permite transiciones CSS nativas. La animacion es simplemente `stroke-dashoffset 0.4s ease`.

### Eliminacion de la aguja
La aguja triangular del diseno anterior creaba confusion visual en gauges pequeños y no aportaba precision adicional respecto al arco de color. El punto central (g-dot) es suficiente indicador de actividad.

### Variables CSS en lugar de hex para colores de estado
Los colores de estado usan `var(--accent-energy)`, `var(--accent-warn)`, `var(--accent-crit)` en lugar de hex directos. Esto permite que el sistema white-label de CMG Track funcione correctamente: si un tenant sobreescribe `--accent-energy`, los gauges respetan ese cambio automaticamente. Ademas los tests verifican directamente los valores de las variables CSS.

### Compatibilidad hacia atras total
Todos los consumidores existentes (SensorGrid, tests) funcionan sin cambios porque:
1. Todas las props originales se mantienen con los mismos nombres y tipos
2. Los contratos de clases CSS (.g-val, .g-dot, .linear-fill, .bat-fill) se preservan
3. Los textos renderizados mantienen el mismo formato
