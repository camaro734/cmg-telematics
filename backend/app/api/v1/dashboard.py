from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
import uuid

from app.core.database import get_db
from app.models.vehicle import Vehicle
from app.models.device import Device
from app.models.telemetry import TelemetryRecord
from app.models.tenant import Tenant
from app.models.user import User
from app.api.v1.auth import get_current_user

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


# ─── helpers ─────────────────────────────────────────────────────────────────

async def _get_subtree(db: AsyncSession, root_id: uuid.UUID) -> set[uuid.UUID]:
    """Return root_id plus all descendant tenant IDs."""
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


# ─── fleet status ─────────────────────────────────────────────────────────────

@router.get("/fleet")
async def fleet_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Overview of all vehicles with last known status."""
    result = await db.execute(
        select(Vehicle, Device)
        .outerjoin(Device, Device.vehicle_id == Vehicle.id)
        .where(Vehicle.active == True)
    )
    rows = result.all()

    fleet = []
    for vehicle, device in rows:
        entry = {
            "vehicle_id": str(vehicle.id),
            "vehicle_name": vehicle.name,
            "license_plate": vehicle.license_plate,
        }
        if device:
            entry["device"] = {
                "imei": device.imei,
                "online": device.online,
                "last_seen": device.last_seen.isoformat() if device.last_seen else None,
            }

            # Get last telemetry record
            tr_result = await db.execute(
                select(TelemetryRecord)
                .where(TelemetryRecord.device_id == device.id)
                .order_by(TelemetryRecord.time.desc())
                .limit(1)
            )
            record = tr_result.scalar_one_or_none()
            if record:
                entry["last_position"] = {
                    "time": record.time.isoformat(),
                    "lat": record.lat,
                    "lng": record.lng,
                    "speed": record.speed,
                    "ignition": record.ignition,
                    "ext_voltage_mv": record.ext_voltage_mv,
                    "dout1": record.dout1,
                    "dout2": record.dout2,
                    "io_data": record.io_data,
                }
        fleet.append(entry)

    return {"fleet": fleet, "total": len(fleet)}


# ─── analytics ───────────────────────────────────────────────────────────────

class FleetAnalytics(BaseModel):
    period_hours: int
    total_distance_km: float
    total_ignition_hours: float
    avg_speed_kmh: float
    max_speed_kmh: int
    total_records: int
    vehicles_active: int
    vehicles_total: int
    pressure_avg_bar: Optional[float]
    pressure_max_bar: Optional[float]


class VehicleStats(BaseModel):
    vehicle_id: str
    vehicle_name: str
    records: int
    ignition_hours: float
    distance_km: float
    max_speed: int
    avg_pressure_bar: Optional[float]
    online: bool


@router.get("/analytics", response_model=FleetAnalytics)
async def fleet_analytics(
    hours: int = Query(default=24, ge=1, le=8760),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fleet-wide KPIs for the current user's tenant subtree."""
    tenant_ids = await _get_subtree(db, current_user.tenant_id)
    tenant_id_list = list(tenant_ids)

    # Total vehicles in tenant
    veh_result = await db.execute(
        select(Vehicle).where(
            Vehicle.tenant_id.in_(tenant_id_list),
            Vehicle.active == True,
        )
    )
    vehicles_total = len(veh_result.scalars().all())

    # Aggregate telemetry stats
    tenant_id_strs = [str(t) for t in tenant_ids]
    sql = text("""
        SELECT
            COUNT(*)                                                        AS total_records,
            COUNT(DISTINCT tr.device_id)                                    AS vehicles_active,
            COALESCE(SUM(tr.speed) / 120.0, 0)                             AS total_distance_km,
            COALESCE(COUNT(*) FILTER (WHERE tr.ignition = TRUE) * 30.0 / 3600.0, 0)
                                                                            AS total_ignition_hours,
            COALESCE(AVG(tr.speed) FILTER (WHERE tr.speed > 5), 0)         AS avg_speed_kmh,
            COALESCE(MAX(tr.speed), 0)                                      AS max_speed_kmh,
            CASE WHEN AVG((tr.io_data->>'9')::float) > 0
                 THEN AVG((tr.io_data->>'9')::float) * 0.006
                 ELSE NULL END                                              AS pressure_avg_bar,
            CASE WHEN MAX((tr.io_data->>'9')::float) > 0
                 THEN MAX((tr.io_data->>'9')::float) * 0.006
                 ELSE NULL END                                              AS pressure_max_bar
        FROM telemetry_record tr
        JOIN device d ON d.id = tr.device_id
        JOIN vehicle v ON v.id = d.vehicle_id
        WHERE v.tenant_id::text = ANY(:tenant_ids)
          AND v.active = TRUE
          AND tr.time >= NOW() - :hours * INTERVAL '1 hour'
    """)

    result = await db.execute(sql, {"tenant_ids": tenant_id_strs, "hours": hours})
    row = result.one_or_none()
    if row is None:
        row = type("Row", (), {
            "total_records": 0, "vehicles_active": 0, "total_distance_km": 0,
            "total_ignition_hours": 0, "avg_speed_kmh": 0, "max_speed_kmh": 0,
            "pressure_avg_bar": None, "pressure_max_bar": None,
        })()

    return FleetAnalytics(
        period_hours=hours,
        total_distance_km=float(row.total_distance_km or 0),
        total_ignition_hours=float(row.total_ignition_hours or 0),
        avg_speed_kmh=float(row.avg_speed_kmh or 0),
        max_speed_kmh=int(row.max_speed_kmh or 0),
        total_records=int(row.total_records or 0),
        vehicles_active=int(row.vehicles_active or 0),
        vehicles_total=vehicles_total,
        pressure_avg_bar=float(row.pressure_avg_bar) if row.pressure_avg_bar else None,
        pressure_max_bar=float(row.pressure_max_bar) if row.pressure_max_bar else None,
    )


@router.get("/vehicle-stats", response_model=list[VehicleStats])
async def vehicle_stats(
    hours: int = Query(default=24, ge=1, le=8760),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Per-vehicle stats for the current user's tenant subtree."""
    tenant_ids = await _get_subtree(db, current_user.tenant_id)
    tenant_id_list = list(tenant_ids)

    tenant_id_strs2 = [str(t) for t in tenant_ids]
    sql = text("""
        SELECT
            v.id                                                                AS vehicle_id,
            v.name                                                              AS vehicle_name,
            d.online                                                            AS online,
            COUNT(tr.time)                                                      AS records,
            COALESCE(COUNT(*) FILTER (WHERE tr.ignition = TRUE) * 30.0 / 3600.0, 0)
                                                                                AS ignition_hours,
            COALESCE(SUM(tr.speed) / 120.0, 0)                                 AS distance_km,
            COALESCE(MAX(tr.speed), 0)                                          AS max_speed,
            CASE WHEN AVG((tr.io_data->>'9')::float) > 0
                 THEN AVG((tr.io_data->>'9')::float) * 0.006
                 ELSE NULL END                                                  AS avg_pressure_bar
        FROM vehicle v
        JOIN device d ON d.vehicle_id = v.id
        LEFT JOIN telemetry_record tr
            ON tr.device_id = d.id
           AND tr.time >= NOW() - :hours * INTERVAL '1 hour'
        WHERE v.tenant_id::text = ANY(:tenant_ids)
          AND v.active = TRUE
        GROUP BY v.id, v.name, d.online
        ORDER BY ignition_hours DESC
    """)

    rows = (await db.execute(sql, {"tenant_ids": tenant_id_strs2, "hours": hours})).all()

    return [
        VehicleStats(
            vehicle_id=str(row.vehicle_id),
            vehicle_name=row.vehicle_name,
            records=int(row.records or 0),
            ignition_hours=float(row.ignition_hours or 0),
            distance_km=float(row.distance_km or 0),
            max_speed=int(row.max_speed or 0),
            avg_pressure_bar=float(row.avg_pressure_bar) if row.avg_pressure_bar else None,
            online=bool(row.online),
        )
        for row in rows
    ]
