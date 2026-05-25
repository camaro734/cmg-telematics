# backend/app/api/v1/tenants.py
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from sqlalchemy.exc import IntegrityError
from app.core.database import get_db
from app.api.v1.deps import get_current_user, require_tier, assert_can_manage_tenant
from app.schemas.auth import CurrentUser
from app.schemas.tenant import TenantOut, TenantCreate, TenantUpdate, BrandTokensUpdate, GrantOut, GrantCreate
from app.schemas.user import UserOut, UserCreate
from app.models.tenant import Tenant
from app.models.permission_grant import PermissionGrant
from app.models.user import User
from app.core.security import hash_password

router = APIRouter(tags=["tenants"])

ALLOWED_MODULES = {"fleet", "alerts", "maintenance", "reports"}


@router.get("/tenants", response_model=list[TenantOut])
async def list_tenants(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier == "cmg":
        result = await db.execute(select(Tenant).order_by(Tenant.name))
    elif user.tenant_tier == "client":
        # client ve su propio tenant + sus subclientes
        result = await db.execute(
            select(Tenant).where(
                (Tenant.id == user.tenant_id) |
                (Tenant.parent_id == user.tenant_id)
            ).order_by(Tenant.name)
        )
    elif user.tenant_tier == "manufacturer":
        # manufacturer ve su propio tenant + los clientes que ha creado
        result = await db.execute(
            select(Tenant).where(
                (Tenant.id == user.tenant_id) |
                (Tenant.parent_manufacturer_id == user.tenant_id)
            ).order_by(Tenant.name)
        )
    else:
        result = await db.execute(
            select(Tenant).where(Tenant.id == user.tenant_id)
        )
    return result.scalars().all()


@router.post("/tenants", response_model=TenantOut, status_code=status.HTTP_201_CREATED)
async def create_tenant(
    body: TenantCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    if body.tier == "manufacturer" and user.tenant_tier != "cmg":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo CMG puede crear tenants tier=manufacturer")
    # Los clientes solo pueden crear subclientes bajo ellos mismos
    if user.tenant_tier == "client":
        body = body.model_copy(update={"tier": "subclient", "parent_id": user.tenant_id})
    elif user.tenant_tier == "manufacturer":
        if user.role != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin para crear clientes")
        if body.tier != "client":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Un fabricante solo puede crear tenants tier=client")
        body = body.model_copy(update={
            "tier": "client",
            "parent_id": user.tenant_id,
            "parent_manufacturer_id": user.tenant_id,
        })
    elif user.tenant_tier not in ("cmg",):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sin permisos para crear tenants")
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
        # client must have cmg or manufacturer parent, subclient must have client parent
        valid_parent_tiers: dict[str, set[str]] = {"client": {"cmg", "manufacturer"}, "subclient": {"client"}}
        if body.tier in valid_parent_tiers and parent.tier not in valid_parent_tiers[body.tier]:
            allowed = valid_parent_tiers[body.tier]
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Un tenant tier='{body.tier}' debe tener un padre tier en {{{', '.join(sorted(allowed))}}}",
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
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    if body.name is not None:
        tenant.name = body.name
    if body.slug is not None:
        tenant.slug = body.slug
    if body.active is not None:
        tenant.active = body.active
    if body.business_cif is not None:
        tenant.business_cif = body.business_cif.strip() or None
    if body.business_address is not None:
        tenant.business_address = body.business_address.strip() or None
    try:
        await db.commit()
        await db.refresh(tenant)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug ya existe")
    return tenant


@router.patch("/tenants/{tenant_id}", response_model=TenantOut)
async def patch_tenant(
    tenant_id: uuid.UUID,
    body: TenantUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    # client solo puede editar sus propios subclientes
    if user.tenant_tier == "client" and str(tenant.parent_id) != str(user.tenant_id):
        raise HTTPException(status_code=403, detail="Solo puedes editar tus propios subclientes")
    elif user.tenant_tier not in ("cmg", "client"):
        raise HTTPException(status_code=403, detail="Sin permisos")

    if body.enabled_modules is not None:
        invalid = set(body.enabled_modules) - ALLOWED_MODULES
        if invalid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Módulos no válidos: {invalid}",
            )
        if tenant.tier == "subclient" and tenant.parent_id:
            parent = await db.get(Tenant, tenant.parent_id)
            if parent:
                not_allowed = set(body.enabled_modules) - set(parent.enabled_modules)
                if not_allowed:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"El fabricante padre no tiene estos módulos: {not_allowed}",
                    )
        tenant.enabled_modules = body.enabled_modules

    # update remaining fields (exclude enabled_modules — already handled above)
    for field, value in body.model_dump(exclude_unset=True, exclude={"enabled_modules"}).items():
        setattr(tenant, field, value)

    try:
        await db.commit()
        await db.refresh(tenant)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug ya existe")
    return tenant


@router.delete("/tenants/{tenant_id}", response_model=TenantOut)
async def delete_tenant(
    tenant_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    if user.tenant_tier != "cmg":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo CMG puede borrar tenants")
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    if tenant.tier == "cmg":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No se puede borrar un tenant CMG")
    if not tenant.active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant ya está inactivo")
    tenant.active = False
    await db.commit()
    await db.refresh(tenant)
    return tenant


@router.post("/tenants/{tenant_id}/reactivate", response_model=TenantOut)
async def reactivate_tenant(
    tenant_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    if user.tenant_tier != "cmg":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo CMG puede reactivar tenants")
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    if tenant.active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant ya está activo")
    tenant.active = True
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
    result = dict(tenant.brand_tokens or {})
    if tenant.logo_url:
        result["logo_url"] = tenant.logo_url
    if tenant.brand_name:
        result["brand_name"] = tenant.brand_name
    return result


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


@router.get("/tenants/{tenant_id}/users", response_model=list[UserOut])
async def list_tenant_users(
    tenant_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_manage_tenant(user, tenant_id, db)
    result = await db.execute(
        select(User).where(User.tenant_id == tenant_id).order_by(User.email)
    )
    return result.scalars().all()


@router.post("/tenants/{tenant_id}/users", response_model=UserOut, status_code=201)
async def create_tenant_user(
    tenant_id: uuid.UUID,
    body: UserCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_manage_tenant(user, tenant_id, db)
    tenant = await db.get(Tenant, tenant_id)
    if not tenant or not tenant.active:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    new_user = User(
        tenant_id=tenant_id,
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        role=body.role,
    )
    db.add(new_user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Email ya registrado")
    await db.refresh(new_user)
    return new_user


# ── Portal token ──────────────────────────────────────────────────────────────

import secrets as _secrets

@router.post("/tenants/{tenant_id}/portal-token", status_code=200)
async def generate_portal_token(
    tenant_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" and str(user.tenant_id) != str(tenant_id):
        raise HTTPException(status_code=403, detail="Sin permiso")
    tenant = await db.get(Tenant, tenant_id)
    if not tenant or not tenant.active:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    tenant.portal_access_token = _secrets.token_urlsafe(32)
    await db.commit()
    await db.refresh(tenant)
    return {"portal_access_token": tenant.portal_access_token}


@router.get("/tenants/{tenant_id}/portal-token", status_code=200)
async def get_portal_token(
    tenant_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" and str(user.tenant_id) != str(tenant_id):
        raise HTTPException(status_code=403, detail="Sin permiso")
    tenant = await db.get(Tenant, tenant_id)
    if not tenant or not tenant.active:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return {"portal_access_token": tenant.portal_access_token}
