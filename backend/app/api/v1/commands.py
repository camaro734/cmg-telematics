import secrets
import uuid
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.core.config import settings
from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.api.v1.access_v2 import assert_can_access_vehicle
from app.schemas.auth import CurrentUser
from app.models.command_log import CommandLog
from app.models.vehicle import Vehicle
from app.models.device import Device

logger = logging.getLogger(__name__)

router = APIRouter(tags=["commands"])
internal_router = APIRouter(tags=["internal"])


async def _require_internal_key(
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
) -> None:
    """Valida clave compartida para endpoints /internal (solo acceso inter-servicio).
    Si INTERNAL_API_KEY no está configurada, bloquea en producción."""
    if not settings.internal_api_key:
        if settings.is_production:
            raise HTTPException(status_code=500, detail="INTERNAL_API_KEY no configurada")
        logger.warning("INTERNAL_API_KEY no configurada — /internal desprotegido (solo dev)")
        return
    if x_internal_key is None or not secrets.compare_digest(x_internal_key, settings.internal_api_key):
        raise HTTPException(status_code=403, detail="No autorizado")


class CommandLogOut(BaseModel):
    id: uuid.UUID
    device_id: uuid.UUID
    vehicle_id: uuid.UUID
    tenant_id: uuid.UUID
    command: str
    status: str
    sent_at: datetime
    response: str | None
    error_message: str | None

    model_config = {"from_attributes": True}


class CommandLogCreate(BaseModel):
    device_id: uuid.UUID
    vehicle_id: uuid.UUID
    tenant_id: uuid.UUID
    command: str
    status: str = "sent"
    response: str | None = None
    error_message: str | None = None


class CommandLogConfirm(BaseModel):
    response: str | None = None
    status: str = "confirmed"


@router.get("/vehicles/{vehicle_id}/commands", response_model=list[CommandLogOut])
async def list_vehicle_commands(
    vehicle_id: uuid.UUID,
    limit: int = Query(50, le=200),
    command_type: str | None = Query(None, description="Filtrar por comando_type: DOUT | MANUAL_CAN | RAW"),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Mismo control de acceso que el resto de endpoints operativos del vehículo
    # (status/track/maintenance/kpis): incluye el tier manufacturer cuando el tenant
    # cliente tiene manufacturer_can_view_operations=True. assert_can_access_vehicle
    # lanza 404 "Vehículo no encontrado" si no hay acceso (privacy by obscurity).
    vehicle = await assert_can_access_vehicle(
        user, vehicle_id, db, operation="read", scope="operational"
    )
    if not vehicle.active:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    where_clause = [CommandLog.vehicle_id == vehicle_id]
    if command_type:
        where_clause.append(CommandLog.command_type == command_type)

    result = await db.execute(
        select(CommandLog)
        .where(*where_clause)
        .order_by(CommandLog.sent_at.desc())
        .limit(limit)
    )
    return result.scalars().all()


@router.get("/devices/{device_id}/commands", response_model=list[CommandLogOut])
async def list_device_commands(
    device_id: uuid.UUID,
    limit: int = Query(50, le=200),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    device = await db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Dispositivo no encontrado")
    if user.tenant_tier != "cmg" and (device.tenant_id is None or str(device.tenant_id) != str(user.tenant_id)):
        raise HTTPException(status_code=404, detail="Dispositivo no encontrado")
    result = await db.execute(
        select(CommandLog)
        .where(CommandLog.device_id == device_id)
        .order_by(CommandLog.sent_at.desc())
        .limit(limit)
    )
    return result.scalars().all()


@internal_router.post("/commands/log", response_model=CommandLogOut, status_code=201)
async def log_command(
    body: CommandLogCreate,
    _: None = Depends(_require_internal_key),
    db: AsyncSession = Depends(get_db),
):
    log = CommandLog(
        device_id=body.device_id,
        vehicle_id=body.vehicle_id,
        tenant_id=body.tenant_id,
        command=body.command,
        status=body.status,
        response=body.response,
        error_message=body.error_message,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return log


@internal_router.patch("/commands/{log_id}/confirm", response_model=CommandLogOut)
async def confirm_command(
    log_id: uuid.UUID,
    body: CommandLogConfirm,
    _: None = Depends(_require_internal_key),
    db: AsyncSession = Depends(get_db),
):
    log = await db.get(CommandLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log no encontrado")
    log.status = body.status
    if body.response is not None:
        log.response = body.response
    await db.commit()
    await db.refresh(log)
    return log
