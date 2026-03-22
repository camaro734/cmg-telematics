"""
Notification preferences API — manage push subscriptions.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.push_subscription import PushSubscription
from app.models.user import User
from app.api.v1.auth import get_current_user
from app.core.config import settings

router = APIRouter(prefix="/notifications", tags=["notifications"])


class PushSubscribeRequest(BaseModel):
    endpoint: str
    keys: dict  # {"p256dh": str, "auth": str}
    expirationTime: float | None = None


@router.post("/push-subscribe", status_code=201)
async def push_subscribe(
    body: PushSubscribeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Register or update a browser push subscription for the current user."""
    existing = await db.execute(
        select(PushSubscription).where(
            PushSubscription.user_id == current_user.id,
            PushSubscription.endpoint == body.endpoint,
        )
    )
    sub = existing.scalar_one_or_none()
    if sub:
        # Update keys (subscription may have rotated)
        sub.p256dh = body.keys.get("p256dh", "")
        sub.auth = body.keys.get("auth", "")
    else:
        sub = PushSubscription(
            user_id=current_user.id,
            endpoint=body.endpoint,
            p256dh=body.keys.get("p256dh", ""),
            auth=body.keys.get("auth", ""),
        )
        db.add(sub)
    await db.commit()
    return {"status": "subscribed"}


@router.delete("/push-subscribe")
async def push_unsubscribe(
    endpoint: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a push subscription."""
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.user_id == current_user.id,
            PushSubscription.endpoint == endpoint,
        )
    )
    sub = result.scalar_one_or_none()
    if sub:
        await db.delete(sub)
        await db.commit()
    return {"status": "unsubscribed"}


@router.get("/vapid-public-key")
async def get_vapid_public_key():
    """Return the VAPID public key for browser push subscription."""
    return {"publicKey": settings.VAPID_PUBLIC_KEY}
