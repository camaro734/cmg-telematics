import logging
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_current_user, get_redis
from app.core.database import get_db
from app.models.location_access_grant import LocationAccessGrant
from app.models.tenant import Tenant
from app.models.vehicle import Vehicle
from app.schemas.auth import CurrentUser

logger = logging.getLogger(__name__)
router = APIRouter(tags=["location_grant"])


async def _cascade_grant_ids(db, tenant_id: uuid.UUID) -> list[uuid.UUID]:
    """[tenant_id, su parent en cadena, su grandparent, ...] hasta llegar a CMG.

    Determina qué grants deben borrarse en cascada al revocar: el propio +
    todos los de los eslabones superiores que dependen de él.
    """
    ids: list[uuid.UUID] = [tenant_id]
    current_id = tenant_id
    for _ in range(3):
        t = await db.get(Tenant, current_id)
        if not t:
            break
        next_id = t.parent_manufacturer_id or t.parent_id
        if not next_id:
            break
        ids.append(next_id)
        current_id = next_id
    return ids


async def _refresh_vehicle_viewers_cache(db, redis, vehicle_id: uuid.UUID) -> None:
    """Recalcula loc_viewers:{vehicle_id} desde los grants actuales en BD.

    Llamar tras POST o DELETE para que el cambio surta efecto sin esperar el refresher.
    """
    result = await db.execute(
        select(
            LocationAccessGrant.granting_tenant_id,
            Tenant.tier,
            Tenant.parent_manufacturer_id,
        )
        .join(Tenant, Tenant.id == LocationAccessGrant.granting_tenant_id)
        .where(LocationAccessGrant.vehicle_id == vehicle_id)
    )
    rows = result.all()

    viewers: set[str] = set()
    for row in rows:
        if row.tier == "client" and row.parent_manufacturer_id:
            viewers.add(str(row.parent_manufacturer_id))
        elif row.tier == "manufacturer":
            viewers.add("__cmg__")

    pipe = redis.pipeline()
    vid = str(vehicle_id)
    pipe.delete(f"loc_viewers:{vid}")
    if viewers:
        pipe.sadd(f"loc_viewers:{vid}", *viewers)
        pipe.expire(f"loc_viewers:{vid}", 120)
    await pipe.execute()


@router.post(
    "/vehicles/{vehicle_id}/location-grant",
    status_code=status.HTTP_201_CREATED,
    summary="Conceder acceso de ubicación al nivel superior",
)
async def grant_location_access(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
) -> dict:
    """Concede al parent del usuario el derecho a ver la ubicación del vehículo.

    Quién puede conceder:
    - El dueño del vehículo (vehicle.tenant_id == user.tenant_id).
    - Un intermediario que ya recibió el grant del eslabón inferior.
    CMG no puede conceder (no hay nivel superior).
    """
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vehículo no encontrado")

    if user.tenant_tier == "cmg":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "CMG no tiene nivel superior al que conceder"
        )

    is_owner = str(vehicle.tenant_id) == str(user.tenant_id)

    if not is_owner:
        # Verificar que el user ya tiene un grant recibido:
        # existe un grant cuyo granting_tenant tiene como parent a user.tenant_id.
        received = await db.execute(
            select(LocationAccessGrant)
            .join(Tenant, Tenant.id == LocationAccessGrant.granting_tenant_id)
            .where(
                LocationAccessGrant.vehicle_id == vehicle_id,
                or_(
                    Tenant.parent_manufacturer_id == user.tenant_id,
                    Tenant.parent_id == user.tenant_id,
                ),
            )
            .limit(1)
        )
        if not received.scalar_one_or_none():
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Sin permiso para conceder: no has recibido este acceso",
            )

    # Idempotencia: 409 si el grant propio ya existe
    existing = await db.execute(
        select(LocationAccessGrant).where(
            LocationAccessGrant.vehicle_id == vehicle_id,
            LocationAccessGrant.granting_tenant_id == user.tenant_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "El grant ya existe")

    db.add(LocationAccessGrant(vehicle_id=vehicle_id, granting_tenant_id=user.tenant_id))
    await db.flush()

    if redis:
        await _refresh_vehicle_viewers_cache(db, redis, vehicle_id)

    await db.commit()
    logger.info("location_grant_created vehicle_id=%s granting=%s", vehicle_id, user.tenant_id)
    return {"vehicle_id": str(vehicle_id), "granting_tenant_id": str(user.tenant_id)}


@router.delete(
    "/vehicles/{vehicle_id}/location-grant",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revocar acceso de ubicación (con cascada hacia arriba)",
)
async def revoke_location_access(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
) -> None:
    """Revoca el grant propio y en cascada los de los eslabones superiores.

    Al revocar, los grants de los ancestors (que dependen del grant revocado)
    también se eliminan en la misma transacción para evitar grants huérfanos.
    """
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vehículo no encontrado")

    # Verificar que el usuario tiene su propio grant que revocar
    own_grant = await db.execute(
        select(LocationAccessGrant).where(
            LocationAccessGrant.vehicle_id == vehicle_id,
            LocationAccessGrant.granting_tenant_id == user.tenant_id,
        )
    )
    if not own_grant.scalar_one_or_none():
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "No existe un grant que puedas revocar"
        )

    # DELETE en cascada: el propio + todos los ancestors de la cadena
    cascade_ids = await _cascade_grant_ids(db, user.tenant_id)
    await db.execute(
        delete(LocationAccessGrant).where(
            LocationAccessGrant.vehicle_id == vehicle_id,
            LocationAccessGrant.granting_tenant_id.in_(cascade_ids),
        )
    )

    if redis:
        await _refresh_vehicle_viewers_cache(db, redis, vehicle_id)

    await db.commit()
    logger.info(
        "location_grant_revoked vehicle_id=%s revoker=%s cascade_count=%d",
        vehicle_id, user.tenant_id, len(cascade_ids),
    )


@router.get(
    "/vehicles/{vehicle_id}/location-grant/status",
    summary="Estado de privacidad de ubicación para el usuario actual",
)
async def get_location_grant_status(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Devuelve el estado de los grants de ubicación para el usuario actual.

    current_level: saltos hacia arriba en la cadena que tienen acceso.
      0 → Privada (solo propietario).
      1 → Acceso nivel 1 (proveedor directo puede ver).
      2 → Acceso nivel 2 (proveedor directo + administración pueden ver).
    can_grant: True si el usuario puede conceder (dueño, o intermediario con grant recibido).
    has_granted: True si el usuario ya tiene su propio grant activo.
    """
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vehículo no encontrado")

    count_result = await db.execute(
        select(func.count()).select_from(LocationAccessGrant).where(
            LocationAccessGrant.vehicle_id == vehicle_id
        )
    )
    current_level: int = count_result.scalar() or 0

    own_result = await db.execute(
        select(LocationAccessGrant).where(
            LocationAccessGrant.vehicle_id == vehicle_id,
            LocationAccessGrant.granting_tenant_id == user.tenant_id,
        )
    )
    has_granted: bool = own_result.scalar_one_or_none() is not None

    is_owner = str(vehicle.tenant_id) == str(user.tenant_id)
    if is_owner:
        can_grant = True
    elif user.tenant_tier == "cmg":
        can_grant = False
    else:
        received = await db.execute(
            select(LocationAccessGrant)
            .join(Tenant, Tenant.id == LocationAccessGrant.granting_tenant_id)
            .where(
                LocationAccessGrant.vehicle_id == vehicle_id,
                or_(
                    Tenant.parent_manufacturer_id == user.tenant_id,
                    Tenant.parent_id == user.tenant_id,
                ),
            )
            .limit(1)
        )
        can_grant = received.scalar_one_or_none() is not None

    return {"current_level": current_level, "can_grant": can_grant, "has_granted": has_granted}
