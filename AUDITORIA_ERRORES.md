# Auditoría de errores — CMG Telematics 1
**Fecha:** 2026-04-25  
**Alcance:** backend/, services/, frontend/src/, tests/  
**Metodología:** análisis estático completo + verificación manual de ficheros clave  

---

## Resumen ejecutivo

Se encontraron **8 bugs reales** que afectan a producción, ordenados por severidad. Todos han sido corregidos en este mismo commit excepto donde se indica. No se incluyen falsos positivos reportados por análisis automatizado que fueron descartados tras verificación manual.

| # | Severidad | Componente | Descripción | Estado |
|---|-----------|-----------|-------------|--------|
| 1 | **CRÍTICA** | `cycle_detector.py` | Columna `recorded_at` no existe — queries fallan completamente | ✅ Corregido |
| 2 | **CRÍTICA** | `ingest/server.py` | Race condition en `_active_writers` — DOUT falla tras reconexión | ✅ Corregido |
| 3 | **CRÍTICA** | `ingest/codec8.py` | CRC-16 nunca validado — paquetes corruptos aceptados silenciosamente | ✅ Corregido |
| 4 | **ALTA** | `notify/dispatcher.py` | SMTP sin timeout — thread pool se agota si servidor no responde | ✅ Corregido |
| 5 | **ALTA** | `VehicleDetailPage.tsx` | `doutState[slot]` puede ser `undefined` — envía estado DOUT incorrecto | ✅ Corregido |
| 6 | **ALTA** | `vehicles.py` API | `DoutCommand.slot` sin validación de rango — no-op silencioso para slot > 4 | ✅ Corregido |
| 7 | **MEDIA** | `ingest/server.py` | IMEI sin validación de formato — IMEIs malformados aceptados | ✅ Corregido |
| 8 | **MEDIA** | `rules-engine/main.py` | `asyncio.ensure_future` huérfano — errores de recarga de reglas no loguean | ✅ Corregido |

---

## Falsos positivos descartados

Los siguientes problemas reportados por análisis automatizado fueron descartados tras revisión manual:

- **CRC uint32 en Codec 12**: el protocolo Teltonika usa exactamente 4 bytes para el CRC (uint32), con los 2 bytes superiores a 0. `struct.pack(">I", crc)` es CORRECTO.
- **X-byte IOs no almacenados**: son datos de longitud variable no mapeados a AVL IDs estándar. El código mantiene el offset correctamente (evita desalineamiento) y su omisión es intencional según la CLAUDE.md del servicio.
- **`setattr` en tenants.py**: `TenantUpdate` solo tiene campos `name`, `slug`, `active`, `enabled_modules`. No hay campos sensibles accesibles.
- **`_active_writers` threading**: asyncio es single-threaded; la race condition solo aplica entre dos conexiones del mismo IMEI, que sí ocurre en producción (bug #2).
- **Refresh token en localStorage**: es un riesgo real (XSS → robo de sesión), pero resolverlo requiere cambiar el backend a httpOnly cookies, lo que es una tarea de sprint separada. Se documenta como deuda técnica.

---

## Detalle de bugs corregidos

---

### BUG 1 — CRÍTICA: `cycle_detector.py` columna `recorded_at` no existe

**Archivo:** `backend/app/services/cycle_detector.py`  
**Líneas afectadas:** 105, 111–112, 75–80

**Descripción:**  
La función `_query_telemetry()` construye una query SQL que referencia la columna `recorded_at`, pero la tabla `telemetry_record` usa `time` como nombre de columna (campo primario del hypertable TimescaleDB). Cualquier petición que invoque la detección de ciclos falla con:

```
ERROR: column "recorded_at" does not exist
```

Además, el código de post-procesamiento accede a `row["recorded_at"]` para extraer timestamps.

**Código problemático:**
```python
col_list = ", ".join(["recorded_at", "lat", "lon", "can_data"] + safe_extras)
# WHERE vehicle_id = :vid AND recorded_at >= :from_dt ...
# ORDER BY recorded_at
```
```python
started_at = start_row["recorded_at"]   # KeyError si la query hubiera funcionado
ended_at = end_row["recorded_at"]
```

**Corrección:** usar alias `time AS recorded_at` en el SELECT, y `time` en WHERE/ORDER BY.

---

### BUG 2 — CRÍTICA: Race condition en `_active_writers` tras reconexión del dispositivo

**Archivo:** `services/ingest/src/server.py`  
**Línea:** 52

**Descripción:**  
Cuando un dispositivo FMC650 se desconecta y reconecta rápidamente (habitual tras pérdida de cobertura), ocurre esta secuencia:

1. Conexión A registra `_active_writers[imei] = writer_A`
2. Conexión A se cae
3. Conexión B (misma IMEI) registra `_active_writers[imei] = writer_B`
4. El bloque `finally` de Conexión A ejecuta `_active_writers.pop(imei)` → **elimina `writer_B`**
5. Los siguientes comandos DOUT buscan `_active_writers.get(imei)` → `None` → silenciosamente perdidos

El dispositivo está conectado pero ningún comando llega a él.

**Código problemático:**
```python
finally:
    if self.imei:
        _active_writers.pop(self.imei, None)  # Elimina cualquier writer, incluso el nuevo
```

**Corrección:** solo eliminar si el entry apunta a nuestro propio writer.

---

### BUG 3 — CRÍTICA: CRC-16 nunca verificado en `decode_packet()`

**Archivo:** `services/ingest/src/codec8.py`  
**Línea:** 56–92

**Descripción:**  
La función `decode_packet()` lee y parsea todos los registros AVL, pero **nunca verifica el CRC-16/IBM** que el protocolo Codec 8 incluye en los últimos 4 bytes del paquete. Un paquete con corrupción de bits en tránsito (interferencia 4G, pérdida parcial de segmento TCP) se acepta como válido, y los datos corruptos se escriben en TimescaleDB.

Consecuencias: coordenadas GPS erróneas, valores de sensores imposibles, alertas disparadas con datos falsos.

**Código problemático:**
```python
def decode_packet(data: bytes) -> list[AVLRecord]:
    # ... parsea registros ...
    num_records_2 = data[offset]
    if num_records_2 != num_records:
        raise ValueError(...)
    return records  # ← No verifica CRC en ningún momento
```

**Corrección:** calcular `_crc16(data[8:offset+1])` y comparar con los 4 bytes al final del paquete.

---

### BUG 4 — ALTA: SMTP sin timeout — agotamiento del thread pool

**Archivo:** `services/notify/src/dispatcher.py`  
**Línea:** 65

**Descripción:**  
`smtplib.SMTP()` sin parámetro `timeout` usa el timeout global del socket (tipicamente `None` = bloqueante indefinidamente). La llamada se ejecuta en `loop.run_in_executor()`, que usa el ThreadPoolExecutor por defecto (5 threads). Si el servidor SMTP no responde, cada email intenta conectar indefinidamente, agotando los threads disponibles. Transcurridos 5 emails simultáneos bloqueados, ningún otro código del loop que use executor puede ejecutarse.

**Código problemático:**
```python
def _smtp_send(msg: EmailMessage) -> None:
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as s:  # sin timeout
```

**Corrección:** `smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30)`

---

### BUG 5 — ALTA: `doutState[slot]` puede ser `undefined` en primera pulsación

**Archivo:** `frontend/src/features/vehicle/VehicleDetailPage.tsx`  
**Línea:** 64

**Descripción:**  
La función `sendDout()` lee `doutState[slot]` para calcular el nuevo estado con `!doutState[slot]`. Pero `doutState` se construye a partir de `status?.dout_state`, que es `undefined` hasta que la primera query al servidor completa. En ese intervalo, `doutState` es `{}`, y `doutState[slot]` es `undefined`.

`!undefined === true`, así que la primera pulsación **siempre envía `state: true`** (activar), independientemente del estado real del dispositivo. Si DOUT estaba activo, la primera pulsación lo deja activo en lugar de apagarlo.

**Código problemático:**
```typescript
const newState = !doutState[slot]  // undefined si status no ha cargado
```

**Corrección:** `!(doutState[slot] ?? false)`

---

### BUG 6 — ALTA: `DoutCommand.slot` sin validación — no-op silencioso

**Archivo:** `backend/app/api/v1/vehicles.py`  
**Línea:** 586–589

**Descripción:**  
El schema `DoutCommand` declara `slot: int` sin restricción de rango. Si el cliente envía `slot: 5` (o cualquier valor fuera de 1–4), el endpoint construye el comando `setdigout ???? 0` (sin cambios en ningún DOUT) y responde 200 OK. El cliente no recibe error, el usuario asume que la acción se ejecutó, y el dispositivo no hace nada.

**Código problemático:**
```python
class DoutCommand(BaseModel):
    slot: int   # Acepta cualquier entero
    state: bool

# Después:
if 1 <= body.slot <= 4:    # slot fuera de rango → chars queda ["?","?","?","?"]
    chars[body.slot - 1] = ...
command = f"setdigout {''.join(chars)} 0"   # "setdigout ???? 0" — no-op
```

**Corrección:** `slot: int = Field(..., ge=1, le=4)` + validación explícita con 422 si inválido.

---

### BUG 7 — MEDIA: IMEI sin validación de formato

**Archivo:** `services/ingest/src/server.py`  
**Línea:** 66–67

**Descripción:**  
El IMEI se decodifica como ASCII sin validar que sea numérico ni que tenga la longitud correcta (15 dígitos estándar, 10–20 aceptable). Un dispositivo malintencionado o con firmware corrupto puede enviar un IMEI vacío (`imei_len=0`) o con caracteres no numéricos, que se almacena en `self.imei` y se usa en queries DB y logs. Aunque la query posterior (`get_device_info`) fallará por IMEI no encontrado, el NACK se envía correctamente pero el error no distingue entre "IMEI no registrado" y "IMEI malformado".

**Corrección:** validar `imei.isdigit()` y longitud antes de consultar la BD.

---

### BUG 8 — MEDIA: `asyncio.ensure_future` sin manejo de errores en listener de reglas

**Archivo:** `services/rules-engine/src/main.py`  
**Línea:** 126

**Descripción:**  
El callback PostgreSQL LISTEN usa `asyncio.ensure_future()` para lanzar `_reload_rules()`. Si esta tarea falla antes del primer `try` interno (e.g. error en pool de conexiones), la excepción se descarta silenciosamente sin log. En Python 3.10+, `ensure_future` con tareas no esperadas puede generar `Task exception was never retrieved` en stderr, pero no en el logger del servicio.

**Corrección:** reemplazar con `asyncio.get_event_loop().create_task()` con callback de error explícito.

---

## Deuda técnica documentada (no corregida en este commit)

### DT-1 — Refresh token en `localStorage` (riesgo XSS)

**Archivo:** `frontend/src/features/auth/useAuthStore.ts` línea 77

El refresh token se almacena en `localStorage`, accesible desde cualquier script JavaScript en el dominio. Si se introduce una vulnerabilidad XSS (ahora o en el futuro), un atacante puede robar el token y obtener acceso permanente hasta su expiración.

**Solución correcta:** mover refresh token a cookie `httpOnly; Secure; SameSite=Strict` manejada por el backend. Requiere cambios en `backend/app/api/v1/auth.py` (Set-Cookie en login/refresh/logout) y eliminar la lógica de `localStorage` del frontend.

**Prioridad:** sprint siguiente. No bloquea producción actual pero debe resolverse antes de exponer a clientes externos.

### DT-2 — CRC Codec 8 en paquetes que ya pasaron sin verificación

Con el bug #3 corregido, los paquetes futuros se verificarán. Los datos históricos ya almacenados que pudieran ser corruptos no son detectables retroactivamente.

### DT-3 — Dead-letter queue para mensajes telemetría malformados

**Archivo:** `services/rules-engine/src/main.py` línea 99–102

Cuando un mensaje del stream falla por JSON inválido, se hace `xack` (se marca como procesado) y se pierde. Se debería escribir a un stream `telemetry.dlq` para análisis posterior.

---

## Notas sobre tests

- `backend/tests/api/test_vehicle_types_api.py` — tests correctos y suficientes para los endpoints que cubren.
- Los mocks de `db.refresh` con `side_effect` síncrono + `AsyncMock` son funcionalmente correctos en pytest-asyncio porque `AsyncMock` envuelve el side_effect automáticamente.
- Falta cobertura de test para `detect_and_store_cycles()` — este era precisamente el código con el bug crítico #1.
