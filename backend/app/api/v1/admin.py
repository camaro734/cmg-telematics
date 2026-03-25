"""
Admin endpoints — tenant, user and vehicle management.
Access rules:
  superadmin  → all tenants, all users
  admin       → only their subtree (children tenants)
  others      → 403
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid

from app.core.database import get_db
from app.models.tenant import Tenant
from app.models.user import User
from app.models.vehicle import Vehicle
from app.models.device import Device
from app.api.v1.auth import get_current_user, hash_password

router = APIRouter(prefix="/admin", tags=["admin"])

ALLOWED_ROLES = {"superadmin", "admin"}


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ALLOWED_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
    return current_user


# ─── TENANTS ────────────────────────────────────────────────────────────────

class TenantCreate(BaseModel):
    name: str
    type: str  # "manufacturer" | "end_client"
    parent_id: Optional[uuid.UUID] = None


class TenantOut(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    parent_id: Optional[uuid.UUID]
    active: bool
    brand_name: Optional[str] = None
    brand_color: Optional[str] = None
    logo_url: Optional[str] = None
    custom_domain: Optional[str] = None

    model_config = {"from_attributes": True}


@router.get("/tenants", response_model=list[TenantOut])
async def list_tenants(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(Tenant).where(Tenant.active == True).order_by(Tenant.name))
    tenants = result.scalars().all()

    if current_user.role == "superadmin":
        return tenants

    # admin: return their own tenant + all descendants
    allowed = await _get_subtree(db, current_user.tenant_id)
    return [t for t in tenants if t.id in allowed]


@router.post("/tenants", response_model=TenantOut, status_code=201)
async def create_tenant(
    body: TenantCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if body.type not in ("manufacturer", "end_client"):
        raise HTTPException(400, "type must be 'manufacturer' or 'end_client'")

    # superadmin can create manufacturers; admin can only create end_clients under their tree
    if current_user.role == "admin" and body.type == "manufacturer":
        raise HTTPException(403, "Admins can only create end_client tenants")

    parent_id = body.parent_id or current_user.tenant_id

    tenant = Tenant(name=body.name, type=body.type, parent_id=parent_id)
    db.add(tenant)
    await db.commit()
    await db.refresh(tenant)
    return tenant


@router.patch("/tenants/{tenant_id}")
async def update_tenant(
    tenant_id: uuid.UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "Tenant not found")

    if "name" in body:
        tenant.name = body["name"]
    if "active" in body:
        tenant.active = body["active"]
    if "brand_name" in body:
        tenant.brand_name = body["brand_name"] or None
    if "brand_color" in body:
        tenant.brand_color = body["brand_color"] or None
    if "logo_url" in body:
        tenant.logo_url = body["logo_url"] or None
    if "custom_domain" in body:
        tenant.custom_domain = body["custom_domain"].lower().strip() if body["custom_domain"] else None
    await db.commit()
    return {"id": str(tenant.id), "name": tenant.name, "active": tenant.active}


# ─── USERS ──────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: str  # "admin" | "operator" | "viewer" | "driver"
    tenant_id: uuid.UUID


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    tenant_id: uuid.UUID
    active: bool
    notify_email: bool = True

    model_config = {"from_attributes": True}


@router.get("/users", response_model=list[UserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(User).where(User.active == True).order_by(User.email))
    users = result.scalars().all()

    if current_user.role == "superadmin":
        return users

    allowed = await _get_subtree(db, current_user.tenant_id)
    return [u for u in users if u.tenant_id in allowed]


@router.post("/users", response_model=UserOut, status_code=201)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    # Validate role
    valid_roles = {"admin", "operator", "viewer", "driver"}
    if current_user.role == "admin":
        valid_roles = {"operator", "viewer", "driver"}  # admins can't create other admins
    if body.role not in valid_roles:
        raise HTTPException(400, f"Invalid role '{body.role}'. Allowed: {valid_roles}")

    # Check tenant is in subtree
    if current_user.role != "superadmin":
        allowed = await _get_subtree(db, current_user.tenant_id)
        if body.tenant_id not in allowed:
            raise HTTPException(403, "Cannot create users in that tenant")

    # Check email unique
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Email already registered")

    user = User(
        tenant_id=body.tenant_id,
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        role=body.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.patch("/users/{user_id}")
async def update_user(
    user_id: uuid.UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")

    if "full_name" in body:
        user.full_name = body["full_name"]
    if "role" in body:
        user.role = body["role"]
    if "active" in body:
        user.active = body["active"]
    if "notify_email" in body:
        user.notify_email = bool(body["notify_email"])
    if "password" in body and body["password"]:
        user.hashed_password = hash_password(body["password"])
    await db.commit()
    return {"id": str(user.id), "email": user.email, "role": user.role, "active": user.active}


# ─── VEHICLES + DEVICES ─────────────────────────────────────────────────────

class VehicleCreate(BaseModel):
    name: str
    license_plate: Optional[str] = None
    tenant_id: Optional[uuid.UUID] = None        # end_client propietario; None = stock del fabricante
    manufacturer_id: Optional[uuid.UUID] = None  # fabricante; si no se indica, se usa el tenant del usuario
    imei: Optional[str] = None     # asignar FMC650 al crear


class VehicleAdminOut(BaseModel):
    id: uuid.UUID
    name: str
    license_plate: Optional[str]
    tenant_id: uuid.UUID
    tenant_name: str = ""
    manufacturer_id: Optional[uuid.UUID] = None
    manufacturer_name: str = ""
    device_imei: Optional[str] = None
    device_online: Optional[bool] = None

    model_config = {"from_attributes": True}


@router.get("/vehicles", response_model=list[VehicleAdminOut])
async def list_vehicles_admin(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(
        select(Vehicle, Device)
        .outerjoin(Device, Device.vehicle_id == Vehicle.id)
        .where(Vehicle.active == True)
    )
    rows = result.all()

    if current_user.role != "superadmin":
        allowed = await _get_subtree(db, current_user.tenant_id)
        rows = [(v, d) for v, d in rows if v.tenant_id in allowed]

    # Build tenant name lookup
    all_tenant_ids = set()
    for v, _ in rows:
        all_tenant_ids.add(v.tenant_id)
        if v.manufacturer_id:
            all_tenant_ids.add(v.manufacturer_id)

    tenant_names: dict[uuid.UUID, str] = {}
    if all_tenant_ids:
        t_result = await db.execute(select(Tenant).where(Tenant.id.in_(all_tenant_ids)))
        for t in t_result.scalars().all():
            tenant_names[t.id] = t.name

    return [
        VehicleAdminOut(
            id=v.id,
            name=v.name,
            license_plate=v.license_plate,
            tenant_id=v.tenant_id,
            tenant_name=tenant_names.get(v.tenant_id, ""),
            manufacturer_id=v.manufacturer_id,
            manufacturer_name=tenant_names.get(v.manufacturer_id, "") if v.manufacturer_id else "",
            device_imei=d.imei if d else None,
            device_online=(
                d.last_seen is not None and
                (datetime.now(timezone.utc) - (d.last_seen if d.last_seen.tzinfo else d.last_seen.replace(tzinfo=timezone.utc))) < timedelta(minutes=10)
            ) if d else None,
        )
        for v, d in rows
    ]


@router.post("/vehicles", status_code=201)
async def create_vehicle(
    body: VehicleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    # Determine manufacturer: explicit (superadmin) or current user's tenant (admin)
    manufacturer_id = body.manufacturer_id or current_user.tenant_id

    # If no client specified, vehicle belongs to manufacturer (stock)
    tenant_id = body.tenant_id or manufacturer_id

    # Validate manufacturer and client are in admin's subtree (superadmin can use any)
    if current_user.role != "superadmin":
        allowed = await _get_subtree(db, current_user.tenant_id)
        if manufacturer_id not in allowed:
            raise HTTPException(403, "Manufacturer not in your subtree")
        if tenant_id not in allowed:
            raise HTTPException(403, "Client not in your subtree")

    vehicle = Vehicle(
        tenant_id=tenant_id,
        manufacturer_id=manufacturer_id,
        name=body.name,
        license_plate=body.license_plate,
    )
    db.add(vehicle)
    await db.flush()

    if body.imei:
        if len(body.imei) != 15 or not body.imei.isdigit():
            raise HTTPException(400, "IMEI must be exactly 15 digits")
        existing = await db.execute(select(Device).where(Device.imei == body.imei))
        if existing.scalar_one_or_none():
            raise HTTPException(409, f"IMEI {body.imei} already en uso")
        device = Device(vehicle_id=vehicle.id, imei=body.imei, model="FMC650")
        db.add(device)

    await db.commit()
    return {"id": str(vehicle.id), "name": vehicle.name, "imei": body.imei}


@router.patch("/vehicles/{vehicle_id}")
async def update_vehicle(
    vehicle_id: uuid.UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    vehicle = result.scalar_one_or_none()
    if not vehicle:
        raise HTTPException(404, "Vehicle not found")
    if "name" in body:
        vehicle.name = body["name"]
    if "license_plate" in body:
        vehicle.license_plate = body["license_plate"] or None
    if "active" in body:
        vehicle.active = body["active"]
    if "tenant_id" in body and body["tenant_id"]:
        new_tenant_id = uuid.UUID(str(body["tenant_id"]))
        # Validate the target tenant is in the admin's subtree
        if current_user.role != "superadmin":
            allowed = await _get_subtree(db, current_user.tenant_id)
            if new_tenant_id not in allowed:
                raise HTTPException(403, "Target tenant not in your subtree")
        vehicle.tenant_id = new_tenant_id

    # IMEI: assign or replace device
    if "imei" in body:
        imei = (body["imei"] or "").strip()
        # Get existing device for this vehicle
        dev_result = await db.execute(select(Device).where(Device.vehicle_id == vehicle_id))
        existing_device = dev_result.scalar_one_or_none()

        if imei:
            if len(imei) != 15 or not imei.isdigit():
                raise HTTPException(400, "IMEI must be exactly 15 digits")
            # Check IMEI not used by another vehicle
            conflict = await db.execute(select(Device).where(Device.imei == imei))
            conflict_device = conflict.scalar_one_or_none()
            if conflict_device and conflict_device.vehicle_id != vehicle_id:
                raise HTTPException(409, f"IMEI {imei} ya está asignado a otro vehículo")
            if existing_device:
                existing_device.imei = imei
            else:
                db.add(Device(vehicle_id=vehicle_id, imei=imei, model="FMC650"))
        else:
            # Remove device assignment
            if existing_device:
                await db.delete(existing_device)

    await db.commit()
    return {"id": str(vehicle.id), "name": vehicle.name}


# ─── Helpers ─────────────────────────────────────────────────────────────────

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
