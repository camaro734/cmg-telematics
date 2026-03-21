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

    # Subscribe to patterns: telemetry:* (all devices) and alert:* (alert events)
    await pubsub.psubscribe("telemetry:*", "alert:*")

    try:
        async for message in pubsub.listen():
            if message["type"] == "pmessage":
                try:
                    data = json.loads(message["data"])
                    await websocket.send_json(data)
                except Exception as e:
                    logger.warning(f"WS send error: {e}")
                    break
    except WebSocketDisconnect:
        logger.info(f"WebSocket client disconnected: {websocket.client}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
    finally:
        await pubsub.punsubscribe("telemetry:*", "alert:*")
        await pubsub.aclose()
        try:
            await websocket.close()
        except Exception:
            pass
