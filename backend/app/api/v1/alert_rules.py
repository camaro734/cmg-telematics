"""
Alert Rules CRUD — configure threshold-based alerts on FMC650 variables.
Access: superadmin, admin (create/edit/delete); operator/viewer (read-only).
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from datetime import datetime
from uuid import UUID

from app.core.database import get_db
from app.models.alert_rule import AlertRule
from app.models.vehicle import Vehicle
from app.models.tenant import Tenant
from app.models.user import User
from app.api.v1.auth import get_current_user

router = APIRouter(prefix="/alert-rules", tags=["alert-rules"])

WRITE_ROLES = {"superadmin", "admin"}

VALID_CONDITIONS = {"gt", "lt", "gte", "lte", "eq", "neq"}
CONDITION_LABELS = {
    "gt": "> Mayor que",
    "lt": "< Menor que",
    "gte": "≥ Mayor o igual",
    "lte": "≤ Menor o igual",
    "eq": "= Igual a",
    "neq": "≠ Distinto de",
}


# ─── Schemas ─────────────────────────────────────────────────────────────────

class AlertRuleCreate(BaseModel):
    vehicle_id: Optional[UUID] = None  # null = all vehicles in tenant
    name: str
    description: Optional[str] = None
    io_key: str
    display_name: str
    condition: str = "gt"
    threshold: float
    scale_factor: float = 1.0
    offset: float = 0.0
    unit: str = ""
    level: str = "high"
    cooldown_minutes: int = 60


class AlertRuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    io_key: Optional[str] = None
    display_name: Optional[str] = None
    condition: Optional[str] = None
    threshold: Optional[float] = None
    scale_factor: Optional[float] = None
    offset: Optional[float] = None
    unit: Optional[str] = None
    level: Optional[str] = None
    cooldown_minutes: Optional[int] = None
    active: Optional[bool] = None


class AlertRuleOut(BaseModel):
    id: UUID
    tenant_id: UUID
    vehicle_id: Optional[UUID]
    name: str
    description: Optional[str]
    io_key: str
    display_name: str
    condition: str
    threshold: float
    scale_factor: float
    offset: float
    unit: str
    level: str
    cooldown_minutes: int
    active: bool
    created_at: datetime
    vehicle_name: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


# ─── Helpers ─────────────────────────────────────────────────────────────────

async def _get_subtree(db: AsyncSession, root_id: UUID) -> set[UUID]:
    result = await db.execute(select(Tenant).where(Tenant.active == True))
    all_tenants = result.scalars().all()
    by_parent: dict[UUID, list[UUID]] = {}
    for t in all_tenants:
        if t.parent_id:
            by_parent.setdefault(t.parent_id, []).append(t.id)
    visited: set[UUID] = set()
    queue = [root_id]
    while queue:
        tid = queue.pop()
        visited.add(tid)
        queue.extend(by_parent.get(tid, []))
    return visited


async def _allowed_tenant_ids(db: AsyncSession, user: User) -> set[UUID]:
    if user.role == "superadmin":
        result = await db.execute(select(Tenant.id).where(Tenant.active == True))
        return set(result.scalars().all())
    return await _get_subtree(db, user.tenant_id)


async def _allowed_vehicle_ids(db: AsyncSession, user: User) -> set[UUID]:
    allowed_tenants = await _allowed_tenant_ids(db, user)
    result = await db.execute(
        select(Vehicle.id).where(Vehicle.active == True, Vehicle.tenant_id.in_(allowed_tenants))
    )
    return set(result.scalars().all())


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/conditions")
async def list_conditions():
    return [{"key": k, "label": v} for k, v in CONDITION_LABELS.items()]


@router.get("", response_model=list[AlertRuleOut])
async def list_rules(
    vehicle_id: Optional[UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    allowed_tenants = await _allowed_tenant_ids(db, current_user)

    q = select(AlertRule).where(
        AlertRule.tenant_id.in_(allowed_tenants),
        AlertRule.active == True,
    )
    if vehicle_id is not None:
        q = q.where(
            (AlertRule.vehicle_id == vehicle_id) | (AlertRule.vehicle_id.is_(None))
        )
    q = q.order_by(AlertRule.created_at.desc())
    result = await db.execute(q)
    rules = result.scalars().all()

    # Get vehicle names
    vids = {r.vehicle_id for r in rules if r.vehicle_id}
    vnames: dict[UUID, str] = {}
    if vids:
        vr = await db.execute(select(Vehicle.id, Vehicle.name).where(Vehicle.id.in_(vids)))
        vnames = {row.id: row.name for row in vr.all()}

    out = []
    for r in rules:
        out.append(AlertRuleOut(
            id=r.id, tenant_id=r.tenant_id, vehicle_id=r.vehicle_id,
            name=r.name, description=r.description, io_key=r.io_key,
            display_name=r.display_name, condition=r.condition,
            threshold=r.threshold, scale_factor=r.scale_factor,
            offset=r.offset, unit=r.unit, level=r.level,
            cooldown_minutes=r.cooldown_minutes, active=r.active,
            created_at=r.created_at,
            vehicle_name=vnames.get(r.vehicle_id) if r.vehicle_id else None,
        ))
    return out


@router.post("", response_model=AlertRuleOut, status_code=201)
async def create_rule(
    body: AlertRuleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in WRITE_ROLES:
        raise HTTPException(403, "Insufficient permissions")
    if body.condition not in VALID_CONDITIONS:
        raise HTTPException(400, f"condition must be one of: {VALID_CONDITIONS}")

    allowed_vehicles = await _allowed_vehicle_ids(db, current_user)
    if body.vehicle_id is not None and body.vehicle_id not in allowed_vehicles:
        raise HTTPException(403, "Access denied to this vehicle")

    # Determine tenant_id for the rule
    if current_user.role == "superadmin":
        # Use the vehicle's tenant, or the user's own tenant if no vehicle
        if body.vehicle_id:
            vr = await db.execute(select(Vehicle).where(Vehicle.id == body.vehicle_id))
            v = vr.scalar_one_or_none()
            tenant_id = v.tenant_id if v else current_user.tenant_id
        else:
            tenant_id = current_user.tenant_id
    else:
        tenant_id = current_user.tenant_id

    rule = AlertRule(
        tenant_id=tenant_id,
        vehicle_id=body.vehicle_id,
        name=body.name,
        description=body.description,
        io_key=body.io_key,
        display_name=body.display_name,
        condition=body.condition,
        threshold=body.threshold,
        scale_factor=body.scale_factor,
        offset=body.offset,
        unit=body.unit,
        level=body.level,
        cooldown_minutes=body.cooldown_minutes,
        created_by=current_user.id,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)

    vname = None
    if rule.vehicle_id:
        vr = await db.execute(select(Vehicle.name).where(Vehicle.id == rule.vehicle_id))
        vname = vr.scalar_one_or_none()

    return AlertRuleOut(
        id=rule.id, tenant_id=rule.tenant_id, vehicle_id=rule.vehicle_id,
        name=rule.name, description=rule.description, io_key=rule.io_key,
        display_name=rule.display_name, condition=rule.condition,
        threshold=rule.threshold, scale_factor=rule.scale_factor,
        offset=rule.offset, unit=rule.unit, level=rule.level,
        cooldown_minutes=rule.cooldown_minutes, active=rule.active,
        created_at=rule.created_at, vehicle_name=vname,
    )


@router.patch("/{rule_id}", response_model=AlertRuleOut)
async def update_rule(
    rule_id: UUID,
    body: AlertRuleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in WRITE_ROLES:
        raise HTTPException(403, "Insufficient permissions")

    result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(404, "Rule not found")

    allowed_tenants = await _allowed_tenant_ids(db, current_user)
    if rule.tenant_id not in allowed_tenants:
        raise HTTPException(403, "Access denied")

    if body.name is not None: rule.name = body.name
    if body.description is not None: rule.description = body.description
    if body.io_key is not None: rule.io_key = body.io_key
    if body.display_name is not None: rule.display_name = body.display_name
    if body.condition is not None:
        if body.condition not in VALID_CONDITIONS:
            raise HTTPException(400, f"condition must be one of: {VALID_CONDITIONS}")
        rule.condition = body.condition
    if body.threshold is not None: rule.threshold = body.threshold
    if body.scale_factor is not None: rule.scale_factor = body.scale_factor
    if body.offset is not None: rule.offset = body.offset
    if body.unit is not None: rule.unit = body.unit
    if body.level is not None: rule.level = body.level
    if body.cooldown_minutes is not None: rule.cooldown_minutes = body.cooldown_minutes
    if body.active is not None: rule.active = body.active

    await db.commit()
    await db.refresh(rule)

    vname = None
    if rule.vehicle_id:
        vr = await db.execute(select(Vehicle.name).where(Vehicle.id == rule.vehicle_id))
        vname = vr.scalar_one_or_none()

    return AlertRuleOut(
        id=rule.id, tenant_id=rule.tenant_id, vehicle_id=rule.vehicle_id,
        name=rule.name, description=rule.description, io_key=rule.io_key,
        display_name=rule.display_name, condition=rule.condition,
        threshold=rule.threshold, scale_factor=rule.scale_factor,
        offset=rule.offset, unit=rule.unit, level=rule.level,
        cooldown_minutes=rule.cooldown_minutes, active=rule.active,
        created_at=rule.created_at, vehicle_name=vname,
    )


@router.delete("/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in WRITE_ROLES:
        raise HTTPException(403, "Insufficient permissions")

    result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(404, "Rule not found")

    allowed_tenants = await _allowed_tenant_ids(db, current_user)
    if rule.tenant_id not in allowed_tenants:
        raise HTTPException(403, "Access denied")

    rule.active = False
    await db.commit()
