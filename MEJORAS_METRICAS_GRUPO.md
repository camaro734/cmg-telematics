# Métricas agrupadas en gráfico multi-serie

## Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `backend/app/schemas/vehicle.py` | Campo `group: str | None = None` en `HistoricMetricItem` |
| `frontend/src/lib/types.ts` | Campo `group?: string | null` en interfaz `HistoricMetricItem` |
| `frontend/src/features/vehicles/VehicleTypesPage.tsx` | Campo `group` en formulario, modal y tabla de métricas históricas |
| `frontend/src/features/reports/ReportsPage.tsx` | Constante `GROUP_COLORS`, función `mergeSeriesByLabel`, lógica de agrupación y render multi-serie |

## Lógica de agrupación implementada

### Clasificación de métricas
En `HistoricoTab` (ReportsPage), tras construir `avlLineData` con los datos de cada métrica AVL, se aplica la función `avlGrouped`:

- Métricas con `group` definido y no vacío → se acumulan en un `Map<string, items[]>` por nombre de grupo
- Métricas sin `group` (null/undefined/"") → array `singles` — comportamiento anterior inalterado

### Merge por label (timestamp)
La función `mergeSeriesByLabel` realiza un outer join por `label` (el timestamp formateado) de múltiples series `{label, value}`. Devuelve `[{label: "...", key_metrica_1: val, key_metrica_2: val, ...}]` apto para Recharts LineChart.

### Render de gráficos
1. **Grupos** (`avlGrouped.groups`): un único `<LineChart>` con un `<Line>` por métrica del grupo, colores de `GROUP_COLORS`, `<Legend>` visible, tooltip con label correcto de cada serie, título "Label1 / Label2 / ..." con unidad entre paréntesis si todas las métricas del grupo comparten la misma unidad.

2. **Individuales** (`avlGrouped.singles`): gráfico individual exactamente igual que antes (sin cambio de comportamiento).

### Paleta de colores
```ts
const GROUP_COLORS = ['#F97316', '#38BDF8', '#22C55E', '#EAB308', '#EF4444', '#A78BFA']
```
Si la métrica ya tiene un color propio configurado, se usa ese; si no, se asigna por índice de posición dentro del grupo.

## Cómo usar la nueva funcionalidad

1. Ir a **Plantillas de Vehículo** (`/tipos-vehiculo`)
2. Seleccionar un tipo de vehículo
3. En la sección **Métricas del histórico**, pulsar "+ Añadir métrica" o "✎" en una existente
4. En el modal, rellenar el campo **"Agrupar con"** con un nombre de grupo libre (ej: `presiones`, `horas`, `temperaturas`)
5. Guardar. Hacer lo mismo con otra métrica usando **exactamente el mismo nombre de grupo**
6. En **Reportes** → tab **Histórico**, seleccionar el vehículo: las métricas del grupo aparecerán en un único gráfico multi-serie con `<Legend>` y colores diferenciados

### Notas
- El campo `group` es completamente opcional; las métricas sin grupo funcionan igual que antes
- No se necesita migración de base de datos (el campo está en JSONB `historic_metrics` de `vehicle_type`)
- El TypeScript compila sin errores (`tsc -b` exitoso)
- La agrupación es por igualdad exacta del string `group` (case-sensitive)
