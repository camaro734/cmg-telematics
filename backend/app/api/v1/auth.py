# backend/app/api/v1/auth.py
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

_STATIC_ROOT = Path("/app/static") if Path("/app/static").exists() else Path(__file__).parents[3] / "static"

def _versioned_url(url: str | None) -> str | None:
    """Añade ?v=<mtime_unix> a URLs /static/* locales para invalidar caché del navegador."""
    if not url or not url.startswith("/static/"):
        return url
    try:
        mtime = int(os.path.getmtime(_STATIC_ROOT / url[len("/static/"):]))
        return f"{url}?v={mtime}"
    except OSError:
        return url

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import attributes

from app.core.database import get_db
from app.core.security import verify_password, create_access_token, create_refresh_token, decode_token, hash_password
from app.models.user import User
from app.models.tenant import Tenant
from app.api.v1.access_v2 import tenant_can_actuate_controls
from app.schemas.auth import LoginRequest, TokenResponse, RefreshRequest, LogoutRequest, CurrentUser, ForgotPasswordRequest, ResetPasswordRequest
from app.core.reset_token import generate_reset_token, reset_key_for
from app.core.reset_mailer import enqueue_reset_email
from app.schemas.user import MetricPreferences, UserPreferencesIn, UserPreferencesOut
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


_RESET_TOKEN_TTL = 3600  # 1 hora
_RESET_MAX_ATTEMPTS = 5
_RESET_WINDOW_SECONDS = 900
_RESET_GENERIC_MSG = "Si el correo está registrado, recibirás un enlace para restablecer la contraseña."


async def _check_reset_rate_limit(request: Request, suffix: str) -> None:
    """Rate limit para recuperación: máx 5 solicitudes por clave en 15 min."""
    redis = getattr(request.app.state, "redis", None)
    if redis is None:
        return
    key = f"ratelimit:pwreset:{suffix}"
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, _RESET_WINDOW_SECONDS)
    if count > _RESET_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiadas solicitudes. Inténtalo de nuevo más tarde.",
        )


@router.post("/reset-password")
async def reset_password(request: Request, body: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    await _check_reset_rate_limit(request, f"ip:{ip}")

    redis = getattr(request.app.state, "redis", None)
    key = reset_key_for(body.token)
    user_id = await redis.get(key) if redis is not None else None
    if not user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El enlace no es válido o ha caducado.")
    if isinstance(user_id, bytes):
        user_id = user_id.decode()

    user = await db.get(User, uuid.UUID(user_id))
    if user is None:
        await redis.delete(key)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El enlace no es válido o ha caducado.")

    user.hashed_password = hash_password(body.new_password)
    user.pwd_version = (user.pwd_version or 0) + 1  # invalida todos los JWT activos
    await db.commit()
    await redis.delete(key)  # token de un solo uso
    return {"detail": "Contraseña actualizada."}


@router.post("/forgot-password")
async def forgot_password(request: Request, body: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    await _check_reset_rate_limit(request, f"ip:{ip}")
    await _check_reset_rate_limit(request, f"email:{body.email}")

    result = await db.execute(select(User).where(User.email == body.email, User.active == True))
    user = result.scalar_one_or_none()
    redis = getattr(request.app.state, "redis", None)
    if user is not None and redis is not None:
        token, key = generate_reset_token()
        await redis.set(key, str(user.id), ex=_RESET_TOKEN_TTL)
        await enqueue_reset_email(redis, body.email, token)
    # Respuesta SIEMPRE genérica (no revela si el email existe)
    return {"detail": _RESET_GENERIC_MSG}


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

    t_result = await db.execute(select(Tenant.id, Tenant.tier, Tenant.logo_url, Tenant.brand_name, Tenant.enabled_modules, Tenant.parent_id).where(Tenant.id == user.tenant_id))
    tenant_row = t_result.mappings().one_or_none()
    if tenant_row is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error interno")
    effective_logo = tenant_row["logo_url"]
    if not effective_logo and tenant_row["parent_id"]:
        parent = await db.get(Tenant, tenant_row["parent_id"])
        if parent and parent.logo_url:
            effective_logo = parent.logo_url
    payload = {
        "sub": str(user.id),
        "tenant_id": str(user.tenant_id),
        "tenant_tier": tenant_row["tier"],
        "role": user.role,
        "email": user.email,
        "pwd_version": user.pwd_version,
    }
    return TokenResponse(
        access_token=create_access_token(payload),
        refresh_token=create_refresh_token(payload),
        logo_url=_versioned_url(effective_logo),
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

    token_pwd_version = payload.get("pwd_version")
    if token_pwd_version is None or token_pwd_version != user.pwd_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revocado")

    t_result2 = await db.execute(select(Tenant.id, Tenant.tier, Tenant.logo_url, Tenant.brand_name, Tenant.enabled_modules, Tenant.parent_id).where(Tenant.id == user.tenant_id))
    tenant_row2 = t_result2.mappings().one_or_none()
    if tenant_row2 is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido")
    effective_logo2 = tenant_row2["logo_url"]
    if not effective_logo2 and tenant_row2["parent_id"]:
        parent2 = await db.get(Tenant, tenant_row2["parent_id"])
        if parent2 and parent2.logo_url:
            effective_logo2 = parent2.logo_url

    new_payload = {
        "sub": str(user.id),
        "tenant_id": str(user.tenant_id),
        "tenant_tier": tenant_row2["tier"],
        "role": user.role,
        "email": user.email,
        "pwd_version": user.pwd_version,
    }
    old_exp = payload.get("exp")
    refresh_expires_at = (
        datetime.fromtimestamp(old_exp, tz=timezone.utc)
        if old_exp else None
    )
    return TokenResponse(
        access_token=create_access_token(new_payload),
        refresh_token=create_refresh_token(new_payload, expires_at=refresh_expires_at),
        logo_url=_versioned_url(effective_logo2),
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
        "manufacturer_can_manage_clients": bool(getattr(tenant, "manufacturer_can_manage_clients", False)) if tenant else False,
        "manufacturer_can_transfer_vehicles": bool(getattr(tenant, "manufacturer_can_transfer_vehicles", False)) if tenant else False,
        "can_actuate_controls": tenant_can_actuate_controls(current_user.tenant_tier, tenant),
    }


@router.get("/me/preferences", response_model=UserPreferencesOut)
async def get_preferences(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, current_user.user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    prefs = user.preferences or {}
    hm = prefs.get("historic_metrics", {})
    so = prefs.get("sensor_order", {})
    return UserPreferencesOut(
        historic_metrics={
            type_id: MetricPreferences(keys=entry["keys"])
            for type_id, entry in hm.items()
            if isinstance(entry, dict) and entry.get("keys") is not None
        },
        sensor_order={
            type_id: keys
            for type_id, keys in so.items()
            if isinstance(keys, list)
        },
    )


@router.patch("/me/preferences", response_model=UserPreferencesOut)
async def patch_preferences(
    body: UserPreferencesIn,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, current_user.user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    prefs = user.preferences or {}
    existing_hm: dict = dict(prefs.get("historic_metrics", {}))
    for type_id, metric_pref in body.historic_metrics.items():
        if metric_pref.keys is None:
            existing_hm.pop(type_id, None)
        else:
            existing_hm[type_id] = {"keys": metric_pref.keys}

    existing_so: dict = dict(prefs.get("sensor_order", {}))
    for type_id, keys in body.sensor_order.items():
        if keys is None:
            existing_so.pop(type_id, None)
        else:
            existing_so[type_id] = keys

    # Merge de ambas claves: nunca pisar una preferencia con la otra.
    user.preferences = {"historic_metrics": existing_hm, "sensor_order": existing_so}
    attributes.flag_modified(user, "preferences")
    await db.commit()
    return UserPreferencesOut(
        historic_metrics={
            type_id: MetricPreferences(keys=entry["keys"])
            for type_id, entry in existing_hm.items()
            if isinstance(entry, dict) and entry.get("keys") is not None
        },
        sensor_order={
            type_id: keys
            for type_id, keys in existing_so.items()
            if isinstance(keys, list)
        },
    )
