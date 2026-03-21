"""
Alerts endpoints — list, count and acknowledge alert logs.
Access: all authenticated users (filtered by tenant subtree).
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
import uuid

from app.core.database import get_db
from app.models.alert_log import AlertLog
from app.models.vehicle import Vehicle
from app.models.tenant import Tenant
from app.api.v1.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/alerts", tags=["alerts"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class AlertLogOut(BaseModel):
    id: uuid.UUID
    device_id: uuid.UUID
    vehicle_id: uuid.UUID
    io_key: str
    display_name: str
    level: str
    raw_value: float
    converted_value: float
    threshold: float
    unit: str
    fired_at: datetime
    resolved_at: Optional[datetime]
    acknowledged_at: Optional[datetime]
    vehicle_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# ─── Helpers ─────────────────────────────────────────────────────────────────

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


async def _allowed_vehicle_ids(db: AsyncSession, user: User) -> Optional[set[uuid.UUID]]:
    """
    Returns the set of vehicle UUIDs the user may see, or None if superadmin (all).
    """
    if user.role == "superadmin":
        return None  # no restriction

    subtree = await _get_subtree(db, user.tenant_id)
    result = await db.execute(
        select(Vehicle.id).where(Vehicle.tenant_id.in_(subtree), Vehicle.active == True)
    )
    return {row[0] for row in result.all()}


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("", response_model=list[AlertLogOut])
async def list_alerts(
    vehicle_id: Optional[uuid.UUID] = None,
    level: Optional[str] = None,
    active_only: bool = False,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    allowed_ids = await _allowed_vehicle_ids(db, current_user)

    # Join Vehicle to get vehicle name
    query = (
        select(AlertLog, Vehicle.name.label("vehicle_name"))
        .join(Vehicle, Vehicle.id == AlertLog.vehicle_id)
    )

    # Tenant filter
    if allowed_ids is not None:
        query = query.where(AlertLog.vehicle_id.in_(allowed_ids))

    # Optional filters
    if vehicle_id is not None:
        # Verify the caller can see this vehicle
        if allowed_ids is not None and vehicle_id not in allowed_ids:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to this vehicle")
        query = query.where(AlertLog.vehicle_id == vehicle_id)

    if level is not None:
        query = query.where(AlertLog.level == level)

    if active_only:
        query = query.where(AlertLog.resolved_at.is_(None))

    query = query.order_by(AlertLog.fired_at.desc()).limit(limit).offset(offset)

    result = await db.execute(query)
    rows = result.all()

    out = []
    for alert, vehicle_name in rows:
        item = AlertLogOut(
            id=alert.id,
            device_id=alert.device_id,
            vehicle_id=alert.vehicle_id,
            io_key=alert.io_key,
            display_name=alert.display_name,
            level=alert.level,
            raw_value=alert.raw_value,
            converted_value=alert.converted_value,
            threshold=alert.threshold,
            unit=alert.unit,
            fired_at=alert.fired_at,
            resolved_at=alert.resolved_at,
            acknowledged_at=alert.acknowledged_at,
            vehicle_name=vehicle_name,
        )
        out.append(item)

    return out


@router.get("/active/count")
async def active_alert_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns the count of unresolved alerts for the user's tenant."""
    allowed_ids = await _allowed_vehicle_ids(db, current_user)

    query = select(AlertLog).where(AlertLog.resolved_at.is_(None))

    if allowed_ids is not None:
        query = query.where(AlertLog.vehicle_id.in_(allowed_ids))

    result = await db.execute(query)
    alerts = result.scalars().all()
    return {"count": len(alerts)}


@router.post("/{alert_id}/acknowledge")
async def acknowledge_alert(
    alert_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Acknowledge an alert (mark as seen)."""
    result = await db.execute(select(AlertLog).where(AlertLog.id == alert_id))
    alert = result.scalar_one_or_none()

    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")

    # Check access
    allowed_ids = await _allowed_vehicle_ids(db, current_user)
    if allowed_ids is not None and alert.vehicle_id not in allowed_ids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied to this alert")

    alert.acknowledged_at = datetime.now(timezone.utc)
    alert.acknowledged_by = current_user.id
    await db.commit()

    return {"id": str(alert.id), "acknowledged_at": alert.acknowledged_at.isoformat()}
