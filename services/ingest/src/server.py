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
from src.codec8 import decode_packet, build_ack, build_codec12_command
from src.writer import write_record, get_device_info, update_device_online, update_device_last_packet
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
    """Actualiza un registro de comando a status=confirmed con el ACK del dispositivo."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.patch(
                f"{settings.core_api_url}/internal/commands/{log_id}/confirm",
                headers=_internal_headers(),
                json={"response": response, "status": "confirmed"},
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
                async with self.db_pool.acquire() as conn:
                    await update_device_online(conn, self.imei, False)
                if self.device_info:
                    try:
                        await set_vehicle_offline(self.redis, self.device_info["vehicle_id"])
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
            header = await self.reader.readexactly(8)
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
            try:
                records = decode_packet(packet)
            except ValueError as e:
                if codec_id == 0x0C:
                    # Codec 12 response del dispositivo — logueamos y confirmamos el comando
                    try:
                        resp_size = struct.unpack_from(">I", packet, 11)[0]
                        resp_text = packet[15:15 + resp_size].decode("ascii", errors="replace").strip()
                        logger.info("Codec 12 ACK de %s: %r", self.imei, resp_text)
                        last_log_id = await self.redis.get(f"command:{self.imei}:last_log_id")
                        if last_log_id:
                            await _confirm_command(last_log_id, resp_text)
                            await self.redis.delete(f"command:{self.imei}:last_log_id")
                    except Exception:
                        logger.info("Codec 12 ACK de %s (sin texto)", self.imei)
                else:
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

            for avl in records:
                await publish_record(
                    self.redis, avl,
                    self.device_info["device_id"],
                    self.device_info["vehicle_id"],
                    self.device_info["tenant_id"],
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
