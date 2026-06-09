"""
Portal público — acceso sin JWT via portal_access_token.
Expone solo datos de lectura del tenant: vehículos, estado y órdenes recientes.
Permite al cliente firmar una orden completada mediante el endpoint /sign.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.work_reports import _save_signature
from app.core.database import get_db
from app.models.tenant import Tenant
from app.models.vehicle import Vehicle
from app.models.work_order import WorkOrder
from app.models.work_order_stop import WorkOrderStop
from app.models.work_report import WorkReport
from app.services.doc_numbers import assign_doc_number

router = APIRouter(prefix="/portal", tags=["portal"])


# ── Schemas de salida ─────────────────────────────────────────────────────────

class PortalTenantInfo(BaseModel):
    tenant_id: str
    name: str
    brand_name: str | None = None
    logo_url: str | None = None
    brand_tokens: dict | None = None


class PortalVehicle(BaseModel):
    id: str
    name: str
    vehicle_type: str | None = None
    online: bool
    lat: float | None = None
    lon: float | None = None
    speed_kmh: float | None = None
    ignition: bool | None = None
    last_seen: str | None = None


class PortalOrder(BaseModel):
    id: str
    title: str
    status: str
    priority: str
    vehicle_name: str | None = None
    driver_name: str | None = None
    scheduled_at: str | None = None
    completed_at: str | None = None
    location_address: str | None = None
    report_number: str | None = None   # presente si la orden ya está firmada


class PortalStop(BaseModel):
    id: str
    order_index: int
    title: str
    address: str | None = None
    status: str
    completed_at: str | None = None
    pto_minutes: float | None = None
    pump_minutes: float | None = None
    fuel_l: float | None = None


class PortalSignRequest(BaseModel):
    signature: str               # data_url base64
    client_signee_name: str
    client_signee_dni: str


class PortalSignResponse(BaseModel):
    report_number: str


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_tenant_by_token(token: str, db: AsyncSession) -> Tenant:
    result = await db.execute(
        select(Tenant).where(Tenant.portal_access_token == token, Tenant.active == True)  # noqa: E712
    )
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Portal no encontrado o inactivo")
    return tenant


async def _get_portal_order(
    order_id: uuid.UUID,
    tenant_id: uuid.UUID,
    db: AsyncSession,
) -> WorkOrder:
    result = await db.execute(select(WorkOrder).where(WorkOrder.id == order_id))
    order = result.scalar_one_or_none()
    if not order or order.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    return order


async def _get_vehicle_status(vehicle_id: uuid.UUID, redis) -> dict:
    try:
        data = await redis.hgetall(f"vehicle:{vehicle_id}:status")
        return {k.decode() if isinstance(k, bytes) else k: v.decode() if isinstance(v, bytes) else v for k, v in data.items()}
    except Exception:
        return {}


# ── Endpoints públicos ────────────────────────────────────────────────────────

@router.get("/{token}", response_model=PortalTenantInfo)
async def portal_info(token: str, db: AsyncSession = Depends(get_db)):
    tenant = await _get_tenant_by_token(token, db)
    return PortalTenantInfo(
        tenant_id=str(tenant.id),
        name=tenant.name,
        brand_name=tenant.brand_name,
        logo_url=tenant.logo_url,
        brand_tokens=tenant.brand_tokens,
    )


@router.get("/{token}/vehicles", response_model=list[PortalVehicle])
async def portal_vehicles(token: str, request: Request, db: AsyncSession = Depends(get_db)):
    tenant = await _get_tenant_by_token(token, db)
    result = await db.execute(
        select(Vehicle).where(Vehicle.tenant_id == tenant.id, Vehicle.active == True)  # noqa: E712
    )
    vehicles = result.scalars().all()

    redis = request.app.state.redis
    out: list[PortalVehicle] = []
    for v in vehicles:
        st = await _get_vehicle_status(v.id, redis)

        def _bool(key: str) -> bool | None:
            val = st.get(key)
            if val is None:
                return None
            return str(val).lower() in ("true", "1")

        def _float(key: str) -> float | None:
            val = st.get(key)
            try:
                return float(val) if val not in (None, "", "None") else None
            except (ValueError, TypeError):
                return None

        online = _bool("online") or False
        out.append(PortalVehicle(
            id=str(v.id),
            name=v.name,
            vehicle_type=str(v.vehicle_type_id) if v.vehicle_type_id else None,
            online=online,
            lat=_float("lat"),
            lon=_float("lon"),
            speed_kmh=_float("speed_kmh"),
            ignition=_bool("ignition"),
            last_seen=st.get("last_seen"),
        ))
    return out


@router.get("/{token}/orders", response_model=list[PortalOrder])
async def portal_orders(token: str, db: AsyncSession = Depends(get_db)):
    tenant = await _get_tenant_by_token(token, db)

    result = await db.execute(
        select(WorkOrder)
        .where(
            WorkOrder.tenant_id == tenant.id,
            WorkOrder.status.in_(["in_progress", "done"]),
        )
        .order_by(WorkOrder.created_at.desc())
        .limit(20)
    )
    orders = result.scalars().all()

    from app.models.vehicle import Vehicle
    from app.models.driver import Driver

    # Batch: órdenes ya firmadas (evita N+1)
    order_ids = [o.id for o in orders]
    signed_order_ids: set[str] = set()
    if order_ids:
        rep_rows = await db.execute(
            select(WorkReport.work_order_id).where(
                WorkReport.work_order_id.in_(order_ids),
                WorkReport.signature_url.is_not(None),
                WorkReport.client_signee_name.is_not(None),
            )
        )
        signed_order_ids = {str(r[0]) for r in rep_rows.all()}

    out: list[PortalOrder] = []
    for o in orders:
        vname = None
        if o.vehicle_id:
            vr = await db.execute(select(Vehicle).where(Vehicle.id == o.vehicle_id))
            vobj = vr.scalar_one_or_none()
            vname = vobj.name if vobj else None

        dname = None
        if o.driver_id:
            dr = await db.execute(select(Driver).where(Driver.id == o.driver_id))
            dobj = dr.scalar_one_or_none()
            dname = dobj.full_name if dobj else None

        out.append(PortalOrder(
            id=str(o.id),
            title=o.title,
            status=o.status,
            priority=o.priority,
            vehicle_name=vname,
            driver_name=dname,
            scheduled_at=o.scheduled_at.isoformat() if o.scheduled_at else None,
            completed_at=o.completed_at.isoformat() if o.completed_at else None,
            location_address=o.location_address,
            report_number=o.doc_number if str(o.id) in signed_order_ids else None,
        ))
    return out


@router.get("/{token}/orders/{order_id}/stops", response_model=list[PortalStop])
async def portal_order_stops(
    token: str,
    order_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    tenant = await _get_tenant_by_token(token, db)
    order = await _get_portal_order(order_id, tenant.id, db)

    result = await db.execute(
        select(WorkOrderStop)
        .where(WorkOrderStop.work_order_id == order.id)
        .order_by(WorkOrderStop.order_index)
    )
    stops = result.scalars().all()
    return [
        PortalStop(
            id=str(s.id),
            order_index=s.order_index,
            title=s.title,
            address=s.address,
            status=s.status,
            completed_at=s.completed_at.isoformat() if s.completed_at else None,
            pto_minutes=s.pto_minutes,
            pump_minutes=s.pump_minutes,
            fuel_l=s.fuel_l,
        )
        for s in stops
    ]


@router.post("/{token}/orders/{order_id}/sign", response_model=PortalSignResponse)
async def portal_sign_order(
    token: str,
    order_id: uuid.UUID,
    body: PortalSignRequest,
    db: AsyncSession = Depends(get_db),
):
    tenant = await _get_tenant_by_token(token, db)
    order = await _get_portal_order(order_id, tenant.id, db)

    if order.status != "done":
        raise HTTPException(
            status_code=422,
            detail="La orden debe estar completada antes de firmar",
        )

    result = await db.execute(
        select(WorkReport).where(WorkReport.work_order_id == order.id)
    )
    report = result.scalar_one_or_none()
    if report and report.signature_url and report.client_signee_name:
        raise HTTPException(status_code=409, detail="La orden ya está firmada")

    name = body.client_signee_name.strip()
    dni = body.client_signee_dni.strip()
    if not name or not dni:
        raise HTTPException(status_code=422, detail="Nombre y DNI obligatorios")

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

    report.signature_url = _save_signature(body.signature, report.id)
    report.client_signee_name = name
    report.client_signee_dni = dni
    report.unsigned_reason = None

    # Asignar doc_number si el rollup no pudo (defensivo)
    if not order.doc_number:
        order.doc_number = await assign_doc_number(
            db, order.tenant_id, order.completed_at or datetime.now(timezone.utc)
        )

    await db.commit()
    return PortalSignResponse(report_number=order.doc_number)
