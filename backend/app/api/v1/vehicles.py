# backend/app/api/v1/vehicles.py
import uuid
import json
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.schemas.vehicle import (
    VehicleTypeOut, VehicleOut, VehicleStatus,
    TelemetryPoint, TrackPoint, KpiHour,
)
from app.models.vehicle import Vehicle
from app.models.vehicle_type import VehicleType
from app.models.device import Device

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


@router.get("/vehicles", response_model=list[VehicleOut])
async def list_vehicles(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Vehicle).where(Vehicle.active == True)
    if user.tenant_tier != "cmg":
        query = query.where(Vehicle.tenant_id == user.tenant_id)
    result = await db.execute(query.order_by(Vehicle.name))
    return result.scalars().all()


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
    hash_data = await redis.hgetall(redis_key)

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
            return None

    def _parse_json(val: str | None) -> dict | None:
        if val is None:
            return None
        try:
            return json.loads(val)
        except (ValueError, TypeError):
            return None

    online_raw = hash_data.get(b"online") or hash_data.get("online")
    online_str = online_raw.decode() if isinstance(online_raw, bytes) else online_raw

    last_seen_raw = hash_data.get(b"last_seen") or hash_data.get("last_seen")
    last_seen_str = last_seen_raw.decode() if isinstance(last_seen_raw, bytes) else last_seen_raw

    lat_raw = hash_data.get(b"lat") or hash_data.get("lat")
    lat_str = lat_raw.decode() if isinstance(lat_raw, bytes) else lat_raw

    lon_raw = hash_data.get(b"lon") or hash_data.get("lon")
    lon_str = lon_raw.decode() if isinstance(lon_raw, bytes) else lon_raw

    speed_raw = hash_data.get(b"speed_kmh") or hash_data.get("speed_kmh")
    speed_str = speed_raw.decode() if isinstance(speed_raw, bytes) else speed_raw

    ignition_raw = hash_data.get(b"ignition") or hash_data.get("ignition")
    ignition_str = ignition_raw.decode() if isinstance(ignition_raw, bytes) else ignition_raw

    pto_raw = hash_data.get(b"pto_active") or hash_data.get("pto_active")
    pto_str = pto_raw.decode() if isinstance(pto_raw, bytes) else pto_raw

    can_raw = hash_data.get(b"can_data") or hash_data.get("can_data")
    can_str = can_raw.decode() if isinstance(can_raw, bytes) else can_raw

    return VehicleStatus(
        vehicle_id=vehicle_id,
        online=_parse_bool(online_str) or False,
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
