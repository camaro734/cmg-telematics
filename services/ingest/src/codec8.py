"""
Decodificador del protocolo Teltonika Codec 8.

Formato del paquete:
  [0:4]   Preamble — siempre 0x00000000
  [4:8]   Data Field Length (uint32 big-endian)
  [8]     Codec ID — 0x08 para Codec 8
  [9]     Number of Data 1
  [10:N]  AVL Data records
  [N]     Number of Data 2 (debe coincidir con Number of Data 1)
  [N+1:N+5] CRC-16/IBM

Cada AVL Data record:
  [0:8]   Timestamp (uint64, milisegundos epoch UTC)
  [8]     Priority (uint8)
  [9:24]  GPS Element (15 bytes)
  [24:]   IO Element

GPS Element (15 bytes):
  [0:4]   Longitude (int32, grados * 10^7)
  [4:8]   Latitude  (int32, grados * 10^7)
  [8:10]  Altitude  (int16, metros)
  [10:12] Angle     (uint16, grados)
  [12]    Satellites (uint8)
  [13:15] Speed     (uint16, km/h)

IO Element (Codec 8):
  [0]     Event IO ID (uint8)
  [1]     N of Total IO (uint8)
  [2]     N of 1-byte IOs, then pairs (IO_ID uint8, value uint8)
  ...     2-byte IOs, 4-byte IOs, 8-byte IOs
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
    """Decodifica un paquete Codec 8 completo. Devuelve lista de AVLRecord."""
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
    if codec_id != 0x08:
        raise ValueError(f"Codec ID no soportado: {codec_id:#04x} (esperado 0x08)")

    num_records = data[9]
    offset = 10
    records: list[AVLRecord] = []

    for _ in range(num_records):
        rec, offset = _decode_avl_record(data, offset)
        records.append(rec)

    num_records_2 = data[offset]
    if num_records_2 != num_records:
        raise ValueError(f"Mismatch registros: {num_records} vs {num_records_2}")

    return records


def _decode_avl_record(data: bytes, offset: int) -> tuple[AVLRecord, int]:
    """Decodifica un AVL record desde `offset`. Devuelve (record, nuevo_offset)."""
    try:
        timestamp_ms = struct.unpack_from(">Q", data, offset)[0]
        offset += 8

        priority = data[offset]
        offset += 1

        # GPS Element (15 bytes)
        lon_raw = struct.unpack_from(">i", data, offset)[0]
        lat_raw = struct.unpack_from(">i", data, offset + 4)[0]
        altitude_m = struct.unpack_from(">h", data, offset + 8)[0]
        heading = struct.unpack_from(">H", data, offset + 10)[0]
        satellites = data[offset + 12]
        speed_kmh = struct.unpack_from(">H", data, offset + 13)[0]
        offset += 15

        longitude = lon_raw / 1e7
        latitude = lat_raw / 1e7

        # IO Element
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
            timestamp_ms=timestamp_ms,
            priority=priority,
            longitude=longitude,
            latitude=latitude,
            altitude_m=altitude_m,
            heading=heading,
            satellites=satellites,
            speed_kmh=speed_kmh,
            event_io_id=event_io_id,
            io_elements=io_elements,
        ), offset
    except struct.error as exc:
        raise ValueError(f"Paquete truncado o malformado en offset {offset}: {exc}") from exc


def build_ack(num_records: int) -> bytes:
    """Construye el ACK de 4 bytes que el servidor devuelve al dispositivo."""
    return struct.pack(">I", num_records)
