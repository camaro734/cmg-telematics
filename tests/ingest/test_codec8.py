import pytest
from services.ingest.src.codec8 import decode_packet, AVLRecord

# Paquete Codec 8 real de un FMC650 (simplificado para tests)
SAMPLE_PACKET = bytes.fromhex(
    "00000000"          # preamble
    "00000023"          # data field length = 35 bytes
    "08"                # codec ID = 8
    "01"                # number of data 1 = 1 record
    # AVL record:
    "00000189551B4D80"  # timestamp ms = 1689350000000
    "00"                # priority = 0
    # GPS element (15 bytes):
    "0239C5B8"          # longitude raw = 37290424 → 3.7290424°
    "0178FB96"          # latitude raw = 24969110 → 2.4969110°
    "0064"              # altitude = 100m
    "00B4"              # angle = 180°
    "07"                # satellites = 7
    "0040"              # speed = 64 km/h
    # IO element:
    "00"                # event IO ID
    "02"                # total IOs = 2
    "01"                # 1-byte IOs count = 1
    "EF01"              # IO 239 (ignition) = 1
    "00"                # 2-byte IOs count = 0
    "00"                # 4-byte IOs count = 0
    "00"                # 8-byte IOs count = 0
    "01"                # number of data 2 = 1
    "00007B6F"          # CRC (CRC-16/IBM sobre data field, 0x7b6f como uint32 big-endian)
)


def test_decode_returns_list_of_avl_records():
    records = decode_packet(SAMPLE_PACKET)
    assert isinstance(records, list)
    assert len(records) == 1


def test_decode_timestamp():
    records = decode_packet(SAMPLE_PACKET)
    r = records[0]
    assert r.timestamp_ms == 1689350000000


def test_decode_gps():
    records = decode_packet(SAMPLE_PACKET)
    r = records[0]
    assert r.speed_kmh == 64
    assert r.heading == 180
    assert r.satellites == 7
    assert r.altitude_m == 100
    assert abs(r.longitude - 3.7340600) < 1e-5
    assert abs(r.latitude - 2.4705942) < 1e-5


def test_decode_ignition_io():
    records = decode_packet(SAMPLE_PACKET)
    r = records[0]
    assert r.io_elements.get(239) == 1  # ignition ON


def test_decode_invalid_preamble_raises():
    bad_packet = b"\x01\x00\x00\x00" + SAMPLE_PACKET[4:]
    with pytest.raises(ValueError, match="preamble"):
        decode_packet(bad_packet)


def test_decode_insufficient_data_raises():
    with pytest.raises(ValueError):
        decode_packet(b"\x00\x00\x00\x00\x00\x00\x00\x05")
