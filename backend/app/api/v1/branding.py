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
