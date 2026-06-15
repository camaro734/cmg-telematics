# services/ingest/src/main.py
import asyncio
import json as _json
import logging
import asyncpg
from redis.asyncio import Redis
from src.config import settings
from src.server import run_server, command_listener, manual_can_listener

logging.basicConfig(
    level=logging.DEBUG if settings.environment == "development" else logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)


async def main() -> None:
    logger.info("Iniciando ingest-svc...")

    async def _init_conn(conn):
        await conn.set_type_codec(
            "jsonb",
            encoder=_json.dumps,
            decoder=_json.loads,
            schema="pg_catalog",
        )

    db_pool = await asyncpg.create_pool(
        dsn=settings.db_url.replace("+asyncpg", ""),
        min_size=10,
        max_size=40,
        init=_init_conn,
    )
    redis = Redis.from_url(settings.redis_url, decode_responses=True)

    try:
        asyncio.create_task(command_listener(redis))
        asyncio.create_task(manual_can_listener(redis))
        await run_server(db_pool, redis)
    finally:
        await db_pool.close()
        await redis.aclose()


if __name__ == "__main__":
    asyncio.run(main())
