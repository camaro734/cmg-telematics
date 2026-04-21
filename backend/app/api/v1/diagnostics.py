import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser

router = APIRouter(tags=["diagnostics"])


@router.get("/diagnostics/can-scan")
async def can_scan(
    vehicle_id: uuid.UUID = Query(...),
    limit: int = Query(default=30, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo CMG admin")

    since = datetime.now(timezone.utc) - timedelta(hours=2)

    rows = await db.execute(
        text("""
            SELECT time, lat, lon, speed_kmh, heading, altitude_m,
                   ignition, pto_active, ext_voltage_mv, can_data
            FROM telemetry_record
            WHERE vehicle_id = :vid
              AND time >= :since
            ORDER BY time DESC
            LIMIT :lim
        """),
        {"vid": str(vehicle_id), "since": since, "lim": limit},
    )
    records = rows.mappings().all()

    return [
        {
            "time": row["time"].isoformat(),
            "lat": float(row["lat"]) if row["lat"] is not None else None,
            "lon": float(row["lon"]) if row["lon"] is not None else None,
            "speed_kmh": float(row["speed_kmh"]) if row["speed_kmh"] is not None else None,
            "heading": row["heading"],
            "altitude_m": row["altitude_m"],
            "ignition": row["ignition"],
            "pto_active": row["pto_active"],
            "ext_voltage_mv": row["ext_voltage_mv"],
            "can_data": row["can_data"] or {},
        }
        for row in records
    ]
