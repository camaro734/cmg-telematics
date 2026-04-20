# Sprint 13 — Reportes y Exportación PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir un endpoint `GET /api/v1/reports/monthly` que genera un PDF mensual con KPIs de flota, alertas, mantenimiento y mapa GPS por vehículo, y una página "Reportes" en el frontend para descargarlo.

**Architecture:** El backend genera el PDF server-side con WeasyPrint + Jinja2; el servicio `report_generator.py` ejecuta las queries SQL, renderiza mapas PNG via staticmap (tiles OSM cacheados), genera SVG de barras inline y compila el HTML con Jinja2 antes de pasarlo a WeasyPrint. El frontend descarga el binario con un nuevo método `apiClient.getBlob()`.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy async, WeasyPrint ≥62, staticmap ≥0.5.4, Jinja2 ≥3, TimescaleDB (telemetry_1h), React 18, React Query, TypeScript.

---

## File Map

| Fichero | Acción |
|---------|--------|
| `backend/pyproject.toml` | Modificar — añadir weasyprint, staticmap, jinja2 |
| `backend/Dockerfile` | Modificar — instalar deps sistema WeasyPrint |
| `backend/app/services/report_generator.py` | Crear — servicio PDF |
| `backend/app/templates/reports/monthly_report.html` | Crear — plantilla Jinja2 |
| `backend/app/api/v1/reports.py` | Crear — endpoint |
| `backend/app/api/v1/router.py` | Modificar — registrar reports router |
| `backend/tests/__init__.py` | Crear — vacío |
| `backend/tests/api/__init__.py` | Crear — vacío |
| `backend/tests/api/conftest.py` | Crear — fixtures de tests |
| `backend/tests/api/test_reports_api.py` | Crear — tests del endpoint |
| `frontend/src/lib/apiClient.ts` | Modificar — añadir getBlob() |
| `frontend/src/lib/queryKeys.ts` | Modificar — añadir vehiclesByTenant |
| `frontend/src/shared/ui/icons.tsx` | Modificar — añadir IconReportes |
| `frontend/src/shared/ui/Sidebar.tsx` | Modificar — entrada Reportes |
| `frontend/src/features/reports/ReportsPage.tsx` | Crear |
| `frontend/src/features/reports/__tests__/ReportsPage.test.tsx` | Crear |
| `frontend/src/App.tsx` | Modificar — ruta /reports |

---

### Task 1: Backend — Dependencias Python y sistema

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/Dockerfile`

- [ ] **Step 1: Añadir dependencias Python en pyproject.toml**

Reemplazar el bloque `dependencies` y añadir `[tool.pytest.ini_options]`:

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "cmg-telematics-api"
version = "2.0.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi==0.115.0",
    "uvicorn[standard]==0.30.6",
    "sqlalchemy[asyncio]==2.0.35",
    "asyncpg==0.29.0",
    "psycopg2-binary>=2.9",
    "alembic==1.13.3",
    "pydantic==2.9.2",
    "pydantic-settings==2.5.2",
    "bcrypt>=4.0",
    "python-jose[cryptography]==3.3.0",
    "redis[asyncio]==5.1.1",
    "httpx==0.27.2",
    "python-multipart==0.0.12",
    "email-validator>=2.0",
    "weasyprint>=62.0",
    "staticmap>=0.5.4",
    "jinja2>=3.1",
]

[project.optional-dependencies]
dev = [
    "pytest==8.3.3",
    "pytest-asyncio==0.24.0",
    "pytest-cov==5.0.0",
    "httpx==0.27.2",
]

[tool.setuptools.packages.find]
include = ["app*"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 2: Añadir dependencias sistema en Dockerfile**

```dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf2.0-0 \
    libffi-dev \
    shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
RUN pip install --no-cache-dir -e ".[dev]"

COPY . .

EXPOSE 8010

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010", "--reload"]
```

- [ ] **Step 3: Verificar que los ficheros son correctos**

```bash
cd /opt/cmg-telematic1/backend
python -c "import weasyprint; print('ok')" 2>/dev/null || echo "WeasyPrint no instalado aún (normal en dev local sin libs del sistema)"
grep "weasyprint\|staticmap\|jinja2" pyproject.toml
grep "libcairo" Dockerfile
```

- [ ] **Step 4: Commit**

```bash
git add backend/pyproject.toml backend/Dockerfile
git commit -m "chore: add weasyprint, staticmap, jinja2 deps + system libs in Dockerfile"
```

---

### Task 2: Backend — Servicio report_generator.py

**Files:**
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/report_generator.py`

El servicio ejecuta todas las queries, genera mapas y SVG, renderiza la plantilla y llama a WeasyPrint.

- [ ] **Step 1: Crear directorio services con __init__.py**

```bash
mkdir -p /opt/cmg-telematic1/backend/app/services
touch /opt/cmg-telematic1/backend/app/services/__init__.py
```

- [ ] **Step 2: Crear report_generator.py**

Crear `backend/app/services/report_generator.py` con el siguiente contenido:

```python
import base64
import calendar
import uuid
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path

from jinja2 import Environment, FileSystemLoader
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_TEMPLATES_DIR = Path(__file__).parent.parent / "templates"
_MONTH_NAMES = [
    "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]


def _render_pto_bar_chart(daily_data: list[dict], width: int = 400, height: int = 80) -> str:
    if not daily_data:
        return f'<svg width="{width}" height="{height}" xmlns="http://www.w3.org/2000/svg"></svg>'
    max_val = max((d["pto_hours"] for d in daily_data), default=1) or 1
    bar_w = width / len(daily_data)
    bars = ""
    for i, d in enumerate(daily_data):
        h = int((d["pto_hours"] / max_val) * height)
        x = i * bar_w + 1
        bars += (
            f'<rect x="{x:.1f}" y="{height - h}" '
            f'width="{bar_w - 2:.1f}" height="{h}" '
            f'fill="#F97316" opacity="0.85"/>'
        )
    return (
        f'<svg width="{width}" height="{height}" '
        f'xmlns="http://www.w3.org/2000/svg">{bars}</svg>'
    )


def _render_vehicle_map(track_points: list[dict], alert_positions: list[dict]) -> str:
    """Returns PNG as base64 string. Falls back to empty string on error."""
    try:
        from staticmap import StaticMap, Line, CircleMarker

        m = StaticMap(
            600, 400,
            url_template="https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            tile_request_timeout=5,
            cache_dir="/tmp/staticmap_cache/",
        )
        if track_points:
            coords = [(p["lon"], p["lat"]) for p in track_points]
            m.add_line(Line(coords, "#F97316", 2))
            m.add_marker(CircleMarker((coords[0][0], coords[0][1]), "#22C55E", 8))
            m.add_marker(CircleMarker((coords[-1][0], coords[-1][1]), "#38BDF8", 8))
        for pos in alert_positions:
            m.add_marker(CircleMarker((pos["lon"], pos["lat"]), "#EF4444", 10))
        image = m.render()
        buf = BytesIO()
        image.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return ""


async def generate_monthly_pdf(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    year: int,
    month: int,
    vehicle_ids: list[uuid.UUID],
) -> bytes:
    import weasyprint

    start = datetime(year, month, 1, tzinfo=timezone.utc)
    last_day = calendar.monthrange(year, month)[1]
    end = datetime(year, month, last_day, 23, 59, 59, tzinfo=timezone.utc)

    tid = str(tenant_id)
    vids = [str(v) for v in vehicle_ids]

    # 1. Tenant info (brand)
    tenant_row = await db.execute(
        text("SELECT name, brand_name, logo_url FROM tenant WHERE id = :tid"),
        {"tid": tid},
    )
    tenant = tenant_row.mappings().one_or_none()
    tenant_display_name = (tenant["brand_name"] or tenant["name"]) if tenant else "Cliente"
    tenant_logo_url = tenant["logo_url"] if tenant else None

    # 2. Vehicle names
    vehicles_row = await db.execute(
        text("SELECT id, name, license_plate FROM vehicle WHERE tenant_id = :tid AND id = ANY(:vids)"),
        {"tid": tid, "vids": vids},
    )
    vehicles = [dict(r) for r in vehicles_row.mappings().all()]
    vehicle_map = {str(v["id"]): v for v in vehicles}

    # 3. Daily activity (engine + PTO hours per vehicle)
    daily_row = await db.execute(
        text("""
            SELECT vehicle_id::text,
                   time_bucket('1 day', bucket) AS day,
                   SUM(pto_active_minutes) / 60.0 AS pto_hours,
                   SUM(engine_on_minutes) / 60.0  AS engine_hours
            FROM telemetry_1h
            WHERE tenant_id = :tid
              AND bucket >= :start AND bucket < :end
              AND vehicle_id = ANY(:vids)
            GROUP BY vehicle_id, day
            ORDER BY vehicle_id, day
        """),
        {"tid": tid, "start": start, "end": end, "vids": vids},
    )
    daily_activity = [dict(r) for r in daily_row.mappings().all()]

    # Build per-vehicle totals and global daily PTO
    vehicle_totals: dict[str, dict] = {
        str(v["id"]): {"engine_hours": 0.0, "pto_hours": 0.0, "alert_count": 0}
        for v in vehicles
    }
    daily_totals_by_day: dict[date, float] = {}
    for row in daily_activity:
        vid = row["vehicle_id"]
        if vid in vehicle_totals:
            vehicle_totals[vid]["engine_hours"] += float(row["engine_hours"] or 0)
            vehicle_totals[vid]["pto_hours"] += float(row["pto_hours"] or 0)
        d = row["day"].date() if hasattr(row["day"], "date") else row["day"]
        daily_totals_by_day[d] = daily_totals_by_day.get(d, 0.0) + float(row["pto_hours"] or 0)

    global_daily = sorted(
        [{"day": d, "pto_hours": h} for d, h in daily_totals_by_day.items()],
        key=lambda x: x["day"],
    )

    # 4. Alerts
    alerts_row = await db.execute(
        text("""
            SELECT ai.id::text, ai.vehicle_id::text, ai.triggered_at, ai.status,
                   ar.name AS rule_name, ar.severity
            FROM alert_instance ai
            JOIN alert_rule ar ON ar.id = ai.rule_id
            WHERE ai.tenant_id = :tid
              AND ai.triggered_at >= :start AND ai.triggered_at < :end
              AND ai.vehicle_id = ANY(:vids)
            ORDER BY ai.triggered_at
        """),
        {"tid": tid, "start": start, "end": end, "vids": vids},
    )
    alerts = [dict(r) for r in alerts_row.mappings().all()]

    for a in alerts:
        vid = a["vehicle_id"]
        if vid in vehicle_totals:
            vehicle_totals[vid]["alert_count"] += 1
        v = vehicle_map.get(vid, {})
        a["vehicle_name"] = v.get("name", vid)
        a["triggered_at_fmt"] = a["triggered_at"].strftime("%d/%m/%Y %H:%M") if a["triggered_at"] else ""

    critical_count = sum(1 for a in alerts if a["severity"] == "critical")
    warning_count = sum(1 for a in alerts if a["severity"] == "warning")
    resolved_count = sum(1 for a in alerts if a["status"] == "resolved")

    # 5. Alert GPS positions (only for critical alerts)
    alert_positions_by_vid: dict[str, list[dict]] = {}
    for a in alerts:
        if a["severity"] != "critical":
            continue
        vid = a["vehicle_id"]
        pos_row = await db.execute(
            text("""
                SELECT lat, lon FROM telemetry_record
                WHERE vehicle_id = :vid
                  AND recorded_at BETWEEN :t_min AND :t_max
                ORDER BY ABS(EXTRACT(EPOCH FROM (recorded_at - :t_ref)))
                LIMIT 1
            """),
            {
                "vid": vid,
                "t_min": a["triggered_at"] - timedelta(minutes=5),
                "t_max": a["triggered_at"] + timedelta(minutes=5),
                "t_ref": a["triggered_at"],
            },
        )
        pos = pos_row.mappings().one_or_none()
        if pos:
            alert_positions_by_vid.setdefault(vid, []).append(
                {"lat": float(pos["lat"]), "lon": float(pos["lon"])}
            )

    # 6. Maintenance
    maint_row = await db.execute(
        text("""
            SELECT ml.performed_at, ml.performed_by_email,
                   ml.description, ml.cost_eur,
                   mp.name AS plan_name, v.name AS vehicle_name
            FROM maintenance_log ml
            JOIN maintenance_plan mp ON mp.id = ml.plan_id
            JOIN vehicle v ON v.id = ml.vehicle_id
            WHERE mp.tenant_id = :tid
              AND ml.performed_at >= :start AND ml.performed_at < :end
            ORDER BY ml.performed_at
        """),
        {"tid": tid, "start": start, "end": end},
    )
    maintenance = [dict(r) for r in maint_row.mappings().all()]
    for m in maintenance:
        m["performed_at_fmt"] = m["performed_at"].strftime("%d/%m/%Y") if m["performed_at"] else ""
    total_cost = sum(float(m["cost_eur"]) for m in maintenance if m["cost_eur"] is not None)

    # 7. GPS tracks + maps per vehicle
    from datetime import timedelta
    vehicles_with_gps = []
    for v in vehicles:
        vid = str(v["id"])
        track_row = await db.execute(
            text("""
                SELECT lat, lon FROM (
                  SELECT lat, lon,
                         ROW_NUMBER() OVER (ORDER BY recorded_at) AS rn,
                         COUNT(*) OVER () AS total
                  FROM telemetry_record
                  WHERE vehicle_id = :vid
                    AND recorded_at >= :start AND recorded_at < :end
                    AND lat IS NOT NULL AND lon IS NOT NULL
                ) sub
                WHERE rn % GREATEST(total / 500, 1) = 0
                ORDER BY rn
            """),
            {"vid": vid, "start": start, "end": end},
        )
        track_points = [{"lat": float(r["lat"]), "lon": float(r["lon"])} for r in track_row.mappings().all()]
        if not track_points:
            continue
        map_b64 = _render_vehicle_map(track_points, alert_positions_by_vid.get(vid, []))
        totals = vehicle_totals[vid]
        vehicles_with_gps.append({
            "name": v["name"],
            "license_plate": v.get("license_plate") or "",
            "map_base64": map_b64,
            "engine_hours": round(totals["engine_hours"], 1),
            "pto_hours": round(totals["pto_hours"], 1),
            "alert_count": totals["alert_count"],
        })

    # 8. Fleet summary rows
    fleet_rows = []
    for v in vehicles:
        vid = str(v["id"])
        t = vehicle_totals[vid]
        fleet_rows.append({
            "name": v["name"],
            "license_plate": v.get("license_plate") or "",
            "engine_hours": round(t["engine_hours"], 1),
            "pto_hours": round(t["pto_hours"], 1),
            "alert_count": t["alert_count"],
        })

    # 9. Render HTML
    env = Environment(loader=FileSystemLoader(str(_TEMPLATES_DIR)), autoescape=True)
    template = env.get_template("reports/monthly_report.html")
    html = template.render(
        tenant_name=tenant_display_name,
        logo_url=tenant_logo_url,
        year=year,
        month=month,
        month_name=_MONTH_NAMES[month],
        generated_at=datetime.now(timezone.utc).strftime("%d/%m/%Y"),
        kpi_vehicles=len(vehicles),
        kpi_alerts=len(alerts),
        kpi_interventions=len(maintenance),
        fleet_rows=fleet_rows,
        pto_bar_chart_svg=_render_pto_bar_chart(global_daily),
        alerts=alerts,
        critical_count=critical_count,
        warning_count=warning_count,
        resolved_count=resolved_count,
        maintenance=maintenance,
        total_cost=round(total_cost, 2),
        vehicles_with_gps=vehicles_with_gps,
    )

    # 10. PDF
    pdf_bytes = weasyprint.HTML(string=html, base_url=str(_TEMPLATES_DIR)).write_pdf()
    return pdf_bytes
```

- [ ] **Step 3: Verificar sintaxis del módulo**

```bash
cd /opt/cmg-telematic1/backend
python -c "from app.services.report_generator import generate_monthly_pdf; print('ok')"
```

Expected: `ok` (puede haber warning de WeasyPrint sobre libs si no están en el sistema; el import debe funcionar)

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/__init__.py backend/app/services/report_generator.py
git commit -m "feat: add report_generator service — queries, staticmap, SVG, WeasyPrint"
```

---

### Task 3: Backend — Plantilla HTML Jinja2

**Files:**
- Create: `backend/app/templates/reports/monthly_report.html`

- [ ] **Step 1: Crear directorio de templates**

```bash
mkdir -p /opt/cmg-telematic1/backend/app/templates/reports
```

- [ ] **Step 2: Crear monthly_report.html**

Crear `backend/app/templates/reports/monthly_report.html`:

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  @page {
    size: A4;
    margin: 1.5cm 1.5cm 2cm 1.5cm;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    background: #1C1917;
    color: #E7E5E4;
    font-size: 9pt;
    line-height: 1.4;
  }
  .page-break { page-break-before: always; }

  /* ── Cover ── */
  .cover {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 24cm;
    text-align: center;
  }
  .cover-logo {
    width: 64px;
    height: 64px;
    border-radius: 12px;
    background: #F97316;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28pt;
    font-weight: 700;
    color: #fff;
    margin-bottom: 16px;
  }
  .cover-brand { font-size: 22pt; font-weight: 700; color: #E7E5E4; margin-bottom: 4px; }
  .cover-subtitle { font-size: 10pt; color: #A8A29E; margin-bottom: 20px; }
  .cover-period { font-size: 28pt; font-weight: 700; color: #F97316; margin-bottom: 6px; }
  .cover-generated { font-size: 8pt; color: #78716C; margin-bottom: 32px; }
  .kpi-row { display: flex; gap: 16px; justify-content: center; }
  .kpi-box {
    background: #292524;
    border-radius: 8px;
    padding: 14px 24px;
    text-align: center;
    min-width: 90px;
  }
  .kpi-value { font-size: 28pt; font-weight: 700; }
  .kpi-label { font-size: 8pt; color: #78716C; margin-top: 2px; }

  /* ── Section header ── */
  .section-title {
    font-size: 8pt;
    font-weight: 700;
    color: #F97316;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 10px;
    padding-bottom: 4px;
    border-bottom: 1px solid #3C3330;
  }

  /* ── Tables ── */
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  th {
    text-align: left;
    padding: 5px 8px;
    color: #78716C;
    font-weight: 600;
    border-bottom: 1px solid #3C3330;
    font-size: 7.5pt;
  }
  td { padding: 5px 8px; border-bottom: 1px solid #292524; }
  tr:last-child td { border-bottom: none; }
  .mono { font-family: "Courier New", Courier, monospace; }
  .right { text-align: right; }
  .muted { color: #78716C; }

  /* ── Alert severity colors ── */
  .sev-critical { color: #EF4444; }
  .sev-warning  { color: #EAB308; }
  .sev-info     { color: #38BDF8; }

  /* ── Summary cards ── */
  .card-row { display: flex; gap: 12px; margin-bottom: 16px; }
  .card {
    flex: 1;
    background: #292524;
    border-radius: 6px;
    padding: 10px 14px;
    text-align: center;
  }
  .card-value { font-size: 22pt; font-weight: 700; }
  .card-label { font-size: 7pt; color: #78716C; margin-top: 2px; }

  /* ── Map section ── */
  .map-img { width: 100%; border-radius: 6px; margin-bottom: 12px; }
  .map-legend { font-size: 7.5pt; color: #A8A29E; margin-top: -8px; margin-bottom: 12px; }
  .vehicle-kpis { display: flex; gap: 10px; margin-bottom: 12px; }
  .vehicle-kpi {
    flex: 1;
    background: #292524;
    border-radius: 5px;
    padding: 8px 12px;
    text-align: center;
  }
  .vehicle-kpi-value { font-size: 16pt; font-weight: 700; color: #F97316; }
  .vehicle-kpi-label { font-size: 7pt; color: #78716C; }

  /* ── SVG chart container ── */
  .chart-box {
    background: #292524;
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 16px;
  }
  .chart-label { font-size: 7.5pt; color: #78716C; margin-top: 4px; }

  /* ── Cost footer ── */
  .cost-total {
    text-align: right;
    font-size: 9pt;
    font-weight: 700;
    color: #E7E5E4;
    padding: 8px 8px 0;
    border-top: 1px solid #3C3330;
    margin-top: 4px;
  }
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════
     Página 1 — Portada
     ═══════════════════════════════════════════ -->
<div class="cover">
  {% if logo_url %}
    <img src="{{ logo_url }}" alt="logo" style="width:64px;height:64px;object-fit:contain;border-radius:10px;margin-bottom:16px;">
  {% else %}
    <div class="cover-logo">{{ tenant_name[0] | upper }}</div>
  {% endif %}

  <div class="cover-brand">{{ tenant_name }}</div>
  <div class="cover-subtitle">Informe mensual de operaciones</div>
  <div class="cover-period">{{ month_name }} {{ year }}</div>
  <div class="cover-generated">Generado el {{ generated_at }} — CMG Telematic</div>

  <div class="kpi-row">
    <div class="kpi-box">
      <div class="kpi-value" style="color:#F97316">{{ kpi_vehicles }}</div>
      <div class="kpi-label">Vehículos</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-value" style="color:#EF4444">{{ kpi_alerts }}</div>
      <div class="kpi-label">Alertas</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-value" style="color:#22C55E">{{ kpi_interventions }}</div>
      <div class="kpi-label">Intervenciones</div>
    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════
     Página 2 — Resumen de flota + Gráfica PTO
     ═══════════════════════════════════════════ -->
<div class="page-break">
  <div class="section-title">Flota — Resumen del mes</div>
  <table>
    <thead>
      <tr>
        <th>Vehículo</th>
        <th>Matrícula</th>
        <th class="right">H. Motor</th>
        <th class="right">H. PTO</th>
        <th class="right">Alertas</th>
      </tr>
    </thead>
    <tbody>
      {% for row in fleet_rows %}
      <tr>
        <td>{{ row.name }}</td>
        <td class="muted">{{ row.license_plate }}</td>
        <td class="right mono">{{ row.engine_hours }}h</td>
        <td class="right mono" style="color:#F97316">{{ row.pto_hours }}h</td>
        <td class="right mono {% if row.alert_count > 0 %}sev-critical{% else %}muted{% endif %}">
          {{ row.alert_count }}
        </td>
      </tr>
      {% endfor %}
    </tbody>
  </table>

  <br>
  <div class="section-title">Actividad diaria — Horas PTO (global flota)</div>
  <div class="chart-box">
    {{ pto_bar_chart_svg | safe }}
    <div class="chart-label">Días del mes (barras = horas PTO acumuladas de todos los vehículos)</div>
  </div>
</div>

<!-- ═══════════════════════════════════════════
     Página 3 — Alertas del período
     ═══════════════════════════════════════════ -->
<div class="page-break">
  <div class="section-title">Alertas del período</div>

  <div class="card-row">
    <div class="card">
      <div class="card-value sev-critical">{{ critical_count }}</div>
      <div class="card-label">Críticas</div>
    </div>
    <div class="card">
      <div class="card-value sev-warning">{{ warning_count }}</div>
      <div class="card-label">Advertencia</div>
    </div>
    <div class="card">
      <div class="card-value" style="color:#22C55E">{{ resolved_count }}</div>
      <div class="card-label">Resueltas</div>
    </div>
  </div>

  {% if alerts %}
  <table>
    <thead>
      <tr>
        <th>Regla</th>
        <th>Vehículo</th>
        <th>Fecha</th>
        <th>Estado</th>
      </tr>
    </thead>
    <tbody>
      {% for a in alerts %}
      <tr>
        <td class="sev-{{ a.severity }}">{{ a.rule_name }}</td>
        <td class="muted">{{ a.vehicle_name }}</td>
        <td class="muted mono">{{ a.triggered_at_fmt }}</td>
        <td class="muted">{{ a.status }}</td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
  {% else %}
    <p class="muted">Sin alertas en este período.</p>
  {% endif %}
</div>

<!-- ═══════════════════════════════════════════
     Página 4 — Mantenimiento
     ═══════════════════════════════════════════ -->
<div class="page-break">
  <div class="section-title">Intervenciones de mantenimiento</div>

  {% if maintenance %}
  <table>
    <thead>
      <tr>
        <th>Fecha</th>
        <th>Plan</th>
        <th>Vehículo</th>
        <th>Descripción</th>
        <th class="right">Coste</th>
      </tr>
    </thead>
    <tbody>
      {% for m in maintenance %}
      <tr>
        <td class="mono muted">{{ m.performed_at_fmt }}</td>
        <td>{{ m.plan_name }}</td>
        <td class="muted">{{ m.vehicle_name }}</td>
        <td class="muted">{{ m.description or "—" }}</td>
        <td class="right mono">
          {% if m.cost_eur is not none %}{{ "%.2f"|format(m.cost_eur) }} €{% else %}—{% endif %}
        </td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
  <div class="cost-total">Total: {{ "%.2f"|format(total_cost) }} €</div>
  {% else %}
    <p class="muted">Sin intervenciones registradas en este período.</p>
  {% endif %}
</div>

<!-- ═══════════════════════════════════════════
     Páginas GPS — Una por vehículo con datos GPS
     ═══════════════════════════════════════════ -->
{% for v in vehicles_with_gps %}
<div class="page-break">
  <div class="section-title">{{ v.name }}{% if v.license_plate %} — {{ v.license_plate }}{% endif %} — Recorrido {{ month_name }} {{ year }}</div>

  {% if v.map_base64 %}
    <img class="map-img" src="data:image/png;base64,{{ v.map_base64 }}" alt="Mapa GPS {{ v.name }}">
    <div class="map-legend">● Verde = inicio &nbsp; ● Azul = fin &nbsp; ● Rojo = alerta crítica</div>
  {% else %}
    <p class="muted" style="margin-bottom:12px">Mapa no disponible (sin conexión a tiles OSM).</p>
  {% endif %}

  <div class="vehicle-kpis">
    <div class="vehicle-kpi">
      <div class="vehicle-kpi-value">{{ v.engine_hours }}h</div>
      <div class="vehicle-kpi-label">Motor</div>
    </div>
    <div class="vehicle-kpi">
      <div class="vehicle-kpi-value">{{ v.pto_hours }}h</div>
      <div class="vehicle-kpi-label">PTO</div>
    </div>
    <div class="vehicle-kpi">
      <div class="vehicle-kpi-value {% if v.alert_count > 0 %}sev-critical{% endif %}">{{ v.alert_count }}</div>
      <div class="vehicle-kpi-label">Alertas</div>
    </div>
  </div>
</div>
{% endfor %}

</body>
</html>
```

- [ ] **Step 3: Verificar que Jinja2 puede cargar el template**

```bash
cd /opt/cmg-telematic1/backend
python -c "
from jinja2 import Environment, FileSystemLoader
env = Environment(loader=FileSystemLoader('app/templates'))
t = env.get_template('reports/monthly_report.html')
print('template ok')
"
```

Expected: `template ok`

- [ ] **Step 4: Commit**

```bash
git add backend/app/templates/
git commit -m "feat: add Jinja2 HTML template for monthly PDF report"
```

---

### Task 4: Backend — Endpoint reports.py + registro en router

**Files:**
- Create: `backend/app/api/v1/reports.py`
- Modify: `backend/app/api/v1/router.py`

- [ ] **Step 1: Crear backend/app/api/v1/reports.py**

```python
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.models.permission_grant import PermissionGrant
from app.models.tenant import Tenant
from app.models.vehicle import Vehicle
from app.schemas.auth import CurrentUser
from app.services.report_generator import generate_monthly_pdf

router = APIRouter(tags=["reports"])


@router.get("/monthly")
async def get_monthly_report(
    year: int = Query(...),
    month: int = Query(...),
    vehicle_ids: list[uuid.UUID] = Query(default=[]),
    tenant_id: uuid.UUID | None = Query(default=None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    # Validate year/month
    if not (2020 <= year <= 2100):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="year debe estar entre 2020 y 2100")
    if not (1 <= month <= 12):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="month debe estar entre 1 y 12")
    if len(vehicle_ids) > 15:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Máximo 15 vehículos por informe")

    # Resolve effective tenant_id and enforce permissions
    effective_tid: uuid.UUID

    if user.tenant_tier == "cmg" and user.role == "admin":
        if tenant_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tenant_id requerido para CMG admin")
        result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
        if result.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
        effective_tid = tenant_id

    elif user.role == "admin":
        # client admin: ignore tenant_id param, use their own
        if tenant_id is not None and tenant_id != user.tenant_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado para este tenant")
        effective_tid = user.tenant_id

    else:
        # subclient: check permission_grant with resource_type='reports'
        now = datetime.now(timezone.utc)
        result = await db.execute(
            select(PermissionGrant).where(
                PermissionGrant.grantee_id == user.tenant_id,
                PermissionGrant.resource_type == "reports",
                PermissionGrant.active == True,
                or_(PermissionGrant.expires_at.is_(None), PermissionGrant.expires_at > now),
            )
        )
        grant = result.scalar_one_or_none()
        if grant is None or "read" not in (grant.allowed_actions or []):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sin permiso para generar informes")
        effective_tid = grant.grantor_id

    # Resolve vehicle_ids: if empty, take first 15 active vehicles ordered by name
    resolved_vehicle_ids: list[uuid.UUID]
    if not vehicle_ids:
        result = await db.execute(
            select(Vehicle.id)
            .where(Vehicle.tenant_id == effective_tid, Vehicle.active == True)
            .order_by(Vehicle.name)
            .limit(15)
        )
        resolved_vehicle_ids = list(result.scalars().all())
    else:
        resolved_vehicle_ids = list(vehicle_ids)

    pdf_bytes = await generate_monthly_pdf(
        db=db,
        tenant_id=effective_tid,
        year=year,
        month=month,
        vehicle_ids=resolved_vehicle_ids,
    )

    filename = f"informe-{year}-{month:02d}.pdf"
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
```

- [ ] **Step 2: Registrar en router.py**

Añadir al final de `backend/app/api/v1/router.py`:

```python
from app.api.v1.auth import router as auth_router
from app.api.v1.vehicles import router as vehicles_router
from app.api.v1.alerts import router as alerts_router
from app.api.v1.rules import router as rules_router
from app.api.v1.tenants import router as tenants_router
from app.api.v1.settings import router as settings_router
from app.api.v1.maintenance import router as maintenance_router
from app.api.v1.users import router as users_router
from app.api.v1.reports import router as reports_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(vehicles_router)
api_router.include_router(alerts_router)
api_router.include_router(rules_router)
api_router.include_router(tenants_router)
api_router.include_router(settings_router)
api_router.include_router(maintenance_router)
api_router.include_router(users_router)
api_router.include_router(reports_router, prefix="/reports")
```

- [ ] **Step 3: Verificar que el endpoint se registra**

```bash
cd /opt/cmg-telematic1/backend
python -c "
from app.main import app
routes = [r.path for r in app.routes]
assert any('/api/v1/reports/monthly' in r for r in routes), f'route not found: {routes}'
print('endpoint registered ok')
"
```

Expected: `endpoint registered ok`

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/v1/reports.py backend/app/api/v1/router.py
git commit -m "feat: add GET /api/v1/reports/monthly endpoint with permission checks"
```

---

### Task 5: Backend — Tests del endpoint reports

**Files:**
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/api/__init__.py`
- Create: `backend/tests/api/conftest.py`
- Create: `backend/tests/api/test_reports_api.py`

- [ ] **Step 1: Crear directorios y __init__.py vacíos**

```bash
mkdir -p /opt/cmg-telematic1/backend/tests/api
touch /opt/cmg-telematic1/backend/tests/__init__.py
touch /opt/cmg-telematic1/backend/tests/api/__init__.py
```

- [ ] **Step 2: Escribir el test que debe fallar primero**

Crear `backend/tests/api/test_reports_api.py` con solo el test de autenticación:

```python
from unittest.mock import AsyncMock, MagicMock, patch
import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser

CMG_TENANT_ID    = uuid.UUID("10000000-0000-0000-0000-000000000000")
CLIENT_TENANT_ID = uuid.UUID("20000000-0000-0000-0000-000000000000")
OTHER_TENANT_ID  = uuid.UUID("30000000-0000-0000-0000-000000000000")

CMG_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CMG_TENANT_ID,
    tenant_tier="cmg", role="admin", email="cmg@test.com",
)
CLIENT_USER = CurrentUser(
    user_id=uuid.uuid4(), tenant_id=CLIENT_TENANT_ID,
    tenant_tier="client", role="admin", email="client@test.com",
)

def _make_db(tenant_exists: bool = True, vehicles: list = []):
    session = AsyncMock()
    tenant_result = MagicMock()
    tenant_result.scalar_one_or_none.return_value = (
        MagicMock(id=CLIENT_TENANT_ID) if tenant_exists else None
    )
    vehicles_result = MagicMock()
    vehicles_result.scalars.return_value.all.return_value = vehicles
    session.execute = AsyncMock(side_effect=[tenant_result, vehicles_result])
    return session


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def _override_user(user: CurrentUser):
    app.dependency_overrides[get_current_user] = lambda: user


def _override_db(session):
    async def _gen():
        yield session
    app.dependency_overrides[get_db] = _gen


def test_reports_unauthenticated():
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/reports/monthly?year=2026&month=4")
    assert resp.status_code == 403


def test_reports_invalid_month():
    _override_user(CLIENT_USER)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/reports/monthly?year=2026&month=13")
    assert resp.status_code == 400


def test_reports_too_many_vehicles():
    _override_user(CLIENT_USER)
    vids = "&".join(f"vehicle_ids={uuid.uuid4()}" for _ in range(16))
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/reports/monthly?year=2026&month=4&{vids}")
    assert resp.status_code == 400


def test_reports_client_admin_cross_tenant_forbidden():
    _override_user(CLIENT_USER)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get(f"/api/v1/reports/monthly?year=2026&month=4&tenant_id={OTHER_TENANT_ID}")
    assert resp.status_code == 403


def test_reports_client_admin_own_tenant():
    _override_user(CLIENT_USER)
    db = AsyncMock()
    # client admin: only 1 DB call (vehicle resolution, no tenant validation)
    vehicle_result = MagicMock()
    vehicle_result.scalars.return_value.all.return_value = []
    db.execute = AsyncMock(side_effect=[vehicle_result])
    _override_db(db)
    with patch("app.api.v1.reports.generate_monthly_pdf", return_value=b"%PDF-fake") as mock_gen:
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/api/v1/reports/monthly?year=2026&month=4")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    mock_gen.assert_called_once()


def test_reports_cmg_admin_returns_pdf():
    _override_user(CMG_USER)
    db = AsyncMock()
    # First call: tenant existence check
    tenant_result = MagicMock()
    tenant_result.scalar_one_or_none.return_value = MagicMock(id=CLIENT_TENANT_ID)
    # Second call: vehicle resolution
    vehicle_result = MagicMock()
    vehicle_result.scalars.return_value.all.return_value = []
    db.execute = AsyncMock(side_effect=[tenant_result, vehicle_result])
    _override_db(db)
    with patch("app.api.v1.reports.generate_monthly_pdf", return_value=b"%PDF-fake") as mock_gen:
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get(f"/api/v1/reports/monthly?year=2026&month=4&tenant_id={CLIENT_TENANT_ID}")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    mock_gen.assert_called_once()
```

- [ ] **Step 3: Ejecutar tests — deben fallar (no hay conftest aún, pero los tests deberían correr)**

```bash
cd /opt/cmg-telematic1/backend
python -m pytest tests/api/test_reports_api.py -v 2>&1 | head -40
```

Expected: todos los tests deben pasar o algunos fallan por problemas de configuración (no por la lógica del test). Si falla `test_reports_unauthenticated` con error de configuración de DB (settings), eso es esperado; el endpoint intenta conectar a Redis/DB en el lifespan.

Nota: los tests usan `raise_server_exceptions=False` para capturar errores HTTP correctamente. Si el startup del lifespan falla por falta de Redis/DB en el entorno de test, usar `app` con overrides puede lanzar errores. En ese caso el endpoint devuelve 500, no el código esperado.

Si los tests fallan por lifespan (Redis/DB no disponibles), añadir `lifespan=None` override:

```bash
cd /opt/cmg-telematic1/backend
python -m pytest tests/api/test_reports_api.py -v --no-header -q
```

Expected: 6 tests passing.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/ backend/tests/__init__.py backend/tests/api/__init__.py backend/tests/api/test_reports_api.py
git commit -m "test: backend tests for GET /api/v1/reports/monthly — permissions and response contract"
```

---

### Task 6: Frontend — apiClient.getBlob + queryKeys.vehiclesByTenant

**Files:**
- Modify: `frontend/src/lib/apiClient.ts`
- Modify: `frontend/src/lib/queryKeys.ts`

- [ ] **Step 1: Añadir getBlob a apiClient.ts**

Reemplazar el bloque `export const apiClient` al final del fichero:

```ts
export const apiClient = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  getBlob: async (path: string): Promise<Blob> => {
    const token = useAuthStore.getState().accessToken
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    let res: Response
    try {
      res = await fetch(path, { method: 'GET', headers })
    } catch {
      throw new Error('Error de red')
    }
    if (!res.ok) throw new Error(`${res.status}`)
    return res.blob()
  },
}
```

- [ ] **Step 2: Añadir vehiclesByTenant a queryKeys.ts**

Añadir la línea `vehiclesByTenant` al objeto `keys`, tras la línea `vehicles`:

```ts
export const keys = {
  vehicles: () => ['vehicles'] as const,
  vehiclesByTenant: (tenantId: string) => ['vehicles', 'by-tenant', tenantId] as const,
  vehicle: (id: string) => ['vehicles', id] as const,
  // ... resto sin cambios
```

(Modificar solo la línea de `vehicles` añadiendo la nueva key inmediatamente debajo.)

- [ ] **Step 3: Verificar compilación TypeScript**

```bash
cd /opt/cmg-telematic1/frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: sin errores en los ficheros modificados.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/apiClient.ts frontend/src/lib/queryKeys.ts
git commit -m "feat: add apiClient.getBlob() and queryKeys.vehiclesByTenant"
```

---

### Task 7: Frontend — IconReportes en icons.tsx

**Files:**
- Modify: `frontend/src/shared/ui/icons.tsx`

- [ ] **Step 1: Añadir IconReportes al final de icons.tsx**

Añadir después del último export (después de `IconClientes`):

```tsx
// Reports: document with horizontal lines (file-text)
export function IconReportes(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </Icon>
  )
}
```

- [ ] **Step 2: Verificar compilación**

```bash
cd /opt/cmg-telematic1/frontend
npx tsc --noEmit 2>&1 | grep icons
```

Expected: sin errores en icons.tsx.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/shared/ui/icons.tsx
git commit -m "feat: add IconReportes (document icon) to icons.tsx"
```

---

### Task 8: Frontend — Entrada Reportes en Sidebar

**Files:**
- Modify: `frontend/src/shared/ui/Sidebar.tsx`

- [ ] **Step 1: Añadir import de IconReportes**

En la línea de imports de icons (línea 4 del fichero actual):

```ts
import { IconFlota, IconAlertas, IconReglas, IconMantenimiento, IconAjustes, IconClientes, IconReportes } from './icons'
```

- [ ] **Step 2: Añadir NavLink de Reportes visible para admin**

Añadir después del bloque `{isCmg && (...IconClientes...)}` y antes del `<div style={{ marginTop: 'auto' }}>`:

```tsx
{isAdmin && (
  <NavLink
    to="/reports"
    title="Reportes"
    style={({ isActive }) => ({
      width: 36, height: 36,
      borderRadius: 8,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: isActive ? 'var(--accent-energy)' : 'var(--text-muted)',
      background: isActive ? 'color-mix(in srgb, var(--accent-energy) 15%, transparent)' : 'transparent',
      transition: 'background 0.15s, color 0.15s',
    })}
  >
    <IconReportes width={20} height={20}/>
  </NavLink>
)}
```

- [ ] **Step 3: Verificar compilación**

```bash
cd /opt/cmg-telematic1/frontend
npx tsc --noEmit 2>&1 | grep Sidebar
```

Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/shared/ui/Sidebar.tsx
git commit -m "feat: add Reportes entry to Sidebar for admin role"
```

---

### Task 9: Frontend — ReportsPage.tsx

**Files:**
- Create: `frontend/src/features/reports/ReportsPage.tsx`

- [ ] **Step 1: Crear el directorio y el fichero**

```bash
mkdir -p /opt/cmg-telematic1/frontend/src/features/reports/__tests__
```

- [ ] **Step 2: Crear ReportsPage.tsx**

Crear `frontend/src/features/reports/ReportsPage.tsx`:

```tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import type { TenantOut, VehicleOut } from '../../lib/types'

function getPreviousMonth(): { year: number; month: number } {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

const MONTHS = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

export default function ReportsPage() {
  const user = useAuthStore(s => s.user)
  const isCmg = user?.tenant_tier === 'cmg'

  const prev = getPreviousMonth()
  const [year, setYear] = useState(prev.year)
  const [month, setMonth] = useState(prev.month)
  const [tenantId, setTenantId] = useState('')
  const [vehicleIds, setVehicleIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: tenants = [] } = useQuery<TenantOut[]>({
    queryKey: keys.tenants(),
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants'),
    enabled: isCmg,
    staleTime: 60_000,
  })

  const effectiveTenantId = isCmg ? tenantId : (user?.tenant_id ?? '')

  const { data: vehicles = [] } = useQuery<VehicleOut[]>({
    queryKey: isCmg
      ? keys.vehiclesByTenant(effectiveTenantId)
      : keys.vehicles(),
    queryFn: () =>
      isCmg
        ? apiClient.get<VehicleOut[]>(`/api/v1/vehicles?tenant_id=${effectiveTenantId}`)
        : apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    enabled: !isCmg || Boolean(effectiveTenantId),
    staleTime: 60_000,
  })

  // Auto-select first tenant when CMG list loads
  if (isCmg && tenants.length > 0 && !tenantId) {
    const firstClient = tenants.find(t => t.tier !== 'cmg')
    if (firstClient) setTenantId(firstClient.id)
  }

  function toggleVehicle(id: string) {
    setVehicleIds(prev =>
      prev.includes(id) ? prev.filter(v => v !== id) : prev.length < 15 ? [...prev, id] : prev
    )
  }

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) })
      vehicleIds.forEach(id => params.append('vehicle_ids', id))
      if (isCmg && effectiveTenantId) params.set('tenant_id', effectiveTenantId)
      const blob = await apiClient.getBlob(`/api/v1/reports/monthly?${params}`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `informe-${year}-${String(month).padStart(2, '0')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Error al generar el informe. Inténtalo de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--bg-border)',
    color: 'var(--text-primary)',
    borderRadius: 6,
    padding: '7px 10px',
    fontSize: 13,
    width: '100%',
  } as const

  const labelStyle = {
    display: 'block',
    fontSize: 11,
    color: 'var(--text-muted)',
    marginBottom: 4,
  } as const

  return (
    <Shell title="Reportes">
      <div style={{ padding: 24, maxWidth: 560 }}>
        <div style={{ marginBottom: 20, color: 'var(--text-muted)', fontSize: 13 }}>
          Genera el informe mensual de operaciones en PDF: flota, alertas, mantenimiento y mapas GPS.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Tenant selector — CMG admin only */}
          {isCmg && (
            <div>
              <label style={labelStyle}>Cliente</label>
              <select
                value={tenantId}
                onChange={e => { setTenantId(e.target.value); setVehicleIds([]) }}
                style={inputStyle}
              >
                <option value="">— Selecciona un cliente —</option>
                {tenants.filter(t => t.tier !== 'cmg').map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Period */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Año</label>
              <input
                type="number"
                min={2020}
                max={2100}
                value={year}
                onChange={e => setYear(Number(e.target.value))}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Mes</label>
              <select value={month} onChange={e => setMonth(Number(e.target.value))} style={inputStyle}>
                {MONTHS.slice(1).map((name, i) => (
                  <option key={i + 1} value={i + 1}>{name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Vehicle multi-select */}
          {vehicles.length > 0 && (
            <div>
              <label style={labelStyle}>
                Vehículos ({vehicleIds.length > 0 ? `${vehicleIds.length} seleccionados` : 'todos los activos, máx. 15'})
              </label>
              <div style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--bg-border)',
                borderRadius: 6,
                maxHeight: 200,
                overflowY: 'auto',
                padding: 4,
              }}>
                {vehicles.map(v => (
                  <label
                    key={v.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '5px 8px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 13,
                      color: 'var(--text-primary)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={vehicleIds.includes(v.id)}
                      onChange={() => toggleVehicle(v.id)}
                      disabled={!vehicleIds.includes(v.id) && vehicleIds.length >= 15}
                    />
                    {v.name}
                    {v.license_plate && (
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                        {v.license_plate}
                      </span>
                    )}
                  </label>
                ))}
              </div>
              {vehicleIds.length >= 15 && (
                <div style={{ fontSize: 11, color: 'var(--accent-warn)', marginTop: 4 }}>
                  Máximo 15 vehículos por informe.
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid var(--accent-crit)',
              color: 'var(--accent-crit)',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 13,
            }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleGenerate}
            disabled={loading || (isCmg && !effectiveTenantId)}
            style={{
              background: loading || (isCmg && !effectiveTenantId) ? 'var(--bg-elevated)' : 'var(--accent-energy)',
              color: loading || (isCmg && !effectiveTenantId) ? 'var(--text-muted)' : '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 600,
              cursor: loading || (isCmg && !effectiveTenantId) ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {loading ? 'Generando…' : '↓ Generar PDF'}
          </button>
        </div>
      </div>
    </Shell>
  )
}
```

- [ ] **Step 3: Verificar compilación**

```bash
cd /opt/cmg-telematic1/frontend
npx tsc --noEmit 2>&1 | grep -i report
```

Expected: sin errores en ReportsPage.tsx.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/reports/ReportsPage.tsx
git commit -m "feat: add ReportsPage — tenant/month/vehicle form + PDF download"
```

---

### Task 10: Frontend — Ruta /reports en App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Añadir lazy import y ruta**

En `App.tsx`, añadir la importación lazy tras la última importación de lazy:

```tsx
const ReportsPage = lazy(() => import('./features/reports/ReportsPage'))
```

Y añadir la ruta dentro del bloque `<Routes>` interno (antes de `path="*"`):

```tsx
<Route path="reports" element={<ReportsPage />} />
```

El fichero completo actualizado queda:

```tsx
import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './features/auth/LoginPage'
import RequireAuth from './features/auth/RequireAuth'

const FleetPage         = lazy(() => import('./features/fleet/FleetPage'))
const VehicleDetailPage = lazy(() => import('./features/vehicle/VehicleDetailPage'))
const AlertsPage        = lazy(() => import('./features/alerts/AlertsPage'))
const SettingsPage      = lazy(() => import('./features/settings/SettingsPage'))
const RulesPage                  = lazy(() => import('./features/rules/RulesPage'))
const RuleFormPage               = lazy(() => import('./features/rules/RuleFormPage'))
const MaintenancePage            = lazy(() => import('./features/maintenance/MaintenancePage'))
const MaintenancePlanFormPage    = lazy(() => import('./features/maintenance/MaintenancePlanFormPage'))
const MaintenancePlanDetailPage  = lazy(() => import('./features/maintenance/MaintenancePlanDetailPage'))
const TenantsPage      = lazy(() => import('./features/clientes/TenantsPage'))
const TenantFormPage   = lazy(() => import('./features/clientes/TenantFormPage'))
const TenantDetailPage = lazy(() => import('./features/clientes/TenantDetailPage'))
const ReportsPage      = lazy(() => import('./features/reports/ReportsPage'))

function Loading() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-base)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-muted)',
    }}>
      Cargando…
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="fleet"        element={<FleetPage />} />
                <Route path="vehicles/:id" element={<VehicleDetailPage />} />
                <Route path="alerts"       element={<AlertsPage />} />
                <Route path="settings"     element={<SettingsPage />} />
                <Route path="rules"              element={<RulesPage />} />
                <Route path="rules/new"          element={<RuleFormPage />} />
                <Route path="rules/:id"          element={<RuleFormPage />} />
                <Route path="maintenance"          element={<MaintenancePage />} />
                <Route path="maintenance/new"      element={<MaintenancePlanFormPage />} />
                <Route path="maintenance/:id"      element={<MaintenancePlanDetailPage />} />
                <Route path="maintenance/:id/edit" element={<MaintenancePlanFormPage />} />
                <Route path="clientes"          element={<TenantsPage />} />
                <Route path="clientes/new"      element={<TenantFormPage />} />
                <Route path="clientes/:id"      element={<TenantDetailPage />} />
                <Route path="clientes/:id/edit" element={<TenantFormPage />} />
                <Route path="reports"           element={<ReportsPage />} />
                <Route path="*"                 element={<Navigate to="/fleet" replace />} />
              </Routes>
            </Suspense>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
```

- [ ] **Step 2: Verificar compilación**

```bash
cd /opt/cmg-telematic1/frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: add /reports route in App.tsx"
```

---

### Task 11: Frontend — Tests de ReportsPage

**Files:**
- Create: `frontend/src/features/reports/__tests__/ReportsPage.test.tsx`

- [ ] **Step 1: Escribir los tests**

Crear `frontend/src/features/reports/__tests__/ReportsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import ReportsPage from '../ReportsPage'
import type { TenantOut, VehicleOut } from '../../../lib/types'

const mockGetBlob = vi.hoisted(() => vi.fn())

vi.mock('../../../lib/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    getBlob: mockGetBlob,
  },
}))
vi.mock('../../auth/useAuthStore', () => ({
  useAuthStore: vi.fn(),
}))

import { apiClient } from '../../../lib/apiClient'
import { useAuthStore } from '../../auth/useAuthStore'

const cmgUser = { user_id: 'u1', tenant_id: 't0', tenant_tier: 'cmg', role: 'admin', email: 'cmg@test.com' }
const clientUser = { user_id: 'u2', tenant_id: 't1', tenant_tier: 'client', role: 'admin', email: 'c@test.com' }

const mockTenants: TenantOut[] = [
  { id: 't1', parent_id: 't0', tier: 'client', name: 'Wasterent', slug: 'wasterent', active: true,
    brand_name: null, brand_color: null, logo_url: null, custom_domain: null, brand_tokens: null, created_at: '' },
]
const mockVehicles: VehicleOut[] = [
  { id: 'v1', tenant_id: 't1', vehicle_type_id: 'vt1', name: 'WAS-001',
    license_plate: 'WAS001', vin: null, year: null, active: true },
]

function wrap(userData = clientUser, tenants: TenantOut[] = [], vehicles: VehicleOut[] = []) {
  vi.mocked(useAuthStore).mockReturnValue(userData as any)
  vi.mocked(apiClient.get).mockImplementation((path: string) => {
    if (path.includes('tenants')) return Promise.resolve(tenants) as any
    if (path.includes('vehicles')) return Promise.resolve(vehicles) as any
    return Promise.resolve([]) as any
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('ReportsPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renderiza formulario con mes anterior por defecto', () => {
    wrap()
    const now = new Date()
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const expectedYear = prev.getFullYear()
    expect(screen.getByDisplayValue(String(expectedYear))).toBeInTheDocument()
  })

  it('CMG admin ve selector de cliente', async () => {
    wrap(cmgUser, mockTenants)
    expect(await screen.findByText('Cliente')).toBeInTheDocument()
  })

  it('client admin no ve selector de cliente', () => {
    wrap(clientUser, [])
    expect(screen.queryByText('Cliente')).not.toBeInTheDocument()
  })

  it('llama a getBlob con params correctos al enviar', async () => {
    mockGetBlob.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }))
    global.URL.createObjectURL = vi.fn(() => 'blob:fake')
    global.URL.revokeObjectURL = vi.fn()
    const mockClick = vi.fn()
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const el = { href: '', download: '', click: mockClick } as unknown as HTMLAnchorElement
        return el
      }
      return document.createElement(tag)
    })

    wrap(clientUser, [], mockVehicles)
    const btn = await screen.findByText('↓ Generar PDF')
    fireEvent.click(btn)
    await waitFor(() => expect(mockGetBlob).toHaveBeenCalled())
    const calledUrl: string = mockGetBlob.mock.calls[0][0]
    expect(calledUrl).toContain('/api/v1/reports/monthly')
    expect(calledUrl).toContain('year=')
    expect(calledUrl).toContain('month=')
    expect(mockClick).toHaveBeenCalled()
  })

  it('muestra estado de carga mientras genera', async () => {
    let resolve!: (v: Blob) => void
    mockGetBlob.mockReturnValue(new Promise<Blob>(r => { resolve = r }))
    global.URL.createObjectURL = vi.fn(() => 'blob:fake')
    global.URL.revokeObjectURL = vi.fn()

    wrap(clientUser)
    const btn = screen.getByText('↓ Generar PDF')
    fireEvent.click(btn)
    await waitFor(() => expect(screen.getByText('Generando…')).toBeInTheDocument())
    expect(screen.getByText('Generando…')).toBeDisabled()
    resolve(new Blob(['%PDF'], { type: 'application/pdf' }))
    await waitFor(() => expect(screen.getByText('↓ Generar PDF')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Ejecutar los tests para confirmar que fallan**

```bash
cd /opt/cmg-telematic1/frontend
npx vitest run src/features/reports/__tests__/ReportsPage.test.tsx 2>&1 | tail -20
```

Expected: los tests aparecen (no errores de compilación). Pueden fallar por lógica aún no implementada si el componente tiene algún bug; en tal caso ajustar el componente.

- [ ] **Step 3: Ejecutar todos los tests frontend para detectar regresiones**

```bash
cd /opt/cmg-telematic1/frontend
npx vitest run 2>&1 | tail -30
```

Expected: todos los tests pasan. Si hay regresiones en otros tests, investigar y corregir.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/reports/__tests__/ReportsPage.test.tsx
git commit -m "test: frontend tests for ReportsPage — form, role visibility, getBlob params, loading state"
```
