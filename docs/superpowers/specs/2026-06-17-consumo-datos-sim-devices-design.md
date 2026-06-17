# Diseño — Consumo de datos SIM por dispositivo en /devices

**Fecha:** 2026-06-17
**Autor:** Carlos (CMG) + Claude
**Estado:** Aprobado, pendiente de plan de implementación

## Objetivo

Mostrar en la página `/devices` cuántos datos lleva transmitidos cada dispositivo
FMC650, para estimar y controlar el gasto de la tarjeta SIM de cada línea. Se quiere
ver el consumo del **mes en curso**, el **total acumulado** y poder **comparar meses**
(histórico).

## Restricción técnica clave

El FMC650 **no reporta** el consumo real de datos de la SIM. Lo que sí conocemos en el
ingest-svc es el tamaño en bytes de cada frame Codec 8 recibido (`data_length` + 12 de
cabecera/CRC). Por tanto el valor mostrado es una **estimación** basada en los bytes de
los frames recibidos. El consumo real facturado por el operador será algo mayor
(cabeceras TCP/IP, GPRS, reintentos, ACKs) — típicamente +20-40%. La estimación sirve
para comparar dispositivos entre sí y detectar líneas que consumen de más; se etiqueta
explícitamente como **"estimado"** en la UI.

Opción futura (no en este alcance): aplicar un factor de sobrecarga configurable
(p.ej. ×1.3) para acercar el dato a la factura real. Por defecto se guardan bytes crudos.

## Decisiones de alcance

- **Periodo:** mes en curso + total acumulado + histórico mensual para comparar.
- **Reset mensual:** mes natural (cambia el día 1).
- **Sin límites ni alertas** por ahora. Solo visualización (con color suave si el
  consumo del mes es alto). Los límites/alertas por SIM quedan como trabajo futuro.

## Principio de diseño: feature completamente independiente

Esta funcionalidad es **autocontenida**. No reutiliza, modifica ni depende de nada del
contaje existente (`device.total_messages`, `update_device_last_packet`, campos de la
migración 031, etc.). Vive en su propia tabla, con su propia función de captura en el
ingest y sus propios campos en la API.

## Modelo de datos

### `device_data_usage` (única tabla nueva — histórico mensual)
| Columna     | Tipo         | Notas                                  |
|-------------|--------------|----------------------------------------|
| `device_id` | UUID         | FK → `device.id`, ON DELETE CASCADE    |
| `year_month`| VARCHAR(7)   | Ej. `"2026-06"`                        |
| `bytes`     | BIGINT       | NOT NULL DEFAULT 0                      |

- PK compuesta `(device_id, year_month)`.
- El "mes en curso" es la fila `(device_id, mes_actual)`; las filas anteriores son el
  histórico comparativo.
- El **total acumulado** = `SUM(bytes)` de todas las filas del dispositivo. No hay
  columna de total separada; **no se toca la tabla `device`**.
- Volumen estimado: 1000 dispositivos × 12 meses ≈ 12k filas/año. Trivial.

### Migración
- Nueva migración Alembic **054** (la última aplicada es 053). Crea únicamente la tabla
  `device_data_usage`. Requiere confirmación explícita antes de `alembic upgrade`
  (producción).

## Captura en ingest-svc

En `services/ingest/src/server.py`, el `_receive_loop` ya conoce el tamaño del frame
recibido (`packet`). Se añade una **llamada nueva e independiente** a una función
dedicada (módulo nuevo del ingest, p.ej. `data_usage.py`), separada por completo de
`update_device_last_packet`:

```python
await record_device_data_usage(conn, self.imei, len(packet))
```

Esa función hace **solo** el UPSERT del histórico mensual:

```sql
INSERT INTO device_data_usage (device_id, year_month, bytes)
VALUES (:device_id, :year_month, :n)
ON CONFLICT (device_id, year_month)
DO UPDATE SET bytes = device_data_usage.bytes + :n
```

El `year_month` se calcula en el ingest con la hora del servidor (`"%Y-%m"`). Un
dispositivo silencioso a fin de mes simplemente abre su fila del mes nuevo en el
siguiente paquete.

`:n` = `len(packet)` = bytes del frame Codec 8 realmente recibido
(8 cabecera + `data_length` + 4 CRC).

## Backend — API

### `DeviceOut` (schema)
Dos campos nuevos (calculados desde `device_data_usage`, no desde `device`):
- `total_bytes: int` — acumulado total = `SUM(bytes)` de todas las filas del dispositivo.
- `month_bytes: int` — bytes del mes en curso (0 si no hay fila del mes actual).

El listado `GET /api/v1/devices` añade una agregación ligera contra `device_data_usage`
(`SUM(bytes)` total y `SUM` filtrado por mes actual, agrupado por `device_id`), unida por
LEFT JOIN al listado de dispositivos. Una sola consulta, sin N+1. Mantiene el filtrado
`tenant_id` y la jerarquía multi-tenant existentes.

### Nuevo endpoint de detalle
`GET /api/v1/devices/{id}/data-usage`
- Devuelve la serie mensual: `[{year_month, bytes}, ...]` ordenada.
- Aplica filtro `tenant_id` y los chequeos multi-tenant de siempre
  (`assert_can_manage_tenant` / scope del usuario autenticado).
- Para el panel de comparación histórica.

## Frontend — `/devices`

Archivo: `frontend/src/features/devices/DevicesPage.tsx`.

- **Nueva columna "Datos (mes / total)"**: muestra `month_bytes` y `total_bytes`
  formateados (KB/MB/GB con helper de formato). Color suave (p.ej. naranja) si el
  consumo del mes es alto. Etiqueta/tooltip "estimado".
- **Comparación histórica**: al pulsar el dispositivo (o un icono 📊), un panel/modal con
  un mini gráfico de barras de los últimos meses (Recharts, ya en el stack), consumiendo
  `GET /api/v1/devices/{id}/data-usage`.

## Escalabilidad (N=1000)

- Captura: 1 UPSERT independiente por paquete. A ~16-33 paquetes/s en toda la flota,
  carga trivial.
- Listado: una sola consulta con agregación + LEFT JOIN, sin N+1. El refetch cada 15s no
  escanea el hypertable (lee la tabla pequeña `device_data_usage`).

## Fuera de alcance (futuro)

- Límites de MB/mes por SIM + alertas al superarlos.
- Factor de sobrecarga configurable para aproximar la factura real.
- Campo `iccid` (ya existe en BD desde migración 031, sin rellenar).
