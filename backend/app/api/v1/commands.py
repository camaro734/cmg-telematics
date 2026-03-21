from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timezone
import uuid
from typing import Optional

from app.core.database import get_db
from app.models.device import Device
from app.models.command_log import CommandLog
from app.models.user import User
from app.models.vehicle import Vehicle
from app.api.v1.auth import get_current_user
from app.services.teltonika.tcp_server import teltonika_server, DeviceOfflineError

router = APIRouter(prefix="/commands", tags=["commands"])

# DOUT command mappings
DOUT_COMMANDS = {
    "DOUT1": ("1", 0),  # (mask, index)
    "DOUT2": ("2", 1),
    "DOUT3": ("4", 2),
    "DOUT4": ("8", 3),
}


class SendCommandRequest(BaseModel):
    imei: str
    output: str   # "DOUT1" | "DOUT2" | "DOUT3" | "DOUT4"
    value: bool
    duration_seconds: int = 0  # 0 = permanent


class CommandResponse(BaseModel):
    command_id: str
    status: str
    command: str


@router.post("/send", response_model=CommandResponse)
async def send_command(
    request: SendCommandRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if request.output not in DOUT_COMMANDS:
        raise HTTPException(400, f"Invalid output: {request.output}. Must be DOUT1-DOUT4")

    # Find device
    device_result = await db.execute(
        select(Device).where(Device.imei == request.imei, Device.active == True)
    )
    device = device_result.scalar_one_or_none()
    if not device:
        raise HTTPException(404, f"Device with IMEI {request.imei} not found")

    mask, _ = DOUT_COMMANDS[request.output]
    value_str = "1" if request.value else "0"
    command = f"setdigout {mask} {value_str} {request.duration_seconds}"

    # Log the command
    log = CommandLog(
        device_id=device.id,
        issued_by=current_user.id,
        command=command,
        status="pending",
    )
    db.add(log)
    await db.flush()

    # Send via TCP
    try:
        await teltonika_server.send_command(request.imei, command)
        log.status = "sent"
        log.sent_at = datetime.now(timezone.utc)
    except DeviceOfflineError:
        log.status = "failed"
        log.error_message = "Device is offline"
        await db.commit()
        raise HTTPException(409, f"Device {request.imei} is not connected")
    except Exception as e:
        log.status = "failed"
        log.error_message = str(e)
        await db.commit()
        raise HTTPException(500, f"Failed to send command: {e}")

    await db.commit()
    return CommandResponse(
        command_id=str(log.id),
        status=log.status,
        command=command,
    )


@router.get("/history")
async def get_command_history(
    vehicle_id: Optional[uuid.UUID] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the last N commands for a vehicle, with issuer email."""
    query = (
        select(CommandLog, User.email, User.full_name)
        .outerjoin(User, CommandLog.issued_by == User.id)
        .order_by(CommandLog.created_at.desc())
        .limit(limit)
    )

    if vehicle_id is not None:
        # Join through device to filter by vehicle
        query = (
            select(CommandLog, User.email, User.full_name)
            .join(Device, CommandLog.device_id == Device.id)
            .outerjoin(User, CommandLog.issued_by == User.id)
            .where(Device.vehicle_id == vehicle_id)
            .order_by(CommandLog.created_at.desc())
            .limit(limit)
        )

    result = await db.execute(query)
    rows = result.all()

    return [
        {
            "id": str(row.CommandLog.id),
            "command": row.CommandLog.command,
            "status": row.CommandLog.status,
            "created_at": row.CommandLog.created_at.isoformat(),
            "sent_at": row.CommandLog.sent_at.isoformat() if row.CommandLog.sent_at else None,
            "confirmed_at": row.CommandLog.confirmed_at.isoformat() if row.CommandLog.confirmed_at else None,
            "error_message": row.CommandLog.error_message,
            "issued_by_email": row.email,
            "issued_by_name": row.full_name,
        }
        for row in rows
    ]


@router.get("/{command_id}/status")
async def get_command_status(
    command_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(CommandLog).where(CommandLog.id == command_id)
    )
    log = result.scalar_one_or_none()
    if not log:
        raise HTTPException(404, "Command not found")

    return {
        "id": str(log.id),
        "command": log.command,
        "status": log.status,
        "created_at": log.created_at.isoformat(),
        "sent_at": log.sent_at.isoformat() if log.sent_at else None,
        "confirmed_at": log.confirmed_at.isoformat() if log.confirmed_at else None,
        "error_message": log.error_message,
    }
