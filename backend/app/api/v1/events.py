from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel
from typing import Optional
import uuid

from app.core.database import get_db
from app.models.user import User
from app.api.v1.auth import get_current_user

router = APIRouter(prefix="/events", tags=["events"])


class EventEntry(BaseModel):
    event_time: datetime
    event_type: str        # "ignition_on" | "ignition_off" | "alert" | "geofence_enter" | "geofence_exit"
    vehicle_id: str
    vehicle_name: str
    detail: Optional[str]
    severity: str          # "info" | "warning" | "danger"


@router.get("", response_model=list[EventEntry])
async def list_recent_events(
    hours: int = Query(default=24, ge=1, le=168),
    vehicle_id: Optional[uuid.UUID] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Combined chronological feed of events across the fleet:
    ignition state changes, alerts fired, geofence events.
    Tenant-scoped, limited to the last N hours.
    """
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    vehicle_filter = "AND v.id = :vehicle_id" if vehicle_id else ""

    sql = text(f"""
        -- Ignition ON events (ignition=true while prev was false/null)
        WITH ign AS (
            SELECT
                tr.time,
                v.id::text AS vehicle_id,
                v.name AS vehicle_name,
                tr.ignition,
                LAG(tr.ignition) OVER (PARTITION BY d.id ORDER BY tr.time) AS prev_ign
            FROM telemetry_record tr
            JOIN device d ON d.id = tr.device_id
            JOIN vehicle v ON v.id = d.vehicle_id
            WHERE v.tenant_id = :tenant_id
              AND v.active = TRUE
              AND tr.time >= :since
              {vehicle_filter}
        ),
        ign_events AS (
            SELECT
                time AS event_time,
                CASE WHEN ignition AND NOT COALESCE(prev_ign, FALSE) THEN 'ignition_on'
                     WHEN NOT ignition AND COALESCE(prev_ign, TRUE) THEN 'ignition_off'
                END AS event_type,
                vehicle_id,
                vehicle_name,
                NULL::text AS detail,
                'info'::text AS severity
            FROM ign
            WHERE (ignition AND NOT COALESCE(prev_ign, FALSE))
               OR (NOT ignition AND COALESCE(prev_ign, TRUE))
        ),
        -- Alert events
        alert_events AS (
            SELECT
                al.fired_at AS event_time,
                'alert' AS event_type,
                v.id::text AS vehicle_id,
                v.name AS vehicle_name,
                al.display_name || ': ' || ROUND(al.converted_value::numeric, 2)::text || ' ' || COALESCE(al.unit, '') AS detail,
                CASE WHEN al.level = 'high' THEN 'danger' ELSE 'warning' END AS severity
            FROM alert_log al
            JOIN device d ON d.id = al.device_id
            JOIN vehicle v ON v.id = d.vehicle_id
            WHERE v.tenant_id = :tenant_id
              AND al.fired_at >= :since
              {vehicle_filter.replace("v.id =", "v.id =")}
        ),
        -- Geofence events
        geo_events AS (
            SELECT
                ge.occurred_at AS event_time,
                'geofence_' || ge.event_type AS event_type,
                v.id::text AS vehicle_id,
                v.name AS vehicle_name,
                gf.name AS detail,
                'info'::text AS severity
            FROM geofence_event ge
            JOIN geofence gf ON gf.id = ge.geofence_id
            JOIN device d ON d.id = ge.device_id
            JOIN vehicle v ON v.id = d.vehicle_id
            WHERE gf.tenant_id = :tenant_id
              AND ge.occurred_at >= :since
              {vehicle_filter.replace("v.id =", "v.id =")}
        )
        SELECT * FROM ign_events
        UNION ALL
        SELECT * FROM alert_events
        UNION ALL
        SELECT * FROM geo_events
        ORDER BY event_time DESC
        LIMIT 200
    """)

    params: dict = {
        "tenant_id": str(current_user.tenant_id),
        "since": since,
    }
    if vehicle_id:
        params["vehicle_id"] = str(vehicle_id)

    result = await db.execute(sql, params)
    rows = result.mappings().all()

    return [
        EventEntry(
            event_time=row["event_time"],
            event_type=row["event_type"],
            vehicle_id=row["vehicle_id"],
            vehicle_name=row["vehicle_name"],
            detail=row["detail"],
            severity=row["severity"],
        )
        for row in rows
        if row["event_type"] is not None
    ]
