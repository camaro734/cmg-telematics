import asyncio
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

    # 2. Vehicle names + type
    vehicles_row = await db.execute(
        text("""
            SELECT v.id, v.name, v.license_plate, vt.name AS type_name
            FROM vehicle v
            LEFT JOIN vehicle_type vt ON vt.id = v.vehicle_type_id
            WHERE v.tenant_id = :tid AND v.id = ANY(:vids)
        """),
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
                  AND time BETWEEN :t_min AND :t_max
                ORDER BY ABS(EXTRACT(EPOCH FROM (time - :t_ref)))
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
            SELECT ml.performed_at, u.email AS performed_by_email,
                   ml.description, ml.cost_eur,
                   mp.name AS plan_name, v.name AS vehicle_name
            FROM maintenance_log ml
            JOIN maintenance_plan mp ON mp.id = ml.plan_id
            JOIN vehicle v ON v.id = ml.vehicle_id
            LEFT JOIN "user" u ON u.id = ml.performed_by
            WHERE mp.tenant_id = :tid
              AND ml.performed_at >= :start AND ml.performed_at < :end
              AND ml.vehicle_id = ANY(:vids)
            ORDER BY ml.performed_at
        """),
        {"tid": tid, "start": start, "end": end, "vids": [str(v) for v in vehicle_ids]},
    )
    maintenance = [dict(r) for r in maint_row.mappings().all()]
    for m in maintenance:
        m["performed_at_fmt"] = m["performed_at"].strftime("%d/%m/%Y") if m["performed_at"] else ""
    total_cost = sum(float(m["cost_eur"]) for m in maintenance if m["cost_eur"] is not None)

    # 7. GPS tracks + maps per vehicle
    vehicles_with_gps = []
    for v in vehicles:
        vid = str(v["id"])
        track_row = await db.execute(
            text("""
                SELECT lat, lon FROM (
                  SELECT lat, lon,
                         ROW_NUMBER() OVER (ORDER BY time) AS rn,
                         COUNT(*) OVER () AS total
                  FROM telemetry_record
                  WHERE vehicle_id = :vid
                    AND time >= :start AND time < :end
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
            "type_name": v.get("type_name") or "",
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
            "type_name": v.get("type_name") or "",
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
    pdf_bytes = await asyncio.to_thread(
        lambda: weasyprint.HTML(string=html, base_url=str(_TEMPLATES_DIR)).write_pdf()
    )
    return pdf_bytes
