import uuid
from datetime import datetime, timezone
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.schemas.work_order import (
    WorkOrderOut, WorkOrderCreate, WorkOrderUpdate, WorkOrderStatusPatch,
    WorkOrderStopOut, WorkOrderStopCreate, WorkOrderStopUpdate, WorkOrderStopStatusPatch,
)
from app.models.work_order import WorkOrder
from app.models.work_order_stop import WorkOrderStop
from app.models.vehicle import Vehicle
from app.models.driver import Driver

router = APIRouter(tags=["work_orders"])

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
    order.status = body.status
    now = datetime.now(timezone.utc)
    if body.status == "in_progress" and not order.started_at:
        order.started_at = now
    elif body.status == "done" and not order.completed_at:
        order.completed_at = now
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
    if order.status not in ("pending", "cancelled"):
        raise HTTPException(status_code=400, detail="Solo se pueden eliminar órdenes pendientes o canceladas")
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
