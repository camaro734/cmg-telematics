# backend/app/api/v1/tenants.py
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from sqlalchemy.exc import IntegrityError
from app.core.database import get_db
from app.api.v1.deps import get_current_user, require_tier
from app.schemas.auth import CurrentUser
from app.schemas.tenant import TenantOut, TenantCreate, TenantUpdate, BrandTokensUpdate, GrantOut, GrantCreate
from app.models.tenant import Tenant
from app.models.permission_grant import PermissionGrant

router = APIRouter(tags=["tenants"])


@router.get("/tenants", response_model=list[TenantOut])
async def list_tenants(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier == "cmg":
        result = await db.execute(select(Tenant).order_by(Tenant.name))
    else:
        result = await db.execute(
            select(Tenant).where(Tenant.id == user.tenant_id)
        )
    return result.scalars().all()


@router.post("/tenants", response_model=TenantOut, status_code=status.HTTP_201_CREATED)
async def create_tenant(
    body: TenantCreate,
    user: CurrentUser = Depends(require_tier("cmg")),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(select(Tenant).where(Tenant.slug == body.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un tenant con slug '{body.slug}'",
        )
    # Fix 4: validate parent_id and tier hierarchy
    if body.parent_id is not None:
        parent = await db.get(Tenant, body.parent_id)
        if not parent or not parent.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tenant padre no encontrado o inactivo",
            )
        # client must have cmg parent, subclient must have client parent
        valid_parent_tiers = {"client": "cmg", "subclient": "client"}
        if body.tier in valid_parent_tiers and parent.tier != valid_parent_tiers[body.tier]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Un tenant tier='{body.tier}' debe tener un padre tier='{valid_parent_tiers[body.tier]}'",
            )
    elif body.tier in ("client", "subclient"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Un tenant tier='{body.tier}' requiere parent_id",
        )
    tenant = Tenant(**body.model_dump())
    db.add(tenant)
    # Fix 2: handle slug uniqueness race condition
    try:
        await db.commit()
        await db.refresh(tenant)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un tenant con slug '{body.slug}'",
        )
    return tenant


@router.get("/tenants/{tenant_id}", response_model=TenantOut)
async def get_tenant(
    tenant_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    if user.tenant_tier != "cmg" and str(tenant.id) != str(user.tenant_id):
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return tenant


@router.put("/tenants/{tenant_id}", response_model=TenantOut)
async def update_tenant(
    tenant_id: uuid.UUID,
    body: TenantUpdate,
    user: CurrentUser = Depends(require_tier("cmg")),
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    if body.name is not None:
        tenant.name = body.name
    if body.slug is not None:
        tenant.slug = body.slug
    if body.active is not None:
        tenant.active = body.active
    try:
        await db.commit()
        await db.refresh(tenant)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Slug ya existe")
    return tenant


@router.get("/tenants/{tenant_id}/brand-tokens")
async def get_brand_tokens(
    tenant_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    return tenant.brand_tokens or {}


@router.put("/tenants/{tenant_id}/brand-tokens")
async def update_brand_tokens(
    tenant_id: uuid.UUID,
    body: BrandTokensUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    if user.tenant_tier != "cmg" and str(tenant.id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado")
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo admins")
    tenant.brand_tokens = body.brand_tokens
    await db.commit()
    return tenant.brand_tokens


@router.get("/grants", response_model=list[GrantOut])
async def list_grants(
    grantee_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(PermissionGrant).where(PermissionGrant.active == True)
    if user.tenant_tier != "cmg":
        query = query.where(
            or_(
                PermissionGrant.grantor_id == user.tenant_id,
                PermissionGrant.grantee_id == user.tenant_id,
            )
        )
    if grantee_id is not None:
        query = query.where(PermissionGrant.grantee_id == grantee_id)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/grants", response_model=GrantOut, status_code=status.HTTP_201_CREATED)
async def create_grant(
    body: GrantCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo admins")
    # Fix 3a: validate grantee exists and is active
    grantee = await db.get(Tenant, body.grantee_id)
    if not grantee or not grantee.active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Grantee no encontrado o inactivo",
        )
    # Fix 3b: validate vehicle resource belongs to grantor's tenant (non-cmg)
    if body.resource_type == "vehicle" and body.resource_id is not None and user.tenant_tier != "cmg":
        from app.models.vehicle import Vehicle
        vehicle = await db.get(Vehicle, body.resource_id)
        if not vehicle or str(vehicle.tenant_id) != str(user.tenant_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes acceso a este recurso",
            )
    # Fix 3c: validate allowed_actions is non-empty
    if not body.allowed_actions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="allowed_actions no puede estar vacío",
        )
    data = body.model_dump()
    grant = PermissionGrant(
        grantor_id=user.tenant_id,
        granted_by_user=user.user_id,
        **data,
    )
    db.add(grant)
    await db.commit()
    await db.refresh(grant)
    return grant


@router.delete("/grants/{grant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_grant(
    grant_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    grant = await db.get(PermissionGrant, grant_id)
    if not grant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Grant no encontrado")
    if user.tenant_tier != "cmg" and str(grant.grantor_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado")
    grant.active = False
    await db.commit()
