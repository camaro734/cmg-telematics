# Fix: Métricas sin datos en /reports

**Fecha:** 2026-04-30  
**Estado:** Aplicado — TypeScript compila sin errores (tsc -b --noEmit)

---

## Bugs corregidos

### Bug 1 — Backend: avl-series buscaba en `io_data` en lugar de `can_data`
**Fichero:** `backend/app/api/v1/vehicles.py` — endpoint `/vehicles/{id}/avl-series`

El writer (`services/ingest/src/writer.py`) guarda todos los IO elements en la columna `can_data` de `telemetry_record`. El endpoint usaba `io_data` que no existe, devolviendo siempre 0 resultados.

**Fix:** Cambiar `io_data` → `can_data` en toda la query SQL del endpoint.

---

### Bug 2 — Backend: avl-series no aceptaba `start`/`end`
**Fichero:** `backend/app/api/v1/vehicles.py`

El endpoint solo tenía el parámetro `hours: int`. El frontend ya enviaba `start` y `end` en formato ISO pero el backend los ignoraba.

**Fix:** Añadir parámetros opcionales `start: datetime | None` y `end: datetime | None`. Si se proporcionan, se usan; si no, se calcula desde `hours`. También se añade `AND time <= :until` para acotar correctamente el rango superior.

---

### Bug 3 — Frontend: query KPI custom usaba `from`/`to` en lugar de `start`/`end`
**Fichero:** `frontend/src/features/reports/ReportsPage.tsx` — `HistoricoTab`

Para period='custom', la query KPI enviaba `?from=...&to=...` pero el backend `/kpis` solo acepta `?start=...&end=...`.

**Fix:** Renombrar los parámetros URL a `start` y `end`.

---

### Bug 4 — Frontend: métricas KPI conocidas podían enrutarse a avl-series
**Fichero:** `frontend/src/features/reports/ReportsPage.tsx` — `HistoricoTab`

Si una métrica como `pto_active_minutes` tenía `avl_id` configurado (accidentalmente), el código la enrutaba a avl-series en lugar de leer de `kpis[]` (telemetry_1h). Los valores de `engine_on_minutes` y `pto_active_minutes` son columnas calculadas en telemetry_1h — nunca deben buscarse como AVL serie directa.

**Fix:** Añadir `KPI_HOUR_KEYS` (Set con las columnas de KpiHour) y forzar que siempre usen el path de `kpis[]`, incluso si `avl_id` está configurado:
```typescript
const KPI_HOUR_KEYS = new Set(['engine_on_minutes', 'pto_active_minutes', 'avg_pressure_1', 'max_pressure_1', 'avg_oil_temp', 'max_oil_temp', 'record_count'])
const avlMetrics = metrics.filter(m => m.avl_id !== undefined && m.avl_id !== null && !KPI_HOUR_KEYS.has(m.key))
const kpiLineMetrics = allLineMetrics.filter(m => KPI_HOUR_KEYS.has(m.key) || !(m as any).avl_id)
const avlLineMetrics = allLineMetrics.filter(m => !KPI_HOUR_KEYS.has(m.key) && (m as any).avl_id !== undefined)
```

---

## Resultado esperado

Tras desplegar los cambios:
- **Horas Transfer (custom_avl_145):** El endpoint ahora busca en `can_data->>avl_145` y acepta rangos `start`/`end`. Los datos del 23/04–30/04 deben aparecer en el gráfico.
- **Horas PTO (pto_active_minutes):** La métrica lee de `telemetry_1h.pto_active_minutes` vía el endpoint `/kpis`. Con datos del 29/04, el gráfico semana debe mostrar la barra/línea correcta. Los valores son en minutos — el `transform` de la métrica (p.ej. `1/60`) controla la conversión a horas.
- **Período custom:** Ambas queries (kpis y avl-series) ahora usan los parámetros correctos `start`/`end`.

## Nota de despliegue

El `dist/` del frontend tiene permisos de root (generado por Docker). Para rebuildar:
```bash
# Desde el servidor con acceso Docker:
docker compose build frontend && docker compose up -d frontend
# o rebuild core-api también por el cambio en vehicles.py:
docker compose build core-api && docker compose up -d core-api
```
