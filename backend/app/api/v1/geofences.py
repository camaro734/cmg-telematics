"""
Geofence endpoints — define geographic zones and query events.
Any authenticated user can read geofences for their tenant.
Create / update / delete require admin or superadmin.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
import uuid
from datetime import datetime

from app.core.database import get_db
from app.models.geofence import Geofence, GeofenceEvent
from app.models.user import User
from app.api.v1.auth import get_current_user

router = APIRouter(prefix="/geofences", tags=["geofences"])

ADMIN_ROLES = {"superadmin", "admin"}


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(403, "Insufficient permissions")
    return current_user


# ─── Schemas ────────────────────────────────────────────────────────────────

class GeofenceCreate(BaseModel):
    name: str
    description: Optional[str] = None
    shape_type: str = "circle"  # "circle" | "polygon"
    center_lat: Optional[float] = None
    center_lng: Optional[float] = None
    radius_m: Optional[float] = None
    polygon_points: Optional[list] = None
    alert_on_enter: bool = True
    alert_on_exit: bool = True


class GeofenceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    shape_type: Optional[str] = None
    center_lat: Optional[float] = None
    center_lng: Optional[float] = None
    radius_m: Optional[float] = None
    polygon_points: Optional[list] = None
    alert_on_enter: Optional[bool] = None
    alert_on_exit: Optional[bool] = None
    active: Optional[bool] = None


class GeofenceOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    description: Optional[str]
    shape_type: str
    center_lat: Optional[float]
    center_lng: Optional[float]
    radius_m: Optional[float]
    polygon_points: Optional[list]
    alert_on_enter: bool
    alert_on_exit: bool
    active: bool
    created_at: datetime
    created_by: Optional[uuid.UUID]

    model_config = {"from_attributes": True}


class GeofenceEventOut(BaseModel):
    id: uuid.UUID
    geofence_id: uuid.UUID
    geofence_name: str
    vehicle_id: uuid.UUID
    vehicle_name: Optional[str]
    device_id: uuid.UUID
    event_type: str  # "enter" | "exit"
    occurred_at: datetime
    lat: float
    lng: float

    model_config = {"from_attributes": True}


# ─── Endpoints ──────────────────────────────────────────────────────────────

@router.get("", response_model=list[GeofenceOut])
async def list_geofences(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all geofences for the current user's tenant."""
    result = await db.execute(
        select(Geofence)
        .where(Geofence.tenant_id == current_user.tenant_id)
        .order_by(Geofence.name)
    )
    return result.scalars().all()


@router.post("", response_model=GeofenceOut, status_code=201)
async def create_geofence(
    body: GeofenceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Create a new geofence. Requires admin or superadmin."""
    if body.shape_type not in ("circle", "polygon"):
        raise HTTPException(400, "shape_type must be 'circle' or 'polygon'")

    if body.shape_type == "circle":
        if body.center_lat is None or body.center_lng is None or body.radius_m is None:
            raise HTTPException(400, "Circle geofences require center_lat, center_lng, and radius_m")
    elif body.shape_type == "polygon":
        if not body.polygon_points or len(body.polygon_points) < 3:
            raise HTTPException(400, "Polygon geofences require at least 3 points")

    geofence = Geofence(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        name=body.name,
        description=body.description,
        shape_type=body.shape_type,
        center_lat=body.center_lat,
        center_lng=body.center_lng,
        radius_m=body.radius_m,
        polygon_points=body.polygon_points,
        alert_on_enter=body.alert_on_enter,
        alert_on_exit=body.alert_on_exit,
        created_by=current_user.id,
    )
    db.add(geofence)
    await db.commit()
    await db.refresh(geofence)
    return geofence


@router.patch("/{geofence_id}", response_model=GeofenceOut)
async def update_geofence(
    geofence_id: uuid.UUID,
    body: GeofenceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Update a geofence. Requires admin or superadmin."""
    result = await db.execute(
        select(Geofence).where(
            Geofence.id == geofence_id,
            Geofence.tenant_id == current_user.tenant_id,
        )
    )
    geofence = result.scalar_one_or_none()
    if not geofence:
        raise HTTPException(404, "Geofence not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(geofence, field, value)

    await db.commit()
    await db.refresh(geofence)
    return geofence


@router.delete("/{geofence_id}", status_code=204)
async def delete_geofence(
    geofence_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Delete a geofence. Requires admin or superadmin."""
    result = await db.execute(
        select(Geofence).where(
            Geofence.id == geofence_id,
            Geofence.tenant_id == current_user.tenant_id,
        )
    )
    geofence = result.scalar_one_or_none()
    if not geofence:
        raise HTTPException(404, "Geofence not found")

    await db.delete(geofence)
    await db.commit()


@router.get("/events", response_model=list[GeofenceEventOut])
async def list_geofence_events(
    vehicle_id: Optional[uuid.UUID] = Query(None),
    geofence_id: Optional[uuid.UUID] = Query(None),
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List recent geofence events for the current tenant."""
    # Subquery: only events for geofences belonging to this tenant
    tenant_fence_ids_result = await db.execute(
        select(Geofence.id).where(Geofence.tenant_id == current_user.tenant_id)
    )
    tenant_fence_ids = [row[0] for row in tenant_fence_ids_result.all()]

    if not tenant_fence_ids:
        return []

    query = (
        select(GeofenceEvent)
        .where(GeofenceEvent.geofence_id.in_(tenant_fence_ids))
        .order_by(GeofenceEvent.occurred_at.desc())
        .limit(limit)
    )

    if vehicle_id:
        query = query.where(GeofenceEvent.vehicle_id == vehicle_id)
    if geofence_id:
        query = query.where(GeofenceEvent.geofence_id == geofence_id)

    result = await db.execute(query)
    return result.scalars().all()
