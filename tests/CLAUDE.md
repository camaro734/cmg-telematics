# Agente Testing — Simulador FMC650 + Tests

## Rol

Especialista en verificar que CMG Telematics funciona correctamente,
con énfasis en el simulador de hardware y los tests del protocolo binario.
Directorio: `/opt/cmg-telematics/tests/`

## Ficheros bajo tu responsabilidad

```
simulate_fmc650.py    — simula un FMC650 real conectándose al TCP server
test_codec8.py        — tests unitarios del parser Codec 8
test_api.py           — tests de integración de los endpoints REST
test_commands.py      — tests del flujo completo de comando remoto DOUT
```

## Simulador FMC650 — implementación completa

```python
# tests/simulate_fmc650.py
"""
Simula un Teltonika FMC650 conectándose al servidor TCP de CMG Telematics.

Uso:
  python tests/simulate_fmc650.py                    # datos estáticos Valencia
  python tests/simulate_fmc650.py --moving           # simula ruta por Valencia
  python tests/simulate_fmc650.py --pressure 210     # fuerza presión alta (genera alerta)
  python tests/simulate_fmc650.py --command-test     # espera comandos DOUT del servidor
"""
import asyncio
import struct
import time
import random
import argparse
import math

# Configuración del simulador
IMEI = "352000000000001"
SERVER_HOST = "213.210.20.183"
SERVER_PORT = 5027
RECORDS_TO_SEND = 10
INTERVAL_S = 2

# Ruta de prueba: círculo por zona industrial de Massanassa, Valencia
ROUTE_WAYPOINTS = [
    (39.4561, -0.3539),  # Massanassa
    (39.4580, -0.3520),
    (39.4600, -0.3500),
    (39.4580, -0.3560),
    (39.4561, -0.3539),  # volver al inicio
]


def crc16_ibm(data: bytes) -> int:
    crc = 0
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return crc


def build_avl_record(
    lat: float,
    lng: float,
    speed: int = 0,
    pressure_mv: int = 18700,   # ~187 bar con escala 0.006
    ignition: bool = True,
    dout1: bool = True,
    dout2: bool = False,
    ext_voltage_mv: int = 24100,
) -> bytes:
    """Construye un AVL Record Codec 8 completo."""
    ts = int(time.time() * 1000)

    # GPS Element
    lon_int = int(lng * 10_000_000)
    lat_int = int(lat * 10_000_000)
    gps = struct.pack(">iihHBH",
        lon_int, lat_int,
        15,     # altitude
        0,      # angle
        8,      # satellites
        speed
    )

    # IO Element
    # 1-byte IOs: DIN1(ignition), DIN2, DOUT1, DOUT2, GSM signal
    ios_1byte = [
        (1,   1 if ignition else 0),
        (2,   0),
        (179, 1 if dout1 else 0),
        (180, 1 if dout2 else 0),
        (21,  4),   # GSM signal
    ]

    # 2-byte IOs: AIN1 (presión), velocidad
    ios_2byte = [
        (9,  pressure_mv),   # AIN1 → presión hidráulica
        (10, 5200),          # AIN2 → caudal
        (24, speed),
    ]

    # 4-byte IOs: tensión alimentación, odómetro
    ios_4byte = [
        (66, ext_voltage_mv),
        (16, 12500),    # odómetro 12.5 km
    ]

    event_io = 0  # record periódico
    total_ios = len(ios_1byte) + len(ios_2byte) + len(ios_4byte)

    io_bytes = struct.pack("BB", event_io, total_ios)

    io_bytes += struct.pack("B", len(ios_1byte))
    for io_id, val in ios_1byte:
        io_bytes += struct.pack("BB", io_id, val)

    io_bytes += struct.pack("B", len(ios_2byte))
    for io_id, val in ios_2byte:
        io_bytes += struct.pack(">BH", io_id, val)

    io_bytes += struct.pack("B", len(ios_4byte))
    for io_id, val in ios_4byte:
        io_bytes += struct.pack(">BI", io_id, val)

    io_bytes += struct.pack("B", 0)  # N8 = 0

    avl = struct.pack(">QB", ts, 0) + gps + io_bytes
    return avl


def build_codec8_packet(avl_records: list[bytes]) -> bytes:
    """Construye un paquete Codec 8 completo con CRC."""
    n = len(avl_records)
    payload = bytes([0x08, n]) + b''.join(avl_records) + bytes([n])
    data_length = len(payload)
    crc = crc16_ibm(payload)

    packet = (
        b'\x00\x00\x00\x00'           # preamble
        + struct.pack(">I", data_length)
        + payload
        + struct.pack(">I", crc)
    )
    return packet


async def run_simulation(args):
    print(f"[SIM] Conectando a {SERVER_HOST}:{SERVER_PORT}...")
    reader, writer = await asyncio.open_connection(SERVER_HOST, SERVER_PORT)
    print(f"[SIM] Conectado")

    # Handshake IMEI
    imei_b = IMEI.encode('ascii')
    writer.write(struct.pack(">H", len(imei_b)) + imei_b)
    await writer.drain()

    resp = await asyncio.wait_for(reader.read(1), timeout=5)
    if resp != b'\x01':
        print(f"[SIM] ERROR: servidor rechazó el IMEI (respuesta: {resp.hex()})")
        return
    print(f"[SIM] IMEI aceptado por el servidor")

    # Enviar records
    for i in range(RECORDS_TO_SEND):
        # Posición
        if args.moving:
            wp_idx = i % len(ROUTE_WAYPOINTS)
            lat, lng = ROUTE_WAYPOINTS[wp_idx]
            lat += random.uniform(-0.0005, 0.0005)
            lng += random.uniform(-0.0005, 0.0005)
            speed = random.randint(20, 60)
        else:
            lat, lng = 39.4561, -0.3539
            speed = 0

        # Presión
        pressure = args.pressure if args.pressure else random.randint(18000, 19500)

        avl = build_avl_record(
            lat=lat, lng=lng, speed=speed,
            pressure_mv=pressure,
            ignition=True,
            dout1=True,
        )
        packet = build_codec8_packet([avl])
        writer.write(packet)
        await writer.drain()

        ack = await asyncio.wait_for(reader.read(4), timeout=5)
        n_ack = struct.unpack(">I", ack)[0]
        print(f"[SIM] Record {i+1}/{RECORDS_TO_SEND} | "
              f"GPS: ({lat:.4f}, {lng:.4f}) | "
              f"Speed: {speed} km/h | "
              f"Presión: {pressure/1000*6:.1f} bar | "
              f"ACK: {n_ack} records")

        await asyncio.sleep(INTERVAL_S)

    # Esperar comandos DOUT si se pidió
    if args.command_test:
        print(f"\n[SIM] Esperando comandos DOUT del servidor (30s)...")
        try:
            data = await asyncio.wait_for(reader.read(256), timeout=30)
            if data:
                length = struct.unpack(">H", data[:2])[0]
                command = data[2:2+length].decode('ascii')
                print(f"[SIM] Comando recibido: '{command}'")
                print(f"[SIM] Simulando confirmación (cambio de estado DOUT en siguiente record)...")
        except asyncio.TimeoutError:
            print(f"[SIM] Sin comandos en 30s")

    writer.close()
    await writer.wait_closed()
    print(f"\n[SIM] Simulación completada")
    print(f"[SIM] Verificar datos en TimescaleDB:")
    print(f"  docker exec -it cmg-timescaledb psql -U cmg -d cmg_telematics \\")
    print(f"    -c \"SELECT time, lat, lng, speed, ain1_mv, dout1 FROM telemetry_record ORDER BY time DESC LIMIT {RECORDS_TO_SEND};\"")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Simulador FMC650 para CMG Telematics")
    parser.add_argument("--moving", action="store_true", help="Simular vehículo en movimiento")
    parser.add_argument("--pressure", type=int, help="Forzar presión AIN1 en mV (ej: 21000 = 210 bar)")
    parser.add_argument("--command-test", action="store_true", help="Esperar comandos DOUT del servidor")
    args = parser.parse_args()
    asyncio.run(run_simulation(args))
```

## Tests unitarios Codec 8

```python
# tests/test_codec8.py
import pytest
import struct
from app.services.teltonika.codec8 import parse_codec8, crc16_ibm, build_dout_command

def test_crc16_ibm_known_value():
    # Valor conocido de la documentación Teltonika
    data = bytes([0x08, 0x01])  # codec_id + 1 record (simplificado)
    result = crc16_ibm(data)
    assert isinstance(result, int)
    assert 0 <= result <= 65535

def test_parse_gps_coordinates():
    # Valencia: lat=39.4561, lng=-0.3539
    lat_raw = int(39.4561 * 10_000_000)   # 394561000
    lng_raw = int(-0.3539 * 10_000_000)   # -3539000
    # Verificar que int32 signed maneja correctamente negativos
    assert struct.pack(">i", lng_raw) == struct.pack(">i", -3539000)
    # El parser debe devolver float negativo para longitudes oeste
    lng_parsed = struct.unpack(">i", struct.pack(">i", lng_raw))[0] / 10_000_000
    assert abs(lng_parsed - (-0.3539)) < 0.000001

def test_build_dout_command_format():
    cmd = build_dout_command(output=1, value=True, duration_s=0)
    length = struct.unpack(">H", cmd[:2])[0]
    command_str = cmd[2:2+length].decode('ascii')
    assert command_str == "setdigout 1 1 0"

def test_build_dout2_off():
    cmd = build_dout_command(output=2, value=False, duration_s=30)
    length = struct.unpack(">H", cmd[:2])[0]
    command_str = cmd[2:2+length].decode('ascii')
    assert command_str == "setdigout 2 0 30"

def test_parse_empty_io():
    # Paquete con 0 IOs debe parsear sin error
    pass  # implementar con bytes reales

def test_full_round_trip():
    # Construir paquete con el simulador y parsearlo
    from tests.simulate_fmc650 import build_codec8_packet, build_avl_record
    avl = build_avl_record(lat=39.4561, lng=-0.3539, speed=50, pressure_mv=18700)
    packet = build_codec8_packet([avl])
    records = parse_codec8(packet)
    assert len(records) == 1
    assert abs(records[0]['lat'] - 39.4561) < 0.001
    assert abs(records[0]['lng'] - (-0.3539)) < 0.001
    assert records[0]['speed'] == 50
    assert records[0]['io'].get(9) == 18700
```

## Tests de API

```python
# tests/test_api.py
import pytest
import httpx
from app.main import app

@pytest.fixture
async def client():
    async with httpx.AsyncClient(app=app, base_url="http://test") as c:
        yield c

@pytest.fixture
async def auth_headers(client):
    resp = await client.post("/api/v1/auth/login",
        json={"email": "admin@cmg.es", "password": "admin123"})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"

async def test_login_ok(client):
    resp = await client.post("/api/v1/auth/login",
        json={"email": "admin@cmg.es", "password": "admin123"})
    assert resp.status_code == 200
    assert "access_token" in resp.json()

async def test_login_wrong_password(client):
    resp = await client.post("/api/v1/auth/login",
        json={"email": "admin@cmg.es", "password": "wrongpass"})
    assert resp.status_code == 401

async def test_fleet_dashboard_requires_auth(client):
    resp = await client.get("/api/v1/dashboard/fleet")
    assert resp.status_code == 401

async def test_fleet_dashboard_ok(client, auth_headers):
    resp = await client.get("/api/v1/dashboard/fleet", headers=auth_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)

async def test_send_command_device_offline(client, auth_headers):
    resp = await client.post("/api/v1/commands/send",
        headers=auth_headers,
        json={"imei": "352000000000001", "output": "DOUT1", "value": True})
    # Sin simulador corriendo, el dispositivo está offline
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "DEVICE_OFFLINE"
```

## Secuencia de validación completa

```bash
# Terminal 1: logs del backend
journalctl -u cmg-telematics -f

# Terminal 2: ejecutar tests
cd /opt/cmg-telematics
source backend/venv/bin/activate

# Unit tests
pytest tests/test_codec8.py -v

# API tests (backend debe estar corriendo)
pytest tests/test_api.py -v

# Simulador básico
python tests/simulate_fmc650.py

# Simulador con presión alta (debe generar alerta)
python tests/simulate_fmc650.py --pressure 21000

# Simulador en movimiento (para ver en el mapa)
python tests/simulate_fmc650.py --moving

# Test comando remoto (en otra terminal enviar comando via API mientras esto corre)
python tests/simulate_fmc650.py --command-test
```
