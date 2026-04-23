# backend/app/main.py
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import redis.asyncio as aioredis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router
from app.api.v1.ws import router as ws_router, ConnectionManager, broadcast_telemetry_task
from app.core.config import settings


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

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
app.include_router(ws_router)
Path("/app/uploads").mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory="/app/uploads"), name="uploads")


@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}
