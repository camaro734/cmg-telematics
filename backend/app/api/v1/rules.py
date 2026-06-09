# backend/app/api/v1/rules.py
import operator
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse, Response
from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.api.v1.deps import get_current_user, require_management_tier
from app.schemas.auth import CurrentUser
from app.schemas.rule import RuleOut, RuleCreate, RuleUpdate, RuleTestRequest, RuleTestResult
from app.models.alert_rule import AlertRule
from app.models.alert_instance import AlertInstance

router = APIRouter(tags=["rules"])

_OPS = {
    ">": operator.gt,
    "<": operator.lt,
    ">=": operator.ge,
    "<=": operator.le,
    "==": operator.eq,
    "!=": operator.ne,
}


def _eval_threshold(condition: dict, field_values: dict) -> tuple[bool, float | None]:
    field = condition.get("field", "")
    val = field_values.get(field)
    if val is None:
        return False, None
    try:
        fval = float(val)
        op_fn = _OPS.get(condition.get("op", ">"))
        threshold = float(condition.get("value", 0))
        return (op_fn(fval, threshold) if op_fn else False), fval
    except (TypeError, ValueError):
        return False, None


def _point_in_polygon(lat: float, lon: float, polygon: list) -> bool:
    inside = False
    n = len(polygon)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i][0], polygon[i][1]
        xj, yj = polygon[j][0], polygon[j][1]
        if ((yi > lon) != (yj > lon)) and (lat < (xj - xi) * (lon - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


@router.get("/rules", response_model=list[RuleOut])
async def list_rules(
    include_archived: bool = Query(False),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    alert_count_sq = (
        select(func.count())
        .where(AlertInstance.rule_id == AlertRule.id)
        .correlate(AlertRule)
        .scalar_subquery()
    )
    query = select(AlertRule, alert_count_sq.label("alert_count"))
    # Ocultar reglas de sistema — no editables por el usuario
    query = query.where(AlertRule.condition["type"].as_string() != "silence")
    query = query.where(AlertRule.condition["type"].as_string() != "maintenance")
    if not include_archived:
        query = query.where(AlertRule.archived_at.is_(None))
    if user.tenant_tier != "cmg":
        query = query.where(AlertRule.tenant_id == user.tenant_id)
    result = await db.execute(query.order_by(AlertRule.created_at.desc()))
    rows = result.all()
    out = []
    for rule, alert_count in rows:
        data = {c.key: getattr(rule, c.key) for c in AlertRule.__table__.columns}
        data["alert_count"] = alert_count
        out.append(RuleOut(**data))
    return out


@router.get("/rules/{rule_id}", response_model=RuleOut)
async def get_rule(
    rule_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    if user.tenant_tier != "cmg" and str(rule.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    return rule


@router.post("/rules", response_model=RuleOut, status_code=status.HTTP_201_CREATED)
async def create_rule(
    body: RuleCreate,
    user: CurrentUser = Depends(require_management_tier()),
    db: AsyncSession = Depends(get_db),
):
    data = body.model_dump()
    data.pop("tenant_id", None)
    data.pop("created_by_user_id", None)
    rule = AlertRule(tenant_id=user.tenant_id, created_by_user_id=user.user_id, **data)
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.put("/rules/{rule_id}", response_model=RuleOut)
async def update_rule(
    rule_id: uuid.UUID,
    body: RuleUpdate,
    user: CurrentUser = Depends(require_management_tier()),
    db: AsyncSession = Depends(get_db),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    if user.tenant_tier != "cmg" and str(rule.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(rule, field, value)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/rules/{rule_id}")
async def delete_rule(
    rule_id: uuid.UUID,
    purge: bool = Query(False),
    user: CurrentUser = Depends(require_management_tier()),
    db: AsyncSession = Depends(get_db),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    if user.tenant_tier != "cmg" and str(rule.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")

    alert_count = await db.scalar(
        select(func.count()).where(AlertInstance.rule_id == rule.id)
    ) or 0

    if purge:
        # Elimina instancias primero para evitar FK RESTRICT, luego la regla
        await db.execute(sa_delete(AlertInstance).where(AlertInstance.rule_id == rule.id))
        await db.delete(rule)
        await db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    if alert_count == 0:
        await db.delete(rule)
        await db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    # Tiene alertas → archivar: desactiva y marca timestamp de archivo
    rule.archived_at = datetime.now(timezone.utc)
    rule.active = False
    await db.commit()
    return JSONResponse(status_code=200, content={"archived": True, "alert_count": alert_count})


@router.post("/rules/{rule_id}/restore", response_model=RuleOut)
async def restore_rule(
    rule_id: uuid.UUID,
    user: CurrentUser = Depends(require_management_tier()),
    db: AsyncSession = Depends(get_db),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    if user.tenant_tier != "cmg" and str(rule.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    rule.archived_at = None
    await db.commit()
    await db.refresh(rule)
    return rule


@router.post("/rules/{rule_id}/test", response_model=RuleTestResult)
async def test_rule(
    rule_id: uuid.UUID,
    body: RuleTestRequest,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    if user.tenant_tier != "cmg" and str(rule.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")

    ctype = rule.condition.get("type")
    if ctype == "threshold":
        fired, val = _eval_threshold(rule.condition, body.field_values)
        return RuleTestResult(would_fire=fired, trigger_value=val)

    if ctype == "geofence":
        lat = body.field_values.get("lat")
        lon = body.field_values.get("lon")
        if lat is None or lon is None:
            return RuleTestResult(would_fire=False, reason="Proporciona 'lat' y 'lon' en field_values para probar geofence")
        polygon = rule.condition.get("polygon", [])
        action = rule.condition.get("action", "enter")
        inside = _point_in_polygon(float(lat), float(lon), polygon)
        would_fire = (action == "enter" and inside) or (action == "exit" and not inside)
        return RuleTestResult(would_fire=would_fire, reason=f"Punto {'dentro' if inside else 'fuera'} del polígono")

    return RuleTestResult(
        would_fire=False,
        reason=f"Tipo '{ctype}' requiere estado — prueba con datos reales",
    )
