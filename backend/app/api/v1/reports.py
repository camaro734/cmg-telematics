import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.models.permission_grant import PermissionGrant
from app.models.tenant import Tenant
from app.models.vehicle import Vehicle
from app.schemas.auth import CurrentUser
from app.services.report_generator import generate_monthly_pdf

router = APIRouter(tags=["reports"])


@router.get("/monthly")
async def get_monthly_report(
    year: int = Query(...),
    month: int = Query(...),
    vehicle_ids: list[uuid.UUID] = Query(default=[]),
    tenant_id: uuid.UUID | None = Query(default=None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    # Validar rango de año y mes
    if not (2020 <= year <= 2100):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="year debe estar entre 2020 y 2100")
    if not (1 <= month <= 12):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="month debe estar entre 1 y 12")
    if len(vehicle_ids) > 15:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Máximo 15 vehículos por informe")

    # Resolver tenant efectivo según el rol y tier del usuario
    effective_tid: uuid.UUID

    if user.tenant_tier == "cmg" and user.role == "admin":
        # CMG admin puede generar informes para cualquier tenant
        if tenant_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tenant_id requerido para CMG admin")
        result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
        if result.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")
        effective_tid = tenant_id

    elif user.role == "admin":
        # Client admin: usa siempre su propio tenant, ignora el parámetro tenant_id
        if tenant_id is not None and tenant_id != user.tenant_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado para este tenant")
        effective_tid = user.tenant_id

    else:
        # Subclient u otros: requiere permission_grant activo con resource_type='reports'
        now = datetime.now(timezone.utc)
        result = await db.execute(
            select(PermissionGrant).where(
                PermissionGrant.grantee_id == user.tenant_id,
                PermissionGrant.resource_type == "reports",
                PermissionGrant.active == True,
                or_(PermissionGrant.expires_at.is_(None), PermissionGrant.expires_at > now),
            )
        )
        grant = result.scalar_one_or_none()
        if grant is None or "read" not in (grant.allowed_actions or []):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sin permiso para generar informes")
        effective_tid = grant.grantor_id

    # Resolver vehicle_ids: si no se pasan, tomar los primeros 15 activos ordenados por nombre
    resolved_vehicle_ids: list[uuid.UUID]
    if not vehicle_ids:
        result = await db.execute(
            select(Vehicle.id)
            .where(Vehicle.tenant_id == effective_tid, Vehicle.active == True)
            .order_by(Vehicle.name)
            .limit(15)
        )
        resolved_vehicle_ids = list(result.scalars().all())
    else:
        resolved_vehicle_ids = list(vehicle_ids)

    pdf_bytes = await generate_monthly_pdf(
        db=db,
        tenant_id=effective_tid,
        year=year,
        month=month,
        vehicle_ids=resolved_vehicle_ids,
    )

    filename = f"informe-{year}-{month:02d}.pdf"
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
