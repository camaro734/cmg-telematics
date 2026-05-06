import base64
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from jinja2 import Template
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from weasyprint import HTML

from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.models.driver import Driver
from app.models.tenant import Tenant
from app.models.vehicle import Vehicle
from app.models.work_order import WorkOrder
from app.models.work_report import WorkReport
from app.schemas.auth import CurrentUser
from app.schemas.work_report import WorkReportCreate, WorkReportOut

router = APIRouter(prefix="/api/v1/work-orders", tags=["work-reports"])

UPLOADS_DIR = Path("/app/uploads/work_reports")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

# ── PDF HTML template ─────────────────────────────────────────────────────────

_PDF_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #222; background: #fff; padding: 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #F97316; padding-bottom: 16px; margin-bottom: 24px; }
  .brand { font-size: 22px; font-weight: 700; color: #F97316; }
  .brand-sub { font-size: 11px; color: #666; margin-top: 2px; }
  .doc-info { text-align: right; font-size: 11px; color: #555; }
  .doc-info strong { font-size: 14px; color: #222; display: block; margin-bottom: 4px; }
  h2 { font-size: 14px; font-weight: 700; color: #1a1a1a; margin-bottom: 10px; margin-top: 20px; border-left: 3px solid #F97316; padding-left: 8px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 4px; }
  .field { margin-bottom: 6px; }
  .field-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; }
  .field-value { font-size: 12px; color: #222; font-weight: 500; }
  .description-box { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 4px; padding: 10px 12px; font-size: 12px; line-height: 1.5; white-space: pre-wrap; }
  .photos-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 8px; }
  .photo-img { width: 100%; height: 140px; object-fit: cover; border-radius: 4px; border: 1px solid #e0e0e0; }
  .materials-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .materials-table th { background: #f3f3f3; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #555; padding: 6px 8px; text-align: left; border-bottom: 1px solid #ddd; }
  .materials-table td { padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 12px; }
  .signature-section { margin-top: 20px; page-break-inside: avoid; }
  .signature-box { border: 1px solid #e0e0e0; border-radius: 4px; padding: 8px; display: inline-block; }
  .signature-img { max-height: 100px; max-width: 300px; display: block; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #eee; font-size: 10px; color: #aaa; text-align: center; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">{{ brand_name }}</div>
      <div class="brand-sub">Informe de trabajo</div>
    </div>
    <div class="doc-info">
      <strong>{{ order_title }}</strong>
      Fecha: {{ created_at }}<br>
      {% if completed_at %}Completada: {{ completed_at }}{% endif %}
    </div>
  </div>

  <h2>Datos de la orden</h2>
  <div class="grid2">
    <div class="field"><div class="field-label">Vehículo</div><div class="field-value">{{ vehicle_name or '—' }}</div></div>
    <div class="field"><div class="field-label">Conductor</div><div class="field-value">{{ driver_name or '—' }}</div></div>
    <div class="field"><div class="field-label">Prioridad</div><div class="field-value">{{ priority }}</div></div>
    <div class="field"><div class="field-label">Duración trabajo</div><div class="field-value">{{ duration }}</div></div>
    {% if location_address %}
    <div class="field" style="grid-column:1/-1"><div class="field-label">Ubicación</div><div class="field-value">{{ location_address }}</div></div>
    {% endif %}
  </div>

  {% if description %}
  <h2>Descripción del trabajo</h2>
  <div class="description-box">{{ description }}</div>
  {% endif %}

  {% if materials_used %}
  <h2>Materiales utilizados</h2>
  <table class="materials-table">
    <thead><tr><th>Material</th><th>Cantidad</th><th>Unidad</th></tr></thead>
    <tbody>
      {% for m in materials_used %}
      <tr><td>{{ m.name }}</td><td>{{ m.quantity }}</td><td>{{ m.unit or '—' }}</td></tr>
      {% endfor %}
    </tbody>
  </table>
  {% endif %}

  {% if photo_urls %}
  <h2>Fotografías</h2>
  <div class="photos-grid">
    {% for url in photo_urls %}
    <img class="photo-img" src="{{ url }}"/>
    {% endfor %}
  </div>
  {% endif %}

  {% if signature_url %}
  <div class="signature-section">
    <h2>Firma del operario</h2>
    <div class="signature-box">
      <img class="signature-img" src="{{ signature_url }}"/>
    </div>
  </div>
  {% endif %}

  <div class="footer">Generado por {{ brand_name }} · CMG Telematics</div>
</body>
</html>
"""

_template = Template(_PDF_TEMPLATE)


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


@router.get("/{order_id}/report/pdf")
async def download_pdf(
    order_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    order = await _get_order_authorized(order_id, user, db)
    result = await db.execute(select(WorkReport).where(WorkReport.work_order_id == order_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Sin informe para generar PDF")

    # Enrich names
    vehicle_name = None
    if order.vehicle_id:
        vr = await db.execute(select(Vehicle).where(Vehicle.id == order.vehicle_id))
        v = vr.scalar_one_or_none()
        vehicle_name = v.name if v else None

    driver_name = None
    if order.driver_id:
        dr = await db.execute(select(Driver).where(Driver.id == order.driver_id))
        d = dr.scalar_one_or_none()
        driver_name = d.full_name if d else None

    # Brand name
    tr = await db.execute(select(Tenant).where(Tenant.id == order.tenant_id))
    tenant = tr.scalar_one_or_none()
    brand_name = (tenant.brand_name or "CMG Track") if tenant else "CMG Track"

    priority_map = {"low": "Baja", "normal": "Normal", "high": "Alta", "urgent": "Urgente"}
    duration = (
        f"{report.work_duration_minutes // 60}h {report.work_duration_minutes % 60}min"
        if report.work_duration_minutes
        else "—"
    )

    from app.schemas.work_report import MaterialItem
    materials = [MaterialItem(**m) for m in (report.materials_used or [])]

    # Convert URL paths to local file:// paths for WeasyPrint image resolution
    def _to_file_url(url_path: str | None) -> str | None:
        if not url_path:
            return None
        local = "/app" + url_path  # /uploads/... → /app/uploads/...
        return f"file://{local}"

    photo_file_urls = [_to_file_url(u) for u in (report.photo_urls or []) if u]
    sig_file_url = _to_file_url(report.signature_url)

    html_str = _template.render(
        brand_name=brand_name,
        order_title=order.title,
        created_at=report.created_at.strftime("%d/%m/%Y %H:%M") if report.created_at else "—",
        completed_at=order.completed_at.strftime("%d/%m/%Y %H:%M") if order.completed_at else None,
        vehicle_name=vehicle_name,
        driver_name=driver_name,
        priority=priority_map.get(order.priority, order.priority),
        duration=duration,
        location_address=order.location_address,
        description=report.description,
        materials_used=materials,
        photo_urls=photo_file_urls,
        signature_url=sig_file_url,
        base_url="",
    )

    pdf_bytes = HTML(string=html_str).write_pdf()
    safe_title = order.title[:40].replace(" ", "_")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="informe_{safe_title}.pdf"'},
    )
