"""Endpoints de destino asignado a un vehículo (ruta + ETA en vivo)."""
import math
import uuid
from datetime import datetime, timezone

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.access_v2 import assert_can_access_vehicle
from app.api.v1.deps import get_current_user, get_redis
from app.core.database import get_db
from app.models.vehicle_destination import VehicleDestination
from app.schemas.auth import CurrentUser
from app.schemas.destination import DestinationIn, DestinationOut, ReverseGeoOut, RouteInfo
from app.services.geocoding import GeoResult, nominatim_reverse, nominatim_search
from app.services.routing import valhalla_route

router = APIRouter()
logger = logging.getLogger(__name__)

ARRIVAL_RADIUS_M = 100.0


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distancia en metros entre dos (lat, lon)."""
    r = 6371000.0
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _parse_float(v) -> float | None:
    """Convierte valor Redis (bytes o str) a float; None si inválido."""
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


async def _get_vehicle_latlon(redis, vehicle_id: uuid.UUID) -> tuple[float, float] | None:
    """Última posición conocida desde el hash Redis vehicle:{id}:status."""
    data = await redis.hgetall(f"vehicle:{vehicle_id}:status")
    if not data:
        return None
    # Redis puede devolver bytes o str dependiendo de decode_responses
    get = lambda k: data.get(k) or data.get(k.encode())  # noqa: E731
    lat, lon = _parse_float(get("lat")), _parse_float(get("lon"))
    if lat is None or lon is None:
        return None
    return (lat, lon)


@router.post("/vehicles/{vehicle_id}/destination", response_model=DestinationOut)
async def set_destination(
    vehicle_id: uuid.UUID,
    body: DestinationIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DestinationOut:
    """Asigna o sobreescribe el destino activo de un vehículo."""
    vehicle = await assert_can_access_vehicle(user, vehicle_id, db, operation="write", scope="operational")
    result = await db.execute(
        select(VehicleDestination).where(VehicleDestination.vehicle_id == vehicle_id)
    )
    dest = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if dest is None:
        dest = VehicleDestination(
            id=uuid.uuid4(),
            tenant_id=vehicle.tenant_id,
            vehicle_id=vehicle_id,
            label=body.label,
            lat=body.lat,
            lon=body.lon,
            status="active",
            assigned_by=user.user_id,
            assigned_at=now,
        )
        db.add(dest)
    else:
        dest.label, dest.lat, dest.lon = body.label, body.lat, body.lon
        dest.status = "active"
        dest.arrived_at = None
        dest.assigned_by = user.user_id
        dest.assigned_at = now
    await db.commit()
    return DestinationOut(
        vehicle_id=dest.vehicle_id,
        label=dest.label,
        lat=dest.lat,
        lon=dest.lon,
        status=dest.status,
        assigned_at=dest.assigned_at,
        arrived_at=dest.arrived_at,
    )


@router.delete("/vehicles/{vehicle_id}/destination", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_destination(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Cancela el destino activo de un vehículo."""
    await assert_can_access_vehicle(user, vehicle_id, db, operation="write", scope="operational")
    result = await db.execute(
        select(VehicleDestination).where(VehicleDestination.vehicle_id == vehicle_id)
    )
    dest = result.scalar_one_or_none()
    if dest is not None:
        dest.status = "cancelled"
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/vehicles/{vehicle_id}/destination", response_model=DestinationOut)
async def get_destination(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
) -> DestinationOut:
    """Devuelve el destino activo con ruta restante y ETA (si posición disponible)."""
    await assert_can_access_vehicle(user, vehicle_id, db, operation="read", scope="operational")
    result = await db.execute(
        select(VehicleDestination).where(
            VehicleDestination.vehicle_id == vehicle_id,
            VehicleDestination.status == "active",
        )
    )
    dest = result.scalar_one_or_none()
    if dest is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sin destino activo")

    out = DestinationOut(
        vehicle_id=dest.vehicle_id,
        label=dest.label,
        lat=dest.lat,
        lon=dest.lon,
        status=dest.status,
        assigned_at=dest.assigned_at,
        arrived_at=dest.arrived_at,
    )
    pos = await _get_vehicle_latlon(redis, vehicle_id)
    if pos is None:
        return out

    # Detección de llegada: si el vehículo está dentro del radio de llegada
    if _haversine_m(pos, (dest.lat, dest.lon)) <= ARRIVAL_RADIUS_M:
        now = datetime.now(timezone.utc)
        # Siempre informamos llegada en la respuesta (todos los lectores la ven)
        out.status = "arrived"
        out.arrived_at = now

        # Solo persistimos si el caller tiene permiso de escritura.
        # Un GET es read-only para lectores; no debe mutar la BD en su nombre.
        can_write = False
        try:
            await assert_can_access_vehicle(user, vehicle_id, db, operation="write", scope="operational")
            can_write = True
        except HTTPException:
            pass  # lector sin permisos de escritura → solo respuesta transitoria

        if can_write:
            dest.status = "arrived"
            dest.arrived_at = now
            await db.commit()

        return out

    try:
        route = await valhalla_route(pos, (dest.lat, dest.lon))
        out.route = RouteInfo(**route.model_dump())
        out.remaining_distance_m = route.distance_m
        out.remaining_duration_s = route.duration_s
    except Exception as exc:  # noqa: BLE001 — Valhalla caído no debe romper el GET del destino
        logger.warning("valhalla_route_failed vehicle_id=%s error=%s", vehicle_id, exc)
    return out


@router.get("/geocode", response_model=list[GeoResult])
async def geocode(
    q: str = Query(..., min_length=2),
    limit: int = Query(5, ge=1, le=10),
    user: CurrentUser = Depends(get_current_user),
) -> list[GeoResult]:
    """Proxy a Nominatim: búsqueda de ubicación por texto libre."""
    return await nominatim_search(q, limit=limit)


@router.get("/reverse-geocode", response_model=ReverseGeoOut)
async def reverse_geocode(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    user: CurrentUser = Depends(get_current_user),
    redis=Depends(get_redis),
) -> ReverseGeoOut:
    """Proxy a Nominatim (inverso): (lat, lon) → dirección textual.

    Cachea en Redis por coordenada redondeada a 5 decimales (~1 m) para no
    repetir peticiones sobre la misma posición y respetar el rate-limit de
    Nominatim. Si Nominatim falla, devuelve address vacío (nunca 500).
    """
    # Redondeo a 5 decimales: agrupa jitter GPS y maximiza aciertos de caché.
    cache_key = f"revgeo:{lat:.5f}:{lon:.5f}"
    try:
        cached = await redis.get(cache_key)
    except Exception as exc:  # noqa: BLE001 — Redis caído no debe romper el geocode
        logger.warning("revgeo_cache_read_failed error=%s", exc)
        cached = None
    if cached is not None:
        return ReverseGeoOut(address=cached or None)

    try:
        address = await nominatim_reverse(lat, lon)
    except Exception as exc:  # noqa: BLE001 — Nominatim caído → dirección vacía, no 500
        logger.warning("reverse_geocode_failed lat=%s lon=%s error=%s", lat, lon, exc)
        address = None

    # Cachea también el "sin resultado" (cadena vacía) para no reintentar en bucle.
    # TTL 1 día: una dirección física no cambia; ahorra peticiones a Nominatim.
    try:
        await redis.set(cache_key, address or "", ex=86400)
    except Exception as exc:  # noqa: BLE001
        logger.warning("revgeo_cache_write_failed error=%s", exc)

    return ReverseGeoOut(address=address)


@router.get("/route", response_model=RouteInfo)
async def route(
    from_lat: float = Query(..., ge=-90, le=90),
    from_lon: float = Query(..., ge=-180, le=180),
    to_lat: float = Query(..., ge=-90, le=90),
    to_lon: float = Query(..., ge=-180, le=180),
    user: CurrentUser = Depends(get_current_user),
) -> RouteInfo:
    """Proxy a Valhalla: previsualización de ruta libre entre dos puntos."""
    result = await valhalla_route((from_lat, from_lon), (to_lat, to_lon))
    return RouteInfo(**result.model_dump())
