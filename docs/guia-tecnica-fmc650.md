# Guía técnica: Teltonika FMC650 + CMG Telematics

**Audiencia:** técnicos CMG y clientes avanzados  
**Objetivo:** entender cómo funciona el FMC650, qué datos envía, cómo configurarlo y dónde aparecen los datos en la plataforma.

---

## 1. El dispositivo — qué es y qué puede hacer

El FMC650 es el rastreador GPS/4G que instalamos en los vehículos. Sus capacidades clave:

| Capacidad | Detalle |
|-----------|---------|
| Conectividad celular | 4G LTE Cat 1 con fallback GSM/GPRS, dual SIM |
| GNSS | L1+L5 dual-band (GPS, GLONASS, Galileo, BeiDou) — precisión < 2,5 m CEP |
| CAN bus | **Dual CAN J1939** + J1708 con terminadores conmutables (120/60 Ω) |
| RS-232 / RS-485 | 2× RS232 + 1× RS485 — para sensores propios CMG |
| Entradas digitales | 4× DIN (0/1) |
| Salidas digitales | 4× DOUT open-collector (máx. 0,5 A) |
| Entradas analógicas | 4× AIN (0–10 V o 0–30 V configurable) |
| 1-Wire | Sensores de temperatura Dallas |
| K-Line | Lectura de tacógrafo integrada |
| Alimentación | 8–32 V DC + batería interna Ni-MH 8,4 V / 550 mAh |
| Consumo | 32 mA (sleep GPS) — 60 mA (GPRS activo) |

---

## 2. Cómo envía los datos — protocolo Codec 8

El FMC650 se conecta a nuestro servidor por **TCP en el puerto 5027** y envía paquetes en formato **Codec 8**.

### Estructura del paquete

```
[0-3]   Preámbulo: 0x00000000
[4-7]   Longitud de datos (uint32 big-endian)
[8]     Codec ID: 0x08
[9]     Número de registros AVL
[10-N]  Registros AVL (uno por cada muestra de telemetría)
[N]     Número de registros (repetido, validación)
[N+1-N+4] CRC-16
```

### Cada registro AVL contiene

```
Timestamp    8 bytes  — milisegundos desde epoch UTC
Prioridad    1 byte   — 0=baja, 1=alta, 2=pánico
GPS:
  Longitud   4 bytes  — grados × 10⁷ (signed int32)
  Latitud    4 bytes  — grados × 10⁷ (signed int32)
  Altitud    2 bytes  — metros (signed int16)
  Ángulo     2 bytes  — grados desde norte (uint16)
  Satélites  1 byte   — número de satélites visibles
  Velocidad  2 bytes  — km/h (uint16)
IO Elements: — variables según configuración
  N×1-byte IOs
  N×2-byte IOs
  N×4-byte IOs
  N×8-byte IOs
```

Cada IO element es un par `(ID, Valor)`. El ID identifica qué parámetro es.

> **Nota:** El servidor soporta tanto **Codec 8** (ID 0x08) como **Codec 8 Extended** (ID 0x8E). Usa Codec 8 si solo necesitas los primeros 10 slots de CAN Manual. Si necesitas más de 10 slots de CAN Manual (AVL IDs > 255), configura el dispositivo en **Codec 8 Extended**.

---

## 3. AVL IDs — qué significa cada número

Los IO elements viajan como números. La plataforma los interpreta así:

### IDs procesados por nombre propio

| AVL ID | Nombre en Teltonika | Campo en BD | Descripción |
|--------|--------------------|-----------|----|
| 239 | Ignition | `ignition` (bool) | Motor encendido/apagado |
| 179 | PTO State | `pto_active` (bool) | Toma de fuerza activa |
| 66 | External Voltage | `ext_voltage_mv` (int) | Voltaje de alimentación en mV |

### IDs almacenados en `can_data` (JSONB)

Todos los demás IDs llegan al campo `can_data` con la clave `avl_{ID}`. Ejemplos:

| AVL ID | Nombre Teltonika | Clave en can_data | Unidad |
|--------|-----------------|-------------------|--------|
| 1 | Digital Input 1 | `avl_1` | 0/1 |
| 2 | Digital Input 2 | `avl_2` | 0/1 |
| 3 | Digital Input 3 | `avl_3` | 0/1 |
| 4 | Digital Input 4 | `avl_4` | 0/1 |
| 9 | Analog Input 1 | `avl_9` | mV (×0,001 = V) |
| 10 | Analog Input 2 | `avl_10` | mV (×0,001 = V) |
| 11 | Analog Input 3 | `avl_11` | mV (×0,001 = V) |
| 245 | Analog Input 4 | `avl_245` | mV (×0,001 = V) |
| 24 | Speed (GPS) | `avl_24` | km/h |
| 70 | PCB Temperature | `avl_70` | °C ×0,1 |
| 80 | Wheel Based Speed | `avl_80` | km/h (J1939) |
| 83 | PTO State (alt) | `avl_83` | 0/1 |
| 85 | Engine Current Load | `avl_85` | % |
| 86 | Engine Total Fuel Used | `avl_86` | litros |
| 87 | Fuel Level | `avl_87` | % |
| 88 | Engine Speed (RPM) | `avl_88` | rpm |
| 104 | Engine Total Hours | `avl_104` | horas |
| 127 | Coolant Temperature | `avl_127` | °C |
| 135 | Fuel Rate | `avl_135` | l/h |

> **Para alertas y ciclos:** cuando configures una regla de alerta o un ciclo de trabajo que use datos CAN, usa la clave `avl_{ID}` correspondiente. Ejemplo: RPM del motor → `avl_88`.

---

## 4. Configurar el FMC650 paso a paso

### 4.1 Herramientas necesarias

- **Teltonika Configurator** — descarga desde [wiki.teltonika-gps.com](https://wiki.teltonika-gps.com) → Software
- Cable **Mini-USB** (viene con el dispositivo)
- Alimentación 12 V o el harness del vehículo conectado

### 4.2 Conectar al Configurator

1. Conecta el FMC650 al PC con el cable Mini-USB
2. Alimenta el dispositivo (o usa el USB como fuente si tiene batería interna cargada)
3. Abre el Teltonika Configurator → aparecerá el IMEI y versión de firmware
4. Haz clic en **Load** para cargar la configuración actual del dispositivo

### 4.3 Configurar el servidor (sección GPRS)

| Campo | Valor |
|-------|-------|
| Domain (Server) | `cmgtrack.com` |
| Port | `5027` |
| Protocol | `TCP` |
| Codec | `Codec 8` para slots CAN Manual 1–10 / `Codec 8 Extended` para slots 11+ |

También en esta sección configura el **APN** de la SIM:
- SIM 1: APN, usuario y contraseña según operador (Movistar/Vodafone/Orange)
- Deja SIM 2 vacío si solo usas una SIM

### 4.4 Configurar perfiles de adquisición de datos

El FMC650 tiene 3 perfiles: **Home** (red propia), **Roaming**, **Unknown**. Configura los tres igual para evitar diferencias:

| Parámetro | Valor recomendado |
|-----------|-------------------|
| Min Period (On Stop) | 60 s |
| Min Period (Moving) | 30 s |
| Min Distance | 50 m |
| Min Angle | 10° |
| Min Speed Delta | 5 km/h |
| Send Period | 60 s |

> Estos valores envían un registro cada 30 s en movimiento y cada 60 s parado. Ajusta según el volumen de datos y coste de SIM del cliente.

### 4.5 Activar los IO elements que necesitas

En la sección **I/O** del Configurator, activa los parámetros que quieres recibir. Los mínimos para CMG:

| IO ID | Nombre | Activar |
|-------|--------|---------|
| 239 | Ignition | ✅ Siempre |
| 179 | PTO State | ✅ Vehículos con PTO |
| 66 | External Voltage | ✅ Siempre |
| 1–4 | Digital Inputs 1–4 | Según instalación |
| 9–11, 245 | Analog Inputs 1–4 | Según sensores instalados |
| 88 | Engine Speed (RPM) | ✅ Si hay CAN J1939 |
| 87 | Fuel Level | Si hay CAN J1939 |
| 104 | Engine Total Hours | ✅ Para mantenimiento predictivo |
| 127 | Coolant Temperature | Si hay CAN J1939 |

Para cada IO activado, configura:
- **Priority**: Low (para datos continuos) / High (para eventos críticos)
- **Operand**: Monitoring (envía siempre el valor) o On Change (solo cuando cambia)

### 4.6 Configuración CAN J1939 (si el vehículo lo soporta)

En la sección **CAN / LVCAN**:
1. Selecciona el tipo de bus: **J1939** o **FMS**
2. El Configurator detectará automáticamente los parámetros disponibles del vehículo
3. Activa los parámetros que quieras recoger (RPM, temperatura, nivel combustible, etc.)

> Si el vehículo no tiene CAN accesible, los campos relacionados llegarán vacíos o con valor 0.

### 4.7 Guardar y verificar

1. Haz clic en **Save to device**
2. El dispositivo se reinicia y sincroniza
3. En la pestaña **GSM** del Configurator verás el estado de conexión
4. En la plataforma, entra en **Dispositivos** → el IMEI debería cambiar a **Online** en 1–2 minutos

---

## 5. Qué aparece en la plataforma

Una vez el FMC650 está enviando datos:

| Dato | Dónde aparece |
|------|---------------|
| Posición GPS | Mapa en **Flota** y pestaña **EN VIVO** del vehículo |
| Velocidad | Gauge en pestaña **EN VIVO** |
| Ignición | Badge de estado en la fila del vehículo |
| PTO activo | Gauge y estado en **EN VIVO** |
| Voltaje externo | Panel de diagnóstico |
| RPM, temperatura, combustible | Gauges configurados en el `sensor_schema` del tipo de vehículo |
| Todos los `avl_*` | Disponibles para alertas, ciclos de trabajo y exportación CSV |

---

## 6. Diagnóstico — el dispositivo no aparece Online

| Síntoma | Causa probable | Solución |
|---------|---------------|---------|
| Dispositivo Offline tras 5 min | APN incorrecto | Verifica APN en sección GPRS del Configurator |
| Dispositivo Offline, LED parpadeando | Sin señal GSM | Verifica cobertura 4G en la zona |
| Dispositivo Online pero sin datos en mapa | IMEI no registrado o no asignado a vehículo | Entra en **Dispositivos** y verifica la asignación |
| Datos llegan pero `can_data` vacío | CAN no conectado o J1939 no configurado | Verifica cableado CAN y configuración en Configurator |
| `pto_active` siempre false | ID incorrecto de PTO | Verifica que la salida PTO está mapeada al AVL ID 179 |

### Verificar qué datos llegan realmente

Desde el servidor puedes consultar los últimos registros de un vehículo directamente en BD:

```sql
SELECT time, ignition, pto_active, speed_kmh, can_data
FROM telemetry_record
WHERE vehicle_id = '<uuid-del-vehiculo>'
ORDER BY time DESC
LIMIT 10;
```

Esto muestra exactamente qué AVL IDs llegaron y con qué valores.

---

## 7. Notas de implementación para CMG

- **Codec 8 Extended no soportado aún:** si los IDs CAN son > 255 (frecuente en instalaciones FMS complejas), necesitaríamos añadir soporte a `codec8.py`. En ese caso abrir un ticket.
- **PTO ID:** el dispositivo puede enviar el estado PTO en el ID 179 o en el ID 83 según firmware y configuración. Si `pto_active` siempre es false, comprueba en el log de BD si llega `avl_83` en lugar de `avl_179`.
- **Sensores propios CMG (RS-232/RS-485):** los valores de sensores instalados por CMG llegan como Analog Inputs (AIN1–4) o Digital Inputs (DIN1–4) según el cableado. Mapea el sensor al AIN/DIN correspondiente en el `sensor_schema` del tipo de vehículo.
- **Mantenimiento predictivo:** para usar horas de motor reales, activa el AVL ID 104 (Engine Total Hours) en el Configurator. Aparecerá como `avl_104` en `can_data` y puedes usarlo como trigger en un plan de mantenimiento.
