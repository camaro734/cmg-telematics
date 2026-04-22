# backend/app/api/v1/vehicles.py
import uuid
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.schemas.vehicle import (
    VehicleTypeOut, VehicleOut, VehicleCreate, VehicleUpdate, VehicleStatus,
    TelemetryPoint, TrackPoint, KpiHour, VehicleTypeSensorSchemaUpdate,
    VehicleTypeCreate, VehicleTypeUpdate,
)
from app.models.vehicle import Vehicle
from app.models.vehicle_type import VehicleType
from app.models.maintenance import MaintenancePlan
from app.schemas.maintenance import MaintenancePlanOut

logger = logging.getLogger(__name__)

router = APIRouter(tags=["vehicles"])


def _check_vehicle_access(vehicle: Vehicle, user: CurrentUser) -> None:
    if user.tenant_tier == "cmg":
        return
    if str(vehicle.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")


@router.get("/vehicle-types", response_model=list[VehicleTypeOut])
async def list_vehicle_types(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(VehicleType).order_by(VehicleType.name))
    return result.scalars().all()


@router.patch("/vehicle-types/{type_id}/sensor-schema", response_model=VehicleTypeOut)
async def update_vehicle_type_sensor_schema(
    type_id: uuid.UUID,
    body: VehicleTypeSensorSchemaUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo CMG admin puede modificar tipos de vehículo",
        )
    vtype = await db.get(VehicleType, type_id)
    if not vtype:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tipo de vehículo no encontrado",
        )
    from sqlalchemy.orm.attributes import flag_modified
    vtype.sensor_schema = body.sensor_schema
    flag_modified(vtype, "sensor_schema")
    await db.commit()
    await db.refresh(vtype)
    return vtype


@router.post("/vehicle-types", response_model=VehicleTypeOut, status_code=201)
async def create_vehicle_type(
    body: VehicleTypeCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=403, detail="Solo CMG admin puede crear tipos de vehículo")
    dup = await db.execute(select(VehicleType).where(VehicleType.slug == body.slug))
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Ya existe un tipo con ese slug")
    vtype = VehicleType(name=body.name, slug=body.slug, sensor_schema=[])
    db.add(vtype)
    await db.commit()
    await db.refresh(vtype)
    return vtype


@router.patch("/vehicle-types/{type_id}", response_model=VehicleTypeOut)
async def update_vehicle_type(
    type_id: uuid.UUID,
    body: VehicleTypeUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(status_code=403, detail="Solo CMG admin puede modificar tipos de vehículo")
    vtype = await db.get(VehicleType, type_id)
    if not vtype:
        raise HTTPException(status_code=404, detail="Tipo de vehículo no encontrado")
    if body.name is not None:
        vtype.name = body.name
    if body.slug is not None:
        dup = await db.execute(
            select(VehicleType).where(VehicleType.slug == body.slug, VehicleType.id != type_id)
        )
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Ya existe un tipo con ese slug")
        vtype.slug = body.slug
    await db.commit()
    await db.refresh(vtype)
    return vtype


@router.post("/vehicle-types/{type_id}/icon", response_model=VehicleTypeOut)
async def upload_vehicle_type_icon(
    type_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    if current_user.tenant_tier != "cmg" or current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo CMG admin")
    if not (file.content_type or "").startswith("image/png"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Solo se aceptan archivos PNG")
    content = await file.read()
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Archivo demasiado grande (máx 2 MB)")

    result = await db.execute(select(VehicleType).where(VehicleType.id == type_id))
    vehicle_type = result.scalar_one_or_none()
    if not vehicle_type:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tipo de vehículo no encontrado")

    uploads_dir = Path("/app/uploads/icons")
    uploads_dir.mkdir(parents=True, exist_ok=True)
    try:
        (uploads_dir / f"{type_id}.png").write_bytes(content)
    except OSError as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error al guardar el archivo: {e}")

    vehicle_type.icon_url = f"/uploads/icons/{type_id}.png"
    await db.commit()
    await db.refresh(vehicle_type)
    return vehicle_type


@router.get("/vehicles", response_model=list[VehicleOut])
async def list_vehicles(
    tenant_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Vehicle).where(Vehicle.active == True)
    if user.tenant_tier != "cmg":
        query = query.where(Vehicle.tenant_id == user.tenant_id)
    elif tenant_id is not None:
        query = query.where(Vehicle.tenant_id == tenant_id)
    result = await db.execute(query.order_by(Vehicle.name))
    return result.scalars().all()


@router.post("/vehicles", response_model=VehicleOut, status_code=201)
async def create_vehicle(
    body: VehicleCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    effective_tenant_id = (
        body.tenant_id
        if (body.tenant_id is not None and user.tenant_tier == "cmg")
        else uuid.UUID(str(user.tenant_id))
    )
    vtype = await db.get(VehicleType, body.vehicle_type_id)
    if not vtype:
        raise HTTPException(status_code=404, detail="Tipo de vehículo no encontrado")
    vehicle = Vehicle(
        tenant_id=effective_tenant_id,
        vehicle_type_id=body.vehicle_type_id,
        name=body.name,
        license_plate=body.license_plate,
        vin=body.vin,
        year=body.year,
    )
    db.add(vehicle)
    await db.commit()
    await db.refresh(vehicle)
    return vehicle


@router.patch("/vehicles/{vehicle_id}", response_model=VehicleOut)
async def update_vehicle(
    vehicle_id: uuid.UUID,
    body: VehicleUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)
    if body.vehicle_type_id is not None:
        vtype = await db.get(VehicleType, body.vehicle_type_id)
        if not vtype:
            raise HTTPException(status_code=404, detail="Tipo de vehículo no encontrado")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(vehicle, field, value)
    await db.commit()
    await db.refresh(vehicle)
    return vehicle


@router.get("/vehicles/{vehicle_id}", response_model=VehicleOut)
async def get_vehicle(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)
    return vehicle


@router.get("/vehicles/{vehicle_id}/status", response_model=VehicleStatus)
async def get_vehicle_status(
    vehicle_id: uuid.UUID,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)

    redis = request.app.state.redis
    redis_key = f"vehicle:{vehicle_id}:status"
    try:
        hash_data = await redis.hgetall(redis_key)
    except Exception:
        logger.warning("Redis unavailable for vehicle status %s, returning offline", vehicle_id)
        return VehicleStatus(vehicle_id=vehicle_id, online=False)

    if not hash_data:
        return VehicleStatus(vehicle_id=vehicle_id, online=False)

    def _parse_bool(val: str | None) -> bool | None:
        if val is None:
            return None
        return val.lower() in ("true", "1", "yes")

    def _parse_float(val: str | None) -> float | None:
        if val is None:
            return None
        try:
            return float(val)
        except (ValueError, TypeError):
            return None

    def _parse_datetime(val: str | None) -> datetime | None:
        if val is None:
            return None
        try:
            return datetime.fromisoformat(val)
        except (ValueError, TypeError):
            logger.warning("Failed to parse datetime from Redis: %r", val)
            return None

    def _parse_json(val: str | None) -> dict | None:
        if val is None:
            return None
        try:
            return json.loads(val)
        except (ValueError, TypeError):
            return None

    def _get(key: str) -> str | None:
        raw = hash_data.get(key.encode()) if hash_data and isinstance(next(iter(hash_data), None), bytes) else hash_data.get(key)
        if raw is None:
            return None
        return raw.decode() if isinstance(raw, bytes) else raw

    online_str = _get("online")
    last_seen_str = _get("last_seen")
    lat_str = _get("lat")
    lon_str = _get("lon")
    speed_str = _get("speed_kmh")
    ignition_str = _get("ignition")
    pto_str = _get("pto_active")
    can_str = _get("can_data")

    return VehicleStatus(
        vehicle_id=vehicle_id,
        online=bool(_parse_bool(online_str)),
        last_seen=_parse_datetime(last_seen_str),
        lat=_parse_float(lat_str),
        lon=_parse_float(lon_str),
        speed_kmh=_parse_float(speed_str),
        ignition=_parse_bool(ignition_str),
        pto_active=_parse_bool(pto_str),
        can_data=_parse_json(can_str),
    )


@router.get("/vehicles/{vehicle_id}/telemetry/latest", response_model=TelemetryPoint)
async def get_vehicle_telemetry_latest(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)

    since = datetime.now(timezone.utc) - timedelta(days=7)
    row = (
        await db.execute(
            text(
                "SELECT time, lat, lon, speed_kmh, heading, altitude_m, "
                "ignition, pto_active, ext_voltage_mv, can_data "
                "FROM telemetry_record "
                "WHERE vehicle_id = :vid AND tenant_id = :tid AND time >= :since "
                "ORDER BY time DESC LIMIT 1"
            ),
            {"vid": vehicle_id, "tid": vehicle.tenant_id, "since": since},
        )
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No hay telemetría reciente")

    return TelemetryPoint(**dict(row._mapping))


@router.get("/vehicles/{vehicle_id}/telemetry/history", response_model=list[TelemetryPoint])
async def get_vehicle_telemetry_history(
    vehicle_id: uuid.UUID,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = 500,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if limit > 5000:
        limit = 5000
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)

    if start is None:
        start = datetime.now(timezone.utc) - timedelta(days=1)
    if end is None:
        end = datetime.now(timezone.utc)
    if start > end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start must be <= end")

    rows = (
        await db.execute(
            text(
                "SELECT time, lat, lon, speed_kmh, heading, altitude_m, "
                "ignition, pto_active, ext_voltage_mv, can_data "
                "FROM telemetry_record "
                "WHERE vehicle_id = :vid AND tenant_id = :tid "
                "AND time >= :start AND time <= :end "
                "ORDER BY time DESC LIMIT :lim"
            ),
            {
                "vid": vehicle_id,
                "tid": vehicle.tenant_id,
                "start": start,
                "end": end,
                "lim": limit,
            },
        )
    ).fetchall()

    return [TelemetryPoint(**dict(r._mapping)) for r in rows]


@router.get("/vehicles/{vehicle_id}/track/today", response_model=list[TrackPoint])
async def get_vehicle_track_today(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)

    rows = (
        await db.execute(
            text(
                "SELECT time, lat, lon FROM telemetry_record "
                "WHERE vehicle_id = :vid AND tenant_id = :tid "
                "AND time >= current_date::timestamptz "
                "AND lat IS NOT NULL AND lon IS NOT NULL "
                "ORDER BY time ASC LIMIT 2000"
            ),
            {"vid": vehicle_id, "tid": vehicle.tenant_id},
        )
    ).fetchall()

    return [TrackPoint(**dict(r._mapping)) for r in rows]


@router.get("/vehicles/{vehicle_id}/kpis", response_model=list[KpiHour])
async def get_vehicle_kpis(
    vehicle_id: uuid.UUID,
    start: datetime | None = None,
    end: datetime | None = None,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)

    if start is None:
        start = datetime.now(timezone.utc) - timedelta(hours=24)
    if end is None:
        end = datetime.now(timezone.utc)
    if start > end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start must be <= end")

    rows = (
        await db.execute(
            text(
                "SELECT bucket, avg_pressure_1, max_pressure_1, avg_oil_temp, "
                "max_oil_temp, pto_active_minutes, engine_on_minutes, record_count "
                "FROM telemetry_1h "
                "WHERE vehicle_id = :vid AND tenant_id = :tid "
                "AND bucket >= :start AND bucket <= :end "
                "ORDER BY bucket DESC"
            ),
            {"vid": vehicle_id, "tid": vehicle.tenant_id, "start": start, "end": end},
        )
    ).fetchall()

    return [KpiHour(**dict(r._mapping)) for r in rows]


@router.get("/vehicles/{vehicle_id}/maintenance", response_model=list[MaintenancePlanOut])
async def list_vehicle_maintenance(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)

    result = await db.execute(
        select(MaintenancePlan)
        .where(MaintenancePlan.vehicle_id == vehicle_id)
        .order_by(MaintenancePlan.name)
    )
    plans = result.scalars().all()

    # Import here to avoid circular import at module level
    from app.api.v1.maintenance import _to_out as _maintenance_to_out
    return [await _maintenance_to_out(p, vehicle.name, db) for p in plans]
