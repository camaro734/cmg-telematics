import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from app.core.database import get_db
from app.api.v1.deps import get_current_user, get_redis
from app.api.v1.access_v2 import user_can_see_vehicle_location, strip_location
from app.schemas.auth import CurrentUser
from app.schemas.work_cycle import (
    WorkCycleDefinitionOut, WorkCycleDefinitionCreate, WorkCycleDefinitionUpdate,
    WorkCycleOut, ComputeCyclesRequest,
)
from app.models.work_cycle import WorkCycleDefinition, WorkCycle
from app.models.vehicle import Vehicle
from app.services.cycle_detector import detect_and_store_cycles

router = APIRouter(tags=["work_cycles"])


# ── Definitions ──────────────────────────────────────────────────────────────

@router.get("/definitions", response_model=list[WorkCycleDefinitionOut])
async def list_definitions(
    vehicle_type_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(WorkCycleDefinition)
    if user.tenant_tier != "cmg":
        q = q.where(
            or_(WorkCycleDefinition.tenant_id == user.tenant_id,
                WorkCycleDefinition.tenant_id.is_(None))
        )
    if vehicle_type_id:
        q = q.where(WorkCycleDefinition.vehicle_type_id == vehicle_type_id)
    result = await db.execute(q.order_by(WorkCycleDefinition.created_at.desc()))
    return result.scalars().all()


@router.post("/definitions", response_model=WorkCycleDefinitionOut, status_code=status.HTTP_201_CREATED)
async def create_definition(
    body: WorkCycleDefinitionCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    tenant_id = None if user.tenant_tier == "cmg" else user.tenant_id
    defn = WorkCycleDefinition(
        vehicle_type_id=body.vehicle_type_id,
        tenant_id=tenant_id,
        name=body.name,
        trigger_type=body.trigger_type,
        trigger_config=body.trigger_config,
        snapshot_fields=body.snapshot_fields,
        aggregate_fields=body.aggregate_fields,
    )
    db.add(defn)
    await db.commit()
    await db.refresh(defn)
    return defn


@router.patch("/definitions/{definition_id}", response_model=WorkCycleDefinitionOut)
async def update_definition(
    definition_id: uuid.UUID,
    body: WorkCycleDefinitionUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    defn = await db.get(WorkCycleDefinition, definition_id)
    if not defn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Definición no encontrada")
    if user.tenant_tier != "cmg" and str(defn.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Definición no encontrada")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(defn, field, value)
    await db.commit()
    await db.refresh(defn)
    return defn


@router.delete("/definitions/{definition_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_definition(
    definition_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    defn = await db.get(WorkCycleDefinition, definition_id)
    if not defn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Definición no encontrada")
    if user.tenant_tier != "cmg" and str(defn.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Definición no encontrada")
    await db.delete(defn)
    await db.commit()


# ── Cycles ───────────────────────────────────────────────────────────────────

@router.get("", response_model=list[WorkCycleOut])
async def list_cycles(
    vehicle_id: uuid.UUID = Query(...),
    from_dt: datetime = Query(...),
    to_dt: datetime = Query(...),
    definition_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    q = select(WorkCycle).where(
        WorkCycle.vehicle_id == vehicle_id,
        WorkCycle.started_at >= from_dt,
        WorkCycle.started_at < to_dt,
    )
    if user.tenant_tier != "cmg":
        q = q.where(WorkCycle.tenant_id == user.tenant_id)
    if definition_id:
        q = q.where(WorkCycle.definition_id == definition_id)
    result = await db.execute(q.order_by(WorkCycle.started_at))
    cycles = result.scalars().all()

    vehicle_obj = await db.get(Vehicle, vehicle_id)
    if vehicle_obj and not await user_can_see_vehicle_location(user, vehicle_obj, redis):
        outs = [WorkCycleOut.model_validate(c) for c in cycles]
        for out in outs:
            strip_location(out)
        return outs

    return cycles


@router.post("/compute")
async def compute_cycles(
    body: ComputeCyclesRequest,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    defn = await db.get(WorkCycleDefinition, body.definition_id)
    if not defn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Definición no encontrada")
    vehicle = await db.get(Vehicle, body.vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    if user.tenant_tier != "cmg" and str(vehicle.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    count = await detect_and_store_cycles(
        db, body.vehicle_id, vehicle.tenant_id, defn, body.from_dt, body.to_dt
    )
    return {"computed": count}
