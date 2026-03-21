import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.core.config import settings
from app.core.database import init_db
from app.core.redis_client import get_redis, close_redis
from app.api.v1.router import api_router
from app.services.teltonika.tcp_server import teltonika_server
from app.websocket.realtime import fleet_websocket

# Rate limiter — 10 login attempts per minute per IP
limiter = Limiter(key_func=get_remote_address, default_limits=[])

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

_tcp_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _tcp_task

    # Startup
    logger.info("Initializing database...")
    await init_db()
    logger.info("Database ready")

    # Warm up Redis connection
    r = await get_redis()
    await r.ping()
    logger.info("Redis connected")

    # Start TCP server in background
    _tcp_task = asyncio.create_task(teltonika_server.start())
    logger.info(f"Teltonika TCP server starting on port {settings.TCP_PORT}")

    yield

    # Shutdown
    logger.info("Shutting down...")
    if _tcp_task:
        _tcp_task.cancel()
        try:
            await _tcp_task
        except asyncio.CancelledError:
            pass

    await teltonika_server.stop()
    await close_redis()
    logger.info("Shutdown complete")


app = FastAPI(
    title="CMG Telematics API",
    version="0.1.0",
    description="Industrial vehicle telematics platform — CMG Metalhidráulica S.L.",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(api_router)

# WebSocket
app.add_api_websocket_route("/ws/fleet", fleet_websocket)


@app.get("/health", tags=["health"])
async def health_check():
    """Health check endpoint."""
    from app.services.teltonika import device_registry
    from app.core.redis_client import get_redis

    db_ok = False
    redis_ok = False
    tcp_running = _tcp_task is not None and not _tcp_task.done()

    try:
        from app.core.database import engine
        from sqlalchemy import text
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception as e:
        logger.error(f"DB health check failed: {e}")

    try:
        r = await get_redis()
        await r.ping()
        redis_ok = True
    except Exception as e:
        logger.error(f"Redis health check failed: {e}")

    return {
        "status": "ok" if (db_ok and redis_ok and tcp_running) else "degraded",
        "tcp_server": "running" if tcp_running else "stopped",
        "db": "ok" if db_ok else "error",
        "redis": "ok" if redis_ok else "error",
    }
