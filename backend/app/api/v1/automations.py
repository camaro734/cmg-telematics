"""
Automation Rules — per-client configurable trigger + action engine.
Access: superadmin only (read and write).
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, Any
from datetime import datetime
from uuid import UUID

from app.core.database import get_db
from app.models.automation_rule import AutomationRule, AutomationSession, AutomationPositionLog
from app.models.vehicle import Vehicle
from app.models.tenant import Tenant
from app.models.user import User
from app.api.v1.auth import get_current_user


async def _get_accessible_vehicle_ids(db, user: User) -> set[UUID]:
    """Return vehicle IDs accessible to the user based on their tenant subtree."""
    if user.role == "superadmin":
        result = await db.execute(select(Vehicle.id).where(Vehicle.active == True))
        return set(result.scalars().all())
    # Build tenant subtree
    all_tenants = (await db.execute(select(Tenant).where(Tenant.active == True))).scalars().all()
    by_parent: dict[UUID, list[UUID]] = {}
    for t in all_tenants:
        if t.parent_id:
            by_parent.setdefault(t.parent_id, []).append(t.id)
    visited: set[UUID] = set()
    queue = [user.tenant_id]
    while queue:
        tid = queue.pop()
        visited.add(tid)
        queue.extend(by_parent.get(tid, []))
    result = await db.execute(
        select(Vehicle.id).where(Vehicle.active == True, Vehicle.tenant_id.in_(visited))
    )
    return set(result.scalars().all())

router = APIRouter(prefix="/automations", tags=["automations"])

VALID_CONDITIONS = {"gt", "lt", "gte", "lte", "eq", "neq"}
VALID_ACTION_TYPES = {"track_position"}


def _require_superadmin(current_user: User):
    if current_user.role != "superadmin":
        raise HTTPException(403, "Solo superadmin puede gestionar automatizaciones")


# ─── Schemas ──────────────────────────────────────────────────────────────────

class ActionSchema(BaseModel):
    type: str
    params: dict[str, Any] = {}


class AutomationRuleCreate(BaseModel):
    tenant_id: UUID
    vehicle_id: Optional[UUID] = None
    name: str
    description: Optional[str] = None
    io_key: str
    condition: str = "eq"
    threshold: float
    scale_factor: float = 1.0
    offset: float = 0.0
    actions: list[ActionSchema]


class AutomationRuleUpdate(BaseModel):
    tenant_id: Optional[UUID] = None
    vehicle_id: Optional[UUID] = None
    clear_vehicle: bool = False   # set True to remove vehicle assignment (fleet-wide)
    name: Optional[str] = None
    description: Optional[str] = None
    io_key: Optional[str] = None
    condition: Optional[str] = None
    threshold: Optional[float] = None
    scale_factor: Optional[float] = None
    offset: Optional[float] = None
    actions: Optional[list[ActionSchema]] = None
    active: Optional[bool] = None


class AutomationRuleOut(BaseModel):
    id: UUID
    tenant_id: UUID
    vehicle_id: Optional[UUID]
    name: str
    description: Optional[str]
    io_key: str
    condition: str
    threshold: float
    scale_factor: float
    offset: float
    actions: list[dict]
    active: bool
    created_at: datetime
    vehicle_name: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class AutomationSessionOut(BaseModel):
    id: UUID
    rule_id: UUID
    device_id: UUID
    vehicle_id: UUID
    started_at: datetime
    ended_at: Optional[datetime]
    label: Optional[str]
    color: Optional[str]
    position_count: int = 0
    model_config = ConfigDict(from_attributes=True)


class PositionOut(BaseModel):
    time: datetime
    lat: float
    lng: float
    speed: Optional[int]
    model_config = ConfigDict(from_attributes=True)


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/action-types")
async def list_action_types():
    return [
        {"type": "track_position", "label": "Rastrear posición", "description": "Guarda la ubicación del vehículo mientras la condición está activa"},
    ]


@router.get("", response_model=list[AutomationRuleOut])
async def list_rules(
    tenant_id: Optional[UUID] = Query(None),
    vehicle_id: Optional[UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Superadmin: can query all rules or filter freely
    # Other roles: can only see rules for their own vehicles/tenant (read-only)
    if current_user.role != "superadmin":
        accessible = await _get_accessible_vehicle_ids(db, current_user)
        # If vehicle_id requested, verify access
        if vehicle_id and vehicle_id not in accessible:
            raise HTTPException(403, "Sin acceso a este vehículo")
        # Scope to own tenant and (optionally) the requested vehicle
        q = select(AutomationRule).where(
            AutomationRule.active == True,
            AutomationRule.tenant_id == current_user.tenant_id,
        )
        if vehicle_id:
            q = q.where(
                (AutomationRule.vehicle_id == vehicle_id) | (AutomationRule.vehicle_id.is_(None))
            )
        q = q.order_by(AutomationRule.created_at.desc())
        result = await db.execute(q)
        rules = result.scalars().all()
        vids = {r.vehicle_id for r in rules if r.vehicle_id}
        vnames: dict[UUID, str] = {}
        if vids:
            vr = await db.execute(select(Vehicle.id, Vehicle.name).where(Vehicle.id.in_(vids)))
            vnames = {row.id: row.name for row in vr.all()}
        return [
            AutomationRuleOut(
                id=r.id, tenant_id=r.tenant_id, vehicle_id=r.vehicle_id,
                name=r.name, description=r.description, io_key=r.io_key,
                condition=r.condition, threshold=r.threshold,
                scale_factor=r.scale_factor, offset=r.offset,
                actions=r.actions or [], active=r.active, created_at=r.created_at,
                vehicle_name=vnames.get(r.vehicle_id) if r.vehicle_id else None,
            )
            for r in rules
        ]

    # Superadmin path
    q = select(AutomationRule).where(AutomationRule.active == True)
    if tenant_id:
        q = q.where(AutomationRule.tenant_id == tenant_id)
    if vehicle_id:
        q = q.where(
            (AutomationRule.vehicle_id == vehicle_id) | (AutomationRule.vehicle_id.is_(None))
        )
    q = q.order_by(AutomationRule.created_at.desc())
    result = await db.execute(q)
    rules = result.scalars().all()

    vids = {r.vehicle_id for r in rules if r.vehicle_id}
    vnames: dict[UUID, str] = {}
    if vids:
        vr = await db.execute(select(Vehicle.id, Vehicle.name).where(Vehicle.id.in_(vids)))
        vnames = {row.id: row.name for row in vr.all()}

    return [
        AutomationRuleOut(
            id=r.id, tenant_id=r.tenant_id, vehicle_id=r.vehicle_id,
            name=r.name, description=r.description, io_key=r.io_key,
            condition=r.condition, threshold=r.threshold,
            scale_factor=r.scale_factor, offset=r.offset,
            actions=r.actions or [], active=r.active, created_at=r.created_at,
            vehicle_name=vnames.get(r.vehicle_id) if r.vehicle_id else None,
        )
        for r in rules
    ]


@router.post("", response_model=AutomationRuleOut, status_code=201)
async def create_rule(
    body: AutomationRuleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_superadmin(current_user)

    if body.condition not in VALID_CONDITIONS:
        raise HTTPException(400, f"condition debe ser uno de: {VALID_CONDITIONS}")
    for action in body.actions:
        if action.type not in VALID_ACTION_TYPES:
            raise HTTPException(400, f"Tipo de acción '{action.type}' no soportado. Tipos válidos: {VALID_ACTION_TYPES}")

    if body.vehicle_id:
        vr = await db.execute(select(Vehicle).where(Vehicle.id == body.vehicle_id))
        if not vr.scalar_one_or_none():
            raise HTTPException(404, "Vehículo no encontrado")

    rule = AutomationRule(
        tenant_id=body.tenant_id,
        vehicle_id=body.vehicle_id,
        name=body.name,
        description=body.description,
        io_key=body.io_key,
        condition=body.condition,
        threshold=body.threshold,
        scale_factor=body.scale_factor,
        offset=body.offset,
        actions=[a.model_dump() for a in body.actions],
        created_by=current_user.id,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)

    vname = None
    if rule.vehicle_id:
        vr = await db.execute(select(Vehicle.name).where(Vehicle.id == rule.vehicle_id))
        vname = vr.scalar_one_or_none()

    return AutomationRuleOut(
        id=rule.id, tenant_id=rule.tenant_id, vehicle_id=rule.vehicle_id,
        name=rule.name, description=rule.description, io_key=rule.io_key,
        condition=rule.condition, threshold=rule.threshold,
        scale_factor=rule.scale_factor, offset=rule.offset,
        actions=rule.actions or [], active=rule.active, created_at=rule.created_at,
        vehicle_name=vname,
    )


@router.patch("/{rule_id}", response_model=AutomationRuleOut)
async def update_rule(
    rule_id: UUID,
    body: AutomationRuleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_superadmin(current_user)

    result = await db.execute(select(AutomationRule).where(AutomationRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(404, "Regla no encontrada")

    if body.tenant_id is not None: rule.tenant_id = body.tenant_id
    if body.clear_vehicle: rule.vehicle_id = None
    elif body.vehicle_id is not None: rule.vehicle_id = body.vehicle_id
    if body.name is not None: rule.name = body.name
    if body.description is not None: rule.description = body.description
    if body.io_key is not None: rule.io_key = body.io_key
    if body.condition is not None:
        if body.condition not in VALID_CONDITIONS:
            raise HTTPException(400, f"condition debe ser uno de: {VALID_CONDITIONS}")
        rule.condition = body.condition
    if body.threshold is not None: rule.threshold = body.threshold
    if body.scale_factor is not None: rule.scale_factor = body.scale_factor
    if body.offset is not None: rule.offset = body.offset
    if body.actions is not None:
        for action in body.actions:
            if action.type not in VALID_ACTION_TYPES:
                raise HTTPException(400, f"Tipo de acción '{action.type}' no soportado")
        rule.actions = [a.model_dump() for a in body.actions]
    if body.active is not None: rule.active = body.active

    await db.commit()
    await db.refresh(rule)

    vname = None
    if rule.vehicle_id:
        vr = await db.execute(select(Vehicle.name).where(Vehicle.id == rule.vehicle_id))
        vname = vr.scalar_one_or_none()

    return AutomationRuleOut(
        id=rule.id, tenant_id=rule.tenant_id, vehicle_id=rule.vehicle_id,
        name=rule.name, description=rule.description, io_key=rule.io_key,
        condition=rule.condition, threshold=rule.threshold,
        scale_factor=rule.scale_factor, offset=rule.offset,
        actions=rule.actions or [], active=rule.active, created_at=rule.created_at,
        vehicle_name=vname,
    )


@router.delete("/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_superadmin(current_user)

    result = await db.execute(select(AutomationRule).where(AutomationRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(404, "Regla no encontrada")

    rule.active = False
    await db.commit()


@router.get("/sessions", response_model=list[AutomationSessionOut])
async def list_sessions_by_vehicle(
    vehicle_id: UUID = Query(...),
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Any authenticated user can see sessions for vehicles they have access to
    accessible = await _get_accessible_vehicle_ids(db, current_user)
    if vehicle_id not in accessible:
        raise HTTPException(403, "Sin acceso a este vehículo")

    sessions_result = await db.execute(
        select(AutomationSession)
        .where(AutomationSession.vehicle_id == vehicle_id)
        .order_by(AutomationSession.started_at.desc())
        .limit(limit)
    )
    sessions = sessions_result.scalars().all()

    out = []
    for s in sessions:
        count_result = await db.execute(
            select(AutomationPositionLog).where(AutomationPositionLog.session_id == s.id)
        )
        count = len(count_result.scalars().all())
        out.append(AutomationSessionOut(
            id=s.id, rule_id=s.rule_id, device_id=s.device_id,
            vehicle_id=s.vehicle_id, started_at=s.started_at,
            ended_at=s.ended_at, label=s.label, color=s.color,
            position_count=count,
        ))
    return out


@router.get("/{rule_id}/sessions", response_model=list[AutomationSessionOut])
async def list_sessions(
    rule_id: UUID,
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_superadmin(current_user)

    result = await db.execute(
        select(AutomationRule).where(AutomationRule.id == rule_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Regla no encontrada")

    sessions_result = await db.execute(
        select(AutomationSession)
        .where(AutomationSession.rule_id == rule_id)
        .order_by(AutomationSession.started_at.desc())
        .limit(limit)
    )
    sessions = sessions_result.scalars().all()

    out = []
    for s in sessions:
        count_result = await db.execute(
            select(AutomationPositionLog)
            .where(AutomationPositionLog.session_id == s.id)
        )
        count = len(count_result.scalars().all())
        out.append(AutomationSessionOut(
            id=s.id, rule_id=s.rule_id, device_id=s.device_id,
            vehicle_id=s.vehicle_id, started_at=s.started_at,
            ended_at=s.ended_at, label=s.label, color=s.color,
            position_count=count,
        ))
    return out


@router.get("/sessions/{session_id}/positions", response_model=list[PositionOut])
async def get_session_positions(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AutomationSession).where(AutomationSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Sesión no encontrada")
    # Verify the user has access to the vehicle of this session
    accessible = await _get_accessible_vehicle_ids(db, current_user)
    if session.vehicle_id not in accessible:
        raise HTTPException(403, "Sin acceso a este vehículo")

    positions_result = await db.execute(
        select(AutomationPositionLog)
        .where(AutomationPositionLog.session_id == session_id)
        .order_by(AutomationPositionLog.time.asc())
    )
    return positions_result.scalars().all()
