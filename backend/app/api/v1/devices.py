import uuid
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case
from sqlalchemy.exc import IntegrityError

from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.schemas.device import DeviceOut, DeviceCreate, DeviceUpdate, DeviceAssignVehicle, DeviceTransfer
from app.models.device import Device
from app.models.vehicle import Vehicle
from app.models.tenant import Tenant
from app.models.device_data_usage import DeviceDataUsage

logger = logging.getLogger(__name__)

router = APIRouter(tags=["devices"])


def _check_device_access(device: Device, user: CurrentUser) -> None:
    if user.tenant_tier == "cmg":
        return
    if device.tenant_id is None or str(device.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo no encontrado")


async def _fetch_usage_map(
    db: AsyncSession, device_ids: list[uuid.UUID]
) -> dict[uuid.UUID, tuple[int, int]]:
    """Retorna {device_id: (total_bytes, month_bytes)} para los IDs dados.

    Una sola query agregada sobre device_data_usage (sin N+1). El mes en curso
    se calcula en hora local de Madrid para casar con el corte de facturación.
    """
    if not device_ids:
        return {}
    current_month = func.to_char(
        func.timezone("Europe/Madrid", func.now()), "YYYY-MM"
    )
    q = (
        select(
            DeviceDataUsage.device_id,
            func.coalesce(func.sum(DeviceDataUsage.bytes), 0).label("total_bytes"),
            func.coalesce(
                func.sum(
                    case(
                        (DeviceDataUsage.year_month == current_month, DeviceDataUsage.bytes),
                        else_=0,
                    )
                ),
                0,
            ).label("month_bytes"),
        )
        .where(DeviceDataUsage.device_id.in_(device_ids))
        .group_by(DeviceDataUsage.device_id)
    )
    rows = await db.execute(q)
    return {
        row.device_id: (int(row.total_bytes), int(row.month_bytes))
        for row in rows.all()
    }


@router.get("", response_model=list[DeviceOut])
async def list_devices(
    request: Request,
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
    devices = result.scalars().all()

    # Consumo SIM estimado (total acumulado + mes en curso) por dispositivo.
    usage_map = await _fetch_usage_map(db, [d.id for d in devices])

    # device.online y device.last_seen en BD solo se actualizan en handshake/disconnect.
    # Redis vehicle:{id}:status sí refleja cada paquete de telemetría — superponemos
    # ese estado real cuando exista, manteniendo BD como fallback.
    out: list[DeviceOut] = []
    redis = getattr(request.app.state, "redis", None)
    redis_states: dict[str, dict] = {}
    if redis is not None:
        vehicle_ids = [str(d.vehicle_id) for d in devices if d.vehicle_id]
        if vehicle_ids:
            try:
                pipe = redis.pipeline()
                for vid in vehicle_ids:
                    pipe.hgetall(f"vehicle:{vid}:status")
                results = await pipe.execute()
                redis_states = dict(zip(vehicle_ids, results))
            except Exception as e:
                logger.warning("Redis no disponible en list_devices: %s", e)

    def _decode(val):
        if val is None:
            return None
        return val.decode() if isinstance(val, (bytes, bytearray)) else val

    for d in devices:
        item = DeviceOut.model_validate(d)
        total_b, month_b = usage_map.get(d.id, (0, 0))
        item.total_bytes = total_b
        item.month_bytes = month_b
        if d.vehicle_id:
            hash_data = redis_states.get(str(d.vehicle_id)) or {}
            online_raw = _decode(hash_data.get(b"online") if hash_data and isinstance(next(iter(hash_data), None), bytes) else hash_data.get("online"))
            last_seen_raw = _decode(hash_data.get(b"last_seen") if hash_data and isinstance(next(iter(hash_data), None), bytes) else hash_data.get("last_seen"))
            if online_raw is not None:
                item.online = online_raw.lower() in ("true", "1", "yes")
            if last_seen_raw:
                try:
                    item.last_seen = datetime.fromisoformat(last_seen_raw)
                except (ValueError, TypeError):
                    pass
        out.append(item)
    return out


@router.post("", response_model=DeviceOut, status_code=status.HTTP_201_CREATED)
async def create_device(
    body: DeviceCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Política: solo CMG admin o manufacturer admin puede registrar dispositivos.
    # CMG puede indicar un tenant destino (debe ser tier cmg o manufacturer).
    # Manufacturer siempre registra en su propio tenant.
    if user.tenant_tier not in ("cmg", "manufacturer") or user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo CMG o manufacturer admin puede registrar dispositivos")
    if user.tenant_tier == "cmg":
        if body.tenant_id is not None:
            target_tenant = await db.get(Tenant, body.tenant_id)
            if not target_tenant:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
            if target_tenant.tier not in ("cmg", "manufacturer"):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Solo se puede aprovisionar dispositivos a tenants CMG o fabricante",
                )
            effective_tenant_id = body.tenant_id
        else:
            effective_tenant_id = user.tenant_id
    else:
        effective_tenant_id = user.tenant_id
    device = Device(imei=body.imei, model=body.model, firmware_ver=body.firmware_ver, tenant_id=effective_tenant_id)
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


@router.delete("/{device_id}", status_code=204)
async def delete_device(
    device_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo CMG admin puede eliminar dispositivos")
    device = await db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo no encontrado")
    await db.delete(device)
    await db.commit()


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
    same_tenant = str(vehicle.tenant_id) == str(device.tenant_id)
    # El fabricante puede vincular un device suyo a un vehicle de su cliente
    mfr_cross = (
        vehicle.manufacturer_tenant_id is not None
        and str(vehicle.manufacturer_tenant_id) == str(device.tenant_id)
    )
    if not same_tenant and not mfr_cross:
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


@router.patch("/{device_id}/transfer", response_model=DeviceOut)
async def transfer_device(
    device_id: uuid.UUID,
    body: DeviceTransfer,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Solo CMG admin. Transfiere un device libre (sin vehículo) a otro tenant
    CMG o fabricante. Si el device está vinculado a un vehículo → 409."""
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo CMG admin puede transferir dispositivos")
    device = await db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo no encontrado")
    if device.vehicle_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Desvincula primero el dispositivo del vehículo o reasigna el vehículo",
        )
    target = await db.get(Tenant, body.target_tenant_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant destino no encontrado")
    if target.tier not in ("cmg", "manufacturer"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Solo se puede transferir dispositivos a tenants CMG o fabricante",
        )
    device.tenant_id = body.target_tenant_id
    await db.commit()
    await db.refresh(device)
    return device
