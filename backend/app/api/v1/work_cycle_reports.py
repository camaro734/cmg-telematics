"""Endpoints del reporte de trabajos (intervenciones): JSON, PDF (VPS) y Excel.

Solo lectura: el reporte nunca escribe en las intervenciones ni en producción.
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_current_user, require_module
from app.core.database import get_db
from app.schemas.auth import CurrentUser
from app.services.work_cycle_report import generate_report_data

router = APIRouter(tags=["work_cycle_reports"])


def _resolve_scope(user: CurrentUser, client_id: uuid.UUID | None) -> uuid.UUID | None:
    """Resuelve el tenant_scope read-only según rol/tier (CMG ve todo; resto su tenant)."""
    if user.tenant_tier == "cmg" and user.role == "admin":
        return None  # CMG admin: sin restricción (client_id filtra opcionalmente)
    return user.tenant_id


async def _report_payload(
    db: AsyncSession,
    user: CurrentUser,
    desde: datetime,
    hasta: datetime,
    vehicle_id: uuid.UUID | None,
    client_id: uuid.UUID | None,
) -> dict:
    if hasta <= desde:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="'hasta' debe ser posterior a 'desde'")
    scope = _resolve_scope(user, client_id)
    return await generate_report_data(
        db, from_dt=desde, to_dt=hasta,
        vehicle_id=vehicle_id, client_id=client_id, tenant_scope=scope,
    )


@router.get("/data")
async def get_report_data(
    desde: datetime = Query(..., description="Inicio del rango (ISO8601)"),
    hasta: datetime = Query(..., description="Fin del rango (ISO8601)"),
    vehicle_id: uuid.UUID | None = Query(default=None),
    client_id: uuid.UUID | None = Query(default=None),
    user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_module("reports")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Datos del reporte de intervenciones en JSON (para verificar antes de formatear)."""
    return await _report_payload(db, user, desde, hasta, vehicle_id, client_id)
