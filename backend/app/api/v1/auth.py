# backend/app/api/v1/auth.py
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import verify_password, create_access_token, create_refresh_token, decode_token
from app.models.user import User
from app.models.tenant import Tenant
from app.schemas.auth import LoginRequest, TokenResponse, RefreshRequest, LogoutRequest, CurrentUser
from app.api.v1.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])

_LOGIN_MAX_ATTEMPTS = 10
_LOGIN_WINDOW_SECONDS = 900  # 15 minutos


async def _check_login_rate_limit(request: Request) -> None:
    """Rate limit: máx 5 intentos de login por IP en 15 minutos."""
    redis = getattr(request.app.state, "redis", None)
    if redis is None:
        return
    ip = request.client.host if request.client else "unknown"
    key = f"ratelimit:login:{ip}"
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, _LOGIN_WINDOW_SECONDS)
    if count > _LOGIN_MAX_ATTEMPTS:
        ttl = await redis.ttl(key)
        retry_after = str(ttl) if ttl > 0 else str(_LOGIN_WINDOW_SECONDS)
        minutes = max(1, int(ttl / 60) + 1) if ttl > 0 else 15
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Demasiados intentos. Inténtalo de nuevo en {minutes} minuto{'s' if minutes != 1 else ''}.",
            headers={"Retry-After": retry_after},
        )


async def _check_jti_revoked(request: Request, jti: str | None) -> None:
    """Lanza 401 si el JTI del refresh token está en la blacklist de Redis."""
    if not jti:
        return
    redis = getattr(request.app.state, "redis", None)
    if redis and await redis.exists(f"auth:revoked:{jti}"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revocado")


@router.post("/login", response_model=TokenResponse)
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)):
    await _check_login_rate_limit(request)
    result = await db.execute(select(User).where(User.email == body.email, User.active == True))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales incorrectas")

    t_result = await db.execute(select(Tenant.id, Tenant.tier, Tenant.logo_url, Tenant.brand_name, Tenant.enabled_modules).where(Tenant.id == user.tenant_id))
    tenant_row = t_result.mappings().one_or_none()
    if tenant_row is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error interno")
    payload = {
        "sub": str(user.id),
        "tenant_id": str(user.tenant_id),
        "tenant_tier": tenant_row["tier"],
        "role": user.role,
        "email": user.email,
    }
    return TokenResponse(
        access_token=create_access_token(payload),
        refresh_token=create_refresh_token(payload),
        logo_url=tenant_row["logo_url"],
        brand_name=tenant_row["brand_name"],
        enabled_modules=tenant_row["enabled_modules"] or [],
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: Request, body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise ValueError("Not a refresh token")
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido")

    await _check_jti_revoked(request, payload.get("jti"))

    result = await db.execute(
        select(User).where(User.id == uuid.UUID(payload["sub"]), User.active == True)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido")

    t_result2 = await db.execute(select(Tenant.id, Tenant.tier, Tenant.logo_url, Tenant.brand_name, Tenant.enabled_modules).where(Tenant.id == user.tenant_id))
    tenant_row2 = t_result2.mappings().one_or_none()
    if tenant_row2 is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido")

    new_payload = {
        "sub": str(user.id),
        "tenant_id": str(user.tenant_id),
        "tenant_tier": tenant_row2["tier"],
        "role": user.role,
        "email": user.email,
    }
    return TokenResponse(
        access_token=create_access_token(new_payload),
        refresh_token=create_refresh_token(new_payload),
        logo_url=tenant_row2["logo_url"],
        brand_name=tenant_row2["brand_name"],
        enabled_modules=tenant_row2["enabled_modules"] or [],
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, body: LogoutRequest):
    """Revoca el refresh token añadiendo su JTI a la blacklist de Redis."""
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            return
    except ValueError:
        return  # token ya expirado o inválido — nada que revocar

    jti = payload.get("jti")
    exp = payload.get("exp")
    redis = getattr(request.app.state, "redis", None)
    if redis and jti and exp:
        ttl = int(exp - datetime.now(timezone.utc).timestamp())
        if ttl > 0:
            await redis.set(f"auth:revoked:{jti}", "1", ex=ttl)


@router.get("/me")
async def get_me(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, current_user.tenant_id)
    return {
        "tenant_id": str(current_user.tenant_id),
        "tier": current_user.tenant_tier,
        "enabled_modules": tenant.enabled_modules if tenant else [],
    }
