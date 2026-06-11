# backend/app/api/v1/ws.py
import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.security import decode_token
from app.schemas.auth import CurrentUser

logger = logging.getLogger(__name__)
router = APIRouter(tags=["websocket"])


def _enrich_payload(payload: dict) -> dict:
    """Mapea received_at→device_last_seen y calcula el campo online.
    Si online ya es False (evento de desconexión TCP), se preserva sin recalcular."""
    if "received_at" in payload:
        payload["device_last_seen"] = payload["received_at"]
    if payload.get("online") is not False:
        received_str = payload.get("received_at") or payload.get("last_seen")
        if received_str:
            try:
                ts = datetime.fromisoformat(received_str.replace("Z", "+00:00"))
                age_min = (datetime.now(timezone.utc) - ts).total_seconds() / 60
                payload["online"] = age_min < 5
            except Exception:
                pass
    return payload


def _should_emit(
    vehicle_id: str,
    online: object,
    ignition: object,
    last_sent: dict[str, float],
    last_state: dict[str, tuple],
    now_mono: float,
    throttle_s: float = 2.0,
) -> bool:
    """True si el evento debe emitirse al frontend.

    Siempre emite si el estado (online/ignition) cambió respecto al último emit —
    son los cambios que el usuario debe ver inmediatamente. Si no cambió, aplica
    el throttle de 2 s para reducir re-renders con N vehículos activos."""
    last = last_state.get(vehicle_id)
    if last is None or last[0] != online or last[1] != ignition:
        return True
    return (now_mono - last_sent.get(vehicle_id, 0.0)) >= throttle_s


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
        # Enviar en paralelo con timeout corto: un cliente lento no bloquea al resto.
        sockets = list(self._connections.get(tenant_id, set()))
        if not sockets:
            return

        async def _send_one(ws: WebSocket) -> WebSocket | None:
            try:
                await asyncio.wait_for(ws.send_json(message), timeout=2.0)
                return None
            except (asyncio.TimeoutError, Exception):
                return ws

        results = await asyncio.gather(*(_send_one(w) for w in sockets), return_exceptions=False)
        for ws in (r for r in results if r is not None):
            self._connections[tenant_id].discard(ws)
            try:
                await ws.close()
            except Exception:
                pass

    async def broadcast_to_all(self, message: dict) -> None:
        # Paralelizar entre tenants también — cada uno ya es no-bloqueante internamente.
        tenants = list(self._connections)
        if not tenants:
            return
        await asyncio.gather(
            *(self.broadcast_to_tenant(t, message) for t in tenants),
            return_exceptions=True,
        )


async def broadcast_telemetry_task(redis, manager: ConnectionManager) -> None:
    last_id = "$"
    _last_sent: dict[str, float] = {}   # vehicle_id → monotonic del último emit
    _last_state: dict[str, tuple] = {}  # vehicle_id → (online, ignition) del último emit
    _last_cleanup = time.monotonic()
    _CLEANUP_INTERVAL_S = 300.0

    while True:
        try:
            entries = await redis.xread({"telemetry.raw": last_id}, block=1000, count=50)
            now_mono = time.monotonic()
            for _stream, messages in entries:
                for msg_id, fields in messages:
                    last_id = msg_id
                    try:
                        payload = json.loads(
                            fields["payload"] if isinstance(fields, dict) and "payload" in fields
                            else fields[b"payload"]
                        )
                        ws_type = payload.pop("_ws_type", "telemetry")
                        if ws_type == "telemetry":
                            payload = _enrich_payload(payload)
                            vehicle_id = payload.get("vehicle_id")
                            if vehicle_id and not _should_emit(
                                vehicle_id,
                                payload.get("online"),
                                payload.get("ignition"),
                                _last_sent,
                                _last_state,
                                now_mono,
                            ):
                                continue
                            if vehicle_id:
                                _last_sent[vehicle_id] = now_mono
                                _last_state[vehicle_id] = (payload.get("online"), payload.get("ignition"))
                        tenant_id = payload.get("tenant_id")
                        msg = {"type": ws_type, "data": payload}
                        if tenant_id:
                            await manager.broadcast_to_tenant(tenant_id, msg)
                        # CMG admins ven todos los tenants — conexiones registradas bajo "__cmg__"
                        await manager.broadcast_to_tenant("__cmg__", msg)
                    except Exception as exc:
                        logger.warning("WS broadcast parse error: %s", exc)

            # Limpieza periódica: eliminar vehículos sin reportar en los últimos 5 min
            if now_mono - _last_cleanup > _CLEANUP_INTERVAL_S:
                _last_cleanup = now_mono
                cutoff = now_mono - _CLEANUP_INTERVAL_S
                stale = [vid for vid, t in _last_sent.items() if t < cutoff]
                for vid in stale:
                    _last_sent.pop(vid, None)
                    _last_state.pop(vid, None)
                if stale:
                    logger.debug("Throttle cleanup: %d vehículos eliminados", len(stale))
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
