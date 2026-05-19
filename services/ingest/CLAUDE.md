# Agente: ingest-svc

Servicio TCP que recibe datos de dispositivos Teltonika FMC650 vía protocolo Codec 8 / Codec 8 Extended.

---

## Responsabilidad única

Escuchar en TCP:5027, hacer handshake IMEI, decodificar paquetes AVL, escribir en TimescaleDB y publicar en Redis Stream `telemetry.raw`. También recibe comandos DOUT vía Redis PubSub y los reenvía al dispositivo vía Codec 12.

---

## Archivos principales

| Fichero | Responsabilidad |
|---------|----------------|
| `src/server.py` | TCP server asyncio, handshake IMEI, receive loop, command_listener Redis, restore DOUT on reconnect |
| `src/codec8.py` | Decodificador Codec 8 (0x08) y Codec 8 Extended (0x8E), builder Codec 12, CRC-16/IBM |
| `src/writer.py` | INSERT en `telemetry_record` via asyncpg, `get_device_info`, `update_device_online` |
| `src/publisher.py` | Publica en Redis Stream `telemetry.raw` y gestiona estado online en Redis Hash |
| `src/config.py` | Settings desde .env (Pydantic) |

---

## Protocolo Teltonika

### Handshake
```
Cliente → [2 bytes: longitud IMEI][N bytes: IMEI ASCII]
Servidor → 0x01 (aceptado) / 0x00 (rechazado)
```

### Codec 8 (0x08)
- IO IDs y contadores: uint8 (máx ID 255)
- Para CAN Manual slots 0–9 (AVL IDs 145–154)

### Codec 8 Extended (0x8E)
- IO IDs y contadores: uint16 (permite IDs > 255)
- Para CAN Manual slots 10–19 (AVL IDs 380–389)
- **5 grupos de IOs**: 1-byte, 2-byte, 4-byte, 8-byte, y X-byte (longitud variable)
- El grupo X-byte tiene un contador uint16 al final de cada registro aunque sea 0 — ignorarlo causa desalineamiento

### Codec 12 (0x0C)
- Usado para enviar comandos GPRS al dispositivo (server → device)
- El dispositivo responde con otro Codec 12 de tipo respuesta
- Comando DOUT: `setdigout XXXX 0` donde X=0/1/? y el número final es timeout (0=permanente)
  - Ejemplo: `setdigout 1??? 0` → activar DOUT1, dejar el resto sin cambio

---

## AVL IDs importantes

| AVL ID | Campo BD | Descripción |
|--------|----------|-------------|
| 30, 36, 85, 269, 10309 | (vía `can_data`) | **RPM motor — fuente PRIMARIA de ignición** (>200 raw → motor en marcha) |
| 2 (DIN2) | (vía `can_data.avl_2`) | Fallback ignición cuando la trama no trae ningún AVL de RPM |
| 239 | `ignition` | Ignición CAN — fallback adicional junto a DIN2 cuando no llega RPM |
| 1 (DIN1) | (vía `can_data.avl_1`) | Fallback PTO cuando no llega `avl_179` |
| 179 | `pto_active` | PTO State oficial CAN |
| 66 | `ext_voltage_mv` | Voltaje externo (mV) |
| 145–154 | `can_data.avl_*` | CAN Manual slots 0–9 |
| 380–389 | `can_data.avl_*` | CAN Manual slots 10–19 (requieren Codec 8 Extended) |

**Regla de ignición (publisher + writer + core-api):** RPM primario. Si la trama trae cualquier `avl_30/36/85/269/10309` > 200 → motor en marcha. Si trae RPM y está en 0 → motor parado. Si NO trae ningún AVL de RPM → mirar DIN2 (`avl_2`) o `avl_239`. DIN1 NO se mira para ignición — se reserva para PTO.

**Regla de PTO:** `avl_179` (CAN) o DIN1 (`avl_1`) como fallback.

---

## DOUT — Control de salidas digitales

### Flujo completo
1. Frontend llama `POST /api/v1/vehicles/{id}/dout` con `{slot: 1, state: true}`
2. Backend construye `setdigout 1??? 0`, guarda estado en Redis `vehicle:{id}:dout`, publica en `cmg:dout_commands`
3. `command_listener` en server.py recibe el mensaje y escribe el Codec 12 al writer TCP activo
4. Dispositivo ejecuta el comando y responde con Codec 12 ACK (logueado como INFO)

### Persistencia en reconexión
- El estado DOUT se guarda en Redis como `vehicle:{vehicle_id}:dout` → `{"1": true, "2": false, ...}`
- Al reconectar (post-handshake), `_restore_dout_state()` lee Redis y re-envía el comando automáticamente
- Sólo re-envía si alguna salida está activa (no manda comandos innecesarios)

### Diagnóstico DOUT
- Si el ACK dice `'setdigout: ok'` pero la salida física no activa → problema de hardware o configuración del Teltonika Configurator (DOUT debe estar habilitada en I/O settings)
- Si el ACK dice error → revisar sintaxis del comando o firmware del dispositivo

---

## Redis keys

| Key | Tipo | Contenido |
|-----|------|-----------|
| `vehicle:{id}:dout` | String (JSON) | `{"1": true, "2": false, ...}` — último estado DOUT |
| `vehicle:{id}:latest` | Hash | Último registro AVL publicado |
| Stream `telemetry.raw` | Stream | Registros AVL para rules-engine |

---

## Reglas de este servicio

- **Nunca usar threading** — todo async/await
- **Nunca modificar el protocolo Codec 8** — el hardware en campo no se actualiza fácilmente
- **ON CONFLICT DO NOTHING** en writer.py — si llegan dos paquetes con el mismo timestamp (Codec 8 + Codec 8E), el segundo se descarta silenciosamente
- Los logs de Codec 12 ACK son INFO (no debug) para poder diagnosticar problemas DOUT en producción
- `_active_writers` es el registro de conexiones TCP activas (IMEI → StreamWriter)
