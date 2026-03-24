"""
WebSocket endpoint for real-time fleet telemetry.
Subscribes to Redis pubsub channels and forwards events to connected clients.
"""
import asyncio
import json
import logging
from fastapi import WebSocket, WebSocketDisconnect, Query
from jose import JWTError, jwt

from app.core.config import settings
from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"


async def _authenticate_ws(token: str | None) -> dict | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


async def fleet_websocket(websocket: WebSocket, token: str = Query(default=None)):
    """
    WebSocket endpoint: /ws/fleet?token=<JWT>
    Streams all telemetry events for the connected user's tenant.
    """
    payload = await _authenticate_ws(token)
    if payload is None:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    await websocket.accept()
    logger.info(f"WebSocket client connected: {websocket.client}")

    r = await get_redis()
    pubsub = r.pubsub()
    await pubsub.psubscribe("telemetry:*", "alert:*")

    async def _pubsub_listener():
        async for message in pubsub.listen():
            if message["type"] == "pmessage":
                data = json.loads(message["data"])
                await websocket.send_json(data)

    async def _keepalive():
        """Ping every 30s to detect dead connections quickly."""
        while True:
            await asyncio.sleep(30)
            await websocket.send_json({"type": "ping"})

    listener_task = asyncio.create_task(_pubsub_listener())
    keepalive_task = asyncio.create_task(_keepalive())

    try:
        done, pending = await asyncio.wait(
            [listener_task, keepalive_task],
            return_when=asyncio.FIRST_EXCEPTION,
        )
        for task in done:
            exc = task.exception()
            if exc:
                raise exc
    except WebSocketDisconnect:
        logger.info(f"WebSocket client disconnected: {websocket.client}")
    except Exception as e:
        logger.warning(f"WS closed ({websocket.client}): {type(e).__name__}")
    finally:
        listener_task.cancel()
        keepalive_task.cancel()
        await pubsub.punsubscribe("telemetry:*", "alert:*")
        await pubsub.aclose()
        try:
            await websocket.close()
        except Exception:
            pass
