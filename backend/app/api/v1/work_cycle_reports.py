"""Endpoints del reporte de trabajos (intervenciones): JSON, PDF (VPS) y Excel.

Antes de leer, recomputa (idempotente) las intervenciones del rango pedido para
los vehículos en scope, de modo que los partes salgan para cualquier fecha sin
depender de la ventana rolling del runner programado.
"""
import asyncio
import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_current_user, require_module
from app.core.database import get_db
from app.schemas.auth import CurrentUser
from app.services.cycle_detector import recompute_cycles_for_report
from app.services.work_cycle_report import (
    generate_report_data,
    render_report_pdf,
    render_report_xlsx,
)

logger = logging.getLogger(__name__)

_XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

router = APIRouter(tags=["work_cycle_reports"])


def _resolve_scope(user: CurrentUser, client_id: uuid.UUID | None) -> uuid.UUID | None:
    """Resuelve el tenant_scope read-only del reporte de partes/intervenciones.

    Los partes son PRIVADOS del tenant creador: ningún nivel superior
    (cmg/manufacturer) los ve. Por eso el scope es SIEMPRE `user.tenant_id` —sin
    rama None para cmg—. Como `tenant_scope` nunca es None, el filtro
    `v.tenant_id = :scope` del SQL siempre aplica y cierra la fuga del LEFT JOIN
    a `work_order`.
    """
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
    # Detecta las intervenciones del rango bajo demanda (idempotente) antes de leer.
    # Si falla, seguimos con lo que ya hubiera en BD: el reporte nunca debe romperse.
    try:
        await recompute_cycles_for_report(
            db, from_dt=desde, to_dt=hasta,
            vehicle_id=vehicle_id, client_id=client_id, tenant_scope=scope,
        )
    except Exception as exc:  # noqa: BLE001 — la detección no debe tumbar el reporte
        logger.warning("recompute de partes falló para rango [%s,%s): %s", desde, hasta, exc)
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


def _filename(prefix: str, desde: datetime, hasta: datetime, ext: str) -> str:
    return f"{prefix}_{desde.strftime('%Y%m%d')}_{hasta.strftime('%Y%m%d')}.{ext}"


@router.get("/pdf")
async def get_report_pdf(
    desde: datetime = Query(...),
    hasta: datetime = Query(...),
    vehicle_id: uuid.UUID | None = Query(default=None),
    client_id: uuid.UUID | None = Query(default=None),
    user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_module("reports")),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Descarga del reporte de intervenciones en PDF (formato VPS)."""
    report = await _report_payload(db, user, desde, hasta, vehicle_id, client_id)
    subtitle = "Detección automática de intervenciones (work_cycle)"
    pdf = await asyncio.to_thread(render_report_pdf, report, subtitle=subtitle)
    fname = _filename("parte_trabajos", desde, hasta, "pdf")
    return StreamingResponse(
        iter([pdf]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/xlsx")
async def get_report_xlsx(
    desde: datetime = Query(...),
    hasta: datetime = Query(...),
    vehicle_id: uuid.UUID | None = Query(default=None),
    client_id: uuid.UUID | None = Query(default=None),
    user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_module("reports")),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Descarga del reporte de intervenciones en Excel (.xlsx)."""
    report = await _report_payload(db, user, desde, hasta, vehicle_id, client_id)
    xlsx = await asyncio.to_thread(render_report_xlsx, report)
    fname = _filename("parte_trabajos", desde, hasta, "xlsx")
    return StreamingResponse(
        iter([xlsx]),
        media_type=_XLSX_MEDIA,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
