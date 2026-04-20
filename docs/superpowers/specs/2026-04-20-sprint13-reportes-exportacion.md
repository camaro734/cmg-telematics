# Sprint 13 — Reportes y Exportación Design

**Fecha:** 2026-04-20
**Estado:** Aprobado

## Objetivo

Generar informes mensuales KPI en PDF desde el servidor: tablas de flota, alertas y mantenimiento, gráficas SVG de actividad PTO diaria y mapas GPS con recorrido mensual + marcadores de alertas críticas. El PDF se descarga directamente desde el navegador.

## Alcance

### Incluido
- Endpoint `GET /api/v1/reports/monthly` → `application/pdf`
- Secciones del informe: portada, resumen de flota, alertas, mantenimiento, sección GPS por vehículo
- Gráficas SVG de barras (actividad PTO diaria, inline en la plantilla)
- Mapas GPS por vehículo: polilínea de recorrido + marcadores de alertas críticas
- Permisos: CMG admin (cualquier tenant), client admin (propio tenant), subclient con `permission_grant resource_type='reports'`
- Máx. 15 vehículos por informe
- Caché de tiles OSM en disco
- Nueva página "Reportes" en frontend con sidebar entry
- `apiClient.getBlob()` para descarga binaria
- Tests de permisos y contrato de respuesta (backend) + tests de formulario (frontend)

### Excluido
- Sistema de ciclos de trabajo (deferred Sprint 14)
- Exportación CSV/Excel de tablas individuales
- Historial de informes guardados en servidor
- Envío por email automático / informe programado
- Informe para vehículos sin actividad (se omiten del PDF)

## Arquitectura

```
ReportsPage (React)
  └── GET /api/v1/reports/monthly?year&month&vehicle_ids&tenant_id
        └── reports.py (endpoint + validación permisos)
              └── report_generator.py (servicio)
                    ├── SQLAlchemy queries (telemetry_1h, alert_instance, maintenance_log, telemetry_record)
                    ├── staticmap → PNG base64 (por vehículo)
                    ├── SVG inline (bar chart PTO por día)
                    └── Jinja2 + WeasyPrint → bytes PDF
```

## Backend

### Dependencias nuevas (`backend/pyproject.toml`)
```toml
weasyprint = ">=62.0"
staticmap = ">=0.5.4"
```

Dependencias del sistema (Ubuntu): `libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf2.0-0 libffi-dev shared-mime-info` — añadir al `Dockerfile` del `core-api`.

### Endpoint — `backend/app/api/v1/reports.py`

```python
GET /api/v1/reports/monthly
Query params:
  year:        int (requerido, 2020–2100)
  month:       int (requerido, 1–12)
  vehicle_ids: list[str] (opcional, máx 15; si vacío → todos los vehículos activos del tenant ordenados por nombre; si hay >15 activos se toman los primeros 15)
  tenant_id:   str (solo CMG admin; ignorado para client/subclient)

Respuesta:
  200: StreamingResponse(content=pdf_bytes, media_type="application/pdf",
       headers={"Content-Disposition": f"attachment; filename=informe-{year}-{month:02d}.pdf"})
  400: year/month inválidos o >15 vehículos
  403: tenant_id de otro tenant sin permiso
  404: tenant no encontrado
```

**Lógica de permisos:**
- `user.tenant_tier == 'cmg' and user.role == 'admin'` → usa `tenant_id` del parámetro (requerido)
- `user.role == 'admin'` (client) → `tenant_id = user.tenant_id` (parámetro ignorado)
- Subclient con `permission_grant` donde `resource_type='reports'` y `'read' in allowed_actions` → `tenant_id` del `grantor_id` (el cliente que concedió el permiso)
- Cualquier otro caso → 403

### Servicio — `backend/app/services/report_generator.py`

**Queries (todas con `tenant_id` + rango de fechas como guardianes):**

```python
# 1. Vehículos seleccionados
SELECT id, name, license_plate FROM vehicle
WHERE tenant_id = :tid AND id = ANY(:vehicle_ids)

# 2. Actividad diaria por vehículo (telemetry_1h → diario)
SELECT vehicle_id,
       time_bucket('1 day', bucket) AS day,
       SUM(pto_active_minutes) / 60.0 AS pto_hours,
       SUM(engine_on_minutes) / 60.0  AS engine_hours
FROM telemetry_1h
WHERE tenant_id = :tid
  AND bucket >= :start AND bucket < :end
  AND vehicle_id = ANY(:vehicle_ids)
GROUP BY vehicle_id, day
ORDER BY vehicle_id, day

# 3. Alertas del período
SELECT ai.id, ai.vehicle_id, ai.triggered_at, ai.status,
       ai.trigger_value, ar.name AS rule_name, ar.severity
FROM alert_instance ai
JOIN alert_rule ar ON ar.id = ai.rule_id
WHERE ai.tenant_id = :tid
  AND ai.triggered_at >= :start AND ai.triggered_at < :end
  AND ai.vehicle_id = ANY(:vehicle_ids)
ORDER BY ai.triggered_at

# 4. Posición GPS en el momento de cada alerta (ejecutar una vez por alerta)
SELECT lat, lon
FROM telemetry_record
WHERE vehicle_id = :vid
  AND recorded_at BETWEEN :alert_time - interval '5 minutes'
                      AND :alert_time + interval '5 minutes'
ORDER BY ABS(EXTRACT(EPOCH FROM (recorded_at - :alert_time)))
LIMIT 1

# 5. Intervenciones de mantenimiento
SELECT ml.id, ml.performed_at, ml.performed_by_email,
       ml.description, ml.cost_eur, mp.name AS plan_name,
       v.name AS vehicle_name
FROM maintenance_log ml
JOIN maintenance_plan mp ON mp.id = ml.plan_id
JOIN vehicle v ON v.id = ml.vehicle_id
WHERE mp.tenant_id = :tid
  AND ml.performed_at >= :start AND ml.performed_at < :end
ORDER BY ml.performed_at

# 6. GPS track muestreado por vehículo (~300–600 puntos/mes)
SELECT lat, lon, recorded_at
FROM (
  SELECT lat, lon, recorded_at,
         ROW_NUMBER() OVER (PARTITION BY vehicle_id ORDER BY recorded_at) AS rn,
         COUNT(*) OVER (PARTITION BY vehicle_id) AS total
  FROM telemetry_record
  WHERE vehicle_id = :vid
    AND recorded_at >= :start AND recorded_at < :end
    AND lat IS NOT NULL AND lon IS NOT NULL
) sub
WHERE rn % GREATEST(total / 500, 1) = 0
ORDER BY recorded_at
```

**Generación de mapas GPS:**
```python
from staticmap import StaticMap, Line, CircleMarker

def render_vehicle_map(track_points, alert_positions) -> str:
    """Retorna imagen PNG como base64 string."""
    m = StaticMap(600, 400, url_template='https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                  tile_request_timeout=5,
                  cache_dir='/tmp/staticmap_cache/')
    if track_points:
        coords = [(p.lon, p.lat) for p in track_points]
        m.add_line(Line(coords, '#F97316', 2))
        m.add_marker(CircleMarker((coords[0][0], coords[0][1]), '#22C55E', 8))   # inicio
        m.add_marker(CircleMarker((coords[-1][0], coords[-1][1]), '#38BDF8', 8)) # fin
    for pos in alert_positions:
        m.add_marker(CircleMarker((pos.lon, pos.lat), '#EF4444', 10))
    image = m.render()
    buf = BytesIO()
    image.save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode()
```

**Generación de SVG (actividad PTO diaria):**
```python
def render_pto_bar_chart(daily_data: list[dict], width=400, height=80) -> str:
    """Genera SVG inline de barras para horas PTO por día."""
    # daily_data: [{'day': date, 'pto_hours': float}, ...]
    max_val = max((d['pto_hours'] for d in daily_data), default=1)
    bar_w = width / max(len(daily_data), 1)
    bars = ''
    for i, d in enumerate(daily_data):
        h = int((d['pto_hours'] / max_val) * height) if max_val > 0 else 0
        x = i * bar_w + 1
        bars += f'<rect x="{x:.1f}" y="{height - h}" width="{bar_w - 2:.1f}" height="{h}" fill="#F97316" opacity="0.8"/>'
    return f'<svg width="{width}" height="{height}" xmlns="http://www.w3.org/2000/svg">{bars}</svg>'
```

### Plantilla — `backend/app/templates/reports/monthly_report.html`

Plantilla Jinja2 con CSS inline (compatible con WeasyPrint). Estructura:

1. **Portada**: logo del tenant (brand_tokens.logo_url o texto), nombre, período, 3 KPIs en cajas (vehículos, alertas, intervenciones)
2. **Resumen de flota**: tabla por vehículo (horas motor, horas PTO, alertas del mes)
3. **Gráfica actividad**: SVG inline de barras PTO diarias (global, suma todos los vehículos)
4. **Alertas del período**: resumen por estado + tabla cronológica
5. **Mantenimiento**: tabla de intervenciones con coste, total al pie
6. **Sección por vehículo** (solo si tiene GPS data): mapa PNG en base64 + KPIs del vehículo

### Registro en router — `backend/app/api/v1/router.py`
```python
from .reports import router as reports_router
router.include_router(reports_router, prefix="/reports", tags=["reports"])
```

## Frontend

### `apiClient` — añadir método `getBlob`

En `frontend/src/lib/apiClient.ts`:
```ts
async getBlob(path: string): Promise<Blob> {
  const res = await this._fetch(path, { method: 'GET' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.blob()
}
```

### `ReportsPage.tsx` — `frontend/src/features/reports/ReportsPage.tsx`

**Estado del formulario:**
- `tenantId: string` — solo CMG admin; inicializado con el primer tenant de la lista
- `year: number`, `month: number` — por defecto el mes anterior
- `vehicleIds: string[]` — multiselect, máx 15
- `loading: boolean`
- `error: string | null`

**Queries React Query:**
- `keys.tenants()` → lista de tenants (solo si CMG admin)
- `keys.vehicles(tenantId)` → `GET /api/v1/vehicles?tenant_id=X` (refresca al cambiar tenant)

**Descarga:**
```ts
async function handleGenerate() {
  setLoading(true)
  try {
    const params = new URLSearchParams({ year: String(year), month: String(month) })
    vehicleIds.forEach(id => params.append('vehicle_ids', id))
    if (isCmg) params.set('tenant_id', tenantId)
    const blob = await apiClient.getBlob(`/api/v1/reports/monthly?${params}`)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `informe-${year}-${String(month).padStart(2, '0')}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    setError('Error al generar el informe')
  } finally {
    setLoading(false)
  }
}
```

### Sidebar — `frontend/src/shared/ui/Sidebar.tsx`

Añadir entrada "Reportes" visible para `role === 'admin'` (CMG y client), entre Mantenimiento y Reglas:

```tsx
{ to: '/reports', Icon: IconReportes, label: 'Reportes', active: true }
```

### `icons.tsx` — añadir `IconReportes`

Icono de documento con líneas (SVG simple, mismo estilo que los existentes).

### Routing — `frontend/src/App.tsx`

```tsx
const ReportsPage = lazy(() => import('./features/reports/ReportsPage'))
// Añadir ruta:
<Route path="/reports" element={<ReportsPage />} />
```

## Tests

### Backend — `tests/api/test_reports_api.py`

| Test | Descripción |
|------|-------------|
| `test_reports_cmg_admin_returns_pdf` | CMG admin con `tenant_id` válido → 200, `Content-Type: application/pdf` |
| `test_reports_client_admin_own_tenant` | Client admin sin `tenant_id` → 200 (usa su propio tenant) |
| `test_reports_client_admin_cross_tenant_forbidden` | Client admin con `tenant_id` de otro tenant → 403 |
| `test_reports_invalid_month` | `month=13` → 400 |
| `test_reports_too_many_vehicles` | 16 `vehicle_ids` → 400 |
| `test_reports_unauthenticated` | Sin token → 401 |

**Nota:** Los tests mockean `report_generator.generate_monthly_pdf` para devolver `b'%PDF-fake'` — no se prueba el contenido del PDF (WeasyPrint necesita sistema completo).

### Frontend — `frontend/src/features/reports/__tests__/ReportsPage.test.tsx`

| Test | Descripción |
|------|-------------|
| `renderiza formulario con mes anterior por defecto` | Comprueba que el formulario muestra el mes correcto |
| `CMG admin ve selector de cliente` | `tenant_tier=cmg` → select de tenants visible |
| `client admin no ve selector de cliente` | `tenant_tier=client` → sin selector de tenants |
| `llama a getBlob con params correctos al enviar` | Verifica URL y parámetros de la llamada |
| `muestra estado de carga mientras genera` | Botón deshabilitado + texto "Generando..." |

## Ficheros modificados/creados

| Fichero | Acción |
|---------|--------|
| `backend/app/api/v1/reports.py` | Crear — endpoint |
| `backend/app/services/report_generator.py` | Crear — servicio PDF |
| `backend/app/templates/reports/monthly_report.html` | Crear — plantilla Jinja2 |
| `backend/app/api/v1/router.py` | Modificar — registrar reports_router |
| `backend/pyproject.toml` | Modificar — añadir weasyprint, staticmap |
| `backend/Dockerfile` | Modificar — instalar dependencias sistema WeasyPrint |
| `frontend/src/lib/apiClient.ts` | Modificar — añadir getBlob() |
| `frontend/src/features/reports/ReportsPage.tsx` | Crear |
| `frontend/src/features/reports/__tests__/ReportsPage.test.tsx` | Crear |
| `frontend/src/shared/ui/icons.tsx` | Modificar — añadir IconReportes |
| `frontend/src/shared/ui/Sidebar.tsx` | Modificar — entrada Reportes |
| `frontend/src/App.tsx` | Modificar — ruta /reports |
