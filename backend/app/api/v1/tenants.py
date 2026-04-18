# backend/app/api/v1/tenants.py
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from app.core.database import get_db
from app.api.v1.deps import get_current_user, require_tier
from app.schemas.auth import CurrentUser
from app.schemas.tenant import TenantOut, TenantCreate, BrandTokensUpdate, GrantOut, GrantCreate
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
    tenant = Tenant(**body.model_dump())
    db.add(tenant)
    await db.commit()
    await db.refresh(tenant)
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
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier == "cmg":
        result = await db.execute(select(PermissionGrant).where(PermissionGrant.active == True))
    else:
        result = await db.execute(
            select(PermissionGrant).where(
                PermissionGrant.active == True,
                or_(
                    PermissionGrant.grantor_id == user.tenant_id,
                    PermissionGrant.grantee_id == user.tenant_id,
                ),
            )
        )
    return result.scalars().all()


@router.post("/grants", response_model=GrantOut, status_code=status.HTTP_201_CREATED)
async def create_grant(
    body: GrantCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo admins")
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
