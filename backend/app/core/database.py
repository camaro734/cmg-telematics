from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    """Create all tables and configure TimescaleDB hypertables."""
    from app.models import tenant, user, vehicle, device, telemetry, variable_map, command_log, alert_log, maintenance, geofence, push_subscription  # noqa
    from app.models.tenant_notification_config import TenantNotificationConfig  # noqa

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # Create hypertable for telemetry_record (idempotent)
        await conn.execute(text("""
            SELECT create_hypertable(
                'telemetry_record', 'time',
                chunk_time_interval => INTERVAL '1 day',
                if_not_exists => TRUE
            );
        """))

        # Compression policy: compress chunks older than 7 days
        await conn.execute(text("""
            ALTER TABLE telemetry_record SET (
                timescaledb.compress,
                timescaledb.compress_orderby = 'time DESC',
                timescaledb.compress_segmentby = 'device_id'
            );
        """))

        try:
            await conn.execute(text("""
                SELECT add_compression_policy(
                    'telemetry_record',
                    INTERVAL '7 days',
                    if_not_exists => TRUE
                );
            """))
        except Exception as e:
            logger.warning(f"Compression policy (ignorable if already exists): {e}")

        try:
            await conn.execute(text("""
                SELECT add_retention_policy(
                    'telemetry_record',
                    INTERVAL '2 years',
                    if_not_exists => TRUE
                );
            """))
        except Exception as e:
            logger.warning(f"Retention policy (ignorable if already exists): {e}")

    logger.info("Database initialized with TimescaleDB hypertable")
