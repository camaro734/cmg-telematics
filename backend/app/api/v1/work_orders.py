import uuid
from datetime import datetime, timezone
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.core.database import get_db
from app.api.v1.deps import get_current_user, require_module
from app.schemas.auth import CurrentUser
from app.schemas.work_order import (
    WorkOrderOut, WorkOrderCreate, WorkOrderUpdate, WorkOrderStatusPatch,
    WorkOrderStopOut, WorkOrderStopCreate, WorkOrderStopUpdate, WorkOrderStopStatusPatch,
)
from app.models.work_order import WorkOrder
from app.models.work_order_stop import WorkOrderStop
from app.models.vehicle import Vehicle
from app.models.vehicle_type import VehicleType
from app.models.driver import Driver
from app.models.work_report import WorkReport
from app.services.doc_numbers import assign_doc_number

router = APIRouter(tags=["work_orders"], dependencies=[Depends(require_module("work-orders"))])

_STATUS_TRANSITIONS: dict[str, list[str]] = {
    "pending":     ["in_progress", "cancelled"],
    "in_progress": ["done", "cancelled"],
    "done":        [],
    "cancelled":   [],
}


def _check_tenant(user: CurrentUser, tenant_id: uuid.UUID) -> None:
    if user.tenant_tier != "cmg" and str(tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=404, detail="No encontrado")


async def _enrich(db: AsyncSession, order: WorkOrder) -> WorkOrderOut:
    out = WorkOrderOut.model_validate(order)
    if order.vehicle_id:
        v = await db.get(Vehicle, order.vehicle_id)
        out.vehicle_name = v.name if v else None
    if order.driver_id:
        d = await db.get(Driver, order.driver_id)
        out.driver_name = d.full_name if d else None
    return out


@router.get("/work-orders", response_model=list[WorkOrderOut])
async def list_work_orders(
    status_filter: str | None = Query(None, alias="status"),
    vehicle_id: uuid.UUID | None = None,
    driver_id: uuid.UUID | None = None,
    tenant_id: uuid.UUID | None = Query(None),
    limit: int = Query(100, le=500),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(WorkOrder)
    if user.tenant_tier != "cmg":
        q = q.where(WorkOrder.tenant_id == user.tenant_id)
    elif tenant_id is not None:
        q = q.where(WorkOrder.tenant_id == tenant_id)
    if status_filter:
        q = q.where(WorkOrder.status == status_filter)
    if vehicle_id:
        q = q.where(WorkOrder.vehicle_id == vehicle_id)
    if driver_id:
        q = q.where(WorkOrder.driver_id == driver_id)
    q = q.order_by(WorkOrder.created_at.desc()).limit(limit)
    result = await db.execute(q)
    orders = result.scalars().all()
    return [await _enrich(db, o) for o in orders]


@router.get("/work-orders/{order_id}", response_model=WorkOrderOut)
async def get_work_order(
    order_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    order = await db.get(WorkOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    _check_tenant(user, order.tenant_id)
    return await _enrich(db, order)


@router.get("/work-orders/{order_id}/telemetry-detail")
async def get_telemetry_detail(
    order_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Devuelve TODA la telemetría capturada por parada + qué métricas salen en el PDF.

    El admin del tenant emisor lo usa para ver qué se midió en cada trabajo,
    incluso campos que no aparecen en el PDF de cliente.
    """
    order = await db.get(WorkOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    _check_tenant(user, order.tenant_id)

    pdf_keys: list[str] = []
    if order.vehicle_id:
        v = await db.get(Vehicle, order.vehicle_id)
        if v and v.vehicle_type_id:
            vt = await db.get(VehicleType, v.vehicle_type_id)
            if vt and vt.pdf_metrics:
                pdf_keys = [m.get("key") for m in vt.pdf_metrics if m.get("key")]

    stops_q = await db.execute(
        select(WorkOrderStop).where(WorkOrderStop.work_order_id == order_id)
        .order_by(WorkOrderStop.order_index)
    )
    return {
        "stops": [
            {
                "id": str(s.id),
                "order_index": s.order_index,
                "address": s.address,
                "client_name": s.client_name,
                "arrived_at": s.arrived_at.isoformat() if s.arrived_at else None,
                "completed_at": s.completed_at.isoformat() if s.completed_at else None,
                "telemetry": {
                    "pto_minutes": s.pto_minutes,
                    "pressure_min": s.pressure_min,
                    "pressure_max": s.pressure_max,
                    "rpm_avg": s.rpm_avg,
                    "pump_minutes": s.pump_minutes,
                    "fuel_l": s.fuel_l,
                },
            }
            for s in stops_q.scalars().all()
        ],
        "pdf_metric_keys": pdf_keys,
    }


@router.post("/work-orders", response_model=WorkOrderOut, status_code=status.HTTP_201_CREATED)
async def create_work_order(
    body: WorkOrderCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="No autorizado")
    order = WorkOrder(tenant_id=user.tenant_id, created_by=user.user_id, **body.model_dump())
    db.add(order)
    await db.commit()
    await db.refresh(order)
    return await _enrich(db, order)


@router.put("/work-orders/{order_id}", response_model=WorkOrderOut)
async def update_work_order(
    order_id: uuid.UUID,
    body: WorkOrderUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="No autorizado")
    order = await db.get(WorkOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    _check_tenant(user, order.tenant_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(order, field, value)
    await db.commit()
    await db.refresh(order)
    return await _enrich(db, order)


@router.patch("/work-orders/{order_id}/status", response_model=WorkOrderOut)
async def transition_status(
    order_id: uuid.UUID,
    body: WorkOrderStatusPatch,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="No autorizado")
    order = await db.get(WorkOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    _check_tenant(user, order.tenant_id)

    allowed = _STATUS_TRANSITIONS.get(order.status, [])
    if body.status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"No se puede pasar de '{order.status}' a '{body.status}'",
        )

    now = datetime.now(timezone.utc)

    if body.status == "done":
        # Cerrar la orden requiere parte firmado por cliente o motivo de no firma
        rep = (await db.execute(
            select(WorkReport).where(WorkReport.work_order_id == order.id)
        )).scalar_one_or_none()
        is_signed = bool(
            rep and rep.signature_url and rep.client_signee_name and rep.client_signee_dni
        )
        is_unsigned = bool(rep and rep.unsigned_reason)
        if not (is_signed or is_unsigned):
            raise HTTPException(
                status_code=422,
                detail=(
                    "No se puede cerrar la orden: el parte debe estar firmado por "
                    "el cliente (nombre + DNI + firma) o tener un motivo de no firma."
                ),
            )

    order.status = body.status
    if body.status == "in_progress" and not order.started_at:
        order.started_at = now
    elif body.status == "done":
        if not order.completed_at:
            order.completed_at = now
        # Asignación atómica del nº de documento (idempotente)
        if not order.doc_number:
            order.doc_number = await assign_doc_number(db, order.tenant_id, order.completed_at)

    await db.commit()
    await db.refresh(order)
    return await _enrich(db, order)


@router.delete("/work-orders/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_work_order(
    order_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="No autorizado")
    order = await db.get(WorkOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    _check_tenant(user, order.tenant_id)
    if order.status == "in_progress":
        raise HTTPException(status_code=400, detail="No se puede eliminar una orden en curso. Cancélala primero.")
    await db.delete(order)
    await db.commit()


# ── Work Order Stops ──────────────────────────────────────────────────────────

async def _get_order_for_tenant(db: AsyncSession, order_id: uuid.UUID, user: CurrentUser) -> WorkOrder:
    order = await db.get(WorkOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    _check_tenant(user, order.tenant_id)
    return order


@router.get("/work-orders/{order_id}/stops", response_model=list[WorkOrderStopOut])
async def list_stops(
    order_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_order_for_tenant(db, order_id, user)
    result = await db.execute(
        select(WorkOrderStop)
        .where(WorkOrderStop.work_order_id == order_id)
        .order_by(WorkOrderStop.order_index)
    )
    return result.scalars().all()


@router.post("/work-orders/{order_id}/stops", response_model=WorkOrderStopOut, status_code=201)
async def create_stop(
    order_id: uuid.UUID,
    body: WorkOrderStopCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="No autorizado")
    await _get_order_for_tenant(db, order_id, user)
    stop = WorkOrderStop(work_order_id=order_id, **body.model_dump())
    db.add(stop)
    await db.commit()
    await db.refresh(stop)
    return stop


@router.put("/work-orders/{order_id}/stops/{stop_id}", response_model=WorkOrderStopOut)
async def update_stop(
    order_id: uuid.UUID,
    stop_id: uuid.UUID,
    body: WorkOrderStopUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="No autorizado")
    await _get_order_for_tenant(db, order_id, user)
    stop = await db.get(WorkOrderStop, stop_id)
    if not stop or stop.work_order_id != order_id:
        raise HTTPException(status_code=404, detail="Parada no encontrada")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(stop, k, v)
    await db.commit()
    await db.refresh(stop)
    return stop


@router.patch("/work-orders/{order_id}/stops/{stop_id}/status", response_model=WorkOrderStopOut)
async def patch_stop_status(
    order_id: uuid.UUID,
    stop_id: uuid.UUID,
    body: WorkOrderStopStatusPatch,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_order_for_tenant(db, order_id, user)
    stop = await db.get(WorkOrderStop, stop_id)
    if not stop or stop.work_order_id != order_id:
        raise HTTPException(status_code=404, detail="Parada no encontrada")
    now = datetime.now(timezone.utc)
    stop.status = body.status
    if body.status == "arrived" and not stop.arrived_at:
        stop.arrived_at = now
    elif body.status == "in_progress" and not stop.started_at:
        stop.started_at = now
    elif body.status == "done" and not stop.completed_at:
        stop.completed_at = now
        # auto-calculate pto_minutes from started_at
        if stop.started_at:
            delta = (now - stop.started_at).total_seconds()
            stop.pto_minutes = round(delta / 60, 1)
    await db.commit()
    await db.refresh(stop)
    return stop


@router.delete("/work-orders/{order_id}/stops/{stop_id}", status_code=204)
async def delete_stop(
    order_id: uuid.UUID,
    stop_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="No autorizado")
    await _get_order_for_tenant(db, order_id, user)
    stop = await db.get(WorkOrderStop, stop_id)
    if not stop or stop.work_order_id != order_id:
        raise HTTPException(status_code=404, detail="Parada no encontrada")
    await db.delete(stop)
    await db.commit()


# Patrones de key que excluyen una señal bool del grupo "Recomendadas para auto-cierre":
# ignición (estado del motor, no del equipo), setas de emergencia/radio, pedal de freno.
_EXCLUDED_SERVICE_PATTERNS = ("ignition", "seta", "pedal", "freno")


def _recommended_for_service(key: str, signal_type: str) -> bool:
    """True si la señal es un indicador on/off de mecanismo de trabajo (bomba, depresor, PTO)."""
    if signal_type != "bool":
        return False
    k = key.lower()
    return not any(p in k for p in _EXCLUDED_SERVICE_PATTERNS)


_BUILTIN_SIGNALS = [
    {"key": "pto_active",  "label": "PTO activo",       "signal_type": "bool",    "recommended_for_service": True},
    {"key": "ignition",    "label": "Ignición",          "signal_type": "bool",    "recommended_for_service": False},
    {"key": "speed_kmh",   "label": "Velocidad (km/h)",  "signal_type": "numeric", "recommended_for_service": False},
]

# Prefijos y valores exactos que identifican canales NO instantáneos:
#   min_* / minutos_*    → acumuladores de minutos de operación (IFM CR2530 interno)
#   pico_maximo_*        → running max de presión/vacío durante la sesión
#   maximas_*            → running max de RPM u otras magnitudes
#   avl_10314            → Kilómetros Totales (odómetro de por vida)
#   avl_10315            → Combustible Total (acumulador de por vida)
#   unit "Min" / "Veces" → acumulador de tiempo o contador de eventos
_ACCUM_PREFIXES = ("min_", "minutos_", "pico_maximo_", "pico_max_", "maximas_")
_ACCUM_KEYS     = frozenset({"avl_10314", "avl_10315"})
_ACCUM_UNITS    = frozenset({"min", "veces"})


def _is_accumulator_channel(ch: dict) -> bool:
    """True si el canal es un acumulador monótono o running-max — no sirve como disparador de auto-cierre."""
    key  = (ch.get("key")  or "").lower()
    unit = (ch.get("unit") or "").lower()
    return (
        key in _ACCUM_KEYS
        or any(key.startswith(p) for p in _ACCUM_PREFIXES)
        or unit in _ACCUM_UNITS
    )


def _can_signal_entry(ch: dict) -> dict:
    """Construye la entrada de señal CAN para el desplegable de auto-cierre."""
    stype = "bool" if ch.get("gauge_type") == "led" else ch.get("type", "numeric")
    return {
        "key":                    ch["key"],
        "label":                  ch.get("label", ch["key"]),
        "signal_type":            stype,
        "recommended_for_service": _recommended_for_service(ch["key"], stype),
    }


@router.get("/work-orders/vehicle-signals/{vehicle_id}")
async def get_vehicle_signals(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Señales instantáneas disponibles para configurar el auto-cierre de una orden.

    Excluye acumuladores monótonos (min_*, pico_maximo_*, odómetros) y las keys
    que ya aparecen como señal built-in (evita duplicados de 'Ignición').
    Los canales gauge_type=led se exponen como signal_type=bool.
    """
    result = await db.execute(
        select(Vehicle)
        .options(selectinload(Vehicle.vehicle_type))
        .where(Vehicle.id == vehicle_id)
    )
    vehicle = result.scalar_one_or_none()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")
    _check_tenant(user, vehicle.tenant_id)

    builtin_keys = {s["key"] for s in _BUILTIN_SIGNALS}
    channels     = vehicle.vehicle_type.sensor_schema or []
    can_signals  = [
        _can_signal_entry(ch)
        for ch in channels
        if ch.get("key")
        and not _is_accumulator_channel(ch)
        and ch["key"] not in builtin_keys
    ]
    return _BUILTIN_SIGNALS + can_signals
