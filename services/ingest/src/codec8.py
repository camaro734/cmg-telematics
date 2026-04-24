"""
Decodificador de los protocolos Teltonika Codec 8 y Codec 8 Extended.

Formato del paquete (ambos codecs):
  [0:4]   Preamble — siempre 0x00000000
  [4:8]   Data Field Length (uint32 big-endian)
  [8]     Codec ID — 0x08 (Codec 8) / 0x8E (Codec 8 Extended)
  [9]     Number of Data 1
  [10:N]  AVL Data records
  [N]     Number of Data 2 (debe coincidir con Number of Data 1)
  [N+1:N+5] CRC-16/IBM

GPS Element (15 bytes, idéntico en ambos codecs):
  [0:4]   Longitude (int32, grados * 10^7)
  [4:8]   Latitude  (int32, grados * 10^7)
  [8:10]  Altitude  (int16, metros)
  [10:12] Angle     (uint16, grados)
  [12]    Satellites (uint8)
  [13:15] Speed     (uint16, km/h)

IO Element — Codec 8:
  [0]     Event IO ID (uint8)
  [1]     N of Total IO (uint8)
  N of 1-byte IOs, pairs (IO_ID uint8, value uint8)
  N of 2-byte IOs, 4-byte IOs, 8-byte IOs (misma estructura)

IO Element — Codec 8 Extended (permite IDs > 255, necesario para Manual CAN):
  [0:2]   Event IO ID (uint16)
  [2:4]   N of Total IO (uint16)
  N of 1-byte IOs (uint16), pairs (IO_ID uint16, value uint8)
  N de 2/4/8-byte IOs igual pero IDs en uint16
"""
import struct
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class AVLRecord:
    timestamp_ms: int
    priority: int
    longitude: float
    latitude: float
    altitude_m: int
    heading: int
    satellites: int
    speed_kmh: int
    event_io_id: int
    io_elements: dict[int, int] = field(default_factory=dict)

    @property
    def datetime_utc(self) -> datetime:
        return datetime.fromtimestamp(self.timestamp_ms / 1000, tz=timezone.utc)


def decode_packet(data: bytes) -> list[AVLRecord]:
    """Decodifica un paquete Codec 8 o Codec 8 Extended. Devuelve lista de AVLRecord."""
    if len(data) < 10:
        raise ValueError("Paquete demasiado corto")

    preamble = struct.unpack_from(">I", data, 0)[0]
    if preamble != 0x00000000:
        raise ValueError(f"preamble inválido: {preamble:#010x}")

    data_length = struct.unpack_from(">I", data, 4)[0]
    expected_total = 4 + 4 + data_length + 4
    if len(data) < expected_total:
        raise ValueError(
            f"Paquete incompleto: esperado {expected_total} bytes, recibido {len(data)}"
        )

    codec_id = data[8]
    if codec_id == 0x08:
        decode_record = _decode_avl_record
    elif codec_id == 0x8E:
        decode_record = _decode_avl_record_extended
    else:
        raise ValueError(f"Codec ID no soportado: {codec_id:#04x}")

    num_records = data[9]
    offset = 10
    records: list[AVLRecord] = []

    for _ in range(num_records):
        rec, offset = decode_record(data, offset)
        records.append(rec)

    num_records_2 = data[offset]
    if num_records_2 != num_records:
        raise ValueError(f"Mismatch registros: {num_records} vs {num_records_2}")

    return records


def _decode_gps_and_common(data: bytes, offset: int) -> tuple[float, float, int, int, int, int, int]:
    """Lee GPS Element (15 bytes). Devuelve (lon, lat, alt, heading, sats, speed, nuevo_offset)."""
    lon_raw = struct.unpack_from(">i", data, offset)[0]
    lat_raw = struct.unpack_from(">i", data, offset + 4)[0]
    altitude_m = struct.unpack_from(">h", data, offset + 8)[0]
    heading = struct.unpack_from(">H", data, offset + 10)[0]
    satellites = data[offset + 12]
    speed_kmh = struct.unpack_from(">H", data, offset + 13)[0]
    return lon_raw / 1e7, lat_raw / 1e7, altitude_m, heading, satellites, speed_kmh, offset + 15


def _decode_avl_record(data: bytes, offset: int) -> tuple[AVLRecord, int]:
    """Codec 8: IO IDs y contadores en uint8."""
    try:
        timestamp_ms = struct.unpack_from(">Q", data, offset)[0]
        offset += 8
        priority = data[offset]
        offset += 1

        longitude, latitude, altitude_m, heading, satellites, speed_kmh, offset = \
            _decode_gps_and_common(data, offset)

        event_io_id = data[offset]
        offset += 1
        _total_ios = data[offset]
        offset += 1

        io_elements: dict[int, int] = {}
        for io_size in (1, 2, 4, 8):
            count = data[offset]
            offset += 1
            fmt = {1: "B", 2: ">H", 4: ">I", 8: ">Q"}[io_size]
            for _ in range(count):
                io_id = data[offset]
                offset += 1
                (value,) = struct.unpack_from(fmt, data, offset)
                offset += io_size
                io_elements[io_id] = value

        return AVLRecord(
            timestamp_ms=timestamp_ms, priority=priority,
            longitude=longitude, latitude=latitude, altitude_m=altitude_m,
            heading=heading, satellites=satellites, speed_kmh=speed_kmh,
            event_io_id=event_io_id, io_elements=io_elements,
        ), offset
    except struct.error as exc:
        raise ValueError(f"Paquete truncado o malformado en offset {offset}: {exc}") from exc


def _decode_avl_record_extended(data: bytes, offset: int) -> tuple[AVLRecord, int]:
    """Codec 8 Extended: IO IDs y contadores en uint16 (permite IDs > 255, p.ej. Manual CAN)."""
    try:
        timestamp_ms = struct.unpack_from(">Q", data, offset)[0]
        offset += 8
        priority = data[offset]
        offset += 1

        longitude, latitude, altitude_m, heading, satellites, speed_kmh, offset = \
            _decode_gps_and_common(data, offset)

        event_io_id = struct.unpack_from(">H", data, offset)[0]
        offset += 2
        _total_ios = struct.unpack_from(">H", data, offset)[0]
        offset += 2

        io_elements: dict[int, int] = {}
        for io_size in (1, 2, 4, 8):
            count = struct.unpack_from(">H", data, offset)[0]
            offset += 2
            fmt = {1: "B", 2: ">H", 4: ">I", 8: ">Q"}[io_size]
            for _ in range(count):
                io_id = struct.unpack_from(">H", data, offset)[0]
                offset += 2
                (value,) = struct.unpack_from(fmt, data, offset)
                offset += io_size
                io_elements[io_id] = value

        # Codec 8 Extended adds a 5th group: variable-length IOs (X Byte IO)
        x_count = struct.unpack_from(">H", data, offset)[0]
        offset += 2
        for _ in range(x_count):
            io_id = struct.unpack_from(">H", data, offset)[0]
            offset += 2
            io_len = struct.unpack_from(">H", data, offset)[0]
            offset += 2
            offset += io_len  # skip variable-length value

        return AVLRecord(
            timestamp_ms=timestamp_ms, priority=priority,
            longitude=longitude, latitude=latitude, altitude_m=altitude_m,
            heading=heading, satellites=satellites, speed_kmh=speed_kmh,
            event_io_id=event_io_id, io_elements=io_elements,
        ), offset
    except struct.error as exc:
        raise ValueError(f"Paquete truncado o malformado en offset {offset}: {exc}") from exc


def build_ack(num_records: int) -> bytes:
    """Construye el ACK de 4 bytes que el servidor devuelve al dispositivo."""
    return struct.pack(">I", num_records)


def _crc16(data: bytes) -> int:
    """CRC-16/IBM usado por Teltonika (poly=0xA001, init=0x0000, refIn=True, refOut=True)."""
    crc = 0
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return crc


def build_codec12_command(command: str) -> bytes:
    """Construye un paquete Codec 12 con un comando GPRS (setdigout, etc.)."""
    cmd_bytes = command.encode("ascii")
    data = (
        b"\x0C"                        # Codec ID 12
        + b"\x01"                      # Quantity 1
        + b"\x05"                      # Type: GPRS command
        + struct.pack(">I", len(cmd_bytes))
        + cmd_bytes
        + b"\x01"                      # Quantity 2
    )
    crc = _crc16(data)
    return (
        b"\x00\x00\x00\x00"            # Preamble
        + struct.pack(">I", len(data)) # Data length
        + data
        + struct.pack(">I", crc)       # CRC-16 as uint32
    )


def build_setdigout(slot: int, state: bool) -> str:
    """
    Construye el comando setdigout para FMC650 (4 DOUTs).
    slot=1..4 → DOUT1..DOUT4. '?' = sin cambio en los demás. Timeout 0 = permanente.
    """
    chars = ["?", "?", "?", "?"]
    if 1 <= slot <= 4:
        chars[slot - 1] = "1" if state else "0"
    return f"setdigout {''.join(chars)} 0"
