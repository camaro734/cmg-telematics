"""
Tarea background: revisa planes de mantenimiento cada 4 horas.

Por cada plan activo (sesión independiente por plan — un fallo no afecta a los demás):
  - VENCIDO:  crea alert_instance (dedup por plan_id en trigger_value) + email anti-spam
  - PRÓXIMO:  backstop-resolve si había alerta + solo email anti-spam
  - OK:       backstop-resolve si había alerta vencida que ya se normalizó
"""
import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from redis.asyncio import Redis
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.alert_instance import AlertInstance
from app.models.alert_rule import AlertRule
from app.models.maintenance import MaintenancePlan
from app.models.tenant import Tenant
from app.models.vehicle import Vehicle

logger = logging.getLogger(__name__)

STREAM_KEY = "alerts.fire"
CHECK_INTERVAL = 4 * 3600


async def maintenance_notification_task(redis: Redis) -> None:
    """Loop principal: duerme 4h y comprueba todos los planes activos."""
    while True:
        await asyncio.sleep(CHECK_INTERVAL)
        try:
            await _check_and_notify(redis)
        except Exception as exc:
            logger.error("Error en tarea notificaciones mantenimiento: %s", exc)


async def _check_and_notify(redis: Redis) -> None:
    from app.api.v1.maintenance import (
        _compute_progress,
        _ensure_maintenance_rule,
        _resolve_maintenance_alert_for_plan,
    )

    # Cargar solo los IDs para evitar objetos detached entre sesiones
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(MaintenancePlan.id).where(MaintenancePlan.active == True)
        )
        plan_ids = [row[0] for row in result]

    logger.info("Notifier mantenimiento: revisando %d planes activos", len(plan_ids))

    for plan_id in plan_ids:
        try:
            async with AsyncSessionLocal() as db:
                plan = await db.get(MaintenancePlan, plan_id)
                if not plan or not plan.active:
                    continue

                progress = await _compute_progress(plan, db)

                tenant = await db.get(Tenant, plan.tenant_id)
                vehicle = await db.get(Vehicle, plan.vehicle_id)
                vehicle_name = vehicle.name if vehicle else str(plan.vehicle_id)
                notification_email = getattr(tenant, "notification_email", None) if tenant else None

                rule_id = await _ensure_maintenance_rule(db, plan.tenant_id)

                if progress.status == "vencido":
                    await _handle_vencido(
                        db, redis, plan, plan_id, progress, rule_id, vehicle_name, notification_email
                    )
                else:
                    # Backstop: resuelve si el plan se normalizó desde el último ciclo
                    await _resolve_maintenance_alert_for_plan(
                        db, plan.vehicle_id, plan.tenant_id, plan_id
                    )
                    if progress.status == "próximo":
                        await _send_email_if_needed(
                            redis, plan, plan_id, progress, vehicle_name, notification_email
                        )

                await db.commit()

        except Exception as exc:
            logger.error("Error procesando plan %s: %s", plan_id, exc)


async def _handle_vencido(
    db,
    redis: Redis,
    plan: MaintenancePlan,
    plan_id: uuid.UUID,
    progress,
    rule_id: uuid.UUID,
    vehicle_name: str,
    notification_email: str | None,
) -> None:
    # Dedup: ¿ya hay alert_instance firing para este plan?
    existing = await db.execute(
        select(AlertInstance.id).where(
            AlertInstance.vehicle_id == plan.vehicle_id,
            AlertInstance.rule_id == rule_id,
            AlertInstance.status == "firing",
            AlertInstance.trigger_value["plan_id"].as_string() == str(plan_id),
        ).limit(1)
    )
    if not existing.scalar_one_or_none():
        worst = max(progress.thresholds, key=lambda t: t.pct)
        alert = AlertInstance(
            rule_id=rule_id,
            vehicle_id=plan.vehicle_id,
            tenant_id=plan.tenant_id,
            status="firing",
            trigger_value={
                "plan_id": str(plan_id),
                "plan_name": plan.name,
                "threshold_type": worst.type,
                "current": worst.current,
                "limit": worst.limit,
                "pct": worst.pct,
            },
        )
        db.add(alert)
        logger.info(
            "Alerta mantenimiento creada: plan=%s vehicle=%s pct=%.1f%%",
            plan.name, vehicle_name, worst.pct,
        )

    await _send_email_if_needed(redis, plan, plan_id, progress, vehicle_name, notification_email)


async def _send_email_if_needed(
    redis: Redis,
    plan: MaintenancePlan,
    plan_id: uuid.UUID,
    progress,
    vehicle_name: str,
    notification_email: str | None,
) -> None:
    if not notification_email:
        return
    cache_key = f"maint:notified:{plan_id}:{progress.status}"
    if await redis.exists(cache_key):
        return

    await redis.xadd(
        STREAM_KEY,
        {
            "alert_id": str(uuid.uuid4()),
            "rule_id": str(uuid.uuid4()),
            "vehicle_id": str(plan.vehicle_id),
            "tenant_id": str(plan.tenant_id),
            "severity": "critical" if progress.status == "vencido" else "warning",
            "trigger_value": json.dumps(
                {"plan": plan.name, "status": progress.status, "vehicle": vehicle_name}
            ),
            "actions": json.dumps(
                [{"type": "email", "recipients": [notification_email]}]
            ),
            "escalation": json.dumps([]),
        },
        maxlen=10_000,
        approximate=True,
    )
    await redis.setex(cache_key, 23 * 3600, "1")
    logger.info(
        "Email mantenimiento: plan=%s vehicle=%s status=%s",
        plan.name, vehicle_name, progress.status,
    )
