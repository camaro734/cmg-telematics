# backend/app/api/v1/ws.py
import asyncio
import json
import logging
import uuid
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.security import decode_token
from app.schemas.auth import CurrentUser

logger = logging.getLogger(__name__)
router = APIRouter(tags=["websocket"])


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}

    async def connect(self, ws: WebSocket, tenant_id: str) -> None:
        await ws.accept()
        self._connections.setdefault(tenant_id, set()).add(ws)

    def disconnect(self, ws: WebSocket, tenant_id: str) -> None:
        if tenant_id in self._connections:
            self._connections[tenant_id].discard(ws)

    async def broadcast_to_tenant(self, tenant_id: str, message: dict) -> None:
        dead: set[WebSocket] = set()
        for ws in list(self._connections.get(tenant_id, set())):
            try:
                await ws.send_json(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._connections[tenant_id].discard(ws)

    async def broadcast_to_all(self, message: dict) -> None:
        for tenant_id in list(self._connections):
            await self.broadcast_to_tenant(tenant_id, message)


async def broadcast_telemetry_task(redis, manager: ConnectionManager) -> None:
    last_id = "$"
    while True:
        try:
            entries = await redis.xread({"telemetry.raw": last_id}, block=1000, count=50)
            for _stream, messages in entries:
                for msg_id, fields in messages:
                    last_id = msg_id
                    try:
                        payload = json.loads(
                            fields["payload"] if isinstance(fields, dict) and "payload" in fields
                            else fields[b"payload"]
                        )
                        # Recalcular online según last_seen (< 5 min)
                        from datetime import datetime, timezone
                        last_seen_str = payload.get("last_seen")
                        if last_seen_str:
                            try:
                                ls = datetime.fromisoformat(last_seen_str.replace("Z", "+00:00"))
                                age_min = (datetime.now(timezone.utc) - ls).total_seconds() / 60
                                payload["online"] = age_min < 5
                            except Exception:
                                pass
                        tenant_id = payload.get("tenant_id")
                        msg = {"type": "telemetry", "data": payload}
                        if tenant_id:
                            await manager.broadcast_to_tenant(tenant_id, msg)
                        # CMG admins ven todos los tenants — conexiones registradas bajo "__cmg__"
                        await manager.broadcast_to_tenant("__cmg__", msg)
                    except Exception as exc:
                        logger.debug("WS broadcast parse error: %s", exc)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error("WS broadcast task error: %s", exc)
            await asyncio.sleep(1)


@router.websocket("/ws/fleet")
async def ws_fleet(websocket: WebSocket, token: str | None = None) -> None:
    if not token:
        await websocket.accept()
        await websocket.send_json({"error": "unauthenticated"})
        await websocket.close(code=4001)
        return

    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise ValueError("Not an access token")
        user = CurrentUser(
            user_id=uuid.UUID(payload["sub"]),
            tenant_id=uuid.UUID(payload["tenant_id"]),
            tenant_tier=payload["tenant_tier"],
            role=payload["role"],
            email=payload["email"],
        )
    except (ValueError, KeyError):
        await websocket.accept()
        await websocket.send_json({"error": "invalid_token"})
        await websocket.close(code=4001)
        return

    manager: ConnectionManager = websocket.app.state.ws_manager
    ws_tenant_key = "__cmg__" if user.tenant_tier == "cmg" else str(user.tenant_id)
    await manager.connect(websocket, ws_tenant_key)
    try:
        await websocket.send_json({"type": "connected", "tenant_id": str(user.tenant_id)})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket, ws_tenant_key)
