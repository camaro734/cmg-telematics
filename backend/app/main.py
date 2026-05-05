# backend/app/main.py
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import redis.asyncio as aioredis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.api.v1.router import api_router
from app.api.v1.ws import router as ws_router, ConnectionManager, broadcast_telemetry_task
from app.api.v1.commands import internal_router
from app.core.config import settings


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        response = await call_next(request)
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        return response


limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path("/app/uploads/icons").mkdir(parents=True, exist_ok=True)
    Path("/app/uploads/maintenance_docs").mkdir(parents=True, exist_ok=True)
    app.state.redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    app.state.ws_manager = ConnectionManager()
    from app.core.maintenance_notifier import maintenance_notification_task
    task = asyncio.create_task(
        broadcast_telemetry_task(app.state.redis, app.state.ws_manager)
    )
    notifier_task = asyncio.create_task(
        maintenance_notification_task(app.state.redis)
    )
    yield
    task.cancel()
    notifier_task.cancel()
    for t in (task, notifier_task):
        try:
            await t
        except asyncio.CancelledError:
            pass
    await app.state.redis.aclose()


app = FastAPI(
    title="CMG Telematics API",
    version="2.0.0",
    docs_url="/docs" if not settings.is_production else None,
    redoc_url="/redoc" if not settings.is_production else None,
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Internal-Key"],
)
app.add_middleware(SecurityHeadersMiddleware)

app.include_router(api_router)
app.include_router(ws_router)
app.include_router(internal_router, prefix="/internal")

# Resuelve las rutas de ficheros estáticos de forma portable:
# - En producción (Docker) se usan /app/uploads y /app/static
# - En desarrollo/tests se buscan relativo al directorio del paquete backend
_THIS_DIR = Path(__file__).parent.parent  # directorio backend/
_UPLOADS_DIR = Path("/app/uploads") if Path("/app/uploads").exists() else _THIS_DIR / "uploads"
_STATIC_DIR = Path("/app/static") if Path("/app/static").exists() else _THIS_DIR / "static"

_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
_STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_UPLOADS_DIR)), name="uploads")
app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")


@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}
