# services/ingest/src/server.py
"""
TCP server asyncio para dispositivos Teltonika FMC650.
Flujo: IMEI handshake → ACK/NACK → receive Codec 8 loop → write DB + publish Redis
"""
import asyncio
import asyncpg
import json
import logging
import struct
from redis.asyncio import Redis
from src.codec8 import decode_packet, build_ack, build_codec12_command
from src.writer import write_record, get_device_info, update_device_online
from src.publisher import publish_record, set_vehicle_offline
from src.config import settings

logger = logging.getLogger(__name__)

# IMEI → StreamWriter registry for active connections
_active_writers: dict[str, asyncio.StreamWriter] = {}


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
            await self._handshake()
            if not self.device_info:
                return
            await self._receive_loop()
        except (asyncio.IncompleteReadError, ConnectionResetError):
            logger.info("Conexión cerrada por dispositivo %s", self.imei or self.peer)
        except Exception as e:
            logger.error("Error en conexión %s: %s", self.peer, e)
        finally:
            if self.imei:
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
        self.imei = imei_bytes.decode("ascii")
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

    async def _receive_loop(self) -> None:
        """Recibe paquetes Codec 8 en bucle hasta que la conexión se cierre."""
        while True:
            header = await self.reader.readexactly(8)
            data_length = struct.unpack_from(">I", header, 4)[0]
            body = await self.reader.readexactly(data_length + 4)  # +4 para CRC
            packet = header + body

            try:
                records = decode_packet(packet)
            except ValueError as e:
                codec_id = packet[8] if len(packet) > 8 else 0
                if codec_id == 0x0C:
                    # Codec 12 response from device (ACK to a GPRS command) — expected, discard
                    logger.debug("Codec 12 response de %s (ignorado)", self.imei)
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
    """Escucha el canal Redis 'cmg:dout_commands' y envía comandos Codec 12 al dispositivo."""
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
            writer = _active_writers.get(imei)
            if writer is None:
                logger.warning("DOUT: dispositivo %s no está conectado", imei)
                continue
            packet = build_codec12_command(command)
            writer.write(packet)
            await writer.drain()
            logger.info("DOUT enviado a %s: %s", imei, command)
        except Exception as e:
            logger.error("Error procesando comando DOUT: %s", e)


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
