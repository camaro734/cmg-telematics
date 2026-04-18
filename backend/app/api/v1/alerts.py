# backend/app/api/v1/alerts.py
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.schemas.alert import AlertInstanceOut, AckRequest
from app.models.alert_instance import AlertInstance

router = APIRouter(tags=["alerts"])


@router.get("/alerts", response_model=list[AlertInstanceOut])
async def list_alerts(
    alert_status: str | None = Query(None, alias="status"),
    limit: int = 50,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if limit > 200:
        limit = 200
    query = select(AlertInstance)
    if user.tenant_tier != "cmg":
        query = query.where(AlertInstance.tenant_id == user.tenant_id)
    if alert_status:
        query = query.where(AlertInstance.status == alert_status)
    query = query.order_by(AlertInstance.triggered_at.desc()).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/alerts/{alert_id}/acknowledge", response_model=AlertInstanceOut)
async def acknowledge_alert(
    alert_id: uuid.UUID,
    body: AckRequest,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    alert = await db.get(AlertInstance, alert_id)
    if not alert:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alerta no encontrada")
    if user.tenant_tier != "cmg" and str(alert.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alerta no encontrada")
    if alert.status not in ("firing", "escalated"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No se puede reconocer alerta en estado '{alert.status}'",
        )

    alert.status = "acknowledged"
    alert.ack_by_user_id = user.user_id
    alert.ack_at = datetime.now(timezone.utc)
    alert.ack_note = body.note
    await db.commit()
    await db.refresh(alert)
    return alert
