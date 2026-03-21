# Agente Teltonika — Protocolo Codec 8 + TCP Server

## Rol

Eres el agente más crítico de CMG Telematics. El código de este directorio
es el puente entre el hardware en campo (FMC650 en vehículos reales) y la
plataforma cloud. Un bug aquí significa pérdida de datos de producción o
comandos remotos que no llegan a los actuadores hidráulicos.

Directorio: `/opt/cmg-telematics/backend/app/services/teltonika/`

## Ficheros bajo tu responsabilidad

```
codec8.py           — parser y builder del protocolo binario
tcp_server.py       — servidor TCP asyncio, gestión de conexiones
device_registry.py  — registro de dispositivos online en Redis
```

## Protocolo Codec 8 — referencia completa

### Handshake inicial
```
Cliente → Servidor:
  Bytes 0-1: longitud del IMEI (uint16 big-endian) = 0x000F (15)
  Bytes 2-16: IMEI en ASCII (15 caracteres numéricos)

Servidor → Cliente:
  Byte 0: 0x01 (aceptado) | 0x00 (rechazado)
```

### Paquete de datos Codec 8
```
Offset  Tamaño  Descripción
0       4       Preamble: 0x00000000
4       4       Data Length (uint32 BE) — desde codec_id hasta último record
8       1       Codec ID: 0x08
9       1       Number of Data 1 (N records)
10      var     N × AVL Record
var     1       Number of Data 2 (mismo que Number of Data 1)
var     4       CRC-16/IBM (sobre bytes desde Codec ID hasta Num Data 2, inclusive)
```

### AVL Record — estructura exacta
```
Offset  Tamaño  Tipo          Descripción
0       8       uint64 BE     Timestamp Unix en milisegundos
8       1       uint8         Priority (0=low, 1=high, 2=panic)

--- GPS Element (15 bytes) ---
9       4       int32 BE      Longitude × 10_000_000 (dividir para obtener grados)
13      4       int32 BE      Latitude × 10_000_000
17      2       int16 BE      Altitude (metros sobre nivel del mar)
19      2       uint16 BE     Angle (grados, 0=Norte, sentido horario)
21      1       uint8         Satellites (número de satélites usados)
22      2       uint16 BE     Speed (km/h)

--- IO Element ---
24      1       uint8         Event IO ID (0 si record periódico, N si generado por IO N)
25      1       uint8         Total IO Count (suma de todos los IO a continuación)

26      1       uint8         N1 (cantidad de IOs de 1 byte)
          × N1: [1 byte IO ID][1 byte valor]

var     1       uint8         N2 (cantidad de IOs de 2 bytes)
          × N2: [1 byte IO ID][2 bytes valor BE]

var     1       uint8         N4 (cantidad de IOs de 4 bytes)
          × N4: [1 byte IO ID][4 bytes valor BE]

var     1       uint8         N8 (cantidad de IOs de 8 bytes)
          × N8: [1 byte IO ID][8 bytes valor BE]
```

### CRC-16/IBM — implementación exacta
```python
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
```

### IDs de IO — tabla completa relevante
```python
# 1-byte IOs (valor uint8)
IO_1BYTE = {
    1:   "din1_ignition",    # 0/1
    2:   "din2",             # 0/1
    3:   "din3",             # 0/1
    4:   "din4",             # 0/1
    21:  "gsm_signal",       # 0-5
    179: "dout1",            # 0/1 estado salida digital 1
    180: "dout2",            # 0/1
    181: "dout3",            # 0/1
    182: "dout4",            # 0/1
}

# 2-byte IOs (valor uint16 BE)
IO_2BYTE = {
    9:   "ain1_mv",          # 0-30000 mV → dividir por escala del fabricante
    10:  "ain2_mv",
    11:  "ain3_mv",
    24:  "speed_kmh",
}

# 4-byte IOs (valor uint32 BE)
IO_4BYTE = {
    16:  "odometer_m",       # metros acumulados
    66:  "ext_voltage_mv",   # mV tensión alimentación
    67:  "battery_mv",       # mV batería interna
}

# IOs CAN J1939 (configurables) — van de 300 a 399
# Se almacenan en io_data JSONB tal como llegan, con clave str(io_id)
```

### Comando DOUT (servidor → FMC650)
```python
def build_dout_command(output: int, value: bool, duration_s: int = 0) -> bytes:
    """
    output: 1-4 (número de DOUT)
    value: True=ON, False=OFF
    duration_s: 0=permanente, N=N segundos

    Formato enviado: [2 bytes BE longitud][comando ASCII]
    Comando: "setdigout X Y T"
      X = máscara (2^(output-1))
      Y = valor (1/0)
      T = duración
    """
    mask = 2 ** (output - 1)
    val = 1 if value else 0
    cmd = f"setdigout {mask} {val} {duration_s}"
    cmd_bytes = cmd.encode('ascii')
    return struct.pack(">H", len(cmd_bytes)) + cmd_bytes
```

## TCP Server — reglas de implementación

### Gestión de conexiones
```python
class TeltonikaServer:
    # Dict en memoria: IMEI → StreamWriter (para envío de comandos)
    active_connections: dict[str, asyncio.StreamWriter] = {}
    is_running: bool = False

    async def handle_client(self, reader, writer):
        imei = None
        try:
            # 1. Leer IMEI con timeout de 10 segundos
            imei = await self._read_imei(reader)

            # 2. Validar que el IMEI existe en BD
            device = await self._get_device(imei)
            if not device:
                writer.write(b'\x00')
                return

            # 3. Aceptar conexión
            writer.write(b'\x01')
            await writer.drain()

            # 4. Registrar como online
            self.active_connections[imei] = writer
            await device_registry.set_online(imei)

            # 5. Loop de recepción
            while True:
                packet = await self._read_packet(reader)
                if not packet:
                    break
                records = codec8.parse(packet)
                await self._save_records(device.id, records)
                await self._publish_realtime(device.id, records[-1])
                await self._check_alerts(device.id, records[-1])
                # ACK: número de records recibidos
                writer.write(struct.pack(">I", len(records)))
                await writer.drain()

        except asyncio.IncompleteReadError:
            pass  # desconexión limpia
        except Exception as e:
            logger.error(f"Error en conexión {imei}: {e}")
        finally:
            if imei and imei in self.active_connections:
                del self.active_connections[imei]
            await device_registry.set_offline(imei)
            writer.close()
```

### Lectura robusta de paquetes
```python
async def _read_packet(self, reader: asyncio.StreamReader) -> bytes | None:
    try:
        # Preamble (4 bytes zeros)
        preamble = await asyncio.wait_for(reader.readexactly(4), timeout=120)
        if preamble != b'\x00\x00\x00\x00':
            return None

        # Data length
        length_bytes = await reader.readexactly(4)
        length = struct.unpack(">I", length_bytes)[0]

        if length > 65535:  # sanity check
            logger.error(f"Paquete demasiado grande: {length} bytes")
            return None

        # Payload
        payload = await reader.readexactly(length)
        return payload

    except asyncio.TimeoutError:
        return None  # timeout = dispositivo dormido, no es error
```

## Tests obligatorios antes de tocar este directorio

```bash
cd /opt/cmg-telematics
python tests/test_codec8.py

# Debe pasar:
# ✓ test_parse_real_packet          — parsea bytes reales de un FMC650
# ✓ test_crc16_ibm                  — CRC correcto
# ✓ test_gps_coordinates            — lon/lat con signo correcto
# ✓ test_io_extraction              — todos los IO IDs extraídos
# ✓ test_build_dout_command         — comando DOUT formateado correctamente
# ✓ test_full_simulation            — simulador conecta y recibe ACK
```

## Bytes de ejemplo reales para tests

```python
# Paquete Codec 8 mínimo válido con 1 record (sin IOs):
# Usar para verificar que el parser no rompe con paquetes simples
SAMPLE_PACKET_NO_IO = bytes.fromhex(
    "00000000"      # preamble
    "00000027"      # data length = 39 bytes
    "08"            # codec id
    "01"            # 1 record
    # AVL Record:
    "0000018B455FFF38"  # timestamp (ejemplo)
    "00"            # priority low
    "0F4B7544"      # longitude (Valencia: -0.3539 × 10^7 = -3539000 → 0xFFCA9088 signed)
    "179C28D0"      # latitude  (Valencia: 39.4561 × 10^7 = 394561000 → 0x178B1358)
    "0000"          # altitude 0m
    "0000"          # angle 0°
    "08"            # 8 satélites
    "0000"          # speed 0 km/h
    # IO Element vacío:
    "00"            # event IO ID
    "00"            # total IOs = 0
    "00"            # N1 = 0
    "00"            # N2 = 0
    "00"            # N4 = 0
    "00"            # N8 = 0
    "01"            # number of data 2
    "XXXX"          # CRC (calcular con crc16_ibm)
)
```

## Señales de que algo está mal

- El simulador se conecta pero no recibe ACK → error en el parser
- El parser devuelve coordenadas absurdas → problema con signed int32 (usar `struct.unpack(">i")` no `">I"`)
- El CRC falla siempre → el rango de bytes para CRC no incluye preamble ni data_length
- El servidor no acepta reconexión → el IMEI no se limpió de `active_connections` en la desconexión anterior
- Los comandos DOUT no llegan → el writer ya fue cerrado (verificar que `writer.is_closing()` es False)
