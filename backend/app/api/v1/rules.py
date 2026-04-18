# backend/app/api/v1/rules.py
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.schemas.rule import RuleOut, RuleCreate, RuleUpdate, RuleTestRequest, RuleTestResult
from app.models.alert_rule import AlertRule

router = APIRouter(tags=["rules"])

_OPS = {
    ">": float.__gt__,
    "<": float.__lt__,
    ">=": float.__ge__,
    "<=": float.__le__,
    "==": float.__eq__,
    "!=": float.__ne__,
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


@router.get("/rules", response_model=list[RuleOut])
async def list_rules(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(AlertRule)
    if user.tenant_tier != "cmg":
        query = query.where(AlertRule.tenant_id == user.tenant_id)
    result = await db.execute(query.order_by(AlertRule.created_at.desc()))
    return result.scalars().all()


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
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado")
    rule = AlertRule(
        tenant_id=user.tenant_id,
        created_by_user_id=user.user_id,
        **body.model_dump(),
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.put("/rules/{rule_id}", response_model=RuleOut)
async def update_rule(
    rule_id: uuid.UUID,
    body: RuleUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    if user.tenant_tier != "cmg" and str(rule.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(rule, field, value)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(
    rule_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    if user.tenant_tier != "cmg" and str(rule.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada")
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No autorizado")
    await db.delete(rule)
    await db.commit()


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

    return RuleTestResult(
        would_fire=False,
        reason=f"Tipo '{ctype}' requiere estado — prueba con datos reales",
    )
