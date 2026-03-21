from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid

from app.core.database import get_db
from app.models.vehicle import Vehicle
from app.models.device import Device
from app.models.telemetry import TelemetryRecord
from app.models.user import User
from app.api.v1.auth import get_current_user

router = APIRouter(prefix="/vehicles", tags=["telemetry"])


@router.get("/{vehicle_id}/last")
async def get_last_telemetry(
    vehicle_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Last known state of a vehicle."""
    device_result = await db.execute(
        select(Device, Vehicle).join(Vehicle, Vehicle.id == Device.vehicle_id).where(
            Device.vehicle_id == vehicle_id, Device.active == True
        )
    )
    row = device_result.first()
    if not row:
        raise HTTPException(404, "No device assigned to this vehicle")
    device, vehicle_obj = row

    result = await db.execute(
        select(TelemetryRecord)
        .where(TelemetryRecord.device_id == device.id)
        .order_by(TelemetryRecord.time.desc())
        .limit(1)
    )
    record = result.scalar_one_or_none()
    if not record:
        return {"device_id": str(device.id), "imei": device.imei, "vehicle_name": vehicle_obj.name, "online": device.online, "data": None}

    return {
        "device_id": str(device.id),
        "imei": device.imei,
        "vehicle_name": vehicle_obj.name,
        "license_plate": vehicle_obj.license_plate,
        "online": device.online,
        "last_seen": device.last_seen.isoformat() if device.last_seen else None,
        "data": {
            "time": record.time.isoformat(),
            "lat": record.lat,
            "lng": record.lng,
            "speed": record.speed,
            "altitude": record.altitude,
            "satellites": record.satellites,
            "ignition": record.ignition,
            "ext_voltage_mv": record.ext_voltage_mv,
            "dout1": record.dout1,
            "dout2": record.dout2,
            "dout3": record.dout3,
            "dout4": record.dout4,
            "io_data": record.io_data,
        },
    }


@router.get("/{vehicle_id}/telemetry")
async def get_telemetry_history(
    vehicle_id: uuid.UUID,
    hours: int = Query(default=24, le=168),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Telemetry history — last N hours, bucketed by 5-minute intervals using TimescaleDB.
    """
    device_result = await db.execute(
        select(Device).where(Device.vehicle_id == vehicle_id, Device.active == True)
    )
    device = device_result.scalar_one_or_none()
    if not device:
        raise HTTPException(404, "No device assigned to this vehicle")

    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    sql = text("""
        SELECT
            time_bucket('5 minutes', time) AS bucket,
            AVG(lat)             AS lat,
            AVG(lng)             AS lng,
            MAX(speed)           AS max_speed,
            AVG(speed)           AS avg_speed,
            BOOL_OR(ignition)    AS ignition,
            MAX(ext_voltage_mv)  AS ext_voltage_mv,
            BOOL_OR(dout1)       AS dout1,
            BOOL_OR(dout2)       AS dout2,
            MAX((io_data->>'9')::float)  AS ain1_mv,
            MAX((io_data->>'10')::float) AS ain2_mv,
            COUNT(*)             AS record_count
        FROM telemetry_record
        WHERE device_id = :device_id AND time >= :since
        GROUP BY bucket
        ORDER BY bucket ASC
    """)

    result = await db.execute(sql, {"device_id": str(device.id), "since": since})
    rows = result.mappings().all()

    return {
        "device_id": str(device.id),
        "imei": device.imei,
        "from": since.isoformat(),
        "buckets": [dict(r) for r in rows],
    }


@router.get("/{vehicle_id}/export")
async def export_telemetry_csv(
    vehicle_id: uuid.UUID,
    start: datetime,
    end: Optional[datetime] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export telemetry data as CSV for a date range."""
    device_result = await db.execute(
        select(Device).where(Device.vehicle_id == vehicle_id, Device.active == True)
    )
    device = device_result.scalar_one_or_none()
    if not device:
        raise HTTPException(404, "No device assigned to this vehicle")

    end_dt = end if end is not None else datetime.now(timezone.utc)

    async def generate():
        yield "time,lat,lng,speed,ignition,ext_voltage_mv,dout1,dout2,ain1_mv,ain2_mv\n"
        offset = 0
        batch_size = 500
        while True:
            result = await db.execute(
                select(TelemetryRecord)
                .where(TelemetryRecord.device_id == device.id)
                .where(TelemetryRecord.time >= start)
                .where(TelemetryRecord.time <= end_dt)
                .order_by(TelemetryRecord.time.asc())
                .limit(batch_size).offset(offset)
            )
            rows = result.scalars().all()
            if not rows:
                break
            for r in rows:
                v_mv = f"{r.ext_voltage_mv}" if r.ext_voltage_mv is not None else ""
                ain1 = ""
                ain2 = ""
                if r.io_data:
                    raw1 = r.io_data.get("9")
                    raw2 = r.io_data.get("10")
                    if raw1 is not None:
                        ain1 = str(raw1)
                    if raw2 is not None:
                        ain2 = str(raw2)
                yield (
                    f"{r.time.isoformat()},"
                    f"{r.lat if r.lat is not None else ''},"
                    f"{r.lng if r.lng is not None else ''},"
                    f"{r.speed if r.speed is not None else ''},"
                    f"{1 if r.ignition else 0},"
                    f"{v_mv},"
                    f"{1 if r.dout1 else 0},"
                    f"{1 if r.dout2 else 0},"
                    f"{ain1},"
                    f"{ain2}\n"
                )
            if len(rows) < batch_size:
                break
            offset += batch_size

    filename = f"telemetry_{vehicle_id}.csv"
    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
