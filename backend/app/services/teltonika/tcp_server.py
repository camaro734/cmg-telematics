"""
Teltonika FMC650 TCP Server.

Each device maintains a persistent TCP connection.
Protocol: Codec 8 (see codec8.py).
"""
import asyncio
import struct
import logging
import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, update

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.device import Device
from app.models.telemetry import TelemetryRecord
from app.models.variable_map import VariableMap
from app.models.alert_rule import AlertRule
from app.models.alert_log import AlertLog
from app.models.geofence import Geofence, GeofenceEvent
from app.models.vehicle import Vehicle
from app.services.geofence import is_inside_geofence
from app.services.teltonika.codec8 import parse_codec8, AVLRecord
from app.services.teltonika import device_registry

logger = logging.getLogger(__name__)


class _null_context:
    """Async context manager that does nothing — used when no lock is available."""
    async def __aenter__(self): return self
    async def __aexit__(self, *_): pass


class DeviceOfflineError(Exception):
    pass


class TeltonikaServer:
    def __init__(self):
        self._server: Optional[asyncio.Server] = None
        # Per-IMEI write locks (kept for safety)
        self._write_locks: dict[str, asyncio.Lock] = {}
        # Per-IMEI command queues: commands are flushed AFTER each ACK.
        # This guarantees the byte stream is always: ACK → command, never command → ACK.
        self._command_queues: dict[str, asyncio.Queue] = {}

    async def start(self):
        self._server = await asyncio.start_server(
            self.handle_client,
            host=settings.TCP_HOST,
            port=settings.TCP_PORT,
        )
        addrs = ", ".join(str(sock.getsockname()) for sock in self._server.sockets)
        logger.info(f"Teltonika TCP server listening on {addrs}")
        async with self._server:
            await self._server.serve_forever()

    async def stop(self):
        if self._server:
            self._server.close()
            await self._server.wait_closed()

    async def handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        peer = writer.get_extra_info("peername")
        logger.info(f"New connection from {peer}")
        imei: Optional[str] = None

        try:
            # Step 1: Read IMEI handshake
            # [2 bytes: IMEI length][N bytes: IMEI ASCII]
            length_bytes = await asyncio.wait_for(reader.readexactly(2), timeout=30)
            imei_length = struct.unpack(">H", length_bytes)[0]

            if imei_length != 15:
                logger.warning(f"Invalid IMEI length {imei_length} from {peer}")
                writer.write(b'\x00')
                await writer.drain()
                return

            imei_bytes = await asyncio.wait_for(reader.readexactly(imei_length), timeout=10)
            imei = imei_bytes.decode("ascii").strip()
            logger.info(f"IMEI handshake from {peer}: {imei}")

            # Step 2: Validate IMEI against DB
            device = await self._get_device(imei)
            if device is None:
                logger.warning(f"Unknown IMEI {imei} from {peer} — rejected")
                writer.write(b'\x00')
                await writer.drain()
                return

            # Step 3: Accept
            writer.write(b'\x01')
            await writer.drain()
            logger.info(f"IMEI {imei} accepted (device_id={device.id})")

            # Step 4: Mark online
            self._write_locks[imei] = asyncio.Lock()
            self._command_queues[imei] = asyncio.Queue()
            await device_registry.register_device_online(imei, writer)
            await self._mark_device_online(device.id, True)

            # Step 5: Receive telemetry loop
            await self._telemetry_loop(reader, writer, imei, device)

        except asyncio.IncompleteReadError:
            logger.info(f"Connection closed by {peer} (IMEI={imei})")
        except asyncio.TimeoutError:
            logger.warning(f"Timeout waiting for data from {peer} (IMEI={imei})")
        except Exception as e:
            logger.error(f"Error handling {peer} (IMEI={imei}): {e}", exc_info=True)
        finally:
            if imei:
                self._write_locks.pop(imei, None)
                self._command_queues.pop(imei, None)
                await device_registry.unregister_device(imei)
                try:
                    device = await self._get_device(imei)
                    if device:
                        await self._mark_device_online(device.id, False)
                except Exception:
                    pass
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass
            logger.info(f"Connection from {peer} (IMEI={imei}) closed")

    async def _telemetry_loop(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
        imei: str,
        device: Device,
    ):
        while True:
            # === Phase 1: Receive data ===
            # Read first 4 bytes — either telemetry preamble (0x00000000)
            # or a command echo frame (2-byte length + first 2 bytes of ASCII command).
            first4 = await asyncio.wait_for(reader.readexactly(4), timeout=120)
            preamble = struct.unpack_from(">I", first4, 0)[0]

            if preamble != 0:
                # Not a telemetry preamble — interpret as command echo frame.
                # Frame: [2 bytes length][N bytes ASCII] — we have the first 4 bytes.
                cmd_length = struct.unpack_from(">H", first4, 0)[0]
                if cmd_length == 0 or cmd_length > 256:
                    logger.error(
                        f"Unexpected non-zero preamble {preamble:#010x} from IMEI {imei} "
                        f"(interpreted cmd_length={cmd_length}) — closing"
                    )
                    break
                # Read remaining bytes of the echo (we already have first4[2:4] = 2 bytes)
                remaining = cmd_length - 2
                if remaining > 0:
                    rest_echo = await asyncio.wait_for(
                        reader.readexactly(remaining), timeout=10
                    )
                    echo_cmd = (first4[2:] + rest_echo).decode("ascii", errors="replace")
                else:
                    echo_cmd = first4[2:2 + cmd_length].decode("ascii", errors="replace")
                logger.info(f"Command echo from IMEI {imei}: '{echo_cmd}'")
                continue  # Go back to reading next frame

            # It IS a telemetry preamble — read data_length (4 more bytes)
            data_length_bytes = await asyncio.wait_for(reader.readexactly(4), timeout=10)
            data_length = struct.unpack_from(">I", data_length_bytes, 0)[0]

            if data_length > 65536:
                logger.error(f"Suspiciously large packet {data_length} from IMEI {imei}")
                break

            # Read the rest: codec_id...crc (data_length bytes + 4 bytes CRC)
            rest = await asyncio.wait_for(
                reader.readexactly(data_length + 4), timeout=30
            )
            full_packet = first4 + data_length_bytes + rest

            try:
                records = parse_codec8(full_packet)
            except ValueError as e:
                logger.error(f"Codec8 parse error from {imei}: {e}")
                break

            logger.debug(f"IMEI {imei}: {len(records)} AVL records received")

            # === Phase 2: Process records, send ACK, then flush command queue ===
            saved = 0
            for avl in records:
                try:
                    await self._save_record(device, avl)
                    saved += 1
                    await device_registry.refresh_device_ttl(imei)
                except Exception as e:
                    logger.error(f"Error saving record for {imei}: {e}", exc_info=True)

            # ACK first, then flush any queued commands — guaranteed ordering.
            lock = self._write_locks.get(imei)
            ctx = lock if lock else _null_context()
            async with ctx:
                # Send ACK
                writer.write(struct.pack(">I", saved))
                await writer.drain()

                # Drain command queue — commands go AFTER the ACK, never before.
                cmd_queue = self._command_queues.get(imei)
                if cmd_queue:
                    while not cmd_queue.empty():
                        try:
                            cmd_frame = cmd_queue.get_nowait()
                            writer.write(cmd_frame)
                            await writer.drain()
                        except asyncio.QueueEmpty:
                            break

    async def _get_device(self, imei: str) -> Optional[Device]:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(Device).where(Device.imei == imei, Device.active == True)
            )
            return result.scalar_one_or_none()

    async def _mark_device_online(self, device_id, online: bool):
        async with AsyncSessionLocal() as session:
            await session.execute(
                update(Device)
                .where(Device.id == device_id)
                .values(
                    online=online,
                    **({} if not online else {"last_seen": datetime.now(timezone.utc)}),
                )
            )
            await session.commit()

    async def _save_record(self, device: Device, avl: AVLRecord):
        io = avl.io

        record = TelemetryRecord(
            time=datetime.fromtimestamp(avl.timestamp_ms / 1000.0, tz=timezone.utc),
            device_id=device.id,
            lat=avl.lat if avl.lat != 0 else None,
            lng=avl.lng if avl.lng != 0 else None,
            altitude=avl.altitude,
            speed=avl.speed,
            angle=avl.angle,
            satellites=avl.satellites,
            priority=avl.priority,
            ignition=bool(io.get(1)) if 1 in io else None,
            ext_voltage_mv=io.get(66),
            battery_mv=io.get(67),
            dout1=bool(io.get(179)) if 179 in io else None,
            dout2=bool(io.get(180)) if 180 in io else None,
            dout3=bool(io.get(181)) if 181 in io else None,
            dout4=bool(io.get(182)) if 182 in io else None,
            din1=bool(io.get(1)) if 1 in io else None,
            din2=bool(io.get(2)) if 2 in io else None,
            din3=bool(io.get(3)) if 3 in io else None,
            din4=bool(io.get(4)) if 4 in io else None,
            io_data={str(k): v for k, v in io.items()},
        )

        async with AsyncSessionLocal() as session:
            session.add(record)
            await session.commit()

        # Publish to Redis pubsub for WebSocket relay
        payload = {
            "device_id": str(device.id),
            "vehicle_id": str(device.vehicle_id) if device.vehicle_id else None,
            "imei": device.imei,
            "time": record.time.isoformat(),
            "lat": record.lat,
            "lng": record.lng,
            "speed": record.speed,
            "ignition": record.ignition,
            "ext_voltage_mv": record.ext_voltage_mv,
            "dout1": record.dout1,
            "dout2": record.dout2,
            "io_data": record.io_data,
        }
        await device_registry.publish_telemetry(str(device.id), payload)

        # Update last_seen
        async with AsyncSessionLocal() as session:
            await session.execute(
                update(Device)
                .where(Device.id == device.id)
                .values(last_seen=record.time, online=True)
            )
            await session.commit()

        # Fire-and-forget alert evaluation — does not block the ACK path
        asyncio.create_task(self._check_alerts(device, avl))
        # Fire-and-forget geofence evaluation — does not block the ACK path
        asyncio.create_task(self._check_geofences(device, avl))

    async def _check_alerts(self, device: Device, avl: AVLRecord):
        """
        Evaluate AlertRule thresholds for the vehicle.
        Fires AlertLog when condition is met (with cooldown).
        Resolves open alerts when condition clears.
        Runs as fire-and-forget task — never blocks the ACK path.
        """
        if device.vehicle_id is None:
            return

        # Mapping from column name to numeric IO ID for direct lookup
        IO_NAME_TO_ID: dict[str, int] = {
            "ignition": 1, "din1": 1, "din2": 2, "din3": 3, "din4": 4,
            "gsm_signal": 21,
            "ain1_mv": 9, "ain2_mv": 10, "ain3_mv": 11,
            "dout1": 179, "dout2": 180, "dout3": 181, "dout4": 182,
            "ext_voltage_mv": 66, "battery_mv": 67,
            "speed": 24,
        }

        def _resolve_value(io_key: str, io: dict) -> float | None:
            """Get raw value from AVL IO dict by column name or numeric string."""
            # Try named lookup first
            if io_key in IO_NAME_TO_ID:
                v = io.get(IO_NAME_TO_ID[io_key])
                return float(v) if v is not None else None
            # Try numeric string (e.g. "300" for CAN J1939)
            try:
                v = io.get(int(io_key))
                return float(v) if v is not None else None
            except (ValueError, TypeError):
                return None

        def _eval_condition(value: float, condition: str, threshold: float) -> bool:
            return {
                "gt": value > threshold, "lt": value < threshold,
                "gte": value >= threshold, "lte": value <= threshold,
                "eq": abs(value - threshold) < 1e-9,
                "neq": abs(value - threshold) >= 1e-9,
            }.get(condition, False)

        try:
            async with AsyncSessionLocal() as db:
                # Get all active rules for this vehicle OR fleet-wide (vehicle_id IS NULL)
                result = await db.execute(
                    select(AlertRule)
                    .where(AlertRule.active == True)
                    .where(
                        (AlertRule.vehicle_id == device.vehicle_id) |
                        (AlertRule.vehicle_id.is_(None))
                    )
                )
                rules = result.scalars().all()
                if not rules:
                    return

                io = avl.io
                now = datetime.now(timezone.utc)

                for rule in rules:
                    raw = _resolve_value(rule.io_key, io)
                    if raw is None:
                        continue

                    converted = raw * rule.scale_factor + rule.offset
                    condition_met = _eval_condition(converted, rule.condition, rule.threshold)

                    # Find last open alert for this rule + vehicle
                    open_result = await db.execute(
                        select(AlertLog)
                        .where(AlertLog.device_id == device.id)
                        .where(AlertLog.io_key == rule.io_key)
                        .where(AlertLog.rule_id == rule.id)
                        .where(AlertLog.resolved_at.is_(None))
                        .order_by(AlertLog.fired_at.desc())
                        .limit(1)
                    )
                    open_alert = open_result.scalar_one_or_none()

                    if open_alert and not condition_met:
                        # Condition cleared — resolve
                        open_alert.resolved_at = now
                        await db.commit()

                    elif not open_alert and condition_met:
                        # Check cooldown: was there a recent alert for this rule on this device?
                        from datetime import timedelta
                        cooldown_cutoff = now - timedelta(minutes=rule.cooldown_minutes)
                        recent_result = await db.execute(
                            select(AlertLog)
                            .where(AlertLog.device_id == device.id)
                            .where(AlertLog.rule_id == rule.id)
                            .where(AlertLog.fired_at >= cooldown_cutoff)
                            .limit(1)
                        )
                        if recent_result.scalar_one_or_none():
                            continue  # Still in cooldown

                        alert = AlertLog(
                            id=uuid.uuid4(),
                            device_id=device.id,
                            vehicle_id=device.vehicle_id,
                            rule_id=rule.id,
                            io_key=rule.io_key,
                            display_name=rule.display_name,
                            level=rule.level,
                            raw_value=raw,
                            converted_value=converted,
                            threshold=rule.threshold,
                            unit=rule.unit or "",
                            fired_at=now,
                        )
                        db.add(alert)
                        await db.commit()
                        logger.warning(
                            f"ALERT {rule.level.upper()}: {rule.display_name} = {converted:.2f} {rule.unit} "
                            f"(rule={rule.name}, condition={rule.condition} {rule.threshold}) "
                            f"for device {device.imei}"
                        )
                        alert_payload = {
                            "type": "alert",
                            "alert_id": str(alert.id),
                            "device_id": str(device.id),
                            "vehicle_id": str(device.vehicle_id),
                            "imei": device.imei,
                            "io_key": rule.io_key,
                            "display_name": rule.display_name,
                            "level": rule.level,
                            "converted_value": round(converted, 2),
                            "threshold": rule.threshold,
                            "unit": rule.unit or "",
                            "fired_at": now.isoformat(),
                        }
                        await device_registry.publish_alert(str(device.id), alert_payload)

        except Exception as e:
            logger.error(f"Error in _check_alerts for device {device.imei}: {e}")

    async def _check_geofences(self, device: Device, avl: AVLRecord):
        """
        Check if vehicle entered or exited any active geofences for its tenant.
        Compares current position against last known geofence event to detect transitions.
        Runs as an independent asyncio task — never blocks the ACK path.
        """
        if device.vehicle_id is None:
            return

        try:
            lat = avl.lat
            lng = avl.lng
            if not lat or not lng:
                return

            async with AsyncSessionLocal() as db:
                # Get vehicle for this device
                vehicle_result = await db.execute(
                    select(Vehicle).where(Vehicle.id == device.vehicle_id)
                )
                vehicle = vehicle_result.scalar_one_or_none()
                if not vehicle:
                    return

                # Get all active geofences for this tenant
                fences_result = await db.execute(
                    select(Geofence).where(
                        Geofence.tenant_id == vehicle.tenant_id,
                        Geofence.active == True,
                    )
                )
                geofences = fences_result.scalars().all()

                if not geofences:
                    return

                now = datetime.now(timezone.utc)

                for fence in geofences:
                    currently_inside = is_inside_geofence(lat, lng, fence)

                    # Check last known state for this device + geofence via last event
                    last_event_result = await db.execute(
                        select(GeofenceEvent)
                        .where(GeofenceEvent.geofence_id == fence.id)
                        .where(GeofenceEvent.device_id == device.id)
                        .order_by(GeofenceEvent.occurred_at.desc())
                        .limit(1)
                    )
                    last_event = last_event_result.scalar_one_or_none()

                    # Determine previous state
                    was_inside = (last_event.event_type == "enter") if last_event else False

                    if currently_inside and not was_inside and fence.alert_on_enter:
                        # ENTER event
                        event = GeofenceEvent(
                            id=uuid.uuid4(),
                            geofence_id=fence.id,
                            device_id=device.id,
                            vehicle_id=device.vehicle_id,
                            event_type="enter",
                            occurred_at=now,
                            lat=lat,
                            lng=lng,
                            geofence_name=fence.name,
                            vehicle_name=vehicle.name,
                        )
                        db.add(event)
                        await db.commit()
                        logger.info(f"GEOFENCE ENTER: {vehicle.name} entered '{fence.name}'")

                    elif not currently_inside and was_inside and fence.alert_on_exit:
                        # EXIT event
                        event = GeofenceEvent(
                            id=uuid.uuid4(),
                            geofence_id=fence.id,
                            device_id=device.id,
                            vehicle_id=device.vehicle_id,
                            event_type="exit",
                            occurred_at=now,
                            lat=lat,
                            lng=lng,
                            geofence_name=fence.name,
                            vehicle_name=vehicle.name,
                        )
                        db.add(event)
                        await db.commit()
                        logger.info(f"GEOFENCE EXIT: {vehicle.name} exited '{fence.name}'")

        except Exception as e:
            logger.error(f"Error in _check_geofences for device {device.imei}: {e}")

    async def send_command(self, imei: str, command: str) -> None:
        """
        Queue a command for delivery to a connected FMC650.

        Commands are flushed by the telemetry loop AFTER sending the ACK for each
        packet, ensuring they never interleave with ACK bytes in the TCP stream.
        """
        if not device_registry.is_connected(imei):
            raise DeviceOfflineError(f"Device {imei} is not connected")

        cmd_queue = self._command_queues.get(imei)
        if cmd_queue is None:
            raise DeviceOfflineError(f"Device {imei} has no command queue (disconnecting?)")

        cmd_bytes = command.encode("ascii")
        frame = struct.pack(">H", len(cmd_bytes)) + cmd_bytes
        await cmd_queue.put(frame)
        logger.info(f"Command queued for {imei}: {command!r}")


# Global singleton
teltonika_server = TeltonikaServer()
