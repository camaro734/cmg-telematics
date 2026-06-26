import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.core.database import get_db
from app.api.v1.deps import get_current_user, visible_tenant_ids, assert_tenant_visible
from app.schemas.auth import CurrentUser
from app.schemas.driver import DriverOut, DriverCreate, DriverUpdate, AssignDriverRequest, AssignmentOut
from app.models.driver import Driver, VehicleDriverAssignment
from app.models.vehicle import Vehicle

router = APIRouter(tags=["drivers"])




@router.get("/drivers", response_model=list[DriverOut])
async def list_drivers(
    tenant_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Driver).where(Driver.active == True)
    # Jefe de flota (admin client) ve sus choferes + los de sus subclients; cmg ve todo.
    visible = await visible_tenant_ids(user, db)
    if visible is not None:
        query = query.where(Driver.tenant_id.in_(visible))
    elif tenant_id is not None:
        query = query.where(Driver.tenant_id == tenant_id)
    result = await db.execute(query.order_by(Driver.full_name))
    drivers = result.scalars().all()

    # Enrich with current vehicle name
    out = []
    for d in drivers:
        current_vehicle_name = await _get_current_vehicle_name(db, d.id)
        item = DriverOut.model_validate(d)
        item.current_vehicle_name = current_vehicle_name
        out.append(item)
    return out


@router.get("/drivers/{driver_id}", response_model=DriverOut)
async def get_driver(
    driver_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    driver = await db.get(Driver, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Conductor no encontrado")
    await assert_tenant_visible(user, driver.tenant_id, db)
    item = DriverOut.model_validate(driver)
    item.current_vehicle_name = await _get_current_vehicle_name(db, driver.id)
    return item


@router.post("/drivers", response_model=DriverOut, status_code=status.HTTP_201_CREATED)
async def create_driver(
    body: DriverCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="No autorizado")
    driver = Driver(tenant_id=user.tenant_id, **body.model_dump())
    db.add(driver)
    await db.commit()
    await db.refresh(driver)
    return DriverOut.model_validate(driver)


@router.put("/drivers/{driver_id}", response_model=DriverOut)
async def update_driver(
    driver_id: uuid.UUID,
    body: DriverUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="No autorizado")
    driver = await db.get(Driver, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Conductor no encontrado")
    await assert_tenant_visible(user, driver.tenant_id, db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(driver, field, value)
    await db.commit()
    await db.refresh(driver)
    item = DriverOut.model_validate(driver)
    item.current_vehicle_name = await _get_current_vehicle_name(db, driver.id)
    return item


@router.delete("/drivers/{driver_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_driver(
    driver_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="No autorizado")
    driver = await db.get(Driver, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Conductor no encontrado")
    await assert_tenant_visible(user, driver.tenant_id, db)
    driver.active = False
    # Cerrar asignación activa si existe
    await _close_active_assignment(db, driver_id)
    await db.commit()


@router.get("/drivers/{driver_id}/history", response_model=list[AssignmentOut])
async def driver_history(
    driver_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    driver = await db.get(Driver, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Conductor no encontrado")
    await assert_tenant_visible(user, driver.tenant_id, db)
    result = await db.execute(
        select(VehicleDriverAssignment)
        .where(VehicleDriverAssignment.driver_id == driver_id)
        .order_by(VehicleDriverAssignment.assigned_at.desc())
    )
    return result.scalars().all()


@router.post("/vehicles/{vehicle_id}/assign-driver", response_model=DriverOut | None)
async def assign_driver(
    vehicle_id: uuid.UUID,
    body: AssignDriverRequest,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="No autorizado")
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")
    await assert_tenant_visible(user, vehicle.tenant_id, db)

    # Cerrar asignación anterior si existe
    await _close_active_assignment_for_vehicle(db, vehicle_id)

    if body.driver_id is None:
        # Solo desasignar
        await db.commit()
        return None

    driver = await db.get(Driver, body.driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Conductor no encontrado")
    await assert_tenant_visible(user, driver.tenant_id, db)

    assignment = VehicleDriverAssignment(vehicle_id=vehicle_id, driver_id=body.driver_id)
    db.add(assignment)
    # Sincronizar driver_name en vehicle para compatibilidad con vistas existentes
    vehicle.driver_name = driver.full_name
    await db.commit()
    item = DriverOut.model_validate(driver)
    item.current_vehicle_name = vehicle.name
    return item


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _get_current_vehicle_name(db: AsyncSession, driver_id: uuid.UUID) -> str | None:
    result = await db.execute(
        select(Vehicle.name)
        .join(VehicleDriverAssignment, VehicleDriverAssignment.vehicle_id == Vehicle.id)
        .where(
            and_(
                VehicleDriverAssignment.driver_id == driver_id,
                VehicleDriverAssignment.ended_at == None,  # noqa: E711
            )
        )
    )
    return result.scalar_one_or_none()


async def _close_active_assignment(db: AsyncSession, driver_id: uuid.UUID) -> None:
    result = await db.execute(
        select(VehicleDriverAssignment).where(
            and_(
                VehicleDriverAssignment.driver_id == driver_id,
                VehicleDriverAssignment.ended_at == None,  # noqa: E711
            )
        )
    )
    for assignment in result.scalars().all():
        assignment.ended_at = datetime.now(timezone.utc)


async def _close_active_assignment_for_vehicle(db: AsyncSession, vehicle_id: uuid.UUID) -> None:
    result = await db.execute(
        select(VehicleDriverAssignment).where(
            and_(
                VehicleDriverAssignment.vehicle_id == vehicle_id,
                VehicleDriverAssignment.ended_at == None,  # noqa: E711
            )
        )
    )
    for assignment in result.scalars().all():
        assignment.ended_at = datetime.now(timezone.utc)
