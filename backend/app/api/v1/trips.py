from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select
from datetime import datetime, timezone
from uuid import UUID
from pydantic import BaseModel
from typing import Optional

from app.core.database import get_db
from app.models.tenant import Tenant
from app.models.user import User
from app.models.vehicle import Vehicle
from app.models.device import Device
from app.api.v1.auth import get_current_user

router = APIRouter(prefix="/vehicles", tags=["trips"])


class Trip(BaseModel):
    trip_num: int
    start_time: datetime
    end_time: datetime
    duration_seconds: int
    max_speed: int
    avg_speed: float
    distance_km: float
    record_count: int
    start_lat: Optional[float]
    start_lng: Optional[float]
    end_lat: Optional[float]
    end_lng: Optional[float]


class TrackPoint(BaseModel):
    time: datetime
    lat: float
    lng: float
    speed: int


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


async def _get_device_for_vehicle(
    vehicle_id: UUID,
    db: AsyncSession,
    current_user: User,
) -> Device:
    """Validate vehicle is in user's subtree and return its active device."""
    vehicle_result = await db.execute(
        select(Vehicle).where(
            Vehicle.id == vehicle_id,
            Vehicle.active == True,
        )
    )
    vehicle = vehicle_result.scalar_one_or_none()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    allowed = await _get_subtree(db, current_user.tenant_id)
    if vehicle.tenant_id not in allowed:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    device_result = await db.execute(
        select(Device).where(
            Device.vehicle_id == vehicle_id,
            Device.active == True,
        )
    )
    device = device_result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="No device assigned to this vehicle")

    return device


@router.get("/{vehicle_id}/trips", response_model=list[Trip])
async def list_trips(
    vehicle_id: UUID,
    start: datetime = Query(...),
    end: Optional[datetime] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List trips for a vehicle in a given time range, detected from ignition ON/OFF cycles."""
    device = await _get_device_for_vehicle(vehicle_id, db, current_user)

    end_dt = end if end is not None else datetime.now(timezone.utc)

    sql = text("""
        WITH numbered AS (
            SELECT
                time, lat, lng, speed, ignition,
                LAG(ignition) OVER (ORDER BY time) AS prev_ign
            FROM telemetry_record
            WHERE device_id = :device_id
              AND time >= :start AND time <= :end
              AND lat IS NOT NULL AND lng IS NOT NULL
        ),
        trip_groups AS (
            SELECT *,
                SUM(CASE WHEN ignition = TRUE AND (prev_ign = FALSE OR prev_ign IS NULL) THEN 1 ELSE 0 END)
                    OVER (ORDER BY time) AS trip_num
            FROM numbered
            WHERE ignition = TRUE
        )
        SELECT
            trip_num,
            MIN(time) AS start_time,
            MAX(time) AS end_time,
            EXTRACT(EPOCH FROM (MAX(time) - MIN(time)))::int AS duration_seconds,
            MAX(speed) AS max_speed,
            AVG(speed)::float AS avg_speed,
            COALESCE(SUM(speed) / 120.0, 0)::float AS distance_km,
            COUNT(*) AS record_count,
            (array_agg(lat ORDER BY time ASC))[1] AS start_lat,
            (array_agg(lng ORDER BY time ASC))[1] AS start_lng,
            (array_agg(lat ORDER BY time DESC))[1] AS end_lat,
            (array_agg(lng ORDER BY time DESC))[1] AS end_lng
        FROM trip_groups
        GROUP BY trip_num
        HAVING COUNT(*) >= 3
        ORDER BY start_time ASC
    """)

    result = await db.execute(
        sql,
        {
            "device_id": str(device.id),
            "start": start,
            "end": end_dt,
        },
    )
    rows = result.mappings().all()
    return [Trip(**dict(r)) for r in rows]


@router.get("/{vehicle_id}/trips/{trip_num}/track", response_model=list[TrackPoint])
async def get_trip_track(
    vehicle_id: UUID,
    trip_num: int,
    start: datetime = Query(...),
    end: Optional[datetime] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get GPS track points for a specific trip number."""
    device = await _get_device_for_vehicle(vehicle_id, db, current_user)

    end_dt = end if end is not None else datetime.now(timezone.utc)

    sql = text("""
        WITH numbered AS (
            SELECT
                time, lat, lng, speed, ignition,
                LAG(ignition) OVER (ORDER BY time) AS prev_ign
            FROM telemetry_record
            WHERE device_id = :device_id
              AND time >= :start AND time <= :end
              AND lat IS NOT NULL AND lng IS NOT NULL
        ),
        trip_groups AS (
            SELECT *,
                SUM(CASE WHEN ignition = TRUE AND (prev_ign = FALSE OR prev_ign IS NULL) THEN 1 ELSE 0 END)
                    OVER (ORDER BY time) AS trip_num
            FROM numbered
            WHERE ignition = TRUE
        ),
        target_trip AS (
            SELECT time, lat, lng, speed FROM trip_groups
            WHERE trip_num = :trip_num
            ORDER BY time ASC
        )
        SELECT * FROM target_trip
    """)

    result = await db.execute(
        sql,
        {
            "device_id": str(device.id),
            "start": start,
            "end": end_dt,
            "trip_num": trip_num,
        },
    )
    rows = result.mappings().all()
    return [TrackPoint(**dict(r)) for r in rows]
