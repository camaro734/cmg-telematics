# services/ingest/src/main.py
import asyncio
import logging
import asyncpg
from redis.asyncio import Redis
from src.config import settings
from src.server import run_server

logging.basicConfig(
    level=logging.DEBUG if settings.environment == "development" else logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)


async def main() -> None:
    logger.info("Iniciando ingest-svc...")

    db_pool = await asyncpg.create_pool(
        dsn=settings.db_url.replace("+asyncpg", ""),
        min_size=5,
        max_size=20,
    )
    redis = Redis.from_url(settings.redis_url, decode_responses=True)

    try:
        await run_server(db_pool, redis)
    finally:
        await db_pool.close()
        await redis.aclose()


if __name__ == "__main__":
    asyncio.run(main())
