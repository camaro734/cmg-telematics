# Mejoras Métricas de Reportes — Sprint 18 (2026-04-25, actualizado)

---

## MÉTRICAS DE REPORTES CONFIGURABLES — chart_type + avl_id + show_in_pdf

### Contexto
Se ha extendido el sistema de `historic_metrics` en VehicleType para soportar:
- Tipo de gráfico por métrica (`line`, `donut`, `bar`)
- AVL ID de referencia (documentativo, para futura lectura de CAN data)
- Control de inclusión en informe PDF (`show_in_pdf`)

### Backend — `backend/app/schemas/vehicle.py`
`HistoricMetricItem` — 3 nuevos campos (opcionales, backward compatible):
```python
avl_id: int | None = None
chart_type: Literal['line', 'donut', 'bar'] = 'line'
show_in_pdf: bool = True
```
Nuevos schemas: `ReportMetricItem` (alias) y `VehicleTypeReportMetricsUpdate(report_metrics)`.

### Backend — `backend/app/api/v1/vehicles.py`
Endpoint `PATCH /api/v1/vehicle-types/{id}/historic-metrics`:
- Body cambiado: `{ metrics: [...] }` → `{ report_metrics: [...] }`
- Guard: solo CMG admin (sin cambios)

### Frontend — `frontend/src/lib/types.ts`
`HistoricMetricItem` ampliado con `avl_id?`, `chart_type?`, `show_in_pdf?`.

### Frontend — `frontend/src/features/vehicles/VehicleTypesPage.tsx`
Sección "Métricas del histórico" (solo CMG admin):
- Tabla: columnas `MÉTRICA`, `ETIQUETA`, `COLOR`, `TIPO GRÁFICO`, `PDF`
- Badge de tipo de gráfico con color por tipo
- Modal ampliado: AVL ID opcional, selector de tipo (Línea/Dona/Barra), checkbox PDF
- Mutación: envía `{ report_metrics: [...] }`

### Frontend — `frontend/src/features/reports/ReportsPage.tsx`
Tab HISTÓRICO — segmentación por `chart_type`:
- **Línea**: métricas con `chart_type === 'line'` (o sin chart_type — backward compat)
  - Fallback a motor/PTO solo si no hay métricas de línea configuradas
  - Mensaje mejorado cuando no hay métricas configuradas
- **Donuts fijos** Motor vs PTO / Distribución del tiempo: sin cambios
- **Donuts configurables** (nuevo): métricas con `chart_type === 'donut'` → sección "Distribución de actividades"

### Build
`tsc -b --noEmit` sin errores. `vite build` compilado correctamente.

---

# Mejoras Visuales — Sprint 18 (2026-04-25)

## TAREA 1 — Iconos SVG de vehículos industriales

### Archivos modificados
- `frontend/src/shared/ui/icons.tsx` — añadidos 4 iconos industriales + helper
- `frontend/src/features/fleet/VehicleCard.tsx` — usa icono dinámico por tipo
- `frontend/src/features/fleet/FleetMap.tsx` — marcadores Leaflet con tipo de vehículo
- `frontend/src/features/fleet/FleetDashboard.tsx` — pasa vehicleTypes a FleetMap

### Nuevos iconos (viewBox 0 0 64 32, stroke-based, currentColor)
- **`IconTruckGeneric`** — camión de carga estándar, caja rectangular, eje doble trasero
- **`IconTruckCistern`** — cisterna con cuerpo cilíndrico (pill), costillas de refuerzo y boca de llenado
- **`IconTruckVacuum`** — vacío/presión: cisterna corta + caja de bomba trasera + conexión de manguera
- **`IconTruckCrane`** — grúa: plataforma plana + brazo articulado + cable y gancho

### Selección automática por slug
`getVehicleIconForSlug(slug)` mapea el slug del tipo de vehículo al icono correspondiente:
- `cistern/tanque/tank` → IconTruckCistern
- `vacuum/vac/aspirad/barred/vaciado` → IconTruckVacuum
- `crane/grua/elevad/brazo` → IconTruckCrane
- Default → IconTruckGeneric

### Marcadores Leaflet
Los marcadores del mapa de flota ahora incluyen la silueta SVG del tipo de vehículo
dentro del pin de color (verde=online, naranja=PTO activo, gris=offline).

---

## TAREA 2 — Rediseño completo de ReportsPage

### Archivo modificado
- `frontend/src/features/reports/ReportsPage.tsx` (reescrito completo)

### Cabecera unificada
- Título "Reportes" integrado en la barra de selectores
- Selector de período (Día / Semana / Mes) visible en todos los tabs
- Botón "Informe PDF" siempre visible con icono SVG

### Tab HISTÓRICO — 3 secciones
1. **4 KPI cards** (antes 3): Días operativos, Total horas motor, Total horas PTO, % PTO/Motor
   - Cada card con accent color y barra de color inferior

2. **LineChart multi-series** (sustituye BarCharts por métrica):
   - Una sola gráfica con todas las series del vehículo (métricas configuradas en el tipo)
   - Se añaden automáticamente H.Motor y H.PTO si hay datos
   - Colores: naranja, verde, azul cielo...

3. **2 gráficos de dona (PieChart)**:
   - Motor vs PTO
   - Distribución del tiempo: PTO / Motor / Parado en el período

### Tab RUTAS
- Polilínea verde brillante (#10b981) más gruesa (4px)
- Stats inline en la barra de fecha: Distancia (km), Velocidad media (km/h), Duración
  - Calculadas con fórmula de Haversine entre puntos GPS consecutivos

### Tab ALERTAS
- Nueva columna "Severidad" con badge de color: CRÍTICA / AVISO / INFO
- Filtro de severidad por pills (Todas / Crítica / Aviso / Info)
- Export CSV incluye la severidad

### Navegación desde VehicleDetailPage
ReportsPage acepta `location.state: { vehicleId, tab }` para pre-seleccionar
vehículo y tab al navegar desde la banda de accesos rápidos.

---

## TAREA 3 — Banda de accesos rápidos en VehicleDetailPage

### Archivo modificado
- `frontend/src/features/vehicle/VehicleDetailPage.tsx`

### Nuevos componentes
- **`QuickReportCard`** — tarjeta de acción con icono SVG, etiqueta, accent color y badge
- **`PdfQuickModal`** — modal standalone de descarga PDF

### Sección añadida al tab EN VIVO
Al final del panel derecho (65%), cuadrícula de 4 tarjetas de acceso rápido:

| Tarjeta | Acción | Accent |
|---------|--------|--------|
| Desempeño histórico | /reports?tab=historico | Azul info |
| Rutas del mes | /reports?tab=rutas | Verde ok |
| Alertas activas | /reports?tab=alertas (badge con count) | Rojo crit |
| Descargar PDF | Modal PDF inline | Naranja energy |

Las tarjetas tienen hover con borde coloreado según el accent.

---

## Estado TypeScript
- `tsc -b --noEmit` sin errores en las 3 tareas

## Para desplegar
```bash
# Como root en el VPS:
sudo docker-compose build frontend
sudo docker-compose up -d frontend
```
