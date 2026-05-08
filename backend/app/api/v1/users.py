import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.api.v1.deps import get_current_user, assert_can_manage_tenant
from app.schemas.auth import CurrentUser
from app.schemas.user import UserOut, UserUpdate
from app.models.user import User
from app.core.security import hash_password

router = APIRouter(tags=["users"])


async def _check_user_access(target: User, current: CurrentUser, db: AsyncSession) -> None:
    """Permite a un admin gestionar usuarios de su propio tenant o de subclients (cliente padre)."""
    await assert_can_manage_tenant(current, target.tenant_id, db)


@router.put("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID,
    body: UserUpdate,
    current: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    await _check_user_access(user, current, db)
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.role is not None:
        user.role = body.role
    if body.active is not None:
        user.active = body.active
    if body.password is not None:
        user.hashed_password = hash_password(body.password)
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=204)
async def deactivate_user(
    user_id: uuid.UUID,
    current: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    await _check_user_access(user, current, db)
    if user.id == current.user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No puedes desactivarte a ti mismo")
    user.active = False
    await db.commit()
