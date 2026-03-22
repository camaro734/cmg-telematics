from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
import uuid

from app.core.database import get_db
from app.models.tenant import Tenant
from app.models.vehicle import Vehicle
from app.models.device import Device
from app.models.user import User
from app.api.v1.auth import get_current_user

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


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


class VehicleOut(BaseModel):
    id: uuid.UUID
    name: str
    license_plate: Optional[str]
    tenant_id: uuid.UUID
    device_imei: Optional[str] = None
    device_online: Optional[bool] = None

    model_config = {"from_attributes": True}


@router.get("", response_model=list[VehicleOut])
async def list_vehicles(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    allowed = await _get_subtree(db, current_user.tenant_id)
    result = await db.execute(
        select(Vehicle, Device)
        .outerjoin(Device, Device.vehicle_id == Vehicle.id)
        .where(Vehicle.active == True, Vehicle.tenant_id.in_(list(allowed)))
    )
    rows = result.all()
    out = []
    for vehicle, device in rows:
        v = VehicleOut(
            id=vehicle.id,
            name=vehicle.name,
            license_plate=vehicle.license_plate,
            tenant_id=vehicle.tenant_id,
            device_imei=device.imei if device else None,
            device_online=device.online if device else None,
        )
        out.append(v)
    return out


@router.get("/{vehicle_id}")
async def get_vehicle(
    vehicle_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Vehicle).where(Vehicle.id == vehicle_id, Vehicle.active == True)
    )
    vehicle = result.scalar_one_or_none()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    allowed = await _get_subtree(db, current_user.tenant_id)
    if vehicle.tenant_id not in allowed:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    return {"id": str(vehicle.id), "name": vehicle.name}
