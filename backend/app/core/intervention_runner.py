"""Tarea background: runner programado del detector de intervención v2.

Corre cada N minutos y, SOLO para los vehículos de la allowlist (por defecto el
FUSO de pruebas), recomputa intervenciones de una ventana reciente rolling. Es
idempotente: ``detect_and_store_cycles`` hace DELETE+INSERT transaccional por
ventana y definición, así que los lectores nunca ven huecos.

El reporte de intervención es por rango de fecha (no necesita tiempo real), por eso
un barrido periódico basta y es mucho más seguro que detección por-mensaje.

Aislamiento: cada vehículo se procesa en su propio try/except; un fallo no afecta
a los demás, ni al tracking en vivo, ni a la ingesta. NO toca el rules-engine.
Reutiliza ``detect_and_store_cycles`` (Paso 2b-1), ya validado en frío.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.vehicle import Vehicle
from app.models.work_cycle import WorkCycleDefinition
from app.services.cycle_detector import detect_and_store_cycles

logger = logging.getLogger(__name__)


def _allowlist() -> list[uuid.UUID]:
    """Parsea la allowlist (CSV de vehicle_id) a UUIDs, descartando inválidos."""
    out: list[uuid.UUID] = []
    for part in (settings.intervention_runner_vehicle_ids or "").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(uuid.UUID(part))
        except ValueError:
            logger.warning("intervention_runner: vehicle_id inválido en allowlist: %r", part)
    return out


async def intervention_runner_task() -> None:
    """Loop principal: duerme interval_s y procesa la allowlist en cada pasada."""
    if not settings.intervention_runner_enabled:
        logger.info("intervention_runner DESACTIVADO (intervention_runner_enabled=False)")
        return
    interval = settings.intervention_runner_interval_s
    logger.info(
        "intervention_runner activo: interval=%ss window=%ss allowlist=%d vehículo(s)",
        interval, settings.intervention_runner_window_s, len(_allowlist()),
    )
    while True:
        await asyncio.sleep(interval)
        try:
            await run_once()
        except Exception as exc:  # noqa: BLE001 — nunca debe tumbar el loop
            logger.error("intervention_runner: error en barrido: %s", exc)


async def run_once() -> int:
    """Procesa una pasada sobre la allowlist. Devuelve nº de vehículos procesados OK."""
    allow = _allowlist()
    if not allow:
        return 0
    now = datetime.now(timezone.utc)
    from_dt = now - timedelta(seconds=settings.intervention_runner_window_s)
    ok = 0
    for vehicle_id in allow:
        try:
            n = await _process_vehicle(vehicle_id, from_dt, now)
            logger.info(
                "intervention_runner: vehicle=%s intervenciones=%s ventana=[%s,%s)",
                vehicle_id, n, from_dt.isoformat(), now.isoformat(),
            )
            ok += 1
        except Exception as exc:  # noqa: BLE001 — aislamiento por vehículo
            logger.error("intervention_runner: fallo en vehicle=%s: %s", vehicle_id, exc)
    return ok


async def _process_vehicle(vehicle_id: uuid.UUID, from_dt: datetime, to_dt: datetime) -> int:
    """Computa intervenciones de todas las definiciones aplicables al vehículo."""
    total = 0
    async with AsyncSessionLocal() as db:
        vehicle = await db.get(Vehicle, vehicle_id)
        if vehicle is None or not vehicle.active:
            logger.warning("intervention_runner: vehicle %s inexistente/inactivo; omitido", vehicle_id)
            return 0
        # Definiciones del tipo del vehículo, activas, globales o de su tenant.
        defs = (await db.execute(
            select(WorkCycleDefinition).where(
                WorkCycleDefinition.vehicle_type_id == vehicle.vehicle_type_id,
                WorkCycleDefinition.active.is_(True),
                or_(
                    WorkCycleDefinition.tenant_id == vehicle.tenant_id,
                    WorkCycleDefinition.tenant_id.is_(None),
                ),
            )
        )).scalars().all()
        for defn in defs:
            total += await detect_and_store_cycles(
                db, vehicle_id, vehicle.tenant_id, defn, from_dt, to_dt
            )
    return total
