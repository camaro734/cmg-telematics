# tests/ingest/test_ingest_integration.py
"""
Test de integración: simula un FMC650 conectándose al ingest-svc.
Requiere que docker compose esté corriendo con postgres + redis + ingest-svc.
"""
import asyncio
import struct
import pytest

INGEST_HOST = "localhost"
INGEST_PORT = 5027
TEST_IMEI = "000000000000001"


def build_imei_packet(imei: str) -> bytes:
    encoded = imei.encode("ascii")
    return struct.pack(">H", len(encoded)) + encoded


def build_codec8_packet() -> bytes:
    """Construye un paquete Codec 8 mínimo con 1 registro."""
    import time
    ts_ms = int(time.time() * 1000)

    avl = struct.pack(">Q", ts_ms)
    avl += b"\x00"                           # priority low
    avl += struct.pack(">i", -3785000)       # longitude
    avl += struct.pack(">i", 394730000)      # latitude
    avl += struct.pack(">h", 50)             # altitude 50m
    avl += struct.pack(">H", 0)              # angle 0
    avl += b"\x06"                           # 6 satellites
    avl += struct.pack(">H", 30)             # 30 km/h
    avl += b"\x00"                           # event IO ID
    avl += b"\x01"                           # total IOs
    avl += b"\x01"                           # count 1-byte IOs
    avl += b"\xef\x01"                       # IO 239 = 1 (ignition on)
    avl += b"\x00\x00\x00"                   # 2,4,8-byte IOs = 0 each

    data = b"\x08"  # codec ID
    data += b"\x01"  # num records 1
    data += avl
    data += b"\x01"  # num records 2

    length = struct.pack(">I", len(data))
    preamble = b"\x00\x00\x00\x00"
    crc = b"\x00\x00\x00\x00"
    return preamble + length + data + crc


@pytest.mark.asyncio
async def test_ingest_accepts_registered_imei():
    """El servidor acepta el IMEI y responde 0x01."""
    reader, writer = await asyncio.open_connection(INGEST_HOST, INGEST_PORT)
    writer.write(build_imei_packet(TEST_IMEI))
    await writer.drain()
    response = await asyncio.wait_for(reader.readexactly(1), timeout=5.0)
    assert response == b"\x01", f"Esperaba ACK 0x01, recibí {response.hex()}"
    writer.close()
    await writer.wait_closed()


@pytest.mark.asyncio
async def test_ingest_rejects_unknown_imei():
    """El servidor rechaza IMEIs no registrados con 0x00."""
    reader, writer = await asyncio.open_connection(INGEST_HOST, INGEST_PORT)
    writer.write(build_imei_packet("999999999999999"))
    await writer.drain()
    response = await asyncio.wait_for(reader.readexactly(1), timeout=5.0)
    assert response == b"\x00", f"Esperaba NACK 0x00, recibí {response.hex()}"
    writer.close()
    await writer.wait_closed()
