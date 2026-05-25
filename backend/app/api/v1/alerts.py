# backend/app/api/v1/alerts.py
import csv
import io
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.schemas.alert import AlertInstanceOut, AlertInstanceEnrichedOut, AckRequest
from app.models.alert_instance import AlertInstance
from app.models.alert_rule import AlertRule
from app.models.vehicle import Vehicle
from app.api.v1.access_v2 import list_accessible_vehicle_ids

router = APIRouter(tags=["alerts"])


@router.get("/alerts", response_model=list[AlertInstanceEnrichedOut])
async def list_alerts(
    alert_status: str | None = Query(None, alias="status"),
    vehicle_id: uuid.UUID | None = Query(None),
    triggered_at_from: datetime | None = Query(None),
    triggered_at_to: datetime | None = Query(None),
    tenant_id: uuid.UUID | None = Query(None),
    limit: int = 50,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if limit > 200:
        limit = 200
    query = (
        select(
            AlertInstance,
            AlertRule.name.label("rule_name"),
            AlertRule.severity.label("severity"),
            Vehicle.name.label("vehicle_name"),
        )
        .join(AlertRule, AlertRule.id == AlertInstance.rule_id)
        .join(Vehicle, Vehicle.id == AlertInstance.vehicle_id)
    )
    accessible = await list_accessible_vehicle_ids(user, db)
    if accessible == "ALL":
        if tenant_id is not None:
            query = query.where(AlertInstance.tenant_id == tenant_id)
    else:
        query = query.where(AlertInstance.vehicle_id.in_(accessible))
    if alert_status:
        query = query.where(AlertInstance.status == alert_status)
    if vehicle_id:
        query = query.where(AlertInstance.vehicle_id == vehicle_id)
    if triggered_at_from:
        query = query.where(AlertInstance.triggered_at >= triggered_at_from)
    if triggered_at_to:
        query = query.where(AlertInstance.triggered_at <= triggered_at_to)
    query = query.order_by(AlertInstance.triggered_at.desc()).limit(limit)
    result = await db.execute(query)
    rows = result.all()
    enriched = []
    for alert, rule_name, severity, vehicle_name in rows:
        enriched.append(AlertInstanceEnrichedOut(
            **{c.key: getattr(alert, c.key) for c in AlertInstance.__table__.columns},
            rule_name=rule_name,
            severity=severity,
            vehicle_name=vehicle_name,
        ))
    return enriched


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


@router.get("/alerts/export.csv")
async def export_alerts_csv(
    alert_status: str | None = Query(None, alias="status"),
    vehicle_id: uuid.UUID | None = Query(None),
    triggered_at_from: datetime | None = Query(None),
    triggered_at_to: datetime | None = Query(None),
    tenant_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(AlertInstance, AlertRule.name.label("rule_name"), AlertRule.severity)
        .join(AlertRule, AlertRule.id == AlertInstance.rule_id)
    )
    accessible = await list_accessible_vehicle_ids(user, db)
    if accessible == "ALL":
        if tenant_id is not None:
            query = query.where(AlertInstance.tenant_id == tenant_id)
    else:
        query = query.where(AlertInstance.vehicle_id.in_(accessible))
    if alert_status:
        query = query.where(AlertInstance.status == alert_status)
    if vehicle_id:
        query = query.where(AlertInstance.vehicle_id == vehicle_id)
    if triggered_at_from:
        query = query.where(AlertInstance.triggered_at >= triggered_at_from)
    if triggered_at_to:
        query = query.where(AlertInstance.triggered_at <= triggered_at_to)
    query = query.order_by(AlertInstance.triggered_at.desc())
    result = await db.execute(query)
    rows = result.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "vehicle_id", "rule_name", "severity", "triggered_at", "resolved_at", "status", "trigger_value", "ack_note"])
    for alert, rule_name, severity in rows:
        writer.writerow([
            str(alert.id),
            str(alert.vehicle_id),
            rule_name,
            severity,
            alert.triggered_at.isoformat() if alert.triggered_at else "",
            alert.resolved_at.isoformat() if alert.resolved_at else "",
            alert.status,
            str(alert.trigger_value) if alert.trigger_value else "",
            alert.ack_note or "",
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="alertas.csv"'},
    )
