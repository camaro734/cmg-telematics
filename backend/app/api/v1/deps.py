# backend/app/api/v1/deps.py
import uuid
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.security import decode_token
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
