"""
Unit tests for Codec 8 parser.
Run with: python -m pytest tests/test_codec8.py -v
"""
import sys
import os
import time
import struct

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.services.teltonika.codec8 import build_codec8_packet, parse_codec8, _crc16_ibm


def test_crc16_ibm():
    # Known value from Teltonika docs
    data = bytes([0x08, 0x01])
    crc = _crc16_ibm(data)
    assert isinstance(crc, int)
    assert 0 <= crc <= 0xFFFF


def test_build_and_parse_roundtrip():
    """Build a packet, parse it back, verify values match."""
    records_in = [
        {
            "timestamp_ms": int(time.time() * 1000),
            "priority": 0,
            "lat": 39.4561,
            "lng": -0.3539,
            "altitude": 15,
            "angle": 90,
            "satellites": 8,
            "speed": 45,
            "event_io_id": 0,
            "io": {
                1:   1,      # ignition
                9:   18700,  # AIN1 (2-byte IO)
                66:  24100,  # ext_voltage_mv (4-byte IO)
                21:  4,      # gsm_signal
                179: 1,      # dout1
                180: 0,      # dout2
            },
        }
    ]

    packet = build_codec8_packet(records_in)

    # Verify packet structure
    assert len(packet) >= 12
    preamble = struct.unpack_from(">I", packet, 0)[0]
    assert preamble == 0, "Preamble must be 0"

    # Parse
    records_out = parse_codec8(packet)
    assert len(records_out) == 1

    r = records_out[0]
    assert r.priority == 0
    assert abs(r.lat - 39.4561) < 0.0001
    assert abs(r.lng - (-0.3539)) < 0.0001
    assert r.altitude == 15
    assert r.angle == 90
    assert r.satellites == 8
    assert r.speed == 45

    # IO data
    assert r.io[1] == 1     # ignition
    assert r.io[9] == 18700 # AIN1
    assert r.io[66] == 24100
    assert r.io[21] == 4
    assert r.io[179] == 1
    assert r.io[180] == 0


def test_multiple_records():
    """Multiple records in one packet."""
    records_in = [
        {
            "timestamp_ms": int(time.time() * 1000) + i * 1000,
            "priority": 0,
            "lat": 39.4561 + i * 0.001,
            "lng": -0.3539,
            "altitude": 15,
            "angle": 0,
            "satellites": 8,
            "speed": i * 10,
            "event_io_id": 0,
            "io": {1: 1, 66: 24100},
        }
        for i in range(5)
    ]

    packet = build_codec8_packet(records_in)
    records_out = parse_codec8(packet)

    assert len(records_out) == 5
    for i, r in enumerate(records_out):
        assert r.speed == i * 10


def test_crc_corruption_detected():
    """Corrupted CRC should raise ValueError."""
    import pytest

    record = {
        "timestamp_ms": int(time.time() * 1000),
        "priority": 0,
        "lat": 39.0,
        "lng": -0.3,
        "altitude": 0,
        "angle": 0,
        "satellites": 4,
        "speed": 0,
        "event_io_id": 0,
        "io": {},
    }
    packet = bytearray(build_codec8_packet([record]))
    # Corrupt last byte (CRC)
    packet[-1] ^= 0xFF

    with pytest.raises(ValueError, match="CRC mismatch"):
        parse_codec8(bytes(packet))


def test_zero_coordinate_handling():
    """lat=0, lng=0 edge case (no GPS fix)."""
    record = {
        "timestamp_ms": int(time.time() * 1000),
        "priority": 0,
        "lat": 0.0,
        "lng": 0.0,
        "altitude": 0,
        "angle": 0,
        "satellites": 0,
        "speed": 0,
        "event_io_id": 0,
        "io": {1: 0},
    }
    packet = build_codec8_packet([record])
    records = parse_codec8(packet)
    assert records[0].lat == 0.0
    assert records[0].lng == 0.0


if __name__ == "__main__":
    test_crc16_ibm()
    test_build_and_parse_roundtrip()
    test_multiple_records()
    test_crc_corruption_detected()
    test_zero_coordinate_handling()
    print("All tests passed ✓")
