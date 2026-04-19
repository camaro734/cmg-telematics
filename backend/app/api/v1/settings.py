# backend/app/api/v1/settings.py
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.api.v1.deps import get_current_user, require_role
from app.schemas.auth import CurrentUser
from app.schemas.settings import SettingsOut, SettingsPatch
from app.models.tenant import Tenant

router = APIRouter(tags=["settings"])


def _effective_tenant_id(user: CurrentUser, tenant_id: uuid.UUID | None) -> uuid.UUID:
    """Devuelve el tenant_id efectivo: si el usuario es CMG puede especificar otro tenant."""
    if tenant_id is not None and user.tenant_tier == "cmg":
        return tenant_id
    return user.tenant_id


@router.get("/settings", response_model=SettingsOut)
async def get_settings(
    tenant_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tid = _effective_tenant_id(user, tenant_id)
    tenant = await db.get(Tenant, tid)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    return tenant


@router.patch("/settings", response_model=SettingsOut)
async def patch_settings(
    body: SettingsPatch,
    tenant_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    tid = _effective_tenant_id(user, tenant_id)
    tenant = await db.get(Tenant, tid)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
    tenant.notification_email = body.notification_email
    await db.commit()
    await db.refresh(tenant)
    return tenant
