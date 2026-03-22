"""
Maintenance tracking endpoints — tasks and logs for vehicle maintenance.
Access: superadmin, admin, operator (create/edit tasks); viewer (read-only).

Engine hours for "hours" trigger tasks are computed from telemetry_record
by summing intervals where the configured IO signal (pto_io_key) is active.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from datetime import datetime, date, timedelta, timezone
from uuid import UUID
import uuid
import re

from app.core.database import get_db
from app.models.maintenance import MaintenanceTask, MaintenanceLog
from app.models.vehicle import Vehicle
from app.models.device import Device
from app.models.tenant import Tenant
from app.models.user import User
from app.api.v1.auth import get_current_user

router = APIRouter(prefix="/maintenance", tags=["maintenance"])

WRITE_ROLES = {"superadmin", "admin", "operator"}

# Regex for safe column-name interpolation into SQL (prevents injection)
_IO_KEY_RE = re.compile(r'^[a-z][a-z0-9_]{0,49}$')

# Suggested signals shown in the UI (user can also type any valid column name)
IO_KEY_SUGGESTIONS = {
    "ignition": "Ignición (motor encendido)",
    "din1": "Entrada digital 1 (DIN1)",
    "din2": "Entrada digital 2 (DIN2)",
    "din3": "Entrada digital 3 (DIN3)",
    "din4": "Entrada digital 4 (DIN4)",
    "dout1": "Salida digital 1 (DOUT1 — Toma de fuerza)",
    "dout2": "Salida digital 2 (DOUT2)",
    "dout3": "Salida digital 3 (DOUT3)",
    "dout4": "Salida digital 4 (DOUT4)",
}


def _safe_io_key(key: str) -> str:
    """Validate and return the key, fallback to 'ignition' if unsafe."""
    if key and _IO_KEY_RE.match(key):
        return key
    return "ignition"


# ─── Schemas ─────────────────────────────────────────────────────────────────

class MaintenanceTaskCreate(BaseModel):
    vehicle_id: UUID
    name: str
    description: Optional[str] = None
    trigger_type: str  # "km" | "hours" | "days" | "date"
    interval_value: Optional[float] = None
    next_due_km: Optional[float] = None
    next_due_hours: Optional[float] = None
    next_due_date: Optional[date] = None
    warn_before: float = 50.0
    pto_io_key: str = "ignition"  # IO signal to count for engine hours


class MaintenanceTaskUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    interval_value: Optional[float] = None
    next_due_km: Optional[float] = None
    next_due_hours: Optional[float] = None
    next_due_date: Optional[date] = None
    warn_before: Optional[float] = None
    active: Optional[bool] = None
    pto_io_key: Optional[str] = None


class MaintenanceTaskOut(BaseModel):
    id: UUID
    vehicle_id: UUID
    name: str
    description: Optional[str]
    trigger_type: str
    interval_value: Optional[float]
    next_due_km: Optional[float]
    next_due_hours: Optional[float]
    next_due_date: Optional[date]
    warn_before: float
    active: bool
    created_at: datetime
    status: str = "ok"
    vehicle_name: Optional[str] = None
    pto_io_key: str = "ignition"
    # Computed fields for "hours" tasks
    current_hours: Optional[float] = None      # hours accumulated since last maintenance
    last_maintenance_at: Optional[datetime] = None  # when last maintenance was done
    model_config = ConfigDict(from_attributes=True)


class MaintenanceLogCreate(BaseModel):
    task_id: UUID
    performed_at: datetime
    notes: Optional[str] = None
    odometer_km: Optional[float] = None


class MaintenanceLogOut(BaseModel):
    id: UUID
    task_id: UUID
    vehicle_id: UUID
    performed_at: datetime
    performed_by: Optional[UUID]
    notes: Optional[str]
    odometer_km: Optional[float]
    engine_hours: Optional[float] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class MaintenanceSummary(BaseModel):
    overdue: int
    warning: int
    ok: int


# ─── Helpers ─────────────────────────────────────────────────────────────────

async def _get_subtree(db: AsyncSession, root_id: UUID) -> set[UUID]:
    result = await db.execute(select(Tenant).where(Tenant.active == True))
    all_tenants = result.scalars().all()
    by_parent: dict[UUID, list[UUID]] = {}
    for t in all_tenants:
        if t.parent_id:
            by_parent.setdefault(t.parent_id, []).append(t.id)
    visited: set[UUID] = set()
    queue = [root_id]
    while queue:
        tid = queue.pop()
        visited.add(tid)
        queue.extend(by_parent.get(tid, []))
    return visited


async def _get_allowed_vehicles(db: AsyncSession, current_user: User) -> list[UUID]:
    if current_user.role == "superadmin":
        result = await db.execute(select(Vehicle.id).where(Vehicle.active == True))
        return list(result.scalars().all())
    allowed_tenants = await _get_subtree(db, current_user.tenant_id)
    result = await db.execute(
        select(Vehicle.id).where(Vehicle.active == True).where(Vehicle.tenant_id.in_(allowed_tenants))
    )
    return list(result.scalars().all())


async def _get_vehicle_name_map(db: AsyncSession, vehicle_ids: list[UUID]) -> dict[UUID, str]:
    if not vehicle_ids:
        return {}
    result = await db.execute(select(Vehicle.id, Vehicle.name).where(Vehicle.id.in_(vehicle_ids)))
    return {row.id: row.name for row in result.all()}


async def _get_current_odometers(db: AsyncSession, vehicle_ids: list[UUID]) -> dict[UUID, float]:
    if not vehicle_ids:
        return {}
    result = await db.execute(
        select(Device.id, Device.vehicle_id)
        .where(Device.vehicle_id.in_(vehicle_ids))
    )
    device_rows = result.all()
    device_to_vehicle: dict[UUID, UUID] = {row.id: row.vehicle_id for row in device_rows}
    device_ids = [row.id for row in device_rows]
    if not device_ids:
        return {}
    q = text("""
        SELECT DISTINCT ON (device_id) device_id, io_data
        FROM telemetry_record
        WHERE device_id = ANY(:device_ids)
          AND time >= NOW() - INTERVAL '30 days'
        ORDER BY device_id, time DESC
    """)
    rows = await db.execute(q, {"device_ids": [str(d) for d in device_ids]})
    odometers: dict[UUID, float] = {}
    for row in rows.all():
        dev_id = UUID(str(row.device_id)) if not isinstance(row.device_id, UUID) else row.device_id
        io_data = row.io_data or {}
        raw_meters = io_data.get("16")
        if raw_meters is not None:
            vehicle_id = device_to_vehicle.get(dev_id)
            if vehicle_id:
                odometers[vehicle_id] = float(raw_meters) / 1000.0
    return odometers


async def _get_vehicle_devices(db: AsyncSession, vehicle_ids: list[UUID]) -> dict[UUID, UUID]:
    """Return {vehicle_id: device_id} for vehicles that have a device assigned."""
    if not vehicle_ids:
        return {}
    result = await db.execute(
        select(Device.id, Device.vehicle_id).where(Device.vehicle_id.in_(vehicle_ids))
    )
    return {row.vehicle_id: row.id for row in result.all()}


async def _get_engine_hours(
    db: AsyncSession,
    device_id: UUID,
    since: datetime,
    io_key: str = "ignition",
) -> float:
    """
    Count hours when io_key was True from since to now using telemetry_record.
    Uses LEAD window function to compute intervals between consecutive records.
    Caps each interval at 5 minutes to avoid counting offline gaps.
    """
    io_key = _safe_io_key(io_key)

    # Build query — io_key is validated by regex so safe to interpolate as column name
    q = text(f"""
        SELECT COALESCE(SUM(
          CASE WHEN pto_active = TRUE THEN
            LEAST(
              EXTRACT(EPOCH FROM (next_time - time)) / 3600.0,
              0.0833  -- max 5 min per interval
            )
          ELSE 0.0 END
        ), 0.0) AS hours
        FROM (
          SELECT
            time,
            LEAD(time) OVER (ORDER BY time) AS next_time,
            {io_key} AS pto_active
          FROM telemetry_record
          WHERE device_id = :device_id
            AND time >= :since
            AND time <= NOW()
        ) t
        WHERE next_time IS NOT NULL
    """)
    result = await db.execute(q, {
        "device_id": str(device_id),
        "since": since,
    })
    row = result.one_or_none()
    return round(float(row.hours), 2) if row else 0.0


async def _get_last_maintenance_per_task(
    db: AsyncSession,
    task_ids: list[UUID],
) -> dict[UUID, datetime]:
    """Return {task_id: last_performed_at} for the given task IDs."""
    if not task_ids:
        return {}
    q = text("""
        SELECT DISTINCT ON (task_id) task_id, performed_at
        FROM maintenance_log
        WHERE task_id = ANY(:task_ids)
        ORDER BY task_id, performed_at DESC
    """)
    rows = await db.execute(q, {"task_ids": [str(t) for t in task_ids]})
    result = {}
    for row in rows.all():
        tid = UUID(str(row.task_id))
        result[tid] = row.performed_at
    return result


def _compute_status(
    task: MaintenanceTask,
    current_km: Optional[float],
    today: date,
    current_hours: Optional[float] = None,
) -> str:
    """Compute status: 'overdue', 'warning', or 'ok'.
    For 'hours' tasks: uses real accumulated hours if available,
    falls back to date check. Whichever triggers first wins.
    """
    warn = task.warn_before or 50.0

    if task.trigger_type == "km" and task.next_due_km is not None and current_km is not None:
        diff = task.next_due_km - current_km
        if diff <= 0:
            return "overdue"
        if diff <= warn:
            return "warning"
        return "ok"

    if task.trigger_type == "hours":
        # Check hours-based trigger
        if task.next_due_hours is not None and current_hours is not None:
            diff_h = task.next_due_hours - current_hours
            if diff_h <= 0:
                return "overdue"
            if diff_h <= warn:
                return "warning"
        # Also check calendar fallback (1 year) — whichever comes first
        if task.next_due_date is not None:
            days_left = (task.next_due_date - today).days
            if days_left < 0:
                return "overdue"
            if days_left <= int(warn):
                return "warning"
        return "ok"

    if task.trigger_type in ("days", "date") and task.next_due_date is not None:
        days_left = (task.next_due_date - today).days
        if days_left < 0:
            return "overdue"
        if days_left <= int(warn):
            return "warning"
        return "ok"

    return "ok"


# ─── Tasks endpoints ──────────────────────────────────────────────────────────

@router.get("/io-keys")
async def list_io_keys(db: AsyncSession = Depends(get_db)):
    """
    Returns suggested IO keys for the PTO signal selector, enriched with
    actual boolean/integer columns present in telemetry_record so the user
    can pick any signal the FMC650 sends.
    """
    # Fetch real column names from telemetry_record (excluding internal/geo fields)
    result = await db.execute(text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'telemetry_record'
          AND data_type IN ('boolean', 'smallint', 'integer', 'bigint', 'double precision', 'real', 'numeric')
          AND column_name NOT IN ('altitude', 'speed', 'satellites', 'angle',
                                  'ext_voltage_mv', 'battery_mv', 'gsm_signal',
                                  'ain1_mv', 'ain2_mv', 'ain3_mv')
        ORDER BY column_name
    """))
    db_cols = {row.column_name for row in result.all()}

    suggestions = []
    # First add the curated suggestions (in defined order)
    for key, label in IO_KEY_SUGGESTIONS.items():
        suggestions.append({"key": key, "label": label})

    # Then add any extra columns from the DB not already in the list
    curated = set(IO_KEY_SUGGESTIONS.keys())
    for col in sorted(db_cols):
        if col not in curated:
            suggestions.append({"key": col, "label": col})

    return suggestions


@router.get("/tasks", response_model=list[MaintenanceTaskOut])
async def list_tasks(
    vehicle_id: Optional[UUID] = Query(None),
    status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    allowed_vehicle_ids = await _get_allowed_vehicles(db, current_user)
    if not allowed_vehicle_ids:
        return []

    q = select(MaintenanceTask).where(
        MaintenanceTask.vehicle_id.in_(allowed_vehicle_ids)
    ).where(MaintenanceTask.active == True)

    if vehicle_id is not None:
        if vehicle_id not in allowed_vehicle_ids:
            raise HTTPException(403, "Access denied to this vehicle")
        q = q.where(MaintenanceTask.vehicle_id == vehicle_id)

    result = await db.execute(q.order_by(MaintenanceTask.created_at.desc()))
    tasks = result.scalars().all()

    if not tasks:
        return []

    task_vehicle_ids = list({t.vehicle_id for t in tasks})
    odometers = await _get_current_odometers(db, task_vehicle_ids)
    vehicle_names = await _get_vehicle_name_map(db, task_vehicle_ids)
    today = datetime.now(timezone.utc).date()

    # Compute engine hours for "hours" trigger tasks
    hours_tasks = [t for t in tasks if t.trigger_type == "hours"]
    vehicle_devices = {}
    last_maintenance_map: dict[UUID, datetime] = {}
    current_hours_map: dict[UUID, float] = {}  # keyed by task.id

    if hours_tasks:
        hours_vehicle_ids = list({t.vehicle_id for t in hours_tasks})
        vehicle_devices = await _get_vehicle_devices(db, hours_vehicle_ids)
        last_maintenance_map = await _get_last_maintenance_per_task(
            db, [t.id for t in hours_tasks]
        )
        for task in hours_tasks:
            device_id = vehicle_devices.get(task.vehicle_id)
            if device_id:
                since = last_maintenance_map.get(task.id) or task.created_at
                # Ensure since is timezone-aware
                if since.tzinfo is None:
                    since = since.replace(tzinfo=timezone.utc)
                hours = await _get_engine_hours(db, device_id, since, task.pto_io_key)
                current_hours_map[task.id] = hours

    output = []
    for task in tasks:
        current_km = odometers.get(task.vehicle_id)
        current_hours = current_hours_map.get(task.id)
        task_status = _compute_status(task, current_km, today, current_hours)

        if status and task_status != status:
            continue

        out = MaintenanceTaskOut(
            id=task.id,
            vehicle_id=task.vehicle_id,
            name=task.name,
            description=task.description,
            trigger_type=task.trigger_type,
            interval_value=task.interval_value,
            next_due_km=task.next_due_km,
            next_due_hours=task.next_due_hours,
            next_due_date=task.next_due_date,
            warn_before=task.warn_before,
            active=task.active,
            created_at=task.created_at,
            status=task_status,
            vehicle_name=vehicle_names.get(task.vehicle_id),
            pto_io_key=task.pto_io_key or "ignition",
            current_hours=current_hours,
            last_maintenance_at=last_maintenance_map.get(task.id),
        )
        output.append(out)

    return output


@router.post("/tasks", response_model=MaintenanceTaskOut, status_code=201)
async def create_task(
    body: MaintenanceTaskCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in WRITE_ROLES:
        raise HTTPException(403, "Insufficient permissions")

    allowed_vehicle_ids = await _get_allowed_vehicles(db, current_user)
    if body.vehicle_id not in allowed_vehicle_ids:
        raise HTTPException(403, "Access denied to this vehicle")

    valid_types = {"km", "hours", "days", "date"}
    if body.trigger_type not in valid_types:
        raise HTTPException(400, f"trigger_type must be one of: {valid_types}")

    pto_io_key = _safe_io_key(body.pto_io_key)

    task = MaintenanceTask(
        vehicle_id=body.vehicle_id,
        name=body.name,
        description=body.description,
        trigger_type=body.trigger_type,
        interval_value=body.interval_value,
        next_due_km=body.next_due_km,
        next_due_hours=body.next_due_hours,
        next_due_date=body.next_due_date,
        warn_before=body.warn_before,
        pto_io_key=pto_io_key,
        created_by=current_user.id,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    odometers = await _get_current_odometers(db, [task.vehicle_id])
    vehicle_names = await _get_vehicle_name_map(db, [task.vehicle_id])
    today = datetime.now(timezone.utc).date()
    task_status = _compute_status(task, odometers.get(task.vehicle_id), today)

    return MaintenanceTaskOut(
        id=task.id, vehicle_id=task.vehicle_id, name=task.name,
        description=task.description, trigger_type=task.trigger_type,
        interval_value=task.interval_value, next_due_km=task.next_due_km,
        next_due_hours=task.next_due_hours, next_due_date=task.next_due_date,
        warn_before=task.warn_before, active=task.active, created_at=task.created_at,
        status=task_status, vehicle_name=vehicle_names.get(task.vehicle_id),
        pto_io_key=task.pto_io_key or "ignition",
    )


@router.patch("/tasks/{task_id}", response_model=MaintenanceTaskOut)
async def update_task(
    task_id: UUID,
    body: MaintenanceTaskUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in WRITE_ROLES:
        raise HTTPException(403, "Insufficient permissions")

    result = await db.execute(select(MaintenanceTask).where(MaintenanceTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")

    allowed_vehicle_ids = await _get_allowed_vehicles(db, current_user)
    if task.vehicle_id not in allowed_vehicle_ids:
        raise HTTPException(403, "Access denied")

    if body.name is not None:
        task.name = body.name
    if body.description is not None:
        task.description = body.description
    if body.interval_value is not None:
        task.interval_value = body.interval_value
    if body.next_due_km is not None:
        task.next_due_km = body.next_due_km
    if body.next_due_hours is not None:
        task.next_due_hours = body.next_due_hours
    if body.next_due_date is not None:
        task.next_due_date = body.next_due_date
    if body.warn_before is not None:
        task.warn_before = body.warn_before
    if body.active is not None:
        task.active = body.active
    if body.pto_io_key is not None and _IO_KEY_RE.match(body.pto_io_key):
        task.pto_io_key = body.pto_io_key

    await db.commit()
    await db.refresh(task)

    odometers = await _get_current_odometers(db, [task.vehicle_id])
    vehicle_names = await _get_vehicle_name_map(db, [task.vehicle_id])
    today = datetime.now(timezone.utc).date()
    task_status = _compute_status(task, odometers.get(task.vehicle_id), today)

    return MaintenanceTaskOut(
        id=task.id, vehicle_id=task.vehicle_id, name=task.name,
        description=task.description, trigger_type=task.trigger_type,
        interval_value=task.interval_value, next_due_km=task.next_due_km,
        next_due_hours=task.next_due_hours, next_due_date=task.next_due_date,
        warn_before=task.warn_before, active=task.active, created_at=task.created_at,
        status=task_status, vehicle_name=vehicle_names.get(task.vehicle_id),
        pto_io_key=task.pto_io_key or "ignition",
    )


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in WRITE_ROLES:
        raise HTTPException(403, "Insufficient permissions")

    result = await db.execute(select(MaintenanceTask).where(MaintenanceTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")

    allowed_vehicle_ids = await _get_allowed_vehicles(db, current_user)
    if task.vehicle_id not in allowed_vehicle_ids:
        raise HTTPException(403, "Access denied")

    task.active = False
    await db.commit()


# ─── Logs endpoints ───────────────────────────────────────────────────────────

@router.get("/logs", response_model=list[MaintenanceLogOut])
async def list_logs(
    vehicle_id: Optional[UUID] = Query(None),
    task_id: Optional[UUID] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    allowed_vehicle_ids = await _get_allowed_vehicles(db, current_user)
    if not allowed_vehicle_ids:
        return []

    q = select(MaintenanceLog).where(MaintenanceLog.vehicle_id.in_(allowed_vehicle_ids))

    if vehicle_id is not None:
        if vehicle_id not in allowed_vehicle_ids:
            raise HTTPException(403, "Access denied to this vehicle")
        q = q.where(MaintenanceLog.vehicle_id == vehicle_id)

    if task_id is not None:
        q = q.where(MaintenanceLog.task_id == task_id)

    q = q.order_by(MaintenanceLog.performed_at.desc()).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/logs", response_model=MaintenanceLogOut, status_code=201)
async def complete_task(
    body: MaintenanceLogCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark a maintenance task as completed. Resets the hours/km counter."""
    if current_user.role not in WRITE_ROLES:
        raise HTTPException(403, "Insufficient permissions")

    result = await db.execute(select(MaintenanceTask).where(MaintenanceTask.id == body.task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")

    allowed_vehicle_ids = await _get_allowed_vehicles(db, current_user)
    if task.vehicle_id not in allowed_vehicle_ids:
        raise HTTPException(403, "Access denied")

    # Get current odometer if not provided
    odometer_km = body.odometer_km
    if odometer_km is None:
        odometers = await _get_current_odometers(db, [task.vehicle_id])
        odometer_km = odometers.get(task.vehicle_id)

    # For "hours" tasks: snapshot current engine hours at completion time
    engine_hours_snapshot: Optional[float] = None
    if task.trigger_type == "hours":
        dev_result = await db.execute(
            select(Device).where(Device.vehicle_id == task.vehicle_id)
        )
        device = dev_result.scalar_one_or_none()
        if device:
            # Get last log to know when to count from
            last_log_result = await db.execute(
                select(MaintenanceLog)
                .where(MaintenanceLog.task_id == task.id)
                .order_by(MaintenanceLog.performed_at.desc())
                .limit(1)
            )
            last_log = last_log_result.scalar_one_or_none()
            since = last_log.performed_at if last_log else task.created_at
            if since.tzinfo is None:
                since = since.replace(tzinfo=timezone.utc)
            engine_hours_snapshot = await _get_engine_hours(
                db, device.id, since, task.pto_io_key or "ignition"
            )

    # Create the log entry
    log = MaintenanceLog(
        task_id=task.id,
        vehicle_id=task.vehicle_id,
        performed_at=body.performed_at,
        performed_by=current_user.id,
        notes=body.notes,
        odometer_km=odometer_km,
        engine_hours=engine_hours_snapshot,
    )
    db.add(log)

    # Update task's next_due thresholds — counter resets from this moment
    today = datetime.now(timezone.utc).date()

    if task.trigger_type == "km" and task.interval_value is not None:
        base_km = odometer_km if odometer_km is not None else (task.next_due_km or 0)
        task.next_due_km = base_km + task.interval_value

    elif task.trigger_type == "hours" and task.interval_value is not None:
        # next_due_hours is the threshold (e.g. 1000h) — it doesn't change
        # The counter resets because the new log becomes the "since" reference point
        # Update date fallback: 1 year from now (or interval_value days if set)
        task.next_due_date = today + timedelta(days=365)

    elif task.trigger_type in ("days", "date") and task.interval_value is not None:
        task.next_due_date = today + timedelta(days=int(task.interval_value))

    await db.commit()
    await db.refresh(log)
    return log


# ─── Summary endpoint ─────────────────────────────────────────────────────────

@router.get("/summary", response_model=MaintenanceSummary)
async def get_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    allowed_vehicle_ids = await _get_allowed_vehicles(db, current_user)
    if not allowed_vehicle_ids:
        return MaintenanceSummary(overdue=0, warning=0, ok=0)

    result = await db.execute(
        select(MaintenanceTask)
        .where(MaintenanceTask.vehicle_id.in_(allowed_vehicle_ids))
        .where(MaintenanceTask.active == True)
    )
    tasks = result.scalars().all()

    if not tasks:
        return MaintenanceSummary(overdue=0, warning=0, ok=0)

    task_vehicle_ids = list({t.vehicle_id for t in tasks})
    odometers = await _get_current_odometers(db, task_vehicle_ids)
    today = datetime.now(timezone.utc).date()

    # For hours tasks in summary: compute real hours
    hours_tasks = [t for t in tasks if t.trigger_type == "hours"]
    current_hours_map: dict[UUID, float] = {}
    if hours_tasks:
        vehicle_devices = await _get_vehicle_devices(db, list({t.vehicle_id for t in hours_tasks}))
        last_maint = await _get_last_maintenance_per_task(db, [t.id for t in hours_tasks])
        for task in hours_tasks:
            device_id = vehicle_devices.get(task.vehicle_id)
            if device_id:
                since = last_maint.get(task.id) or task.created_at
                if since.tzinfo is None:
                    since = since.replace(tzinfo=timezone.utc)
                hours = await _get_engine_hours(db, device_id, since, task.pto_io_key or "ignition")
                current_hours_map[task.id] = hours

    counts = {"overdue": 0, "warning": 0, "ok": 0}
    for task in tasks:
        s = _compute_status(
            task,
            odometers.get(task.vehicle_id),
            today,
            current_hours_map.get(task.id),
        )
        counts[s] += 1

    return MaintenanceSummary(**counts)
