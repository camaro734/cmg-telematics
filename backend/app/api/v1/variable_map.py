"""
Variable Map endpoints — IO key configuration.

Two scopes:
  - Manufacturer template: tenant_id set, vehicle_id null
    → applies to ALL vehicles built by that manufacturer
  - Vehicle override: vehicle_id set, tenant_id null
    → overrides a specific IO key for one vehicle

Resolution order for a vehicle: vehicle override > manufacturer template

Access rules:
  superadmin / admin → full CRUD
  others             → read-only (their tenant subtree)
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, Literal
import uuid
from datetime import datetime

from app.core.database import get_db
from app.models.variable_map import VariableMap
from app.models.vehicle import Vehicle
from app.models.tenant import Tenant
from app.models.user import User
from app.api.v1.auth import get_current_user

router = APIRouter(tags=["variable-maps"])

ALLOWED_ROLES = {"superadmin", "admin"}


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ALLOWED_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
    return current_user


# ─── Schemas ──────────────────────────────────────────────────────────────────

class VariableMapCreate(BaseModel):
    # Exactly one of vehicle_id or tenant_id must be provided
    vehicle_id: Optional[uuid.UUID] = None
    tenant_id: Optional[uuid.UUID] = None
    io_key: str
    display_name: str
    unit: Optional[str] = None
    scale_factor: float = 1.0
    offset: float = 0.0
    alert_low: Optional[float] = None
    alert_high: Optional[float] = None
    data_type: str = "gauge"

    @model_validator(mode="after")
    def check_scope(self):
        if (self.vehicle_id is None) == (self.tenant_id is None):
            raise ValueError("Exactly one of vehicle_id or tenant_id must be set")
        return self


class VariableMapUpdate(BaseModel):
    io_key: Optional[str] = None
    display_name: Optional[str] = None
    unit: Optional[str] = None
    scale_factor: Optional[float] = None
    offset: Optional[float] = None
    alert_low: Optional[float] = None
    alert_high: Optional[float] = None
    data_type: Optional[str] = None


class VariableMapOut(BaseModel):
    id: uuid.UUID
    vehicle_id: Optional[uuid.UUID]
    tenant_id: Optional[uuid.UUID]
    scope: Literal["manufacturer", "vehicle"]
    io_key: str
    display_name: str
    unit: Optional[str]
    scale_factor: float
    offset: float
    alert_low: Optional[float]
    alert_high: Optional[float]
    data_type: str
    created_at: datetime

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_with_scope(cls, vm: VariableMap) -> "VariableMapOut":
        return cls(
            id=vm.id,
            vehicle_id=vm.vehicle_id,
            tenant_id=vm.tenant_id,
            scope="vehicle" if vm.vehicle_id is not None else "manufacturer",
            io_key=vm.io_key,
            display_name=vm.display_name,
            unit=vm.unit,
            scale_factor=vm.scale_factor,
            offset=vm.offset,
            alert_low=vm.alert_low,
            alert_high=vm.alert_high,
            data_type=vm.data_type,
            created_at=vm.created_at,
        )


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _get_subtree(db: AsyncSession, root_id: uuid.UUID) -> set[uuid.UUID]:
    """Return root_id plus all descendant tenant IDs."""
    result = await db.execute(select(Tenant).where(Tenant.active == True))
    all_tenants = result.scalars().all()
    by_parent: dict[uuid.UUID, list[uuid.UUID]] = {}
    for t in all_tenants:
        if t.parent_id:
            by_parent.setdefault(t.parent_id, []).append(t.id)
    visited: set[uuid.UUID] = set()
    queue = [root_id]
    while queue:
        tid = queue.pop()
        visited.add(tid)
        queue.extend(by_parent.get(tid, []))
    return visited


async def _assert_vehicle_access(db: AsyncSession, vehicle_id: uuid.UUID, user: User) -> Vehicle:
    result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id, Vehicle.active == True))
    vehicle = result.scalar_one_or_none()
    if not vehicle:
        raise HTTPException(404, "Vehicle not found")
    if user.role != "superadmin":
        allowed = await _get_subtree(db, user.tenant_id)
        if vehicle.tenant_id not in allowed:
            raise HTTPException(403, "Access to this vehicle is not allowed")
    return vehicle


async def _assert_tenant_access(db: AsyncSession, tenant_id: uuid.UUID, user: User) -> Tenant:
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id, Tenant.active == True))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    if user.role != "superadmin":
        allowed = await _get_subtree(db, user.tenant_id)
        if tenant_id not in allowed:
            raise HTTPException(403, "Access to this tenant is not allowed")
    return tenant


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=list[VariableMapOut])
async def list_variable_maps(
    vehicle_id: Optional[uuid.UUID] = None,
    tenant_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List variable maps. Provide exactly one of:
      - vehicle_id → vehicle-specific overrides only
      - tenant_id  → manufacturer templates only
    """
    if vehicle_id is not None:
        await _assert_vehicle_access(db, vehicle_id, current_user)
        q = select(VariableMap).where(VariableMap.vehicle_id == vehicle_id)
    elif tenant_id is not None:
        await _assert_tenant_access(db, tenant_id, current_user)
        q = select(VariableMap).where(VariableMap.tenant_id == tenant_id)
    else:
        raise HTTPException(400, "Provide vehicle_id or tenant_id")

    result = await db.execute(q.order_by(VariableMap.io_key))
    return [VariableMapOut.from_orm_with_scope(vm) for vm in result.scalars().all()]


@router.get("/resolved", response_model=list[VariableMapOut])
async def get_resolved_variable_maps(
    vehicle_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get the effective (resolved) variable map for a vehicle.
    Merges manufacturer template + vehicle overrides.
    Vehicle-specific entries take precedence over manufacturer templates.
    """
    vehicle = await _assert_vehicle_access(db, vehicle_id, current_user)

    # 1. Get manufacturer templates (if vehicle has a manufacturer)
    templates: dict[str, VariableMap] = {}
    if vehicle.manufacturer_id:
        res = await db.execute(
            select(VariableMap)
            .where(VariableMap.tenant_id == vehicle.manufacturer_id)
            .order_by(VariableMap.io_key)
        )
        for vm in res.scalars().all():
            templates[vm.io_key] = vm

    # 2. Get vehicle-specific overrides
    res = await db.execute(
        select(VariableMap)
        .where(VariableMap.vehicle_id == vehicle_id)
        .order_by(VariableMap.io_key)
    )
    overrides: dict[str, VariableMap] = {}
    for vm in res.scalars().all():
        overrides[vm.io_key] = vm

    # 3. Merge: overrides win per io_key
    merged = {**templates, **overrides}
    return [VariableMapOut.from_orm_with_scope(vm) for vm in sorted(merged.values(), key=lambda x: x.io_key)]


@router.post("", response_model=VariableMapOut, status_code=201)
async def create_variable_map(
    body: VariableMapCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    valid_types = {"gauge", "counter", "boolean", "hours"}
    if body.data_type not in valid_types:
        raise HTTPException(400, f"data_type must be one of: {valid_types}")

    if body.vehicle_id:
        await _assert_vehicle_access(db, body.vehicle_id, current_user)
    else:
        await _assert_tenant_access(db, body.tenant_id, current_user)

    vm = VariableMap(
        vehicle_id=body.vehicle_id,
        tenant_id=body.tenant_id,
        io_key=body.io_key,
        display_name=body.display_name,
        unit=body.unit,
        scale_factor=body.scale_factor,
        offset=body.offset,
        alert_low=body.alert_low,
        alert_high=body.alert_high,
        data_type=body.data_type,
    )
    db.add(vm)
    await db.commit()
    await db.refresh(vm)
    return VariableMapOut.from_orm_with_scope(vm)


@router.patch("/{variable_id}", response_model=VariableMapOut)
async def update_variable_map(
    variable_id: uuid.UUID,
    body: VariableMapUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(VariableMap).where(VariableMap.id == variable_id))
    vm = result.scalar_one_or_none()
    if not vm:
        raise HTTPException(404, "Variable map not found")

    # Verify access to whichever scope this belongs to
    if vm.vehicle_id:
        await _assert_vehicle_access(db, vm.vehicle_id, current_user)
    else:
        await _assert_tenant_access(db, vm.tenant_id, current_user)

    if body.io_key is not None:
        vm.io_key = body.io_key
    if body.display_name is not None:
        vm.display_name = body.display_name
    if body.unit is not None:
        vm.unit = body.unit
    if body.scale_factor is not None:
        vm.scale_factor = body.scale_factor
    if body.offset is not None:
        vm.offset = body.offset
    if body.alert_low is not None:
        vm.alert_low = body.alert_low
    if body.alert_high is not None:
        vm.alert_high = body.alert_high
    if body.data_type is not None:
        valid_types = {"gauge", "counter", "boolean", "hours"}
        if body.data_type not in valid_types:
            raise HTTPException(400, f"data_type must be one of: {valid_types}")
        vm.data_type = body.data_type

    await db.commit()
    await db.refresh(vm)
    return VariableMapOut.from_orm_with_scope(vm)


@router.delete("/{variable_id}", status_code=204)
async def delete_variable_map(
    variable_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(VariableMap).where(VariableMap.id == variable_id))
    vm = result.scalar_one_or_none()
    if not vm:
        raise HTTPException(404, "Variable map not found")

    if vm.vehicle_id:
        await _assert_vehicle_access(db, vm.vehicle_id, current_user)
    else:
        await _assert_tenant_access(db, vm.tenant_id, current_user)

    await db.delete(vm)
    await db.commit()
