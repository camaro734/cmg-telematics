"""
Tarea background: revisa planes de mantenimiento cada 4 horas.
Publica notificaciones email al Redis stream 'alerts.fire' cuando
un plan está 'próximo' o 'vencido', con anti-spam de 23h por plan.
"""
import asyncio
import json
import logging
import uuid

from redis.asyncio import Redis
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.maintenance import MaintenancePlan
from app.models.vehicle import Vehicle
from app.models.tenant import Tenant

logger = logging.getLogger(__name__)

STREAM_KEY = "alerts.fire"
CHECK_INTERVAL = 4 * 3600


async def maintenance_notification_task(redis: Redis) -> None:
    """Loop: sleep 4h, then check all active plans and notify if due."""
    while True:
        await asyncio.sleep(CHECK_INTERVAL)
        try:
            await _check_and_notify(redis)
        except Exception as e:
            logger.error("Error en tarea notificaciones mantenimiento: %s", e)


async def _check_and_notify(redis: Redis) -> None:
    from app.api.v1.maintenance import _compute_progress

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(MaintenancePlan).where(MaintenancePlan.active == True)
        )
        plans = result.scalars().all()

        for plan in plans:
            try:
                progress = await _compute_progress(plan, db)
                if progress.status not in ("próximo", "vencido"):
                    continue

                cache_key = f"maint:notified:{plan.id}:{progress.status}"
                if await redis.exists(cache_key):
                    continue

                tenant = await db.get(Tenant, plan.tenant_id)
                if not tenant or not getattr(tenant, "notification_email", None):
                    continue

                vehicle = await db.get(Vehicle, plan.vehicle_id)
                vehicle_name = vehicle.name if vehicle else str(plan.vehicle_id)

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
                            [{"type": "email", "recipients": [tenant.notification_email]}]
                        ),
                        "escalation": json.dumps([]),
                    },
                    maxlen=10_000,
                    approximate=True,
                )

                await redis.setex(cache_key, 23 * 3600, "1")
                logger.info(
                    "Notificación mantenimiento: plan=%s vehicle=%s status=%s",
                    plan.name, vehicle_name, progress.status,
                )
            except Exception as e:
                logger.error("Error procesando plan %s: %s", plan.id, e)
