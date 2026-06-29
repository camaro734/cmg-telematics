"""Optimizador de rutas (stateless): reordena paradas por camino más corto.

No persiste nada. Resuelve origen/destino (base del tenant, posición del camión,
o coordenadas) y delega en Valhalla ``/optimized_route``.
"""
import logging
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.access_v2 import assert_can_access_vehicle
from app.api.v1.deps import get_current_user, get_redis
from app.api.v1.destinations import _get_vehicle_latlon
from app.core.database import get_db
from app.models.tenant import Tenant
from app.schemas.auth import CurrentUser
from app.schemas.route import OptimizeIn, OptimizeOut, RoutePoint
from app.services.routing import valhalla_optimize

router = APIRouter(tags=["routes"])
logger = logging.getLogger(__name__)


async def _resolve_point(
    point: RoutePoint,
    user: CurrentUser,
    db: AsyncSession,
    redis,
    *,
    what: str,
) -> tuple[float, float]:
    """Traduce un RoutePoint a (lat, lon). Lanza 400 con mensaje claro si no se puede."""
    if point.type == "base":
        tenant = await db.get(Tenant, user.tenant_id)
        if not tenant or tenant.base_lat is None or tenant.base_lon is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No has configurado la base de tu empresa. Ve a Ajustes → Mi base para fijarla ({what}).",
            )
        return (tenant.base_lat, tenant.base_lon)

    if point.type == "vehicle":
        if point.vehicle_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Falta vehicle_id")
        # Respeta el control de acceso al vehículo.
        await assert_can_access_vehicle(user, point.vehicle_id, db, operation="read", scope="operational")
        latlon = await _get_vehicle_latlon(redis, point.vehicle_id)
        if latlon is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"El camión no tiene una posición conocida todavía ({what}).",
            )
        return latlon

    # coords / address
    if point.lat is None or point.lon is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Faltan coordenadas ({what}).")
    return (point.lat, point.lon)


@router.post("/routes/optimize", response_model=OptimizeOut)
async def optimize_route(
    body: OptimizeIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """Reordena las paradas por el camino más corto entre origen y destino.

    El origen y el destino quedan fijos; solo se reordenan las paradas intermedias.
    Devuelve el orden óptimo de las paradas, la distancia/tiempo totales y la
    geometría de la ruta (ya decodificada) para dibujarla.
    """
    if len(body.stops) < 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Añade al menos una parada para optimizar")

    origin = await _resolve_point(body.origin, user, db, redis, what="salida")
    dest = await _resolve_point(body.destination, user, db, redis, what="llegada")
    stops = [(s.lat, s.lon) for s in body.stops]

    try:
        order, result = await valhalla_optimize(origin, stops, dest)
    except (httpx.HTTPError, KeyError) as exc:
        logger.warning("optimize_route: fallo Valhalla: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="No se pudo calcular la ruta optimizada ahora mismo. Inténtalo de nuevo.",
        )

    return OptimizeOut(
        order=order,
        distance_m=result.distance_m,
        duration_s=result.duration_s,
        geometry=result.geometry,
    )
