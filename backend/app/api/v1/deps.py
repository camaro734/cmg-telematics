# backend/app/api/v1/deps.py
import uuid
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import decode_token
from app.models.tenant import Tenant
from app.schemas.auth import CurrentUser

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> CurrentUser:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autenticado")
    try:
        payload = decode_token(credentials.credentials)
        if payload.get("type") != "access":
            raise ValueError("Not an access token")
        return CurrentUser(
            user_id=uuid.UUID(payload["sub"]),
            tenant_id=uuid.UUID(payload["tenant_id"]),
            tenant_tier=payload["tenant_tier"],
            role=payload["role"],
            email=payload["email"],
        )
    except (ValueError, KeyError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido")


def require_role(*roles: str):
    """Dependency factory: requires user to have one of the given roles."""
    async def checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado")
        return user
    return checker


def require_tier(*tiers: str):
    """Dependency factory: requires user's tenant to be one of the given tiers."""
    async def checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.tenant_tier not in tiers:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado")
        return user
    return checker


async def visible_tenant_ids(user: CurrentUser, db: AsyncSession) -> list[uuid.UUID] | None:
    """IDs de tenants visibles para `user`: el suyo + sus descendientes directos.

    Política de descenso (1 nivel), coherente con `assert_can_manage_tenant`:
      - cmg: None  → sin filtro (ve todos los tenants).
      - client (admin del tenant cliente / "jefe de flota"): su tenant + sus
        subclients (`parent_id == user.tenant_id`).
      - manufacturer: su tenant + sus clients (`parent_manufacturer_id == user.tenant_id`).
      - subclient (u otros): solo su propio tenant.

    Es ADITIVO: el filtro previo era `tenant_id == user.tenant_id` (exacto), y este
    siempre incluye ese id; solo añade descendientes. Nunca reduce la visibilidad.
    """
    if user.tenant_tier == "cmg":
        return None
    ids: list[uuid.UUID] = [user.tenant_id]
    if user.tenant_tier == "client":
        res = await db.execute(select(Tenant.id).where(Tenant.parent_id == user.tenant_id))
        ids.extend(res.scalars().all())
    elif user.tenant_tier == "manufacturer":
        res = await db.execute(select(Tenant.id).where(Tenant.parent_manufacturer_id == user.tenant_id))
        ids.extend(res.scalars().all())
    return ids


async def assert_tenant_visible(
    user: CurrentUser,
    target_tenant_id: uuid.UUID,
    db: AsyncSession,
    *,
    status_code: int = status.HTTP_404_NOT_FOUND,
    detail: str = "No encontrado",
) -> None:
    """Lanza si `target_tenant_id` no está en el subárbol visible del usuario.

    cmg pasa siempre. Acceso de lectura/gestión coherente con `visible_tenant_ids`.
    """
    visible = await visible_tenant_ids(user, db)
    if visible is not None and str(target_tenant_id) not in {str(t) for t in visible}:
        raise HTTPException(status_code=status_code, detail=detail)


async def assert_can_manage_tenant(user: CurrentUser, target_tenant_id: uuid.UUID, db) -> None:
    """
    Verifica que `user` (admin) pueda gestionar el tenant `target_tenant_id`:
      - tier=cmg: cualquier tenant.
      - tier=client (admin): su propio tenant o cualquier subclient suyo (parent_id == user.tenant_id).
      - tier=manufacturer (admin): su propio tenant o cualquier client suyo (parent_manufacturer_id == user.tenant_id).
      - tier=subclient (admin): solo su propio tenant.
      - operator/viewer/driver: nunca.
    Lanza 403 si no.
    """
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    if user.tenant_tier == "cmg":
        return
    if str(target_tenant_id) == str(user.tenant_id):
        return
    if user.tenant_tier == "client":
        # cargar el target para ver si es subclient nuestro
        from app.models.tenant import Tenant
        target = await db.get(Tenant, target_tenant_id)
        if target and str(target.parent_id) == str(user.tenant_id):
            return
    if user.tenant_tier == "manufacturer":
        from app.models.tenant import Tenant
        target = await db.get(Tenant, target_tenant_id)
        if target and str(target.parent_manufacturer_id) == str(user.tenant_id):
            return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sin permiso sobre este cliente")


def require_management_tier(*roles: str):
    """Dependency factory: exige tier cmg o manufacturer Y rol en roles.
    Bloquea a client y subclient con 403 — política: SOLO VEN.
    Si no se especifican roles, permite admin y operator.
    """
    allowed_roles = roles or ("admin", "operator")

    async def checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.tenant_tier not in ("cmg", "manufacturer"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado")
        if user.role not in allowed_roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado")
        return user

    return checker


def require_operational_role():
    """Dependency factory: exige role admin u operator de cualquier tier.
    Bloquea a viewer y driver con 403.
    """
    async def checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in ("admin", "operator"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado")
        return user

    return checker


def require_module(*modules: str):
    """Dependency factory: verifica que el tenant tenga activo al menos uno de los módulos.
    Bypass automático para tier=cmg y tier=manufacturer.
    """
    async def checker(
        user: CurrentUser = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> None:
        if user.tenant_tier in ("cmg", "manufacturer"):
            return
        tenant = await db.get(Tenant, user.tenant_id)
        tenant_modules: list[str] = tenant.enabled_modules if tenant else []
        if not any(m in tenant_modules for m in modules):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Módulo no habilitado para este tenant",
            )
    return checker


async def require_plan_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Dependency: exige rol admin de tier cmg o manufacturer.
    client, subclient y roles no-admin obtienen 403.
    Usado en creación, edición y borrado de planes de mantenimiento.
    """
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    if user.tenant_tier not in ("cmg", "manufacturer"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Tier no autorizado para gestionar planes"
        )
    return user


async def assert_can_manage_plan(user: CurrentUser, plan) -> None:
    """
    Verifica que el usuario puede gestionar (editar/borrar) un plan de mantenimiento.

    Política de propiedad:
    - cmg admin: siempre.
    - manufacturer admin: solo si plan.owner_tenant_id == user.tenant_id.
    - client y subclient: 403 (solo lectura en gestión de planes).
    - Cualquier rol no-admin: 403.
    """
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    if user.tenant_tier == "cmg":
        return
    if user.tenant_tier == "manufacturer":
        if str(plan.owner_tenant_id) == str(user.tenant_id):
            return
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sin permiso sobre este plan")
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN, detail="Tier no autorizado para gestionar planes"
    )


async def get_redis(request: Request):
    """Devuelve la conexión Redis de app.state. Inyectable como dependencia FastAPI."""
    return getattr(request.app.state, "redis", None)
