from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
import uuid

from app.core.database import get_db
from app.models.vehicle import Vehicle
from app.models.device import Device
from app.models.tenant import Tenant
from app.models.user import User
from app.api.v1.auth import get_current_user

router = APIRouter(prefix="/ecodriving", tags=["ecodriving"])


# ─── helpers ──────────────────────────────────────────────────────────────────

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


def _compute_grade(score: int) -> str:
    if score >= 90:
        return "A"
    elif score >= 75:
        return "B"
    elif score >= 60:
        return "C"
    elif score >= 40:
        return "D"
    return "F"


# ─── schemas ──────────────────────────────────────────────────────────────────

class EcoDrivingEvent(BaseModel):
    event_type: str  # "speeding" | "harsh_braking" | "harsh_acceleration" | "idling"
    count: int
    penalty: int


class EcoDrivingScore(BaseModel):
    vehicle_id: str
    vehicle_name: str
    period_hours: int
    score: int           # 0-100
    grade: str           # A/B/C/D/F
    events: list[EcoDrivingEvent]
    total_records: int
    distance_km: float
    ignition_hours: float


# ─── SQL for event detection ──────────────────────────────────────────────────

EVENTS_SQL = text("""
WITH speed_changes AS (
    SELECT
        time,
        speed,
        ignition,
        LAG(speed) OVER (PARTITION BY device_id ORDER BY time) AS prev_speed,
        LAG(ignition) OVER (PARTITION BY device_id ORDER BY time) AS prev_ignition
    FROM telemetry_record
    WHERE device_id = :device_id
      AND time >= NOW() - :hours * INTERVAL '1 hour'
),
events AS (
    SELECT
        COUNT(*) FILTER (WHERE speed > 90)                             AS speeding_count,
        COUNT(*) FILTER (WHERE prev_speed - speed > 20 AND speed >= 0) AS harsh_brake_count,
        COUNT(*) FILTER (WHERE speed - prev_speed > 20)                AS harsh_accel_count,
        COUNT(*) FILTER (WHERE ignition = TRUE AND speed = 0)          AS idling_records,
        COUNT(*)                                                        AS total_records,
        COALESCE(SUM(speed) / 120.0, 0)                                AS distance_km,
        COALESCE(COUNT(*) FILTER (WHERE ignition = TRUE) * 30.0 / 3600.0, 0) AS ignition_hours
    FROM speed_changes
)
SELECT * FROM events
""")


# ─── endpoint ─────────────────────────────────────────────────────────────────

@router.get("/scores", response_model=list[EcoDrivingScore])
async def get_ecodriving_scores(
    hours: int = Query(default=24, ge=1, le=8760),
    vehicle_id: Optional[uuid.UUID] = Query(default=None),
    speed_limit: int = Query(default=90, ge=1, le=300),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns eco-driving scores for all vehicles in the user's tenant subtree,
    optionally filtered to a single vehicle.
    """
    tenant_ids = await _get_subtree(db, current_user.tenant_id)
    tenant_id_list = list(tenant_ids)

    # Fetch vehicles (with devices) in tenant subtree
    query = (
        select(Vehicle, Device)
        .outerjoin(Device, Device.vehicle_id == Vehicle.id)
        .where(Vehicle.tenant_id.in_(tenant_id_list))
        .where(Vehicle.active == True)
    )
    if vehicle_id is not None:
        query = query.where(Vehicle.id == vehicle_id)

    result = await db.execute(query)
    rows = result.all()

    scores: list[EcoDrivingScore] = []

    for vehicle, device in rows:
        if device is None:
            # No device assigned — return a neutral score
            scores.append(EcoDrivingScore(
                vehicle_id=str(vehicle.id),
                vehicle_name=vehicle.name,
                period_hours=hours,
                score=100,
                grade="A",
                events=[],
                total_records=0,
                distance_km=0.0,
                ignition_hours=0.0,
            ))
            continue

        row = (await db.execute(
            EVENTS_SQL,
            {"device_id": str(device.id), "hours": hours},
        )).one_or_none()

        if row is None or int(row.total_records or 0) == 0:
            scores.append(EcoDrivingScore(
                vehicle_id=str(vehicle.id),
                vehicle_name=vehicle.name,
                period_hours=hours,
                score=100,
                grade="A",
                events=[],
                total_records=0,
                distance_km=0.0,
                ignition_hours=0.0,
            ))
            continue

        speeding_count   = int(row.speeding_count or 0)
        harsh_brake_count = int(row.harsh_brake_count or 0)
        harsh_accel_count = int(row.harsh_accel_count or 0)
        idling_records   = int(row.idling_records or 0)
        total_records    = int(row.total_records or 0)
        distance_km      = float(row.distance_km or 0)
        ignition_hours   = float(row.ignition_hours or 0)

        # Idling: 1 event per 5-min block (records at 30-sec interval → 10 records = 5 min)
        idling_events = idling_records // 10

        # Penalty calculation
        speeding_penalty    = speeding_count   * 2
        braking_penalty     = harsh_brake_count * 3
        accel_penalty       = harsh_accel_count * 2
        idling_penalty      = idling_events     * 1

        total_penalty = speeding_penalty + braking_penalty + accel_penalty + idling_penalty
        score = max(0, min(100, 100 - total_penalty))
        grade = _compute_grade(score)

        event_list: list[EcoDrivingEvent] = []
        if speeding_count > 0:
            event_list.append(EcoDrivingEvent(
                event_type="speeding", count=speeding_count, penalty=speeding_penalty
            ))
        if harsh_brake_count > 0:
            event_list.append(EcoDrivingEvent(
                event_type="harsh_braking", count=harsh_brake_count, penalty=braking_penalty
            ))
        if harsh_accel_count > 0:
            event_list.append(EcoDrivingEvent(
                event_type="harsh_acceleration", count=harsh_accel_count, penalty=accel_penalty
            ))
        if idling_events > 0:
            event_list.append(EcoDrivingEvent(
                event_type="idling", count=idling_events, penalty=idling_penalty
            ))

        scores.append(EcoDrivingScore(
            vehicle_id=str(vehicle.id),
            vehicle_name=vehicle.name,
            period_hours=hours,
            score=score,
            grade=grade,
            events=event_list,
            total_records=total_records,
            distance_km=round(distance_km, 1),
            ignition_hours=round(ignition_hours, 2),
        ))

    # Sort best score first
    scores.sort(key=lambda s: s.score, reverse=True)
    return scores
