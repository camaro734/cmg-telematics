# backend/app/api/v1/maintenance.py
import csv
import io
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, func, cast, or_
from sqlalchemy.dialects.postgresql import array
from app.core.database import get_db
from app.api.v1.deps import get_current_user, require_module, require_management_tier, require_operational_role
from app.schemas.auth import CurrentUser
from app.schemas.maintenance import (
    MaintenancePlanCreate, MaintenancePlanUpdate, MaintenancePlanOut,
    MaintenanceLogCreate, MaintenanceLogOut,
    MaintenanceProgress, ThresholdProgress,
)
from app.models.alert_instance import AlertInstance
from app.models.alert_rule import AlertRule
from app.models.maintenance import MaintenancePlan, MaintenanceLog
from app.models.user import User
from app.models.vehicle import Vehicle
from app.models.permission_grant import PermissionGrant
from app.api.v1.access_v2 import assert_can_access_vehicle, list_accessible_vehicle_ids

router = APIRouter(tags=["maintenance"])

logger = logging.getLogger(__name__)

# Safe mapping from threshold type to telemetry_1h column name
_COUNTER_COLUMNS = {
    "pto_hours": "pto_active_minutes",
    "engine_hours": "engine_on_minutes",
}


async def _require_admin(user: CurrentUser) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")


async def _require_admin_or_grant(user: CurrentUser, db: AsyncSession) -> None:
    if user.role == "admin":
        return
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(PermissionGrant).where(
            PermissionGrant.grantee_id == user.tenant_id,
            PermissionGrant.resource_type == "maintenance",
            PermissionGrant.active == True,
            or_(
                PermissionGrant.expires_at.is_(None),
                PermissionGrant.expires_at > now,
            ),
        )
    )
    grant = result.scalar_one_or_none()
    if not grant or "log" not in (grant.allowed_actions or []):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sin permiso para registrar intervenciones",
        )


async def _ensure_maintenance_rule(db: AsyncSession, tenant_id: uuid.UUID) -> uuid.UUID:
    """Garantiza UNA regla __maintenance__ por tenant. Idempotente."""
    result = await db.execute(
        select(AlertRule.id).where(
            AlertRule.tenant_id == tenant_id,
            AlertRule.condition["type"].as_string() == "maintenance",
        ).limit(1)
    )
    existing = result.scalar_one_or_none()
    if existing:
        return existing
    rule = AlertRule(
        tenant_id=tenant_id,
        name="Sistema: mantenimiento vencido",
        condition={"type": "maintenance"},
        vehicle_filter={"scope": "all"},
        severity="critical",
        actions=[],
        escalation=[],
        schedule={"type": "always"},
        active=False,
        cooldown_minutes=0,
    )
    db.add(rule)
    await db.flush()
    logger.info("Regla __maintenance__ creada para tenant=%s rule=%s", tenant_id, rule.id)
    return rule.id


async def _resolve_maintenance_alert_for_plan(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    tenant_id: uuid.UUID,
    plan_id: uuid.UUID,
) -> None:
    """Resuelve el alert_instance firing de un plan concreto (dedup por plan_id en trigger_value)."""
    rule_result = await db.execute(
        select(AlertRule.id).where(
            AlertRule.tenant_id == tenant_id,
            AlertRule.condition["type"].as_string() == "maintenance",
        ).limit(1)
    )
    rule_id = rule_result.scalar_one_or_none()
    if not rule_id:
        return

    instance_result = await db.execute(
        select(AlertInstance).where(
            AlertInstance.vehicle_id == vehicle_id,
            AlertInstance.rule_id == rule_id,
            AlertInstance.status == "firing",
            AlertInstance.trigger_value["plan_id"].as_string() == str(plan_id),
        ).limit(1)
    )
    instance = instance_result.scalar_one_or_none()
    if instance:
        instance.status = "resolved"
        instance.resolved_at = datetime.now(timezone.utc)
        logger.info("Alerta mantenimiento resuelta: plan=%s vehicle=%s", plan_id, vehicle_id)


async def _fetch_baselines(
    plan_ids: list[uuid.UUID],
    db: AsyncSession,
) -> dict[tuple[uuid.UUID, str], datetime]:
    """Batch-fetch the most recent log per (plan_id, counter_type) in one query."""
    if not plan_ids:
        return {}
    rows = await db.execute(
        text(
            """
            WITH expanded AS (
                SELECT plan_id, performed_at,
                       unnest(reset_counters) AS t_type
                FROM maintenance_log
                WHERE plan_id = ANY(:plan_ids)
            ),
            ranked AS (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY plan_id, t_type
                    ORDER BY performed_at DESC
                ) AS rn
                FROM expanded
            )
            SELECT plan_id, t_type, performed_at FROM ranked WHERE rn = 1
            """
        ),
        {"plan_ids": plan_ids},
    )
    return {(row.plan_id, row.t_type): row.performed_at for row in rows}


async def _compute_progress(
    plan: MaintenancePlan,
    db: AsyncSession,
    baselines: dict[tuple[uuid.UUID, str], datetime] | None = None,
) -> MaintenanceProgress:
    thresholds = plan.trigger_condition.get("thresholds", [])
    results: list[ThresholdProgress] = []

    for thresh in thresholds:
        t_type = thresh["type"]
        limit = float(thresh["value"])

        if baselines is not None:
            baseline: datetime = baselines.get((plan.id, t_type)) or plan.created_at
        else:
            log_res = await db.execute(
                select(MaintenanceLog.performed_at)
                .where(
                    MaintenanceLog.plan_id == plan.id,
                    MaintenanceLog.reset_counters.op("@>")(array([t_type])),
                )
                .order_by(MaintenanceLog.performed_at.desc())
                .limit(1)
            )
            baseline = log_res.scalar_one_or_none() or plan.created_at

        if t_type == "calendar_days":
            current = float(max(0, (datetime.now(timezone.utc) - baseline).days))
        elif t_type in _COUNTER_COLUMNS:
            col = _COUNTER_COLUMNS[t_type]
            # Usar el mínimo entre el baseline del plan y el primer dato disponible
            # para no perder datos históricos anteriores a la creación del plan
            first_data_row = await db.execute(
                text("SELECT MIN(bucket) FROM telemetry_1h WHERE vehicle_id = :vid"),
                {"vid": plan.vehicle_id},
            )
            first_data = first_data_row.scalar_one_or_none()
            effective_baseline = min(baseline, first_data) if first_data else baseline
            row = await db.execute(
                text(
                    f"SELECT COALESCE(SUM({col}), 0) / 60.0 "
                    "FROM telemetry_1h "
                    "WHERE vehicle_id = :vid AND bucket >= :baseline"
                ),
                {"vid": plan.vehicle_id, "baseline": effective_baseline},
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


async def _to_out(
    plan: MaintenancePlan,
    vehicle_name: str,
    db: AsyncSession,
    baselines: dict[tuple[uuid.UUID, str], datetime] | None = None,
) -> MaintenancePlanOut:
    progress = await _compute_progress(plan, db, baselines=baselines)
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
    active: bool | None = Query(None),
    tenant_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_module("maintenance")),
    db: AsyncSession = Depends(get_db),
):
    query = select(MaintenancePlan)
    accessible = await list_accessible_vehicle_ids(user, db)
    if accessible == "ALL":
        if tenant_id is not None:
            query = query.where(MaintenancePlan.tenant_id == tenant_id)
    else:
        query = query.where(MaintenancePlan.vehicle_id.in_(accessible))
    if vehicle_id:
        query = query.where(MaintenancePlan.vehicle_id == vehicle_id)
    if active is not None:
        query = query.where(MaintenancePlan.active == active)
    result = await db.execute(query.order_by(MaintenancePlan.name))
    plans = result.scalars().all()

    vehicle_ids = list({p.vehicle_id for p in plans})
    vehicles: dict[uuid.UUID, str] = {}
    if vehicle_ids:
        v_res = await db.execute(
            select(Vehicle.id, Vehicle.name).where(Vehicle.id.in_(vehicle_ids))
        )
        vehicles = {row.id: row.name for row in v_res}

    plan_ids = [p.id for p in plans]
    baselines = await _fetch_baselines(plan_ids, db)

    return [await _to_out(p, vehicles.get(p.vehicle_id, "—"), db, baselines=baselines) for p in plans]


@router.post("/maintenance/plans", response_model=MaintenancePlanOut, status_code=201)
async def create_plan(
    body: MaintenancePlanCreate,
    user: CurrentUser = Depends(require_management_tier("admin")),
    _: None = Depends(require_module("maintenance")),
    db: AsyncSession = Depends(get_db),
):
    # NOTE: cuando existan subclientes, migrar el check de tenant v1 siguiente a
    # assert_can_access_vehicle(write) para que el fabricante gestione planes de subclientes.
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
    _: None = Depends(require_module("maintenance")),
    db: AsyncSession = Depends(get_db),
):
    plan = await db.get(MaintenancePlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    vehicle = await assert_can_access_vehicle(user, plan.vehicle_id, db, operation="read")
    return await _to_out(plan, vehicle.name, db)


@router.put("/maintenance/plans/{plan_id}", response_model=MaintenancePlanOut)
async def update_plan(
    plan_id: uuid.UUID,
    body: MaintenancePlanUpdate,
    user: CurrentUser = Depends(require_management_tier("admin")),
    _: None = Depends(require_module("maintenance")),
    db: AsyncSession = Depends(get_db),
):
    plan = await db.get(MaintenancePlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    await assert_can_access_vehicle(user, plan.vehicle_id, db, operation="write")

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
    user: CurrentUser = Depends(require_management_tier("admin")),
    _: None = Depends(require_module("maintenance")),
    db: AsyncSession = Depends(get_db),
):
    # NOTE: cuando existan subclientes, migrar el check de tenant v1 siguiente a
    # assert_can_access_vehicle(write) para que el fabricante gestione planes de subclientes.
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
    _: None = Depends(require_module("maintenance")),
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
    _: None = Depends(require_module("maintenance")),
    db: AsyncSession = Depends(get_db),
):
    plan = await db.get(MaintenancePlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    await assert_can_access_vehicle(user, plan.vehicle_id, db, operation="read")
    result = await db.execute(
        select(MaintenanceLog)
        .where(MaintenanceLog.plan_id == plan_id)
        .order_by(MaintenanceLog.performed_at.desc())
    )
    logs = result.scalars().all()

    # Batch lookup user emails to avoid N+1 queries
    user_ids = {lg.performed_by for lg in logs if lg.performed_by is not None}
    email_map: dict[uuid.UUID, str] = {}
    if user_ids:
        u_res = await db.execute(select(User.id, User.email).where(User.id.in_(user_ids)))
        email_map = {row.id: row.email for row in u_res}

    return [
        MaintenanceLogOut(
            id=lg.id, plan_id=lg.plan_id, vehicle_id=lg.vehicle_id,
            performed_at=lg.performed_at,
            performed_by_email=email_map.get(lg.performed_by) if lg.performed_by else None,
            description=lg.description,
            reset_counters=lg.reset_counters or [],
            cost_eur=float(lg.cost_eur) if lg.cost_eur is not None else None,
        )
        for lg in logs
    ]


@router.post("/maintenance/plans/{plan_id}/complete", response_model=MaintenanceLogOut, status_code=201)
async def complete_plan(
    plan_id: uuid.UUID,
    file: UploadFile | None = File(None),
    description: str | None = Form(None),
    user: CurrentUser = Depends(require_operational_role()),
    _: None = Depends(require_module("maintenance")),
    db: AsyncSession = Depends(get_db),
):
    plan = await db.get(MaintenancePlan, plan_id)
    if not plan or (user.tenant_tier != "cmg" and str(plan.tenant_id) != str(user.tenant_id)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan no encontrado")

    has_file = file is not None and file.filename
    if user.tenant_tier != "cmg" and not has_file:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Debe adjuntar un documento (factura o albarán) para registrar el mantenimiento",
        )

    log_id = uuid.uuid4()
    document_url: str | None = None

    if has_file:
        allowed_types = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
        content_type = (file.content_type or "").split(";")[0].strip()
        if content_type not in allowed_types:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Formato no válido. Use imagen (JPEG, PNG, WEBP) o PDF.",
            )
        contents = await file.read()
        if len(contents) > 5 * 1024 * 1024:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El archivo supera el límite de 5 MB",
            )
        ext = Path(file.filename).suffix.lower() or ".pdf"
        dest = Path("/app/uploads/maintenance_docs") / f"{log_id}{ext}"
        dest.write_bytes(contents)
        document_url = f"/uploads/maintenance_docs/{log_id}{ext}"

    thresholds = plan.trigger_condition.get("thresholds", [])
    reset_counters = [t["type"] for t in thresholds]
    now = datetime.now(timezone.utc)

    log = MaintenanceLog(
        id=log_id,
        vehicle_id=plan.vehicle_id,
        plan_id=plan_id,
        performed_at=now,
        performed_by=uuid.UUID(str(user.user_id)),
        description=description,
        reset_counters=reset_counters,
        document_url=document_url,
    )
    db.add(log)

    for t in thresholds:
        if t["type"] == "calendar_days":
            from datetime import timedelta
            plan.next_due_at = now + timedelta(days=float(t["value"]))
            break

    await _resolve_maintenance_alert_for_plan(db, plan.vehicle_id, plan.tenant_id, plan_id)
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
        cost_eur=None,
        document_url=log.document_url,
    )


@router.get("/logs/export.csv")
async def export_maintenance_logs_csv(
    user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_module("maintenance")),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(
            MaintenanceLog,
            MaintenancePlan.name.label("plan_name"),
            Vehicle.name.label("vehicle_name"),
        )
        .join(MaintenancePlan, MaintenancePlan.id == MaintenanceLog.plan_id)
        .join(Vehicle, Vehicle.id == MaintenanceLog.vehicle_id)
    )
    accessible = await list_accessible_vehicle_ids(user, db)
    if accessible != "ALL":
        query = query.where(MaintenanceLog.vehicle_id.in_(accessible))
    query = query.order_by(MaintenanceLog.performed_at.desc())
    result = await db.execute(query)
    rows = result.all()

    # Batch lookup user emails to avoid N+1 queries
    performed_by_ids = {log.performed_by for log, _, _ in rows if log.performed_by}
    email_map: dict = {}
    if performed_by_ids:
        users_res = await db.execute(
            select(User.id, User.email).where(User.id.in_(performed_by_ids))
        )
        email_map = {str(row.id): row.email for row in users_res}

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "vehicle_name", "plan_name", "performed_at", "performed_by_email", "description", "cost_eur"])
    for log, plan_name, vehicle_name in rows:
        writer.writerow([
            str(log.id),
            vehicle_name,
            plan_name,
            log.performed_at.isoformat() if log.performed_at else "",
            email_map.get(str(log.performed_by), "") if log.performed_by else "",
            log.description or "",
            str(log.cost_eur) if log.cost_eur is not None else "",
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="mantenimiento.csv"'},
    )
