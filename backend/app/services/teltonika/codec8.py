"""
Teltonika Codec 8 parser and packet builder.

Spec:
  Preamble (4 bytes) | Data Length (4 bytes) | Codec ID (1 byte=0x08)
  | Num Records (1 byte) | [AVL Records...] | Num Records (1 byte)
  | CRC-16/IBM (4 bytes, over codec_id..last_num_records)
"""
import struct
from dataclasses import dataclass, field
from typing import Optional


# Known IO ID mappings
IO_IDS = {
    1:   ("din1",             "bool"),
    2:   ("din2",             "bool"),
    3:   ("din3",             "bool"),
    4:   ("din4",             "bool"),
    9:   ("analog_1_mv",      "uint16"),
    10:  ("analog_2_mv",      "uint16"),
    11:  ("analog_3_mv",      "uint16"),
    16:  ("total_odometer_m", "uint32"),
    21:  ("gsm_signal",       "uint8"),
    22:  ("rssi",             "uint8"),
    24:  ("speed_kmh",        "uint16"),
    66:  ("ext_voltage_mv",   "uint32"),
    67:  ("battery_mv",       "uint32"),
    68:  ("battery_current",  "uint32"),
    71:  ("dallas_temp_1",    "uint8"),
    179: ("dout1_status",     "bool"),
    180: ("dout2_status",     "bool"),
    181: ("dout3_status",     "bool"),
    182: ("dout4_status",     "bool"),
    200: ("sleep_mode",       "uint8"),
    239: ("ignition",         "bool"),
    240: ("movement",         "bool"),
}


@dataclass
class AVLRecord:
    timestamp_ms: int
    priority: int
    lat: float
    lng: float
    altitude: int
    angle: int
    satellites: int
    speed: int
    event_io_id: int
    io: dict = field(default_factory=dict)


def _crc16_ibm(data: bytes) -> int:
    """CRC-16/IBM (also known as CRC-16/ARC) used by Teltonika."""
    crc = 0
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return crc


def parse_codec8(data: bytes) -> list[AVLRecord]:
    """
    Parse a Codec 8 payload (without the TCP length framing).
    data starts at the preamble (4 zero bytes).
    Raises ValueError on CRC mismatch or malformed data.
    """
    if len(data) < 12:
        raise ValueError(f"Packet too short: {len(data)} bytes")

    # Preamble
    preamble = struct.unpack_from(">I", data, 0)[0]
    if preamble != 0:
        raise ValueError(f"Invalid preamble: {preamble:#010x}")

    data_length = struct.unpack_from(">I", data, 4)[0]
    codec_id = data[8]

    if codec_id != 0x08:
        raise ValueError(f"Unsupported codec ID: {codec_id:#04x} (only Codec 8 supported)")

    # CRC covers from codec_id to end of last num_records byte
    crc_data = data[8: 8 + data_length]
    expected_crc = struct.unpack_from(">I", data, 8 + data_length)[0]
    calculated_crc = _crc16_ibm(crc_data)

    if calculated_crc != expected_crc:
        raise ValueError(
            f"CRC mismatch: calculated {calculated_crc:#010x}, expected {expected_crc:#010x}"
        )

    offset = 9
    num_records = data[offset]
    offset += 1

    records = []
    for _ in range(num_records):
        record, offset = _parse_avl_record(data, offset)
        records.append(record)

    # Verify num_records_2
    num_records_2 = data[offset]
    if num_records != num_records_2:
        raise ValueError(
            f"Record count mismatch: header={num_records}, footer={num_records_2}"
        )

    return records


def _parse_avl_record(data: bytes, offset: int) -> tuple[AVLRecord, int]:
    # Timestamp (8 bytes, ms)
    timestamp_ms = struct.unpack_from(">Q", data, offset)[0]
    offset += 8

    # Priority (1 byte)
    priority = data[offset]
    offset += 1

    # GPS (15 bytes)
    lng_raw = struct.unpack_from(">i", data, offset)[0]
    offset += 4
    lat_raw = struct.unpack_from(">i", data, offset)[0]
    offset += 4
    altitude = struct.unpack_from(">h", data, offset)[0]
    offset += 2
    angle = struct.unpack_from(">H", data, offset)[0]
    offset += 2
    satellites = data[offset]
    offset += 1
    speed = struct.unpack_from(">H", data, offset)[0]
    offset += 2

    lat = lat_raw / 10_000_000.0
    lng = lng_raw / 10_000_000.0

    # IO Element
    event_io_id = data[offset]
    offset += 1
    total_io = data[offset]
    offset += 1

    io_data = {}

    # 1-byte IOs
    count = data[offset]
    offset += 1
    for _ in range(count):
        io_id = data[offset]
        offset += 1
        value = data[offset]
        offset += 1
        io_data[io_id] = value

    # 2-byte IOs
    count = data[offset]
    offset += 1
    for _ in range(count):
        io_id = data[offset]
        offset += 1
        value = struct.unpack_from(">H", data, offset)[0]
        offset += 2
        io_data[io_id] = value

    # 4-byte IOs
    count = data[offset]
    offset += 1
    for _ in range(count):
        io_id = data[offset]
        offset += 1
        value = struct.unpack_from(">I", data, offset)[0]
        offset += 4
        io_data[io_id] = value

    # 8-byte IOs
    count = data[offset]
    offset += 1
    for _ in range(count):
        io_id = data[offset]
        offset += 1
        value = struct.unpack_from(">Q", data, offset)[0]
        offset += 8
        io_data[io_id] = value

    record = AVLRecord(
        timestamp_ms=timestamp_ms,
        priority=priority,
        lat=lat,
        lng=lng,
        altitude=altitude,
        angle=angle,
        satellites=satellites,
        speed=speed,
        event_io_id=event_io_id,
        io=io_data,
    )
    return record, offset


def build_codec8_packet(records: list[dict]) -> bytes:
    """
    Build a valid Codec 8 packet from a list of record dicts.
    Each dict: timestamp_ms, priority, lat, lng, altitude, angle,
               satellites, speed, io (dict of {io_id: value}).
    """
    payload = bytearray()

    # Codec ID
    payload.append(0x08)
    # Number of records
    payload.append(len(records))

    for rec in records:
        payload += struct.pack(">Q", rec["timestamp_ms"])
        payload.append(rec.get("priority", 0))

        # GPS
        payload += struct.pack(">i", int(rec["lng"] * 10_000_000))
        payload += struct.pack(">i", int(rec["lat"] * 10_000_000))
        payload += struct.pack(">h", rec.get("altitude", 0))
        payload += struct.pack(">H", rec.get("angle", 0))
        payload.append(rec.get("satellites", 0))
        payload += struct.pack(">H", rec.get("speed", 0))

        io = rec.get("io", {})
        # Classify IOs by size
        b1, b2, b4, b8 = [], [], [], []
        for io_id, value in io.items():
            if value < 0x100:
                b1.append((io_id, value))
            elif value < 0x10000:
                b2.append((io_id, value))
            elif value < 0x100000000:
                b4.append((io_id, value))
            else:
                b8.append((io_id, value))

        # Event IO ID (0 = periodic)
        payload.append(rec.get("event_io_id", 0))
        # Total IO count
        payload.append(len(b1) + len(b2) + len(b4) + len(b8))

        payload.append(len(b1))
        for io_id, v in b1:
            payload.append(io_id)
            payload.append(v)

        payload.append(len(b2))
        for io_id, v in b2:
            payload.append(io_id)
            payload += struct.pack(">H", v)

        payload.append(len(b4))
        for io_id, v in b4:
            payload.append(io_id)
            payload += struct.pack(">I", v)

        payload.append(len(b8))
        for io_id, v in b8:
            payload.append(io_id)
            payload += struct.pack(">Q", v)

    # Number of records (footer)
    payload.append(len(records))

    # CRC
    crc = _crc16_ibm(bytes(payload))

    # Full packet: preamble + data_length + payload + crc
    packet = bytearray()
    packet += struct.pack(">I", 0)              # preamble
    packet += struct.pack(">I", len(payload))   # data length
    packet += payload
    packet += struct.pack(">I", crc)

    return bytes(packet)
