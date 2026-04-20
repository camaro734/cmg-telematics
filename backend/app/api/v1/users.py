import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.schemas.user import UserOut, UserUpdate
from app.models.user import User

router = APIRouter(tags=["users"])


def _check_user_access(target: User, current: CurrentUser) -> None:
    if current.tenant_tier == "cmg":
        return
    if current.role != "admin" or str(target.tenant_id) != str(current.tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sin permiso")


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
    _check_user_access(user, current)
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.role is not None:
        user.role = body.role
    if body.active is not None:
        user.active = body.active
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
    _check_user_access(user, current)
    user.active = False
    await db.commit()
