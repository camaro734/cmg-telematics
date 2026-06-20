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

# Campos de ubicación a ocultar en el WS cuando hide_location_from_upstream=True.
# Solo en el canal upstream (fabricante, __cmg__); el dueño siempre recibe todo.
_WS_LOC_FIELDS: frozenset[str] = frozenset({
    "lat", "lon", "lng", "speed_kmh", "heading", "altitude_m",
})


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


def _broadcast_channels(
    tenant_id: str | None,
    manufacturer_tenant_id: str | None,
    ws_type: str,
) -> list[str]:
    """Canales WS a los que emitir según tipo de evento.

    El fabricante recibe telemetría de sus vehículos asignados a clientes.
    Las alertas NO llegan al fabricante: pertenecen al tenant propietario.
    Cuando la Pieza 3 active el consentimiento explícito, añadir aquí la lógica.
    """
    channels: list[str] = []
    if tenant_id:
        channels.append(tenant_id)
    if ws_type == "telemetry" and manufacturer_tenant_id and manufacturer_tenant_id != tenant_id:
        channels.append(manufacturer_tenant_id)
    channels.append("__cmg__")
    return channels


async def warmup_location_privacy_cache(redis) -> None:
    """Precarga en Redis los sets loc_viewers:{vehicle_id} desde location_access_grant.

    Estructura en Redis:
      loc_viewers:_sentinel  TTL=90s  — ausente → fail-safe (nadie fuera del dueño ve)
      loc_viewers:{id}       SET      TTL=120s — tenant_ids/tokens que tienen grant

    El dueño (vehicle.tenant_id) nunca se guarda en el set: su acceso se garantiza
    por comparación directa tenant_id == vehicle.tenant_id en el hot path.
    TTL sentinel < TTL viewers: si el refresher falla, sentinel expira primero →
    _get_location_viewers devuelve None → fail-safe privado en el WS.
    """
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.models.location_access_grant import LocationAccessGrant
    from app.models.tenant import Tenant

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(
                LocationAccessGrant.vehicle_id,
                Tenant.tier,
                Tenant.parent_manufacturer_id,
            ).join(Tenant, Tenant.id == LocationAccessGrant.granting_tenant_id)
        )
        rows = result.all()

    # viewer_key: el PADRE del granting_tenant es quien gana visibilidad
    viewers_by_vehicle: dict[str, set[str]] = {}
    for row in rows:
        vid = str(row.vehicle_id)
        viewers_by_vehicle.setdefault(vid, set())
        if row.tier == "client" and row.parent_manufacturer_id:
            viewers_by_vehicle[vid].add(str(row.parent_manufacturer_id))
        elif row.tier == "manufacturer":
            viewers_by_vehicle[vid].add("__cmg__")

    pipe = redis.pipeline()
    for vid, viewers in viewers_by_vehicle.items():
        if viewers:
            pipe.delete(f"loc_viewers:{vid}")
            pipe.sadd(f"loc_viewers:{vid}", *viewers)
            pipe.expire(f"loc_viewers:{vid}", 120)
    # Sentinel TTL 90s < viewers TTL 120s: garantiza que expire primero.
    pipe.set("loc_viewers:_sentinel", "1", ex=90)
    await pipe.execute()
    logger.info("loc_viewers_cache_warmed", extra={"count": len(viewers_by_vehicle)})


async def loc_private_refresher(redis) -> None:
    """Refresca la caché loc_viewers cada 60 s. Máxima latencia tras POST/DELETE grant: 60 s."""
    while True:
        try:
            await asyncio.sleep(60)
            await warmup_location_privacy_cache(redis)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("loc_viewers_refresh_failed: %s", exc)


async def _get_location_viewers(redis, vehicle_id: str) -> frozenset[str] | None:
    """Devuelve el set de canales con grant explícito para este vehículo.

    Usa pipeline GET+SMEMBERS (1 round-trip).
    None  → sentinel ausente → cache no inicializada → fail-safe: nadie fuera del dueño ve.
    frozenset vacío → sentinel presente pero sin grants → nadie fuera del dueño ve.
    frozenset con IDs → esos canales (tenant_id / "__cmg__") pueden ver la ubicación.
    """
    try:
        pipe = redis.pipeline()
        pipe.get("loc_viewers:_sentinel")
        pipe.smembers(f"loc_viewers:{vehicle_id}")
        sentinel, viewers = await pipe.execute()
    except Exception:
        return None  # fail-safe
    if sentinel is None:
        return None  # cache no inicializada → fail-safe
    return frozenset(viewers or set())


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
                        manufacturer_tenant_id = payload.get("manufacturer_tenant_id")

                        # Privacidad de ubicación: obtener set de canales con grant (1 round-trip)
                        viewers: frozenset[str] | None = None
                        if ws_type == "telemetry" and vehicle_id:
                            viewers = await _get_location_viewers(redis, str(vehicle_id))

                        full_msg = {"type": ws_type, "data": payload}
                        for channel in _broadcast_channels(tenant_id, manufacturer_tenant_id, ws_type):
                            if channel == tenant_id:
                                # Dueño siempre recibe todo — no consulta Redis
                                await manager.broadcast_to_tenant(channel, full_msg)
                            elif viewers is not None and channel in viewers:
                                # Grant explícito → ubicación visible
                                await manager.broadcast_to_tenant(channel, full_msg)
                            else:
                                # Sin grant o cache no inicializada → fail-safe: strip
                                stripped = {
                                    k: (None if k in _WS_LOC_FIELDS else v)
                                    for k, v in payload.items()
                                }
                                await manager.broadcast_to_tenant(channel, {"type": ws_type, "data": stripped})
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
