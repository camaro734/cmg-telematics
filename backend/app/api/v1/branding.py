"""
Branding endpoint — public, no auth required.

Returns the white-label configuration for a given custom domain.
Used by the frontend to render the branded login page and shell.

If no branding is found for the domain, returns the default CMG branding.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.core.database import get_db
from app.models.tenant import Tenant
from app.models.user import User
from app.api.v1.auth import get_current_user

router = APIRouter(prefix="/branding", tags=["branding"])


class BrandingOut(BaseModel):
    tenant_id: Optional[str] = None
    brand_name: str
    brand_color: str
    logo_url: Optional[str] = None
    is_custom: bool = False  # False = default CMG branding


DEFAULT_BRANDING = BrandingOut(
    tenant_id=None,
    brand_name="CMG Telematics",
    brand_color="#1D9E75",
    logo_url=None,
    is_custom=False,
)


@router.get("", response_model=BrandingOut)
async def get_branding(
    domain: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Get branding for a given domain (hostname without port).
    Returns default CMG branding if no custom domain matches.
    """
    if not domain:
        return DEFAULT_BRANDING

    # Strip port if present and normalize
    host = domain.split(":")[0].lower().strip()

    result = await db.execute(
        select(Tenant).where(
            Tenant.custom_domain == host,
            Tenant.active == True,
        )
    )
    tenant = result.scalar_one_or_none()

    if not tenant or tenant.type not in ("manufacturer", "cmg"):
        return DEFAULT_BRANDING

    return BrandingOut(
        tenant_id=str(tenant.id),
        brand_name=tenant.brand_name or tenant.name,
        brand_color=tenant.brand_color or "#1D9E75",
        logo_url=tenant.logo_url,
        is_custom=True,
    )


@router.get("/me", response_model=BrandingOut)
async def get_my_branding(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns the branding for the manufacturer in the current user's tenant hierarchy.
    Accessible to all authenticated roles (operator, viewer, driver, admin, superadmin).
    """
    # Walk up the tenant tree until we find a manufacturer (or exhaust the tree)
    tenant_id = current_user.tenant_id
    visited = set()

    while tenant_id and tenant_id not in visited:
        visited.add(tenant_id)
        result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
        tenant = result.scalar_one_or_none()
        if not tenant:
            break

        if tenant.type == "manufacturer" and (tenant.brand_name or tenant.logo_url or tenant.brand_color):
            return BrandingOut(
                tenant_id=str(tenant.id),
                brand_name=tenant.brand_name or tenant.name,
                brand_color=tenant.brand_color or "#1D9E75",
                logo_url=tenant.logo_url,
                is_custom=True,
            )

        # Go up to parent
        tenant_id = tenant.parent_id

    return DEFAULT_BRANDING
