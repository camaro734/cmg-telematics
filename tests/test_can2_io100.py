"""
Test end-to-end: CAN2 ID1675 Byte0.1 → IO ID 100 → io_data DB

Flujo:
  1. Unit test: parser Codec 8 con IO 100 = 1
  2. Integración: enviar paquete real al servidor TCP → verificar en BD
  3. Insertar variable_map para vehículo OT98976

Uso:
  source backend/venv/bin/activate
  python tests/test_can2_io100.py
"""
import asyncio
import struct
import time
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.services.teltonika.codec8 import build_codec8_packet, parse_codec8

SERVER_HOST = "localhost"
SERVER_PORT = 5027
IMEI_TEST   = "352000000000001"   # Camión Vacío Test 001

# IO ID elegido para CAN2 ID1675 Byte0.1
# Motivo: Codec 8 estándar solo soporta IO IDs 0-255.
# IO ID 100 está libre y dentro del rango válido.
CAN2_IO_ID  = 100


# ─────────────────────────────────────────────────────────────────
# TEST 1 — Unit: parser round-trip con IO 100
# ─────────────────────────────────────────────────────────────────
def test_unit_parser_io100():
    print("\n── TEST 1: Unit parser round-trip IO 100 ──")

    for bit_value in [0, 1]:
        record = {
            "timestamp_ms": int(time.time() * 1000),
            "priority": 0,
            "lat": 39.4561, "lng": -0.3539,
            "altitude": 15, "angle": 0, "satellites": 8, "speed": 0,
            "event_io_id": 0,
            "io": {
                239: 1,           # ignition ON
                CAN2_IO_ID: bit_value,  # CAN bit (0 ó 1)
            },
        }
        packet  = build_codec8_packet([record])
        records = parse_codec8(packet)
        parsed_bit = records[0].io.get(CAN2_IO_ID)

        assert parsed_bit == bit_value, f"FAIL: esperaba {bit_value}, obtuve {parsed_bit}"
        print(f"  IO {CAN2_IO_ID} = {bit_value} → parsed = {parsed_bit}  ✓")

    print("  PASS")


# ─────────────────────────────────────────────────────────────────
# TEST 2 — Integración: enviar al servidor TCP real y verificar BD
# ─────────────────────────────────────────────────────────────────
async def test_integration_send_and_verify():
    print("\n── TEST 2: Integración TCP → BD ──")

    print(f"  Conectando a {SERVER_HOST}:{SERVER_PORT} con IMEI {IMEI_TEST}...")
    reader, writer = await asyncio.open_connection(SERVER_HOST, SERVER_PORT)

    # Handshake IMEI
    imei_bytes = IMEI_TEST.encode("ascii")
    writer.write(struct.pack(">H", len(imei_bytes)) + imei_bytes)
    await writer.drain()

    resp = await asyncio.wait_for(reader.read(1), timeout=5)
    assert resp == b"\x01", f"IMEI rechazado: {resp!r}"
    print("  Handshake IMEI aceptado ✓")

    # Enviar 2 registros: bit=0 y luego bit=1 (simula flanco del PLC)
    results = []
    for bit_val in [0, 1]:
        ts = int(time.time() * 1000)
        record = {
            "timestamp_ms": ts,
            "priority": 0,
            "lat": 39.4561, "lng": -0.3539,
            "altitude": 15, "angle": 0, "satellites": 8, "speed": 0,
            "event_io_id": CAN2_IO_ID if bit_val else 0,
            "io": {
                239: 1,
                66: 14700,         # ext_voltage 14.7V
                CAN2_IO_ID: bit_val,
            },
        }
        packet = build_codec8_packet([record])
        writer.write(packet)
        await writer.drain()

        ack = await asyncio.wait_for(reader.readexactly(4), timeout=10)
        n_ack = struct.unpack(">I", ack)[0]
        assert n_ack == 1, f"ACK incorrecto: {n_ack}"
        print(f"  Enviado IO {CAN2_IO_ID}={bit_val}  → ACK={n_ack} ✓")
        results.append((ts, bit_val))
        await asyncio.sleep(0.5)

    writer.close()
    await writer.wait_closed()

    # Esperar a que el servidor guarde en BD
    await asyncio.sleep(1)

    # Verificar en BD
    import asyncpg
    conn = await asyncpg.connect(
        host="localhost", port=5432,
        user="cmg", password="cmg_pilot_2024", database="cmg_telematics"
    )

    import json as _json
    t_start = results[0][0] / 1000.0
    rows = await conn.fetch(
        """
        SELECT io_data
        FROM telemetry_record
        WHERE device_id = (SELECT id FROM device WHERE imei = $1)
          AND time >= to_timestamp($2) - interval '5 seconds'
          AND io_data ? $3
        ORDER BY time ASC
        """,
        IMEI_TEST, t_start, str(CAN2_IO_ID)
    )
    assert len(rows) >= 2, f"Esperaba ≥2 registros con IO {CAN2_IO_ID}, encontré {len(rows)}"
    bits_in_db = []
    for r in rows[-2:]:
        raw = r["io_data"]
        io_data = _json.loads(raw) if isinstance(raw, str) else raw
        bits_in_db.append(int(io_data.get(str(CAN2_IO_ID))))
    assert 0 in bits_in_db and 1 in bits_in_db, \
        f"Esperaba bit=0 y bit=1, encontré: {bits_in_db}"
    print(f"  BD: io_data[\"{CAN2_IO_ID}\"] = {bits_in_db[0]} → {bits_in_db[1]}  (flanco OFF→ON)  ✓")

    await conn.close()
    print("  PASS")


# ─────────────────────────────────────────────────────────────────
# TEST 3 — Insertar variable_map para OT98976
# ─────────────────────────────────────────────────────────────────
async def test_insert_variable_map():
    print("\n── TEST 3: Insertar variable_map para OT98976 ──")
    import asyncpg

    conn = await asyncpg.connect(
        host="localhost", port=5432,
        user="cmg", password="cmg_pilot_2024", database="cmg_telematics"
    )

    vehicle_id = await conn.fetchval(
        "SELECT id FROM vehicle WHERE name = 'OT98976'"
    )
    assert vehicle_id, "Vehículo OT98976 no encontrado"

    # Eliminar entrada previa si existe (idempotente)
    await conn.execute(
        "DELETE FROM variable_map WHERE vehicle_id = $1 AND io_key = $2",
        vehicle_id, str(CAN2_IO_ID)
    )

    await conn.execute(
        """
        INSERT INTO variable_map
            (id, vehicle_id, io_key, display_name, unit,
             scale_factor, "offset", data_type, alert_high, alert_low, created_at)
        VALUES
            (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, now())
        """,
        vehicle_id,
        str(CAN2_IO_ID),
        "CAN2 PLC – ID1675 Byte0.1",
        "",        # sin unidad (es un bit digital)
        1.0,       # scale_factor
        0.0,       # offset
        "boolean", # data_type
        None,      # alert_high (sin alerta)
        None,      # alert_low
    )

    # Verificar
    row = await conn.fetchrow(
        "SELECT io_key, display_name, data_type FROM variable_map "
        "WHERE vehicle_id = $1 AND io_key = $2",
        vehicle_id, str(CAN2_IO_ID)
    )
    assert row, "variable_map no insertado"
    print(f"  vehicle_id : {vehicle_id}")
    print(f"  io_key     : {row['io_key']}")
    print(f"  display    : {row['display_name']}")
    print(f"  data_type  : {row['data_type']}")
    print("  PASS")

    await conn.close()


# ─────────────────────────────────────────────────────────────────
# TEST 4 — Verificar lectura final de BD
# ─────────────────────────────────────────────────────────────────
async def test_final_query():
    print("\n── TEST 4: Últimos registros con IO 100 en BD ──")
    import asyncpg

    conn = await asyncpg.connect(
        host="localhost", port=5432,
        user="cmg", password="cmg_pilot_2024", database="cmg_telematics"
    )

    rows = await conn.fetch(
        """
        SELECT time,
               io_data->>$1  AS can2_bit,
               io_data->>'239' AS ignition,
               io_data->>'66'  AS voltage_mv
        FROM telemetry_record
        WHERE device_id = (SELECT id FROM device WHERE imei = $2)
          AND io_data ? $1
        ORDER BY time DESC LIMIT 5
        """,
        str(CAN2_IO_ID), IMEI_TEST
    )

    if not rows:
        print("  (sin registros con IO 100 todavía)")
    else:
        print(f"  {'Timestamp':<32} {'CAN2 bit':>10} {'Ignition':>10} {'Voltage mV':>12}")
        print("  " + "─" * 66)
        for r in rows:
            print(f"  {str(r['time']):<32} {str(r['can2_bit']):>10} "
                  f"{str(r['ignition']):>10} {str(r['voltage_mv']):>12}")

    await conn.close()
    print("  PASS")


if __name__ == "__main__":
    test_unit_parser_io100()
    asyncio.run(test_integration_send_and_verify())
    asyncio.run(test_insert_variable_map())
    asyncio.run(test_final_query())
    print("\n══════════════════════════════════")
    print("  TODOS LOS TESTS PASADOS ✓")
    print("══════════════════════════════════")
    print()
    print("CONFIGURAR en Teltonika Configurator:")
    print(f"  CAN Bus    : CAN2")
    print(f"  Frame ID   : 1675  (0x68B)")
    print(f"  Frame Type : Standard 11-bit  (o Extended 29-bit si J1939)")
    print(f"  Data Offset: 0  (Byte 0)")
    print(f"  Bit Offset : 1  (Bit 1 del Byte 0)")
    print(f"  Data Length: 1  (1 bit)")
    print(f"  IO ID      : {CAN2_IO_ID}  ← IMPORTANTE: usar {CAN2_IO_ID}, NO 301")
    print(f"               (Codec 8 estándar: IDs 0-255 únicamente)")
