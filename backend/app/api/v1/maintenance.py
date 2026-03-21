"""
Maintenance tracking endpoints — tasks and logs for vehicle maintenance.
Access: superadmin, admin, operator (create/edit tasks); viewer (read-only).
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from datetime import datetime, date, timedelta, timezone
from uuid import UUID
import uuid

from app.core.database import get_db
from app.models.maintenance import MaintenanceTask, MaintenanceLog
from app.models.vehicle import Vehicle
from app.models.device import Device
from app.models.tenant import Tenant
from app.models.user import User
from app.api.v1.auth import get_current_user

router = APIRouter(prefix="/maintenance", tags=["maintenance"])

WRITE_ROLES = {"superadmin", "admin", "operator"}


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


class MaintenanceTaskUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    interval_value: Optional[float] = None
    next_due_km: Optional[float] = None
    next_due_hours: Optional[float] = None
    next_due_date: Optional[date] = None
    warn_before: Optional[float] = None
    active: Optional[bool] = None


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
    status: str = "ok"  # "ok" | "warning" | "overdue"
    vehicle_name: Optional[str] = None
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
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class MaintenanceSummary(BaseModel):
    overdue: int
    warning: int
    ok: int


# ─── Helpers ─────────────────────────────────────────────────────────────────

async def _get_subtree(db: AsyncSession, root_id: UUID) -> set[UUID]:
    """Return root_id plus all descendant tenant IDs."""
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
    """Return list of vehicle IDs accessible to this user."""
    if current_user.role == "superadmin":
        result = await db.execute(select(Vehicle.id).where(Vehicle.active == True))
        return list(result.scalars().all())
    allowed_tenants = await _get_subtree(db, current_user.tenant_id)
    result = await db.execute(
        select(Vehicle.id).where(Vehicle.active == True).where(Vehicle.tenant_id.in_(allowed_tenants))
    )
    return list(result.scalars().all())


async def _get_vehicle_name_map(db: AsyncSession, vehicle_ids: list[UUID]) -> dict[UUID, str]:
    """Return {vehicle_id: vehicle_name} for given IDs."""
    if not vehicle_ids:
        return {}
    result = await db.execute(select(Vehicle.id, Vehicle.name).where(Vehicle.id.in_(vehicle_ids)))
    return {row.id: row.name for row in result.all()}


async def _get_current_odometers(db: AsyncSession, vehicle_ids: list[UUID]) -> dict[UUID, float]:
    """
    Return {vehicle_id: odometer_km} using the last telemetry record per device.
    Odometer is io_data key "16" in meters (FMC650), divide by 1000.
    Avoids N+1 with a single query joining device + lateral last telemetry.
    """
    if not vehicle_ids:
        return {}

    # Get device_id -> vehicle_id mapping
    result = await db.execute(
        select(Device.id, Device.vehicle_id)
        .where(Device.vehicle_id.in_(vehicle_ids))
        .where(Device.active == True)
    )
    device_rows = result.all()
    device_to_vehicle: dict[UUID, UUID] = {row.id: row.vehicle_id for row in device_rows}
    device_ids = [row.id for row in device_rows]

    if not device_ids:
        return {}

    # Fetch last telemetry io_data for each device in one query using DISTINCT ON
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


def _compute_status(task: MaintenanceTask, current_km: Optional[float], today: date) -> str:
    """Compute status: 'overdue', 'warning', or 'ok'."""
    warn = task.warn_before or 50.0

    if task.trigger_type == "km" and task.next_due_km is not None and current_km is not None:
        diff = task.next_due_km - current_km
        if diff <= 0:
            return "overdue"
        if diff <= warn:
            return "warning"
        return "ok"

    if task.trigger_type in ("days", "date") and task.next_due_date is not None:
        days_left = (task.next_due_date - today).days
        if days_left < 0:
            return "overdue"
        if days_left <= int(warn):
            return "warning"
        return "ok"

    if task.trigger_type == "hours" and task.next_due_hours is not None:
        # We don't have real engine hours from telemetry yet — fall back to date-based check
        if task.next_due_date is not None:
            days_left = (task.next_due_date - today).days
            if days_left < 0:
                return "overdue"
            if days_left <= int(warn):
                return "warning"
        return "ok"

    return "ok"


# ─── Tasks endpoints ──────────────────────────────────────────────────────────

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

    # Fetch current odometers in one query
    task_vehicle_ids = list({t.vehicle_id for t in tasks})
    odometers = await _get_current_odometers(db, task_vehicle_ids)
    vehicle_names = await _get_vehicle_name_map(db, task_vehicle_ids)
    today = datetime.now(timezone.utc).date()

    output = []
    for task in tasks:
        current_km = odometers.get(task.vehicle_id)
        task_status = _compute_status(task, current_km, today)

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
        created_by=current_user.id,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    # Compute status for response
    odometers = await _get_current_odometers(db, [task.vehicle_id])
    vehicle_names = await _get_vehicle_name_map(db, [task.vehicle_id])
    today = datetime.now(timezone.utc).date()
    task_status = _compute_status(task, odometers.get(task.vehicle_id), today)

    return MaintenanceTaskOut(
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

    await db.commit()
    await db.refresh(task)

    odometers = await _get_current_odometers(db, [task.vehicle_id])
    vehicle_names = await _get_vehicle_name_map(db, [task.vehicle_id])
    today = datetime.now(timezone.utc).date()
    task_status = _compute_status(task, odometers.get(task.vehicle_id), today)

    return MaintenanceTaskOut(
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
    """Mark a maintenance task as completed. Automatically updates next_due thresholds."""
    if current_user.role not in WRITE_ROLES:
        raise HTTPException(403, "Insufficient permissions")

    # Fetch the task
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

    # Create the log entry
    log = MaintenanceLog(
        task_id=task.id,
        vehicle_id=task.vehicle_id,
        performed_at=body.performed_at,
        performed_by=current_user.id,
        notes=body.notes,
        odometer_km=odometer_km,
    )
    db.add(log)

    # Update task's next_due thresholds based on trigger_type
    today = datetime.now(timezone.utc).date()

    if task.trigger_type == "km" and task.interval_value is not None:
        base_km = odometer_km if odometer_km is not None else (task.next_due_km or 0)
        task.next_due_km = base_km + task.interval_value

    elif task.trigger_type == "hours" and task.interval_value is not None:
        base_hours = task.next_due_hours or 0
        task.next_due_hours = base_hours + task.interval_value
        # Also set a date-based fallback
        task.next_due_date = today + timedelta(days=int(task.interval_value))

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
    """Returns count of overdue/warning/ok tasks across the user's fleet."""
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

    counts = {"overdue": 0, "warning": 0, "ok": 0}
    for task in tasks:
        s = _compute_status(task, odometers.get(task.vehicle_id), today)
        counts[s] += 1

    return MaintenanceSummary(**counts)
