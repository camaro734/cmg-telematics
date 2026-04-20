# backend/app/api/v1/maintenance.py
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, func, cast
from sqlalchemy.dialects.postgresql import array
from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.schemas.maintenance import (
    MaintenancePlanCreate, MaintenancePlanUpdate, MaintenancePlanOut,
    MaintenanceLogCreate, MaintenanceLogOut,
    MaintenanceProgress, ThresholdProgress,
)
from app.models.maintenance import MaintenancePlan, MaintenanceLog
from app.models.vehicle import Vehicle
from app.models.permission_grant import PermissionGrant

router = APIRouter(tags=["maintenance"])


async def _require_admin(user: CurrentUser) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")


async def _require_admin_or_grant(user: CurrentUser, db: AsyncSession) -> None:
    if user.role == "admin":
        return
    result = await db.execute(
        select(PermissionGrant).where(
            PermissionGrant.grantee_id == user.tenant_id,
            PermissionGrant.resource_type == "maintenance",
            PermissionGrant.active == True,
        )
    )
    grant = result.scalar_one_or_none()
    if not grant or "log" not in (grant.allowed_actions or []):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sin permiso para registrar intervenciones",
        )


async def _compute_progress(plan: MaintenancePlan, db: AsyncSession) -> MaintenanceProgress:
    thresholds = plan.trigger_condition.get("thresholds", [])
    results: list[ThresholdProgress] = []

    for thresh in thresholds:
        t_type = thresh["type"]
        limit = float(thresh["value"])

        log_res = await db.execute(
            select(MaintenanceLog.performed_at)
            .where(
                MaintenanceLog.plan_id == plan.id,
                MaintenanceLog.reset_counters.op("@>")(array([t_type])),
            )
            .order_by(MaintenanceLog.performed_at.desc())
            .limit(1)
        )
        baseline: datetime = log_res.scalar_one_or_none() or plan.created_at

        if t_type == "calendar_days":
            current = float(max(0, (datetime.now(timezone.utc) - baseline).days))
        elif t_type in ("pto_hours", "engine_hours"):
            col = "pto_active_minutes" if t_type == "pto_hours" else "engine_on_minutes"
            row = await db.execute(
                text(
                    f"SELECT COALESCE(SUM({col}), 0) / 60.0 "
                    "FROM telemetry_1h "
                    "WHERE vehicle_id = :vid AND bucket >= :baseline"
                ),
                {"vid": plan.vehicle_id, "baseline": baseline},
            )
            current = float(row.scalar_one() or 0.0)
        else:
            current = 0.0

        pct = round(current / limit * 100.0, 1) if limit > 0 else 0.0
        results.append(ThresholdProgress(
            type=t_type,
            current=round(current, 2),
            limit=limit,
            pct=pct,
        ))

    warn_threshold = 100.0 - plan.warn_before_pct
    if any(t.pct >= 100.0 for t in results):
        overall = "vencido"
    elif any(t.pct >= warn_threshold for t in results):
        overall = "próximo"
    else:
        overall = "ok"

    return MaintenanceProgress(status=overall, thresholds=results)


async def _to_out(plan: MaintenancePlan, vehicle_name: str, db: AsyncSession) -> MaintenancePlanOut:
    progress = await _compute_progress(plan, db)
    return MaintenancePlanOut(
        id=plan.id,
        vehicle_id=plan.vehicle_id,
        vehicle_name=vehicle_name,
        tenant_id=plan.tenant_id,
        name=plan.name,
        trigger_condition=plan.trigger_condition,
        warn_before_pct=plan.warn_before_pct,
        active=plan.active,
        created_at=plan.created_at,
        progress=progress,
    )


@router.get("/maintenance/plans", response_model=list[MaintenancePlanOut])
async def list_plans(
    vehicle_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(MaintenancePlan)
    if user.tenant_tier != "cmg":
        query = query.where(MaintenancePlan.tenant_id == user.tenant_id)
    if vehicle_id:
        query = query.where(MaintenancePlan.vehicle_id == vehicle_id)
    result = await db.execute(query.order_by(MaintenancePlan.name))
    plans = result.scalars().all()

    vehicle_ids = list({p.vehicle_id for p in plans})
    vehicles: dict[uuid.UUID, str] = {}
    if vehicle_ids:
        v_res = await db.execute(
            select(Vehicle.id, Vehicle.name).where(Vehicle.id.in_(vehicle_ids))
        )
        vehicles = {row.id: row.name for row in v_res}

    return [await _to_out(p, vehicles.get(p.vehicle_id, "—"), db) for p in plans]


@router.post("/maintenance/plans", response_model=MaintenancePlanOut, status_code=201)
async def create_plan(
    body: MaintenancePlanCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(user)
    vehicle = await db.get(Vehicle, body.vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")
    if user.tenant_tier != "cmg" and str(vehicle.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    plan = MaintenancePlan(
        vehicle_id=body.vehicle_id,
        tenant_id=vehicle.tenant_id,
        name=body.name,
        trigger_condition=body.trigger_condition.model_dump(),
        warn_before_pct=body.warn_before_pct,
        active=body.active,
    )
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return await _to_out(plan, vehicle.name, db)


@router.get("/maintenance/plans/{plan_id}", response_model=MaintenancePlanOut)
async def get_plan(
    plan_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plan = await db.get(MaintenancePlan, plan_id)
    if not plan or (user.tenant_tier != "cmg" and str(plan.tenant_id) != str(user.tenant_id)):
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    vehicle = await db.get(Vehicle, plan.vehicle_id)
    return await _to_out(plan, vehicle.name if vehicle else "—", db)


@router.put("/maintenance/plans/{plan_id}", response_model=MaintenancePlanOut)
async def update_plan(
    plan_id: uuid.UUID,
    body: MaintenancePlanUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(user)
    plan = await db.get(MaintenancePlan, plan_id)
    if not plan or (user.tenant_tier != "cmg" and str(plan.tenant_id) != str(user.tenant_id)):
        raise HTTPException(status_code=404, detail="Plan no encontrado")

    if body.name is not None:
        plan.name = body.name
    if body.trigger_condition is not None:
        plan.trigger_condition = body.trigger_condition.model_dump()
    if body.warn_before_pct is not None:
        plan.warn_before_pct = body.warn_before_pct
    if body.active is not None:
        plan.active = body.active

    await db.commit()
    await db.refresh(plan)
    vehicle = await db.get(Vehicle, plan.vehicle_id)
    return await _to_out(plan, vehicle.name if vehicle else "—", db)


@router.delete("/maintenance/plans/{plan_id}", status_code=204)
async def delete_plan(
    plan_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(user)
    plan = await db.get(MaintenancePlan, plan_id)
    if not plan or (user.tenant_tier != "cmg" and str(plan.tenant_id) != str(user.tenant_id)):
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    await db.delete(plan)
    await db.commit()


@router.post("/maintenance/plans/{plan_id}/logs", response_model=MaintenanceLogOut, status_code=201)
async def create_log(
    plan_id: uuid.UUID,
    body: MaintenanceLogCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plan = await db.get(MaintenancePlan, plan_id)
    if not plan or (user.tenant_tier != "cmg" and str(plan.tenant_id) != str(user.tenant_id)):
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    await _require_admin_or_grant(user, db)

    log = MaintenanceLog(
        vehicle_id=plan.vehicle_id,
        plan_id=plan_id,
        performed_at=body.performed_at,
        performed_by=uuid.UUID(str(user.user_id)),
        description=body.description,
        reset_counters=body.reset_counters,
        cost_eur=body.cost_eur,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return MaintenanceLogOut(
        id=log.id,
        plan_id=log.plan_id,
        vehicle_id=log.vehicle_id,
        performed_at=log.performed_at,
        performed_by_email=user.email,
        description=log.description,
        reset_counters=log.reset_counters or [],
        cost_eur=float(log.cost_eur) if log.cost_eur is not None else None,
    )


@router.get("/maintenance/plans/{plan_id}/logs", response_model=list[MaintenanceLogOut])
async def list_logs(
    plan_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plan = await db.get(MaintenancePlan, plan_id)
    if not plan or (user.tenant_tier != "cmg" and str(plan.tenant_id) != str(user.tenant_id)):
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    result = await db.execute(
        select(MaintenanceLog)
        .where(MaintenanceLog.plan_id == plan_id)
        .order_by(MaintenanceLog.performed_at.desc())
    )
    return [
        MaintenanceLogOut(
            id=lg.id, plan_id=lg.plan_id, vehicle_id=lg.vehicle_id,
            performed_at=lg.performed_at, performed_by_email=None,
            description=lg.description,
            reset_counters=lg.reset_counters or [],
            cost_eur=float(lg.cost_eur) if lg.cost_eur is not None else None,
        )
        for lg in result.scalars().all()
    ]
