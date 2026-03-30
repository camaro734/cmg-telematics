from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid

from app.core.database import get_db
from app.models.tenant import Tenant
from app.models.vehicle import Vehicle
from app.models.device import Device
from app.models.telemetry import TelemetryRecord
from app.models.variable_map import VariableMap
from app.models.user import User
from app.api.v1.auth import get_current_user

router = APIRouter(prefix="/vehicles", tags=["telemetry"])

def _is_online(last_seen) -> bool:
    if last_seen is None:
        return False
    ts = last_seen if last_seen.tzinfo else last_seen.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - ts) < timedelta(minutes=10)


async def _get_subtree(db: AsyncSession, root_id: uuid.UUID) -> set[uuid.UUID]:
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


async def _get_device_for_vehicle(
    vehicle_id: uuid.UUID,
    db: AsyncSession,
    current_user: User,
) -> Device:
    """Validate vehicle is in user's subtree and return its active device."""
    result = await db.execute(
        select(Vehicle).where(Vehicle.id == vehicle_id, Vehicle.active == True)
    )
    vehicle = result.scalar_one_or_none()
    if not vehicle:
        raise HTTPException(404, "Vehicle not found")

    allowed = await _get_subtree(db, current_user.tenant_id)
    if vehicle.tenant_id not in allowed:
        raise HTTPException(404, "Vehicle not found")

    dev_result = await db.execute(
        select(Device).where(Device.vehicle_id == vehicle_id, Device.active == True)
    )
    device = dev_result.scalar_one_or_none()
    if not device:
        raise HTTPException(404, "No device assigned to this vehicle")
    return device


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

    # Tenant access check
    allowed = await _get_subtree(db, current_user.tenant_id)
    if vehicle_obj.tenant_id not in allowed:
        raise HTTPException(404, "Vehicle not found")

    result = await db.execute(
        select(TelemetryRecord)
        .where(TelemetryRecord.device_id == device.id)
        .order_by(TelemetryRecord.time.desc())
        .limit(1)
    )
    record = result.scalar_one_or_none()
    if not record:
        return {"device_id": str(device.id), "imei": device.imei, "vehicle_name": vehicle_obj.name, "online": _is_online(device.last_seen), "data": None}

    return {
        "device_id": str(device.id),
        "imei": device.imei,
        "vehicle_name": vehicle_obj.name,
        "license_plate": vehicle_obj.license_plate,
        "online": _is_online(device.last_seen),
        "last_seen": device.last_seen.isoformat() if device.last_seen else None,
        "data": {
            "time": record.time.isoformat(),
            "lat": record.lat,
            "lng": record.lng,
            "speed": record.speed if _is_online(device.last_seen) else None,
            "altitude": record.altitude,
            "satellites": record.satellites,
            "ignition": record.ignition if _is_online(device.last_seen) else None,
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
    device = await _get_device_for_vehicle(vehicle_id, db, current_user)

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
    device = await _get_device_for_vehicle(vehicle_id, db, current_user)

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


async def _get_allowed_vehicles(db: AsyncSession, current_user: User) -> set[uuid.UUID]:
    """Return the set of vehicle IDs the current user may access."""
    allowed_tenants = await _get_subtree(db, current_user.tenant_id)
    result = await db.execute(
        select(Vehicle).where(Vehicle.tenant_id.in_(allowed_tenants), Vehicle.active == True)
    )
    return {v.id for v in result.scalars().all()}


# ─── Named telemetry columns ──────────────────────────────────────────────────

_NAMED_COLUMNS: dict[str, tuple[str, str]] = {
    "ignition":       ("Ignición (motor encendido)", "boolean"),
    "din1":           ("Entrada digital 1 (DIN1)",   "boolean"),
    "din2":           ("Entrada digital 2 (DIN2)",   "boolean"),
    "din3":           ("Entrada digital 3 (DIN3)",   "boolean"),
    "din4":           ("Entrada digital 4 (DIN4)",   "boolean"),
    "dout1":          ("Salida digital 1 (DOUT1)",   "boolean"),
    "dout2":          ("Salida digital 2 (DOUT2)",   "boolean"),
    "dout3":          ("Salida digital 3 (DOUT3)",   "boolean"),
    "dout4":          ("Salida digital 4 (DOUT4)",   "boolean"),
    "ain1_mv":        ("Analógica 1 (mV)",            "gauge"),
    "ain2_mv":        ("Analógica 2 (mV)",            "gauge"),
    "ain3_mv":        ("Analógica 3 (mV)",            "gauge"),
    "ext_voltage_mv": ("Voltaje exterior (mV)",       "gauge"),
    "battery_mv":     ("Batería interna (mV)",        "gauge"),
    "speed":          ("Velocidad (km/h)",             "gauge"),
    "gsm_signal":     ("Señal GSM",                   "gauge"),
}


class LiveSignal(BaseModel):
    io_key: str
    display_name: str
    raw_value: Optional[float]
    converted_value: Optional[float]
    unit: str
    scale_factor: float
    offset: float
    data_type: str          # "boolean" | "gauge" | "counter" | "hours"
    is_configured: bool     # True if a VariableMap entry exists
    source: str             # "named_column" | "io_data"


class LiveSignalsResponse(BaseModel):
    vehicle_id: uuid.UUID
    device_id: Optional[uuid.UUID]
    imei: Optional[str]
    as_of: Optional[datetime]
    signals: list[LiveSignal]


@router.get("/{vehicle_id}/live-signals", response_model=LiveSignalsResponse)
async def get_live_signals(
    vehicle_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns all IO signals the device is currently sending for this vehicle,
    merged with configured VariableMap definitions.
    Signals with VariableMap entries come first (is_configured=True).
    """
    # Access check
    allowed = await _get_allowed_vehicles(db, current_user)
    if vehicle_id not in allowed:
        raise HTTPException(403, "Access denied to this vehicle")

    # Get device for the vehicle
    dev_result = await db.execute(
        select(Device).where(Device.vehicle_id == vehicle_id)
    )
    device = dev_result.scalar_one_or_none()

    if device is None:
        return LiveSignalsResponse(
            vehicle_id=vehicle_id, device_id=None, imei=None,
            as_of=None, signals=[],
        )

    # Get the latest telemetry record
    rec_result = await db.execute(
        select(TelemetryRecord)
        .where(TelemetryRecord.device_id == device.id)
        .order_by(TelemetryRecord.time.desc())
        .limit(1)
    )
    record = rec_result.scalar_one_or_none()

    if record is None:
        return LiveSignalsResponse(
            vehicle_id=vehicle_id, device_id=device.id, imei=device.imei,
            as_of=None, signals=[],
        )

    # Load resolved VariableMap for this vehicle
    # (manufacturer template merged with vehicle-specific overrides)
    vehicle_result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    vehicle = vehicle_result.scalar_one_or_none()

    vm_map: dict[str, VariableMap] = {}
    if vehicle:
        # Manufacturer template
        if vehicle.manufacturer_id:
            tmpl_result = await db.execute(
                select(VariableMap).where(
                    VariableMap.tenant_id == vehicle.manufacturer_id,
                    VariableMap.vehicle_id.is_(None),
                )
            )
            for vm in tmpl_result.scalars().all():
                vm_map[vm.io_key] = vm

        # Vehicle-specific overrides (take precedence)
        veh_result = await db.execute(
            select(VariableMap).where(VariableMap.vehicle_id == vehicle_id)
        )
        for vm in veh_result.scalars().all():
            vm_map[vm.io_key] = vm

    def _make_signal(
        io_key: str,
        default_name: str,
        default_dtype: str,
        raw: Optional[float],
        source: str,
    ) -> LiveSignal:
        # Try to find variable map — also try "io_{key}" prefix convention
        vm = vm_map.get(io_key) or vm_map.get(f"io_{io_key}")
        scale = vm.scale_factor if vm else 1.0
        offs = vm.offset if vm else 0.0
        converted = round(raw * scale + offs, 4) if raw is not None else None
        return LiveSignal(
            io_key=io_key,
            display_name=vm.display_name if vm else default_name,
            raw_value=raw,
            converted_value=converted,
            unit=vm.unit or "" if vm else "",
            scale_factor=scale,
            offset=offs,
            data_type=vm.data_type if vm else default_dtype,
            is_configured=vm is not None,
            source=source,
        )

    signals: list[LiveSignal] = []

    # 1. Named columns
    for col, (default_name, default_dtype) in _NAMED_COLUMNS.items():
        raw_val = getattr(record, col, None)
        if raw_val is None:
            continue
        try:
            raw_f = float(raw_val)
        except (TypeError, ValueError):
            raw_f = 1.0 if raw_val else 0.0
        signals.append(_make_signal(col, default_name, default_dtype, raw_f, "named_column"))

    # 2. io_data JSONB keys (CAN / J1939 / extra IOs)
    named_io_ids = {
        str(io_id) for io_id in [1, 2, 3, 4, 9, 10, 11, 21, 24, 66, 67, 179, 180, 181, 182]
    }
    io_data = record.io_data or {}
    for key_str, val in io_data.items():
        if key_str in named_io_ids:
            continue  # already covered by named columns
        if val is None:
            continue
        try:
            raw_f = float(val)
        except (TypeError, ValueError):
            continue
        default_name = f"IO {key_str}"
        default_dtype = "boolean" if raw_f in (0.0, 1.0) else "gauge"
        signals.append(_make_signal(key_str, default_name, default_dtype, raw_f, "io_data"))

    # Sort: configured first, then by source (named before io_data), then by key
    def _sort_key(s: LiveSignal):
        is_numeric = s.io_key.lstrip("-").isdigit()
        return (
            0 if s.is_configured else 1,
            0 if s.source == "named_column" else 1,
            int(s.io_key) if is_numeric else 0,
            s.io_key,
        )

    signals.sort(key=_sort_key)

    return LiveSignalsResponse(
        vehicle_id=vehicle_id,
        device_id=device.id,
        imei=device.imei,
        as_of=record.time,
        signals=signals,
    )
