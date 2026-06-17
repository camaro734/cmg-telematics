# services/ingest/src/server.py
"""
TCP server asyncio para dispositivos Teltonika FMC650.
Flujo: IMEI handshake → ACK/NACK → receive Codec 8 loop → write DB + publish Redis
"""
import asyncio
import asyncpg
import httpx
import json
import logging
import struct
from redis.asyncio import Redis
from src.codec8 import decode_packet, build_ack, build_codec12_command, parse_codec12_response, is_fmc_error_response
from src.writer import write_record, get_device_info, update_device_online, update_device_last_packet
from src.data_usage import record_device_data_usage
from src.publisher import publish_record, set_vehicle_offline
from src.config import settings

logger = logging.getLogger(__name__)

# IMEI → StreamWriter registry for active connections
_active_writers: dict[str, asyncio.StreamWriter] = {}

# Límite de conexiones TCP concurrentes — previene agotamiento de recursos
_MAX_CONCURRENT_CONNECTIONS = 500
_connection_semaphore = asyncio.Semaphore(_MAX_CONCURRENT_CONNECTIONS)

# Máximo tamaño de paquete Codec 8 — previene ataques de memoria
_MAX_PACKET_BYTES = 65_536

# Estado de conexión TCP en Redis: refleja qué dispositivos están conectados AHORA
# (no "visto hace <60 min"). core-api lo usa para saber si un comando Codec 12 es
# entregable en este instante. TTL como backstop si el proceso muere sin limpiar;
# refresh_connections() lo renueva mientras la conexión siga viva.
_CONN_TTL_S = 90


def _conn_key(imei: str) -> str:
    return f"ingest:conn:{imei}"


def _internal_headers() -> dict[str, str]:
    """Cabecera de autenticación interna para llamadas a core-api /internal."""
    if settings.internal_api_key:
        return {"X-Internal-Key": settings.internal_api_key}
    return {}


async def _log_command(
    device_id: str,
    vehicle_id: str,
    tenant_id: str,
    command: str,
    status: str,
    error_message: str | None = None,
) -> str | None:
    """Registra un comando DOUT en core-api. Devuelve el ID del log o None si falla."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(
                f"{settings.core_api_url}/internal/commands/log",
                headers=_internal_headers(),
                json={
                    "device_id": device_id,
                    "vehicle_id": vehicle_id,
                    "tenant_id": tenant_id,
                    "command": command,
                    "status": status,
                    "error_message": error_message,
                },
            )
            if r.status_code == 201:
                return r.json()["id"]
            logger.warning("_log_command: respuesta inesperada %s", r.status_code)
    except Exception as e:
        logger.warning("No se pudo registrar comando en BD: %s", e)
    return None


async def _confirm_command(log_id: str, response: str) -> None:
    """Actualiza un registro de comando con el ACK del dispositivo.

    Si el FMC respondió con WARNING/ERROR, el comando NO se aplicó: status=failed."""
    status = "failed" if is_fmc_error_response(response) else "confirmed"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.patch(
                f"{settings.core_api_url}/internal/commands/{log_id}/confirm",
                headers=_internal_headers(),
                json={"response": response, "status": status},
            )
    except Exception as e:
        logger.warning("No se pudo confirmar comando %s: %s", log_id, e)


class TeltonikaConnection:
    def __init__(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
        db_pool: asyncpg.Pool,
        redis: Redis,
    ):
        self.reader = reader
        self.writer = writer
        self.db_pool = db_pool
        self.redis = redis
        self.imei: str | None = None
        self.device_info: dict | None = None
        self.peer = writer.get_extra_info("peername")

    async def handle(self) -> None:
        logger.info("Conexión nueva desde %s", self.peer)
        try:
            # Timeout en handshake: previene conexiones que nunca envían IMEI (DoS)
            await asyncio.wait_for(self._handshake(), timeout=30.0)
            if not self.device_info:
                return
            await self._receive_loop()
        except asyncio.TimeoutError:
            logger.warning("Timeout en handshake desde %s — conexión cerrada", self.peer)
        except (asyncio.IncompleteReadError, ConnectionResetError):
            logger.info("Conexión cerrada por dispositivo %s", self.imei or self.peer)
        except Exception as e:
            logger.error("Error en conexión %s: %s", self.peer, e)
        finally:
            if self.imei:
                # Solo eliminar si aún apunta a este writer; una reconexión rápida
                # del mismo IMEI habría registrado un writer nuevo que no debemos borrar.
                if _active_writers.get(self.imei) is self.writer:
                    _active_writers.pop(self.imei, None)
                    # Borrar el marcador de conexión TCP solo si seguía siendo el nuestro;
                    # una reconexión rápida ya habría puesto la key de nuevo.
                    try:
                        await self.redis.delete(_conn_key(self.imei))
                    except Exception as e:
                        logger.warning("No se pudo limpiar ingest:conn de %s: %s", self.imei, e)
                async with self.db_pool.acquire() as conn:
                    await update_device_online(conn, self.imei, False)
                if self.device_info:
                    try:
                        await set_vehicle_offline(
                            self.redis,
                            self.device_info["vehicle_id"],
                            self.device_info["tenant_id"],
                            self.device_info.get("manufacturer_tenant_id"),
                        )
                    except Exception as e:
                        logger.warning("No se pudo marcar offline en Redis: %s", e)
            self.writer.close()

    async def _handshake(self) -> None:
        """Lee el IMEI y responde ACK 0x01 o NACK 0x00."""
        imei_len_bytes = await self.reader.readexactly(2)
        imei_len = struct.unpack(">H", imei_len_bytes)[0]
        imei_bytes = await self.reader.readexactly(imei_len)
        try:
            self.imei = imei_bytes.decode("ascii").strip()
        except UnicodeDecodeError:
            logger.warning("IMEI con bytes no-ASCII desde %s — rechazando", self.peer)
            self.writer.write(b"\x00")
            await self.writer.drain()
            return

        if not self.imei.isdigit() or not (10 <= len(self.imei) <= 20):
            logger.warning("IMEI con formato inválido %r desde %s — rechazando", self.imei, self.peer)
            self.writer.write(b"\x00")
            await self.writer.drain()
            return

        logger.info("IMEI recibido: %s", self.imei)

        async with self.db_pool.acquire() as conn:
            self.device_info = await get_device_info(conn, self.imei)

        if not self.device_info:
            logger.warning("IMEI no registrado: %s — rechazando conexión", self.imei)
            self.writer.write(b"\x00")
            await self.writer.drain()
            return

        self.writer.write(b"\x01")
        await self.writer.drain()
        logger.info("IMEI aceptado: %s → vehicle %s", self.imei, self.device_info["vehicle_id"])

        _active_writers[self.imei] = self.writer

        # Marcar conexión TCP viva en Redis (refrescada por refresh_connections).
        try:
            await self.redis.set(_conn_key(self.imei), "1", ex=_CONN_TTL_S)
        except Exception as e:
            logger.warning("No se pudo marcar ingest:conn de %s: %s", self.imei, e)

        async with self.db_pool.acquire() as conn:
            await update_device_online(conn, self.imei, True)

        # Re-aplicar último estado DOUT conocido al reconectar
        await self._restore_dout_state()

    async def _restore_dout_state(self) -> None:
        """Re-envía el último estado DOUT al dispositivo al reconectar."""
        dout_key = f"vehicle:{self.device_info['vehicle_id']}:dout"
        dout_raw = await self.redis.get(dout_key)
        if not dout_raw:
            return
        try:
            dout_state: dict[str, bool] = json.loads(dout_raw)
        except (ValueError, TypeError):
            return

        # Solo re-enviar si alguna salida está activa
        if not any(dout_state.values()):
            return

        chars = ["?", "?", "?", "?"]
        for slot_str, state in dout_state.items():
            slot = int(slot_str)
            if 1 <= slot <= 4:
                chars[slot - 1] = "1" if state else "0"

        command = f"setdigout {''.join(chars)} 0"
        packet = build_codec12_command(command)
        self.writer.write(packet)
        await self.writer.drain()
        logger.info("DOUT restaurado al reconectar %s: %s", self.imei, command)

    async def _receive_loop(self) -> None:
        """Recibe paquetes Codec 8 en bucle hasta que la conexión se cierre."""
        while True:
            # Timeout solo sobre el inicio del siguiente paquete (header): un socket
            # medio-abierto (pérdida de señal/corriente) dejaría el bucle colgado para
            # siempre y el flag `online` pegado en true. Al saltar el timeout salimos
            # limpiamente y handle() ejecuta el cleanup (set_vehicle_offline).
            try:
                header = await asyncio.wait_for(
                    self.reader.readexactly(8), timeout=settings.idle_timeout_s
                )
            except asyncio.TimeoutError:
                logger.info(
                    "Conexión inactiva %s — sin datos en %ds, cerrando para marcar offline",
                    self.imei or self.peer, settings.idle_timeout_s,
                )
                return
            data_length = struct.unpack_from(">I", header, 4)[0]
            if data_length > _MAX_PACKET_BYTES:
                logger.warning(
                    "Paquete sospechosamente grande (%d bytes) desde %s — cerrando conexión",
                    data_length, self.peer,
                )
                return
            body = await self.reader.readexactly(data_length + 4)  # +4 para CRC
            packet = header + body

            codec_id = packet[8] if len(packet) > 8 else 0

            # Codec 12: respuesta del dispositivo a un comando enviado (DOUT o Manual CAN).
            # Se intercepta ANTES del decode_packet porque decode_packet solo
            # entiende Codec 8/8E y lanzaría ValueError a propósito.
            if codec_id == 0x0C:
                # Éxito por presencia: cualquier respuesta Codec 12 que llegue es válida.
                # No se interpreta el contenido del texto para decidir OK/error.
                resp_text = parse_codec12_response(packet)
                if resp_text is None:
                    resp_text = ""  # 0x0C sin texto parseable; sigue siendo respuesta presente
                logger.info("Codec 12 respuesta de %s: %r", self.imei, resp_text)

                last_log_id = await self.redis.get(f"command:{self.imei}:last_log_id")
                if last_log_id:
                    # Entregar al endpoint que espera por BLPOP (flujo síncrono Manual CAN)
                    # y confirmar en BD (preserva el comportamiento DOUT existente).
                    await self.redis.lpush(f"command:{self.imei}:response", resp_text)
                    await self.redis.expire(f"command:{self.imei}:response", 20)
                    await _confirm_command(last_log_id, resp_text)
                    await self.redis.delete(f"command:{self.imei}:last_log_id")
                else:
                    # Sin comando pendiente: respuesta espontánea o de un comando ya
                    # expirado. Descartar para no emparejarla con el comando equivocado.
                    logger.warning("Codec 12 huérfano de %s, descartado", self.imei)
                continue

            try:
                records = decode_packet(packet)
            except ValueError as e:
                logger.error("Paquete inválido de %s (codec=0x%02x): %s", self.imei, codec_id, e)
                continue

            async with self.db_pool.acquire() as conn:
                for avl in records:
                    await write_record(
                        conn, avl,
                        self.device_info["device_id"],
                        self.device_info["vehicle_id"],
                        self.device_info["tenant_id"],
                    )
                await update_device_last_packet(
                    conn, self.imei, codec_id, len(records)
                )
                # Consumo SIM: suma los bytes del frame recibido (feature independiente)
                await record_device_data_usage(conn, self.imei, len(packet))

            for avl in records:
                await publish_record(
                    self.redis, avl,
                    self.device_info["device_id"],
                    self.device_info["vehicle_id"],
                    self.device_info["tenant_id"],
                    self.device_info.get("manufacturer_tenant_id"),
                )

            ack = build_ack(len(records))
            self.writer.write(ack)
            await self.writer.drain()
            logger.debug("Procesados %d registros de %s", len(records), self.imei)


async def command_listener(redis: Redis) -> None:
    """Escucha el canal Redis 'cmg:dout_commands' y envía comandos Codec 12 al dispositivo.
    Se reinicia automáticamente si Redis se desconecta temporalmente."""
    while True:
        try:
            pubsub = redis.pubsub()
            await pubsub.subscribe("cmg:dout_commands")
            logger.info("command_listener suscrito a cmg:dout_commands")
            async for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                try:
                    data = json.loads(message["data"])
                    imei: str = data["imei"]
                    command: str = data["command"]
                    device_id: str | None = data.get("device_id")
                    vehicle_id: str | None = data.get("vehicle_id")
                    tenant_id: str | None = data.get("tenant_id")

                    writer = _active_writers.get(imei)
                    if writer is None:
                        logger.warning("DOUT: dispositivo %s no está conectado", imei)
                        if device_id and vehicle_id and tenant_id:
                            await _log_command(
                                device_id, vehicle_id, tenant_id, command,
                                "failed", error_message="Dispositivo no conectado",
                            )
                        continue

                    packet = build_codec12_command(command)
                    writer.write(packet)
                    await writer.drain()
                    logger.info("DOUT enviado a %s: %s", imei, command)

                    if device_id and vehicle_id and tenant_id:
                        log_id = await _log_command(device_id, vehicle_id, tenant_id, command, "sent")
                        if log_id:
                            # TTL 120s — suficiente para que el ACK llegue del dispositivo
                            await redis.set(f"command:{imei}:last_log_id", log_id, ex=120)
                except Exception as e:
                    logger.error("Error procesando comando DOUT: %s", e)
        except Exception as e:
            logger.error("command_listener: error en pubsub, reintentando en 5s: %s", e)
            await asyncio.sleep(5)


async def manual_can_listener(redis: Redis) -> None:
    """Escucha el canal Redis 'cmg:manual_can_commands' y envía comandos Codec 12
    (setparam Manual CAN) al dispositivo. Mismo patrón de reconexión que command_listener.

    A diferencia del DOUT (fire-and-forget), aquí el API espera la respuesta por BLPOP:
    - dispositivo no conectado → LPUSH 'DISCONNECTED' para que el API responda 503
      de inmediato, sin agotar el timeout completo.
    - enviado OK → SET command:{imei}:last_log_id (TTL 20s) para emparejar la respuesta.
    El log_id lo crea el API antes de publicar; aquí solo se reenvía."""
    while True:
        try:
            pubsub = redis.pubsub()
            await pubsub.subscribe("cmg:manual_can_commands")
            logger.info("manual_can_listener suscrito a cmg:manual_can_commands")
            async for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                try:
                    data = json.loads(message["data"])
                    imei: str = data["imei"]
                    command: str = data["command"]
                    log_id: str | None = data.get("log_id")

                    writer = _active_writers.get(imei)
                    if writer is None:
                        logger.warning("Manual CAN: dispositivo %s no está conectado", imei)
                        # Respuesta inmediata: el API contesta 503 sin esperar el timeout.
                        await redis.lpush(f"command:{imei}:response", "DISCONNECTED")
                        await redis.expire(f"command:{imei}:response", 20)
                        continue

                    packet = build_codec12_command(command)
                    writer.write(packet)
                    await writer.drain()
                    logger.info("Manual CAN enviado a %s: %s", imei, command)

                    if log_id:
                        # TTL 20s — ventana para emparejar la respuesta Codec 12 entrante.
                        await redis.set(f"command:{imei}:last_log_id", log_id, ex=20)
                except Exception as e:
                    logger.error("Error procesando comando Manual CAN: %s", e)
        except Exception as e:
            logger.error("manual_can_listener: error en pubsub, reintentando en 5s: %s", e)
            await asyncio.sleep(5)


async def refresh_connections(redis: Redis) -> None:
    """Refresca el TTL de las conexiones TCP activas en Redis cada 30 s.

    Mantiene viva la key ingest:conn:{imei} mientras el writer siga en
    _active_writers, para que core-api distinga "conectado ahora" de
    "visto hace rato". TTL 90 s da margen 3x sobre el período de refresco.
    """
    while True:
        await asyncio.sleep(30)
        try:
            imeis = list(_active_writers.keys())
            if not imeis:
                continue
            pipe = redis.pipeline()
            for imei in imeis:
                pipe.set(_conn_key(imei), "1", ex=_CONN_TTL_S)
            await pipe.execute()
        except Exception as e:
            logger.warning("refresh_connections falló: %s", e)


async def run_server(db_pool: asyncpg.Pool, redis: Redis) -> None:
    server = await asyncio.start_server(
        lambda r, w: TeltonikaConnection(r, w, db_pool, redis).handle(),
        host=settings.tcp_host,
        port=settings.tcp_port,
        limit=1024 * 1024,
    )
    addr = server.sockets[0].getsockname()
    logger.info("TCP Teltonika escuchando en %s:%s", *addr)
    async with server:
        await server.serve_forever()
