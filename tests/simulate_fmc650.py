"""
Simula un Teltonika FMC650 conectándose al servidor TCP de CMG Telematics.

Uso:
    python tests/simulate_fmc650.py [--host HOST] [--port PORT] [--imei IMEI]

Envía:
  - Handshake IMEI
  - 5 paquetes de telemetría con datos realistas (GPS Valencia, presión hidráulica)
  - Espera comandos del servidor y los imprime
"""
import asyncio
import struct
import time
import random
import sys
import os
import argparse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.services.teltonika.codec8 import build_codec8_packet


IMEI = "352000000000001"
SERVER_HOST = "213.210.20.183"
SERVER_PORT = 5027

# Valencia GPS coordinates
BASE_LAT = 39.4561
BASE_LNG = -0.3539


async def _drain_commands(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    timeout: float = 0.3,
):
    """
    Drain any server-initiated command frames from the receive buffer.
    The real FMC650 processes the full socket buffer after each ACK.
    Frame format: [2 bytes big-endian length][N bytes ASCII command]
    Device must echo the frame back as confirmation.
    """
    buf = bytearray()
    try:
        chunk = await asyncio.wait_for(reader.read(512), timeout=timeout)
        buf.extend(chunk)
    except asyncio.TimeoutError:
        return  # No pending commands

    offset = 0
    while offset + 2 <= len(buf):
        cmd_length = struct.unpack_from(">H", buf, offset)[0]
        if cmd_length == 0 or cmd_length > 256:
            break  # Not a command frame
        end = offset + 2 + cmd_length
        if end > len(buf):
            break  # Incomplete frame, shouldn't happen
        command = buf[offset + 2 : end].decode("ascii", errors="replace")
        print(f"[SIM] Remote command received: '{command}'")
        # Echo back as confirmation
        writer.write(bytes(buf[offset:end]))
        await writer.drain()
        print(f"[SIM] Command echoed back as confirmation")
        offset = end


async def simulate(host: str, port: int, imei: str):
    print(f"[SIM] Connecting to {host}:{port} with IMEI {imei}")
    reader, writer = await asyncio.open_connection(host, port)
    print(f"[SIM] Connected")

    try:
        # === Handshake IMEI ===
        imei_bytes = imei.encode("ascii")
        writer.write(struct.pack(">H", len(imei_bytes)) + imei_bytes)
        await writer.drain()

        response = await asyncio.wait_for(reader.read(1), timeout=10)
        if response == b"\x01":
            print(f"[SIM] IMEI accepted ✓")
        elif response == b"\x00":
            print(f"[SIM] IMEI REJECTED by server. Is IMEI {imei} in the database?")
            return
        else:
            print(f"[SIM] Unexpected response: {response!r}")
            return

        # === Send telemetry records ===
        for i in range(5):
            lat = BASE_LAT + random.uniform(-0.005, 0.005)
            lng = BASE_LNG + random.uniform(-0.005, 0.005)
            speed = random.randint(0, 60)
            pressure_mv = random.randint(15000, 25000)  # 15-25 V → 90-150 bar
            voltage_mv = random.randint(23800, 24500)   # ~24V supply

            record = {
                "timestamp_ms": int(time.time() * 1000),
                "priority": 0,
                "lat": lat,
                "lng": lng,
                "altitude": 15,
                "angle": random.randint(0, 359),
                "satellites": random.randint(6, 12),
                "speed": speed,
                "event_io_id": 0,
                "io": {
                    1:   1,             # ignition ON
                    9:   pressure_mv,   # AIN1 = presión hidráulica
                    10:  5200,          # AIN2 = caudal
                    21:  4,             # GSM signal 4/5
                    66:  voltage_mv,    # alimentación 24V
                    179: 1,             # DOUT1 = bomba ON
                    180: 0,             # DOUT2 = válvula OFF
                    181: 0,
                    182: 0,
                },
            }

            packet = build_codec8_packet([record])
            writer.write(packet)
            await writer.drain()

            # Read exactly 4 bytes for ACK
            ack = await asyncio.wait_for(reader.readexactly(4), timeout=10)
            n_records = struct.unpack(">I", ack)[0]
            print(
                f"[SIM] Record {i+1}/5 sent ✓  "
                f"(lat={lat:.5f}, lng={lng:.5f}, speed={speed} km/h, "
                f"AIN1={pressure_mv}mV → {pressure_mv*0.006:.1f}bar)  "
                f"ACK={n_records}"
            )

            # After each ACK, drain any pending commands from the server.
            # The real FMC650 reads the full socket buffer — not just 4 bytes.
            # The server may have sent a command right after the ACK.
            await _drain_commands(reader, writer)

            await asyncio.sleep(2)

        # === Final wait for commands ===
        print("[SIM] Waiting for remote commands (5s)...")
        try:
            await asyncio.wait_for(_drain_commands(reader, writer, timeout=5.0), timeout=8)
        except asyncio.TimeoutError:
            print("[SIM] No commands received — OK")

    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        print("[SIM] Simulation completed ✓")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Teltonika FMC650 simulator")
    parser.add_argument("--host", default=SERVER_HOST)
    parser.add_argument("--port", type=int, default=SERVER_PORT)
    parser.add_argument("--imei", default=IMEI)
    args = parser.parse_args()

    asyncio.run(simulate(args.host, args.port, args.imei))
