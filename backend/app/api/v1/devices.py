import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.schemas.device import DeviceOut, DeviceCreate, DeviceUpdate, DeviceAssignVehicle
from app.models.device import Device
from app.models.vehicle import Vehicle
from app.models.tenant import Tenant

router = APIRouter(tags=["devices"])


def _check_device_access(device: Device, user: CurrentUser) -> None:
    if user.tenant_tier == "cmg":
        return
    if device.tenant_id is None or str(device.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo no encontrado")


@router.get("", response_model=list[DeviceOut])
async def list_devices(
    tenant_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Device)
    if user.tenant_tier != "cmg":
        query = query.where(Device.tenant_id == user.tenant_id)
    elif tenant_id is not None:
        query = query.where(Device.tenant_id == tenant_id)
    result = await db.execute(query.order_by(Device.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=DeviceOut, status_code=status.HTTP_201_CREATED)
async def create_device(
    body: DeviceCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo CMG admin puede registrar dispositivos")
    tenant = await db.get(Tenant, body.tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    device = Device(imei=body.imei, model=body.model, firmware_ver=body.firmware_ver, tenant_id=body.tenant_id)
    db.add(device)
    try:
        await db.commit()
        await db.refresh(device)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="IMEI ya registrado")
    return device


@router.get("/{device_id}", response_model=DeviceOut)
async def get_device(
    device_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    device = await db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo no encontrado")
    _check_device_access(device, user)
    return device


@router.patch("/{device_id}", response_model=DeviceOut)
async def update_device(
    device_id: uuid.UUID,
    body: DeviceUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo CMG admin puede modificar dispositivos")
    device = await db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo no encontrado")
    if body.tenant_id is not None and body.tenant_id != device.tenant_id:
        if not await db.get(Tenant, body.tenant_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(device, field, value)
    await db.commit()
    await db.refresh(device)
    return device


@router.patch("/{device_id}/vehicle", response_model=DeviceOut)
async def assign_vehicle(
    device_id: uuid.UUID,
    body: DeviceAssignVehicle,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    device = await db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo no encontrado")
    _check_device_access(device, user)
    if body.vehicle_id is None:
        device.vehicle_id = None
        await db.commit()
        await db.refresh(device)
        return device
    vehicle = await db.get(Vehicle, body.vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    if str(vehicle.tenant_id) != str(device.tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="El vehículo no pertenece al tenant del dispositivo")
    existing = await db.execute(
        select(Device).where(Device.vehicle_id == body.vehicle_id, Device.id != device_id, Device.active == True)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El vehículo ya tiene un dispositivo activo asignado")
    device.vehicle_id = body.vehicle_id
    await db.commit()
    await db.refresh(device)
    return device
