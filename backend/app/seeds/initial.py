# backend/app/seeds/initial.py
"""
Seed idempotente: crea tenant CMG, usuario superadmin y 3 vehicle_types.
Ejecutar: python -m app.seeds.initial
"""
import asyncio
import logging
import uuid
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import select
from app.core.config import settings
from app.core.security import hash_password
from app.models.base import Base
from app.models.tenant import Tenant
from app.models.user import User
from app.models.vehicle_type import VehicleType

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

VACUUM_SENSORS = [
    {"key": "hydraulic_pressure_1", "label": "Presión bomba principal", "unit": "bar",
     "min": 0, "max": 300, "gauge_type": "circular", "warn_above": 220, "alert_above": 250, "avl_id": 305},
    {"key": "hydraulic_pressure_2", "label": "Presión bomba secundaria", "unit": "bar",
     "min": 0, "max": 300, "gauge_type": "circular", "warn_above": 220, "alert_above": 250, "avl_id": 306},
    {"key": "oil_level_pct", "label": "Nivel aceite hidráulico", "unit": "%",
     "min": 0, "max": 100, "gauge_type": "linear", "warn_below": 20, "alert_below": 10, "avl_id": 307},
    {"key": "oil_temp_c", "label": "Temperatura aceite", "unit": "°C",
     "min": 0, "max": 120, "gauge_type": "circular", "warn_above": 80, "alert_above": 95, "avl_id": 308},
    {"key": "filter_pressure_bar", "label": "Presión filtro retorno", "unit": "bar",
     "min": 0, "max": 20, "gauge_type": "circular", "warn_above": 5, "alert_above": 8, "avl_id": 309},
    {"key": "cycle_count", "label": "Ciclos vaciado", "unit": "ciclos",
     "min": 0, "max": 9999, "gauge_type": "numeric", "avl_id": 310},
    {"key": "pto_active", "label": "PTO", "unit": None,
     "gauge_type": "led", "avl_id": 239},
]

SWEEPER_SENSORS = [
    {"key": "brush_speed_rpm", "label": "RPM cepillos", "unit": "rpm",
     "min": 0, "max": 1500, "gauge_type": "circular", "warn_above": 1200, "avl_id": 320},
    {"key": "water_level_pct", "label": "Nivel agua", "unit": "%",
     "min": 0, "max": 100, "gauge_type": "linear", "warn_below": 15, "avl_id": 321},
    {"key": "water_pressure_bar", "label": "Presión agua", "unit": "bar",
     "min": 0, "max": 15, "gauge_type": "circular", "warn_above": 10, "avl_id": 322},
    {"key": "work_speed_kmh", "label": "Velocidad trabajo", "unit": "km/h",
     "min": 0, "max": 25, "gauge_type": "circular", "avl_id": 323},
]

CISTERN_SENSORS = [
    {"key": "tank_level_pct", "label": "Nivel depósito", "unit": "%",
     "min": 0, "max": 100, "gauge_type": "linear", "warn_below": 10, "avl_id": 330},
    {"key": "pump_pressure_bar", "label": "Presión bomba descarga", "unit": "bar",
     "min": 0, "max": 20, "gauge_type": "circular", "warn_above": 15, "avl_id": 331},
    {"key": "flow_rate_lpm", "label": "Caudal", "unit": "L/min",
     "min": 0, "max": 500, "gauge_type": "numeric", "avl_id": 332},
]


async def run():
    engine = create_async_engine(settings.db_url, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with Session() as db:
            # Tenant CMG
            result = await db.execute(select(Tenant).where(Tenant.slug == "cmg"))
            cmg = result.scalar_one_or_none()
            if not cmg:
                cmg = Tenant(id=uuid.uuid4(), tier="cmg", name="CMG Metalhidráulica S.L.",
                             slug="cmg", active=True)
                db.add(cmg)
                await db.flush()
                logger.info("Creado tenant CMG")

            # Usuario superadmin
            result = await db.execute(select(User).where(User.email == "admin@cmg.es"))
            if not result.scalar_one_or_none():
                admin = User(
                    tenant_id=cmg.id, email="admin@cmg.es",
                    hashed_password=hash_password("Admin2026!"),
                    full_name="Administrador CMG", role="admin",
                )
                db.add(admin)
                logger.info("Creado usuario admin@cmg.es / Admin2026!")

            # Vehicle types
            for slug, name, sensors in [
                ("vacuum", "Camión aspirador", VACUUM_SENSORS),
                ("sweeper", "Barredora municipal", SWEEPER_SENSORS),
                ("cistern", "Camión cisterna", CISTERN_SENSORS),
            ]:
                result = await db.execute(select(VehicleType).where(VehicleType.slug == slug))
                if not result.scalar_one_or_none():
                    db.add(VehicleType(slug=slug, name=name, sensor_schema=sensors))
                    logger.info(f"Creado vehicle_type: {slug}")

            await db.commit()
        logger.info("Seed completado.")
    except Exception:
        logger.exception("Error durante seed")
        raise
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run())
