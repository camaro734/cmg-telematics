import asyncio
import base64
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from jinja2 import Environment, BaseLoader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from weasyprint import HTML

from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.models.driver import Driver
from app.models.tenant import Tenant
from app.models.vehicle import Vehicle
from app.models.vehicle_type import VehicleType
from app.models.work_order import WorkOrder
from app.models.work_order_stop import WorkOrderStop
from app.models.work_report import WorkReport
from app.schemas.auth import CurrentUser
from app.schemas.work_report import WorkReportCreate, WorkReportOut

router = APIRouter(prefix="/work-orders", tags=["work-reports"])

UPLOADS_DIR = (
    Path("/app/uploads/work_reports")
    if Path("/app/uploads").exists()
    else Path(__file__).resolve().parent.parent.parent.parent / "uploads" / "work_reports"
)

ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

# ── PDF HTML template ─────────────────────────────────────────────────────────


def format_metric(value, fmt: str, unit: str) -> str:
    """Formatea un valor numérico para la tabla de paradas del PDF."""
    if value is None:
        return "—"
    if fmt == "integer":
        return f"{int(value)} {unit}"
    if fmt == "decimal1":
        return f"{value:.1f} {unit}"
    if fmt == "decimal2":
        return f"{value:.2f} {unit}"
    return f"{value} {unit}"


_PDF_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 18mm 16mm;
    @bottom-left  { content: "{{ brand_name }} · {{ doc_number or '' }}"; font-size: 8px; color: #aaa; }
    @bottom-right { content: "Página " counter(page) " de " counter(pages); font-size: 8px; color: #aaa; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #222; }
  .header { display: flex; justify-content: space-between; align-items: flex-start;
            border-bottom: 2px solid {{ primary_color }}; padding-bottom: 12px; margin-bottom: 18px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-logo { max-height: 44px; max-width: 160px; }
  .brand-name { font-size: 16px; font-weight: 700; color: {{ primary_color }}; }
  .brand-sub { font-size: 10px; color: #888; margin-top: 2px; }
  .doc-info { text-align: right; font-size: 10px; color: #555; }
  .doc-info .num { font-size: 14px; color: #222; font-weight: 700; display: block; }
  h2 { font-size: 11px; font-weight: 700; color: #1a1a1a; text-transform: uppercase;
       letter-spacing: 0.04em; border-left: 3px solid {{ primary_color }}; padding-left: 8px;
       margin: 14px 0 8px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; background: #fafafa;
             border: 1px solid #ececec; border-radius: 4px; padding: 10px 12px; }
  .party-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em;
                 color: {{ primary_color }}; font-weight: 700; margin-bottom: 4px; }
  .party-line { font-size: 11px; line-height: 1.4; }
  .service-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px 16px;
                  font-size: 10px; margin-bottom: 6px; }
  .field-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; }
  .field-value { font-size: 11px; color: #222; font-weight: 500; margin-top: 1px; }
  .description-box { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 4px;
                     padding: 8px 10px; font-size: 10.5px; line-height: 1.5; white-space: pre-wrap; }
  table.stops { width: 100%; border-collapse: collapse; font-size: 10px; }
  table.stops thead { display: table-header-group; }
  table.stops th { background: #f3f3f3; color: #555; padding: 6px 8px; text-align: left;
                   font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em;
                   border-bottom: 1px solid #ddd; }
  table.stops td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  table.stops td.num { font-weight: 700; color: {{ primary_color }}; width: 28px; }
  table.stops td.metric { font-family: 'JetBrains Mono', monospace; text-align: right; white-space: nowrap; }
  table.stops .stop-client { font-size: 9px; color: #888; margin-top: 2px; }
  .photos-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 6px; }
  .photo-img { width: 100%; height: 110px; object-fit: cover; border-radius: 3px; border: 1px solid #ddd; }
  .signature-section { margin-top: 22px; page-break-inside: avoid; }
  .signature-box { border: 1px solid #ccc; border-radius: 4px; padding: 10px 14px;
                   display: inline-block; min-width: 280px; }
  .signature-img { max-height: 90px; max-width: 280px; display: block; margin-bottom: 4px; }
  .signature-meta { font-size: 10px; color: #444; line-height: 1.4; padding-top: 4px; border-top: 1px solid #eee; }
  .signature-meta b { font-size: 11px; color: #222; }
  .unsigned-note { font-size: 11px; color: #777; font-style: italic; padding: 8px 0; }
  .unsigned-note b { color: #555; font-style: normal; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">
      {% if logo_url %}<img class="brand-logo" src="{{ logo_url }}"/>{% endif %}
      <div>
        <div class="brand-name">{{ brand_name }}</div>
        <div class="brand-sub">Parte de servicio</div>
      </div>
    </div>
    <div class="doc-info">
      {% if doc_number %}<span class="num">{{ doc_number }}</span>{% endif %}
      {{ completed_date or '—' }}
      {% if completed_time %}<br>{{ completed_time }}{% endif %}
    </div>
  </div>

  <div class="parties">
    <div>
      <div class="party-label">Emite</div>
      <div class="party-line"><b>{{ brand_name }}</b></div>
      {% if business_cif %}<div class="party-line">CIF: {{ business_cif }}</div>{% endif %}
      {% if business_address %}<div class="party-line">{{ business_address }}</div>{% endif %}
    </div>
    <div>
      <div class="party-label">Cliente</div>
      <div class="party-line"><b>{{ final_client_name or '—' }}</b></div>
      {% if final_client_address %}<div class="party-line">{{ final_client_address }}</div>{% endif %}
    </div>
  </div>

  <h2>Servicio realizado</h2>
  <div class="service-grid">
    <div><div class="field-label">Vehículo</div><div class="field-value">{{ vehicle_label or '—' }}</div></div>
    <div><div class="field-label">Conductor</div><div class="field-value">{{ driver_name or '—' }}</div></div>
    <div><div class="field-label">Duración</div><div class="field-value">{{ duration_label or '—' }}</div></div>
  </div>
  {% if order_title %}<div class="field-value" style="margin: 6px 0 4px;"><b>{{ order_title }}</b></div>{% endif %}
  {% if description %}<div class="description-box">{{ description }}</div>{% endif %}

  {% if stops %}
  <h2>Paradas y mediciones</h2>
  <table class="stops">
    <thead>
      <tr>
        <th>#</th><th>Ubicación</th>
        {% for m in pdf_metrics %}<th style="text-align:right">{{ m.label }}</th>{% endfor %}
      </tr>
    </thead>
    <tbody>
      {% for s in stops %}
      <tr>
        <td class="num">{{ loop.index }}</td>
        <td>
          <div>{{ s.address or '—' }}</div>
          {% if s.client_name %}<div class="stop-client">{{ s.client_name }}</div>{% endif %}
        </td>
        {% for m in pdf_metrics %}<td class="metric">{{ format_metric(s.get(m.key), m.format, m.unit) }}</td>{% endfor %}
      </tr>
      {% endfor %}
    </tbody>
  </table>
  {% endif %}

  {% if materials_used %}
  <h2>Materiales utilizados</h2>
  <table class="stops">
    <thead><tr><th>Material</th><th style="text-align:right">Cantidad</th><th>Unidad</th></tr></thead>
    <tbody>
      {% for m in materials_used %}
      <tr><td>{{ m.name }}</td><td class="metric">{{ m.quantity }}</td><td>{{ m.unit or '—' }}</td></tr>
      {% endfor %}
    </tbody>
  </table>
  {% endif %}

  {% if photo_urls %}
  <h2>Fotografías</h2>
  <div class="photos-grid">
    {% for url in photo_urls %}<img class="photo-img" src="{{ url }}"/>{% endfor %}
  </div>
  {% endif %}

  <div class="signature-section">
    <h2>Conformidad del cliente</h2>
    {% if signature_url %}
      <div class="signature-box">
        <img class="signature-img" src="{{ signature_url }}"/>
        <div class="signature-meta">
          <b>{{ signee_name }}</b><br>
          DNI: {{ signee_dni }}
        </div>
      </div>
    {% else %}
      <div class="unsigned-note">
        Parte cerrado sin firma del cliente. <b>Motivo:</b> {{ unsigned_reason or '—' }}
      </div>
    {% endif %}
  </div>
</body>
</html>
"""

_jinja_env = Environment(loader=BaseLoader())
_jinja_env.globals['format_metric'] = format_metric
_template = _jinja_env.from_string(_PDF_TEMPLATE)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_order_authorized(
    order_id: uuid.UUID,
    user: CurrentUser,
    db: AsyncSession,
) -> WorkOrder:
    result = await db.execute(select(WorkOrder).where(WorkOrder.id == order_id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if user.tenant_tier != "cmg" and str(order.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=403, detail="Sin acceso")
    return order


async def _get_or_create_report(order: WorkOrder, db: AsyncSession) -> WorkReport:
    result = await db.execute(select(WorkReport).where(WorkReport.work_order_id == order.id))
    report = result.scalar_one_or_none()
    if not report:
        report = WorkReport(
            id=uuid.uuid4(),
            work_order_id=order.id,
            tenant_id=order.tenant_id,
            vehicle_id=order.vehicle_id,
            driver_id=order.driver_id,
            photo_urls=[],
            materials_used=[],
        )
        db.add(report)
        await db.flush()
    return report


def _save_signature(data_url: str, report_id: uuid.UUID) -> str:
    if "," not in data_url:
        raise HTTPException(status_code=400, detail="Firma inválida")
    header, encoded = data_url.split(",", 1)
    ext = ".png" if "png" in header else ".jpg"
    sig_dir = UPLOADS_DIR / str(report_id)
    sig_dir.mkdir(parents=True, exist_ok=True)
    dest = sig_dir / f"signature{ext}"
    dest.write_bytes(base64.b64decode(encoded))
    return f"/uploads/work_reports/{report_id}/signature{ext}"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{order_id}/report", response_model=WorkReportOut)
async def get_report(
    order_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_order_authorized(order_id, user, db)
    result = await db.execute(select(WorkReport).where(WorkReport.work_order_id == order_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Sin informe todavía")
    return report


@router.post("/{order_id}/report", response_model=WorkReportOut, status_code=status.HTTP_200_OK)
async def upsert_report(
    order_id: uuid.UUID,
    body: WorkReportCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    order = await _get_order_authorized(order_id, user, db)
    report = await _get_or_create_report(order, db)

    report.description = body.description
    report.work_duration_minutes = body.work_duration_minutes
    report.materials_used = [m.model_dump() for m in body.materials_used]

    # Datos del firmante o motivo de no firma (XOR ya validado en el schema)
    unsigned = (body.unsigned_reason or '').strip() or None
    if unsigned:
        # Modo "no se puede firmar": limpiar campos de firma
        report.unsigned_reason = unsigned
        report.signature_url = None
        report.client_signee_name = None
        report.client_signee_dni = None
    else:
        report.client_signee_name = (body.client_signee_name or '').strip() or None
        report.client_signee_dni = (body.client_signee_dni or '').strip() or None
        report.unsigned_reason = None
        if body.signature_data:
            report.signature_url = _save_signature(body.signature_data, report.id)

    await db.commit()
    await db.refresh(report)
    return report


@router.post("/{order_id}/report/photos", response_model=WorkReportOut)
async def upload_photo(
    order_id: uuid.UUID,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    order = await _get_order_authorized(order_id, user, db)
    report = await _get_or_create_report(order, db)

    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail="Formato no admitido. Usa JPG o PNG.")

    photo_id = uuid.uuid4()
    dest_dir = UPLOADS_DIR / str(report.id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{photo_id}{ext}"
    dest.write_bytes(await file.read())

    urls: list = list(report.photo_urls or [])
    urls.append(f"/uploads/work_reports/{report.id}/{photo_id}{ext}")
    report.photo_urls = urls

    await db.commit()
    await db.refresh(report)
    return report


@router.delete("/{order_id}/report", status_code=status.HTTP_204_NO_CONTENT)
async def delete_report(
    order_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="No autorizado")
    await _get_order_authorized(order_id, user, db)
    result = await db.execute(select(WorkReport).where(WorkReport.work_order_id == order_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Informe no encontrado")
    await db.delete(report)
    await db.commit()


@router.get("/{order_id}/report/pdf")
async def download_pdf(
    order_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    order = await _get_order_authorized(order_id, user, db)
    rep_q = await db.execute(select(WorkReport).where(WorkReport.work_order_id == order_id))
    report = rep_q.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Sin informe para generar PDF")

    # Tenant emisor + branding
    tr = await db.execute(select(Tenant).where(Tenant.id == order.tenant_id))
    tenant = tr.scalar_one_or_none()
    brand_name = (tenant.brand_name or tenant.name) if tenant else "CMG Track"
    business_cif = tenant.business_cif if tenant else None
    business_address = tenant.business_address if tenant else None
    # primary_color: prioriza brand_tokens.primary_color, luego brand_tokens.brand_color
    # (formato de BrandTokensEditor), luego tenant.brand_color (columna), fallback naranja CMG.
    if tenant:
        bt = tenant.brand_tokens or {}
        primary_color = (
            bt.get("primary_color")
            or bt.get("brand_color")
            or tenant.brand_color
            or "#F97316"
        )
    else:
        primary_color = "#F97316"
    logo_url = tenant.logo_url if tenant else None

    # Vehicle + tipo (para pdf_metrics) + label
    vehicle = None
    vtype = None
    if order.vehicle_id:
        vr = await db.execute(select(Vehicle).where(Vehicle.id == order.vehicle_id))
        vehicle = vr.scalar_one_or_none()
        if vehicle and vehicle.vehicle_type_id:
            tq = await db.execute(select(VehicleType).where(VehicleType.id == vehicle.vehicle_type_id))
            vtype = tq.scalar_one_or_none()
    pdf_metrics = (vtype.pdf_metrics if vtype else None) or []
    if vehicle:
        vehicle_label = (
            f"{vehicle.name} · {vehicle.license_plate}" if vehicle.license_plate
            else vehicle.name
        )
    else:
        vehicle_label = None

    # Conductor
    driver_name = None
    if order.driver_id:
        dr = await db.execute(select(Driver).where(Driver.id == order.driver_id))
        d = dr.scalar_one_or_none()
        driver_name = d.full_name if d else None

    # Paradas con telemetría
    stops_q = await db.execute(
        select(WorkOrderStop).where(WorkOrderStop.work_order_id == order_id)
        .order_by(WorkOrderStop.order_index)
    )
    stops = [
        {
            "address": s.address,
            "client_name": s.client_name,
            "pto_minutes": s.pto_minutes,
            "pressure_min": s.pressure_min,
            "pressure_max": s.pressure_max,
            "rpm_avg": s.rpm_avg,
            "pump_minutes": s.pump_minutes,
            "fuel_l": s.fuel_l,
        }
        for s in stops_q.scalars().all()
    ]

    duration_label = (
        f"{report.work_duration_minutes // 60}h {report.work_duration_minutes % 60}min"
        if report.work_duration_minutes else None
    )
    completed_date = order.completed_at.strftime("%d/%m/%Y") if order.completed_at else None
    completed_time = order.completed_at.strftime("%H:%M") if order.completed_at else None

    from app.schemas.work_report import MaterialItem
    materials = [MaterialItem(**m) for m in (report.materials_used or [])]

    # Convertir URLs locales a file:// para que WeasyPrint resuelva las imágenes
    def _to_file_url(url_path: str | None) -> str | None:
        if not url_path:
            return None
        if url_path.startswith(("http://", "https://", "file://")):
            return url_path
        return f"file:///app{url_path}"

    photo_file_urls = [_to_file_url(u) for u in (report.photo_urls or []) if u]
    sig_file_url = _to_file_url(report.signature_url)
    logo_file_url = _to_file_url(logo_url)

    html_str = _template.render(
        brand_name=brand_name,
        business_cif=business_cif,
        business_address=business_address,
        primary_color=primary_color,
        logo_url=logo_file_url,
        doc_number=order.doc_number,
        order_title=order.title,
        completed_date=completed_date,
        completed_time=completed_time,
        vehicle_label=vehicle_label,
        driver_name=driver_name,
        duration_label=duration_label,
        description=report.description,
        materials_used=materials,
        photo_urls=photo_file_urls,
        signature_url=sig_file_url,
        signee_name=report.client_signee_name,
        signee_dni=report.client_signee_dni,
        unsigned_reason=report.unsigned_reason,
        final_client_name=order.final_client_name,
        final_client_address=order.final_client_address,
        pdf_metrics=pdf_metrics,
        stops=stops,
    )

    pdf_bytes = await asyncio.to_thread(HTML(string=html_str).write_pdf)
    fname = order.doc_number or f"informe_{order.title[:40].replace(' ', '_')}"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}.pdf"'},
    )
