# Plan de Refactorización: "Ingesta Inmortal" (TCP Server)

## Contexto para el Agente (Claude)
El servidor TCP actual (`app/services/teltonika/tcp_server.py`) sufre de "Session Exhaustion". Abre demasiadas conexiones `AsyncSessionLocal` por cada coordenada AVL recibida, lo que colapsará el pool de PostgreSQL configurado en `app/core/database.py`.

El objetivo de esta sesión de código es modificar el flujo para utilizar **Bulk Inserts** y migrar el estado efímero a Redis.

## Paso 1: Refactorizar `_save_record` a `_save_records_batch`
**Archivo:** `app/services/teltonika/tcp_server.py`
**Acción:** 1. Eliminar el método `_save_record`.
2. Crear un nuevo método asíncrono `_save_records_batch(self, device: Device, records: list[AVLRecord])`.
3. Dentro de este método, mapear la lista de `AVLRecord` a una lista de diccionarios o modelos `TelemetryRecord`.
4. Usar un único `AsyncSessionLocal()` para hacer un `session.add_all()` (Bulk Insert) de toda la lista de golpe y hacer un solo `session.commit()`.
5. Iterar sobre la lista para publicar en Redis (PubSub para WebSockets) tal y como se hace actualmente, pero sin tocar la base de datos de nuevo.

## Paso 2: Optimizar `_telemetry_loop`
**Archivo:** `app/services/teltonika/tcp_server.py`
**Acción:**
1. Modificar el bucle en `_telemetry_loop`. En lugar de iterar con un `for avl in records:` y hacer `await self._save_record(...)` de uno en uno, debe pasar la lista entera: `await self._save_records_batch(device, records)`.
2. El `saved` count para el ACK ahora será simplemente `len(records)` (si el batch insert no lanza excepción).

## Paso 3: Migrar `last_seen` a Redis (¡No tocar PostgreSQL!)
**Archivo:** `app/services/teltonika/tcp_server.py`
**Acción:**
1. Eliminar la actualización de `last_seen` y `online=True` hacia PostgreSQL que se hace en cada recepción de paquete.
2. Inyectar `from app.core.redis_client import get_redis`.
3. Cuando llegue un paquete en `_telemetry_loop`, usar Redis para guardar el estado:
   `r = await get_redis()`
   `await r.set(f"device:status:{device.imei}", "online", ex=300)` (expira en 5 minutos si no hay datos).
   `await r.set(f"device:last_seen:{device.imei}", datetime.now(timezone.utc).isoformat())`
4. Esto libera a PostgreSQL de hacer miles de `UPDATE`s innecesarios por minuto.

## Paso 4: Pasar el SessionPool por Dependencia a las tareas de fondo
**Acción:**
1. En `_check_alerts`, `_check_geofences` y `_check_automations`, asegúrate de que, si requieren consultar la base de datos, lo hagan abriendo y cerrando la sesión de la forma más corta posible, idealmente procesando también en lotes (*batch*) si es posible, aunque de momento basta con asegurar que no se abren en bucles `for`.

**Ejecuta estos pasos en orden, asegurándote de no romper las importaciones. Comprueba tu código antes de darlo por finalizado.**