# backend/app/api/v1/fleet.py
"""KPIs agregados de flota para el Dashboard.

Suma horas de motor, horas PTO y vehículos activos a partir del continuous
aggregate `telemetry_1h`. Pensado para mostrar el estado operativo total
en el primer pantallazo del producto.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser

router = APIRouter(prefix="/fleet", tags=["fleet"])


_RANGE_DAYS = {"1d": 1, "7d": 7, "30d": 30}


@router.get("/kpis")
async def get_fleet_kpis(
    range: str = Query("7d", description="Rango: 1d, 7d, 30d"),
    tenant_id: str | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    days = _RANGE_DAYS.get(range)
    if days is None:
        raise HTTPException(status_code=400, detail="range inválido — usar 1d, 7d o 30d")

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)

    # Determinar tenant: CMG admin puede consultar uno concreto o ver agregado global;
    # el resto siempre filtrado por su propio tenant.
    if user.tenant_tier == "cmg":
        effective_tenant = tenant_id  # puede ser None → todos los tenants
    else:
        effective_tenant = str(user.tenant_id)

    where_extra = "AND tenant_id = :tenant_id" if effective_tenant else ""
    params: dict = {"start": start, "end": end}
    if effective_tenant:
        params["tenant_id"] = effective_tenant

    # Totales del rango
    totals_sql = f"""
        SELECT
            COALESCE(SUM(engine_on_minutes), 0) AS engine_minutes,
            COALESCE(SUM(pto_active_minutes), 0) AS pto_minutes,
            COUNT(DISTINCT vehicle_id) AS active_vehicles
        FROM telemetry_1h
        WHERE bucket >= :start AND bucket < :end {where_extra}
    """
    row = (await db.execute(text(totals_sql), params)).one()

    # Serie diaria para gráfica
    daily_sql = f"""
        SELECT
            time_bucket('1 day', bucket) AS day,
            COALESCE(SUM(engine_on_minutes), 0) AS engine_minutes,
            COALESCE(SUM(pto_active_minutes), 0) AS pto_minutes
        FROM telemetry_1h
        WHERE bucket >= :start AND bucket < :end {where_extra}
        GROUP BY day
        ORDER BY day ASC
    """
    daily_rows = (await db.execute(text(daily_sql), params)).all()

    return {
        "range": range,
        "engine_hours": round(float(row.engine_minutes) / 60.0, 1),
        "pto_hours": round(float(row.pto_minutes) / 60.0, 1),
        "active_vehicles": int(row.active_vehicles),
        "by_day": [
            {
                "date": r.day.date().isoformat(),
                "engine_hours": round(float(r.engine_minutes) / 60.0, 1),
                "pto_hours": round(float(r.pto_minutes) / 60.0, 1),
            }
            for r in daily_rows
        ],
    }
