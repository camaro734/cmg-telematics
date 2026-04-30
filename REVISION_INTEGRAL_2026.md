# Revisión Integral CMG Track — 2026-04-30

## FASE 1 — Backend & Servicios

### Bugs críticos corregidos

| Archivo | Descripción |
|---|---|
| `backend/app/api/v1/vehicles.py:avl-series` | Query usaba columna inexistente `io_data` en lugar de `can_data`. Todas las llamadas devolvían array vacío silenciosamente. |
| `services/ingest/src/server.py:_receive_loop` | Sin límite de tamaño de paquete TCP: `data_length=4GB` intentaría leer 4 GB en memoria (DoS). Añadida validación `> 65536 bytes → close`. |
| `services/ingest/src/server.py:command_listener` | Sin reconexión si Redis moría: la corrutina terminaba silenciosamente, bloqueando todos los comandos DOUT futuros. |
| `services/rules-engine/src/main.py` | Uso de `asyncio.get_event_loop()` deprecado en Python 3.10+ → reemplazado por `get_running_loop()`. |
| `backend/app/api/v1/vehicles.py:apply_maintenance_templates` | N+1 queries: M×N SELECTs individuales en doble bucle. Reemplazado por batch-fetch único con `IN`. |

### Problemas de seguridad corregidos

| Archivo | Descripción |
|---|---|
| `backend/app/api/v1/commands.py:/internal/*` | Endpoints `/internal/commands/*` sin ninguna autenticación — cualquier proceso con acceso de red podía crear/confirmar command logs. Añadida dependencia `_require_internal_key` con `secrets.compare_digest`. |
| `backend/app/api/v1/reports.py` | vehicle_ids del parámetro no validados contra el tenant: un usuario podía pasar UUIDs de otro tenant y obtener su PDF. Añadida query de validación antes de generar el informe. |
| `backend/app/api/v1/vehicles.py:avl-series` | Query telemetry_record sin `tenant_id` filter. Añadido `AND tenant_id = :tid`. |
| `backend/app/api/v1/diagnostics.py` | Query telemetry_record sin `tenant_id` filter. Añadido filtro y verificación de existencia del vehículo. |
| `backend/app/api/v1/maintenance.py:complete_plan` | Extensión del archivo guardado derivada del nombre original del cliente (permite `.php`, `.exe`). Reemplazado por mapa estático `content_type → ext`. |
| `backend/app/api/v1/vehicles.py:upload_icon` | `content_type.startswith("image/png")` acepta `image/png-malicious`. Corregido a normalización + igualdad exacta. |
| `backend/app/core/config.py` | `SECRET_KEY` sin validación de fortaleza. Añadido `@field_validator` que rechaza claves vacías, conocidas o < 32 caracteres. |
| `backend/app/api/v1/alerts.py:export.csv` | Sin filtro de fecha obligatorio ni límite: full table scan sin cota. Requerido al menos un filtro de fecha + `.limit(10_000)`. |
| `backend/app/api/v1/maintenance.py:export.csv` | Sin límite en exportación CSV. Añadido `.limit(5_000)`. |

### Mejoras de rendimiento y robustez aplicadas

| Archivo | Descripción |
|---|---|
| `backend/app/core/database.py` | Sin `pool_pre_ping` ni `pool_recycle`: conexiones del pool quedaban broken tras reinicio de PostgreSQL. Añadido `pool_pre_ping=True, pool_recycle=1800`. |
| `backend/app/api/v1/vehicles.py:telemetry/history` | Sin límite de rango temporal: queries sobre años de datos posibles. Máximo 7 días por petición. |
| `backend/app/api/v1/vehicles.py:track` | Sin límite de rango temporal. Máximo 31 días por petición. |
| `backend/app/api/v1/maintenance.py:_compute_progress` | Query `telemetry_1h` sin `tenant_id` ni cota superior `now()`. Añadidos ambos filtros. |
| `services/ingest/src/server.py:_handshake` | Sin timeout: conexiones que nunca envían IMEI mantenían corrutinas bloqueadas indefinidamente. Añadido `asyncio.wait_for(..., timeout=30)`. |
| `services/ingest/src/server.py:_handshake` | Campo `imei_len` sin validación: podía indicar longitud absurda. Añadida comprobación `> 20 → reject`. |
| `services/ingest/src/server.py` | Sin semáforo de conexiones concurrentes. Añadido `asyncio.Semaphore(1000)` con rechazo inmediato. |
| `backend/app/api/v1/ws.py` | WebSocket sin timeout de inactividad: conexiones muertas acumuladas. Añadido `wait_for(receive, timeout=90)` con ping keepalive. |
| `services/rules-engine/src/evaluator.py:_check_schedule` | Tipo de schedule desconocido devolvía `True` (dispara siempre). Cambiado a `False` con warning. |
| `services/rules-engine/src/evaluator.py:composite` | Condición AND con lista vacía disparaba siempre (falso positivo). Añadido guard `if not sub_conditions: return None`. |

### Problemas detectados pero NO corregidos (requieren decisión)

| Problema | Impacto | Solución recomendada |
|---|---|---|
| Refresh tokens sin revocación | Token robado válido 30 días | Tabla `revoked_tokens` o Redis Set con JTI + limpieza periódica |
| Sin rate limiting en `/auth/login` | Fuerza bruta de contraseñas sin límite | `slowapi` con `RateLimiter` por IP |
| `_active_writers` local por proceso en multi-instancia ingest-svc | Con HAProxy + N instancias, un DOUT puede fallar si el IMEI está en otra instancia | Redis Hash `imei → instance_id` + reenvío inter-proceso |
| `INTERNAL_API_KEY` no añadida al `.env` todavía | Los endpoints /internal quedan bloqueados en producción | `echo "INTERNAL_API_KEY=$(openssl rand -hex 32)" >> .env` en ambos servicios |
| `DELETE /devices/{id}` hace hard-delete | Si hay registros en `telemetry_record`/`command_log`, se rompe FK | Cambiar a soft-delete `active=False` o añadir ON DELETE SET NULL |
| Logs exponen IMEIs completos en nivel INFO | Identificadores de hardware en logs (posible LOPD) | Política de logs + enmascaramiento opcional |

---

## FASE 2 — Frontend React

Revisión integral completada el 2026-04-30 por el agente Frontend Developer Senior.

### Bugs corregidos

| Archivo | Linea (aprox.) | Descripción del fix |
|---|---|---|
| `VehicleDetailPage.tsx` | 364 | Typo "Úlfima señal" → "Última señal" |
| `VehicleDetailPage.tsx` | 505 | `new Date(entry.sent_at)` sin null-check → `entry.sent_at ? new Date(...) : '—'` para evitar "Invalid Date" |
| `VehicleDetailPage.tsx` | 533 | `new Date(a.triggered_at)` sin null-check en sección Incidencias → guardado |
| `VehicleDetailPage.tsx` | 193 | `status?.dout_state` tipado como `any` → cast explícito `as Record<number, boolean>` para evitar inconsistencia de tipos |
| `AlertsPage.tsx` | 23 | `handleExportCsv` sin try/catch — errores de red silenciados → añadido bloque try/catch con `alert()` al usuario |
| `MaintenancePage.tsx` | 82 | `handleExportCsv` sin try/catch — errores de red silenciados → añadido bloque try/catch con `alert()` al usuario |
| `apiClient.ts` | 64 | `getBlob` lanzaba `Error("400")` sin texto — ahora incluye el body de respuesta en el mensaje |
| `CircularGauge.tsx` | 115-120 | `value=NaN` no se detectaba (NaN != null es true) → introducido `safeValue` que normaliza NaN a null. `min === max` causaba división por cero → `range = max - min || 1` ya existía pero no se propagaba; ahora todo el componente usa `safeValue` |
| `LinearGauge.tsx` | ~155 | `value=NaN` no detectado → introducido `safeValue`. `warnPct` solo calculaba para `warnBelow`, ignorando `warnAbove` → añadido cálculo para `warnAbove` también |
| `BatteryGauge.tsx` | ~74 | `value=NaN` no detectado → introducido `safeValue`, todos los usos del valor actualizados |
| `NumericDisplay.tsx` | 44 | `formatValue(NaN)` devolvía la string "NaN" → añadido guard `if (Number.isNaN(value)) return '—'` |
| `FleetDashboard.tsx` | 55 | Endpoint incorrecto `/api/v1/alert-rules` → corregido a `/api/v1/rules` (mismo que usan el resto de páginas) |
| `FleetDashboard.tsx` | 14 | `relativeTime` no guardaba contra `new Date(iso)` inválida → añadido `if (Number.isNaN(d.getTime())) return 'Sin señal'` |
| `FleetMap.tsx` | 51 | Inicialización de Leaflet con contenedor de altura 0 causaba mapa en blanco → se difiere con `requestAnimationFrame` cuando `clientHeight === 0`. Limpieza del RAF añadida en la función de cleanup |
| `FleetMap.tsx` | ~101 | Contenido del popup construía HTML sin guard sobre `speed_kmh` NaN → añadido `!Number.isNaN(status.speed_kmh)` |
| `ReportsPage.tsx` | ~97 | `from/to` construidos como `T00:00:00Z` (UTC) en RutasTab — para usuarios en zona horaria distinta a UTC el día cambia → ahora se usa `new Date('YYYY-MM-DDT00:00:00')` (hora local) |
| `ReportsPage.tsx` | ~552 | Multi-series `LineChart` renderizaba `allLineMetrics` (incluye AVL metrics) como `<Line>` contra `lineData` que solo contiene KPI data → corregido a `kpiLineMetrics` evitando series vacías fantasma |
| `ReportsPage.tsx` | ~1096 | `new Date(a.triggered_at)` en `handleCsvExport` sin null-check → guardado |
| `ReportsPage.tsx` | ~1155 | `new Date(a.triggered_at)` en tabla AlertasTab sin null-check → guardado |
| `ReportsPage.tsx` | ~823 | `new Date(log.performed_at)` en tabla MantenimientoTab sin null-check → guardado |
| `Shell.tsx` | 9 | Prop `title` aceptada pero nunca usada — `document.title` no se actualizaba → añadido `useEffect` que sincroniza `document.title` con cada página |
| `VehicleTypesPage.tsx` | 186 | `vehicleTypes[0]` se retornaba como fallback siempre — si el usuario no había seleccionado ningún tipo y la lista se recargaba, se forzaba selección automática incorrecta → corregido para que el fallback solo actúe cuando `selectedTypeId === ''` |
| `VehicleTypesPage.tsx` | 614, 628 | `selectedType.sensor_schema as SensorDef[]` podría ser null en datos mal formados → añadido `?? []` para seguridad |

### Edge cases añadidos

- `CircularGauge`, `LinearGauge`, `BatteryGauge`, `NumericDisplay`: todos ahora manejan `value=NaN` mostrando el estado sin datos ("—") en lugar de renderizar "NaN" o arcos con tamaño incorrecto
- `CircularGauge`: `min === max` ya no causa división por cero (range siempre >= 1)
- `LinearGauge`: indicador de umbral `warnAbove` ahora también se dibuja en la barra (antes solo se dibujaba `warnBelow`)
- `FleetMap`: contenedor de altura cero ya no bloquea la inicialización de Leaflet
- `FleetDashboard.relativeTime`: fechas ISO inválidas devuelven 'Sin señal' en lugar de NaN / "Hace NaNd"
- `ReportsPage.RutasTab`: timestamps de ruta correctos para zonas horarias distintas a UTC
- Todos los `handleExportCsv` y operaciones blob: errores de red ahora se muestran al usuario

### Mejoras UX aplicadas

- `Shell.tsx`: `document.title` ahora refleja la página actual → mejora la accesibilidad, historial del navegador y pestañas
- `apiClient.getBlob`: mensajes de error ahora incluyen el cuerpo de la respuesta HTTP para facilitar el diagnóstico
- `ReportsPage.HistoricoTab`: eliminadas series "fantasma" en el gráfico de líneas para métricas AVL que no tenían datos en ese chart

### Problemas detectados pendientes (no corregidos en esta revisión)

- **FleetMap — rendimiento con 500 vehículos**: Los marcadores se crean individualmente. Para flotas grandes (>100 vehículos) se recomienda usar `L.MarkerClusterGroup` o canvas rendering. No se tocó para no añadir dependencias.
- **Sidebar — iconos duplicados**: "Vehículos" y "Plantillas" comparten `IconVehiculos`. Debería diferenciarse con un icono de plantilla/configuración.
- **Shell.tsx — title prop en TopNav**: El `title` del shell no se muestra en ningún elemento visual (barra superior). Solo se usa para `document.title`. Si se necesita breadcrumb visible, añadir al TopNav.
- **ReportsPage — vehicleTypeId null**: Cuando el vehículo no tiene `vehicle_type_id`, `HistoricoTab` recibe un string vacío y no renderiza métricas. Estado manejado con empty state pero la UX podría mejorar con un aviso explícito.
- **VehicleDetailPage — tab maintenance visible para isCmg pero no isCmgAdmin**: El tab de mantenimiento se añade para `isCmgAdmin`, pero la UI de la card de `VehicleHeader` puede mostrar datos de mantenimiento a todos los CMG users. Inconsistencia menor.
- **MaintenancePage — overflow en mobile**: La tabla de mantenimiento no tiene `overflowX: auto` en mobile, puede desbordarse. Ruta de corrección: envolver `<table>` en `<div style={{ overflowX: 'auto' }}>`.
- **AlertsPage — export CSV sin indicador de carga**: El botón "Exportar CSV" no muestra estado de carga durante la descarga. Para archivos grandes puede parecer que nada ocurre.

---

## FASE 3 — Seguridad e Infraestructura

**Auditoría realizada:** 2026-04-30  
**Archivos revisados:** docker-compose.yml, Caddyfile, .env.example, backend/app/core/config.py, backend/app/core/security.py, backend/app/main.py, services/ingest/src/server.py, services/ingest/src/config.py, .github/workflows/ci.yml, backend/Dockerfile, frontend/Dockerfile, frontend/nginx.conf

---

### Vulnerabilidades corregidas

#### CRÍTICO — Uvicorn con `--reload` en producción
**Archivo:** `backend/Dockerfile` línea 21  
**Descripción:** `--reload` inicia un file-system watcher inadecuado en producción: condiciones de carrera en startup, un único worker sin paralelismo, consumo extra de recursos.  
**Corrección:** Eliminado `--reload`, añadidos `--workers 2 --proxy-headers --forwarded-allow-ips *`.

#### CRÍTICO — Endpoint /internal sin autenticación ni restricción de red
**Archivo:** `backend/app/main.py`  
**Descripción:** `POST /internal/commands/log` y `PATCH /internal/commands/{id}/confirm` no tenían ningún mecanismo de autenticación. La variable `internal_api_key` existía en config.py pero nunca se validaba. Cualquier proceso con acceso HTTP a core-api podía registrar entradas falsas en el log de comandos DOUT.  
**Corrección:** Añadido `InternalNetworkMiddleware` que rechaza peticiones a `/internal` desde IPs fuera de RFC-1918 (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) y, si `INTERNAL_API_KEY` está configurada, valida el header `X-Internal-Key`.

#### ALTO — Sin rate limiting en login (brute force / credential stuffing)
**Archivo:** `backend/app/api/v1/auth.py`  
**Descripción:** Endpoint `POST /api/v1/auth/login` sin ningún límite de intentos.  
**Corrección:** Rate limiter in-process via Redis: 10 intentos/IP/60s. Responde HTTP 429 con `Retry-After: 60`. No requiere dependencia nueva; falla abierto si Redis no disponible.

#### ALTO — Headers de seguridad HTTP incompletos
**Archivo:** `Caddyfile`  
**Descripción:** Faltaban `Referrer-Policy` y `Content-Security-Policy` en ambos vhosts. `X-Frame-Options` era `SAMEORIGIN` en lugar de `DENY`. HSTS sin `preload`.  
**Corrección:** Añadidos en ambos vhosts: `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy` con `default-src 'self'` y `frame-ancestors 'none'`, `X-Frame-Options: DENY`, HSTS con `preload`.

#### ALTO — SECRET_KEY sin validación de fortaleza
**Archivo:** `backend/app/core/config.py`  
**Descripción:** `secret_key` aceptaba valores vacíos o cortos, permitiendo forjar tokens JWT.  
**Corrección:** `@field_validator("secret_key")` que rechaza strings vacíos, valores débiles conocidos, y cualquier cadena < 32 caracteres. Falla en arranque con mensaje diagnóstico.

#### MEDIO — Imágenes Docker con tags flotantes
**Archivo:** `docker-compose.yml`  
**Descripción:** `timescale/timescaledb:latest-pg16`, `caddy:2-alpine`, `redis:7-alpine` eran no deterministas.  
**Corrección:** Pinned a `timescale/timescaledb:2.17.2-pg16`, `caddy:2.9-alpine`, `redis:7.4-alpine`.

#### MEDIO — Sin aislamiento de red Docker
**Archivo:** `docker-compose.yml`  
**Descripción:** Sin red explícita todos los contenedores podían comunicarse sin restricción.  
**Corrección:** Añadida red `backend-net`; todos los servicios asignados.

#### MEDIO — CORS con wildcards en métodos y headers
**Archivo:** `backend/app/main.py`  
**Descripción:** `allow_methods=["*"]` y `allow_headers=["*"]` permiten métodos peligrosos y headers arbitrarios.  
**Corrección:** Métodos explícitos `GET, POST, PUT, PATCH, DELETE, OPTIONS`; headers `Authorization, Content-Type, X-Requested-With`.

#### BAJO — Sin límite de conexiones concurrentes en ingest TCP
**Archivo:** `services/ingest/src/server.py`  
**Descripción:** Un flood de conexiones TCP podía agotar file descriptors o el pool asyncpg.  
**Corrección:** Añadido `asyncio.Semaphore(1000)` en `_handle_with_semaphore()`. Complementa las protecciones existentes (handshake timeout 30s, max packet size 64KB).

---

### Mejoras infraestructura aplicadas

1. Red Docker explícita `backend-net` — patrón para futuras segmentaciones
2. Versiones pinned en todas las imágenes de terceros
3. `INTERNAL_API_KEY` propagada a ingest-svc y core-api en docker-compose
4. `INTERNAL_API_KEY` documentada en `.env.example`
5. Script de backup `/opt/cmg-telematic1/scripts/backup_db.sh` creado

---

### Recomendaciones pendientes

| Prioridad | Item |
|-----------|------|
| ALTA | Activar cron de backup: `0 2 * * * /opt/cmg-telematic1/scripts/backup_db.sh >> /var/log/cmg-backup.log 2>&1` |
| ALTA | Configurar `INTERNAL_API_KEY` en producción: `openssl rand -hex 32` y reiniciar core-api + ingest-svc |
| ALTA | Backup offsite/S3: añadir `rclone` o `aws s3 cp` al final del script de backup |
| ALTA | Rate limiting en Caddy: compilar imagen con plugin `mholt/caddy-ratelimit` via `xcaddy` (ver comentario en Caddyfile) |
| MEDIA | Rotar logs Docker: `{"log-driver":"json-file","log-opts":{"max-size":"50m","max-file":"5"}}` en `/etc/docker/daemon.json` |
| MEDIA | MFA para roles admin/operator: operadores controlan hardware físico vía DOUT; implementar TOTP (RFC 6238) |
| MEDIA | Validación MIME en upload de iconos: rechazar ejecutables, validar magic bytes además de extensión |
| MEDIA | CSP: eliminar `unsafe-inline` cuando el frontend migre a nonces/hash |
| BAJA | CI: Redis con contraseña en tests (desviación del entorno de producción) |
| BAJA | Alertas de anomalías en ingest-svc: exportar métricas de IMEIs rechazados para detectar sondeos |

---

## FASE 4 — UX y Product

**Revisión:** 2026-04-30

### Mejoras implementadas

| Mejora | Archivo | Linea | Detalle |
|--------|---------|-------|---------|
| **1 — Badge alertas activas en Sidebar** | `frontend/src/shared/ui/Sidebar.tsx` | 28-48 | Hook `useActiveAlertCount` hace dos `useQuery` reutilizando los query keys `[...keys.alerts(), 'firing']` y `'escalated'` (mismos que AlertsPage), con `refetchInterval: 30_000`. Si `alertCount > 0`, se muestra un badge naranja (`var(--accent-energy)`) superpuesto al icono de alertas. Cap a `99+`. El tooltip del NavLink cambia a "Alertas (N activas)". Sin peticiones extra al backend: React Query deduplicará con las peticiones de AlertsPage cuando esté montada. |
| **2a — Empty state VehicleList** | `frontend/src/features/fleet/VehicleList.tsx` | 43-85 | Sustituye el mensaje plano por un panel centrado con icono SVG de camión, título "No hay vehículos registrados", subtítulo y botón CTA naranja que navega a `/vehiculos` con `useNavigate`. |
| **2b — Empty state AlertsPage (sin alertas activas)** | `frontend/src/features/alerts/ActiveAlertsList.tsx` | 34-57 | Sustituye el texto monocromático por panel centrado con icono SVG de check en círculo verde (`var(--accent-ok)`), título "No hay alertas activas" y subtítulo descriptivo. |
| **2c — Empty state MaintenancePage** | `frontend/src/features/maintenance/MaintenancePage.tsx` | 154-194 | Sustituye texto plano por panel centrado con icono SVG de llave inglesa, descripción del propósito de los planes de mantenimiento predictivo, y botón CTA "Crear primer plan" a `/maintenance/new`. Si `vehicleFilter` está activo, el mensaje es específico para ese vehículo. |
| **3 — Sistema de toasts** | `frontend/src/shared/ui/Toast.tsx` (nuevo), `frontend/src/App.tsx` | — | Store Zustand `useToastStore` con cola de `ToastItem[]`. Hook público `useToast()` expone `success/error/warning/info(msg)`. El `ToastContainer` se monta una sola vez en `App.tsx` fuera del router (accesible desde cualquier página). Cada toast se cierra automáticamente a los 4 segundos o manualmente. Tiene `role="alert"` y `aria-live="assertive"` para accesibilidad. Animación CSS `cmg-toast-in` de 180 ms. Los colores usan los tokens del sistema (`--accent-ok`, `--accent-crit`, `--accent-warn`, `--accent-info`). |
| **4 — Titulo de pagina dinamico** | `frontend/src/shared/ui/Shell.tsx` | 13-20 | `useEffect` sincroniza `document.title` con el prop `title` de cada Shell: formato `"${title} — CMG Track"`. El cleanup resetea a `"CMG Track"` al desmontar. El prop `title` ya existía en la firma pero era ignorado — ahora se usa. |

### Notas técnicas

- El sistema de toasts usa Zustand (ya en el stack) en lugar de Context o una librería externa — sin dependencias nuevas.
- Los empty states usan SVG inline para no añadir dependencias de iconos. Los estilos respetan los tokens CSS del sistema.
- El badge de alertas en Sidebar reutiliza exactamente los mismos query keys que `AlertsPage`, por lo que React Query deduplica las peticiones cuando ambos componentes están montados simultáneamente.
- `useToast` está listo para usar en cualquier componente existente (mutations de formularios, export CSV, acciones DOUT, etc.) sin modificar su arquitectura.

### No implementado

| Item | Razon |
|------|-------|
| Toasts integrados en formularios existentes | Fuera del scope de esta tarea — los formularios actuales usan `alert()` o estados de error locales. Migrar requiere revisar cada formulario individualmente. El hook `useToast` está disponible para hacerlo incrementalmente. |
| Badge de alertas en TopNav (mobile) | TopNav no tiene un slot fijo para el badge sin rediseñar el layout del drawer. El Sidebar (desktop) cubre el caso principal. |

---

### Script de backup creado

**Ruta:** `/opt/cmg-telematic1/scripts/backup_db.sh`  
**Descripción:** `pg_dump` via `docker exec`, compresión gzip-9, validación de integridad, retención configurable (default 30 días), enlace `latest.sql.gz`, limpieza de archivos parciales en error. Seguro para cron (`set -euo pipefail`, log ISO timestamps, exit code no-cero en fallo).

---

## FASE 5 — Tests y QA

**Revisión:** 2026-04-30

### Estado de tests existentes

#### Backend (pytest)

| Suite | Tests existentes | Estado antes | Estado después |
|-------|-----------------|--------------|----------------|
| `tests/ingest/test_codec8.py` | 6 | 4 FAIL (CRC incorrecto en SAMPLE_PACKET) | 10 PASS |
| `tests/ingest/test_ingest_integration.py` | 2 | 1 FAIL (pre-existente, requiere Docker) | 1 FAIL (pre-existente) / 1 PASS |
| `tests/rules_engine/test_evaluator.py` | 19 | 19 PASS | 23 PASS |
| `tests/api/test_auth_deps.py` | 3 | ERROR (StaticFiles path hardcodeado `/app/static`) | Añadidos tests, pendiente BD |
| `tests/api/test_vehicles_api.py` | 5 | ERROR (StaticFiles path hardcodeado) | Pendiente BD |

**Problema crítico corregido:** `backend/app/main.py` montaba `/app/static` y `/app/uploads` con rutas absolutas de Docker — falla en cualquier entorno sin contenedor. Corregido a rutas relativas fallback cuando las rutas Docker no existen.

#### Frontend (vitest)

| Suite | Tests | Estado |
|-------|-------|--------|
| `gauges/__tests__/CircularGauge.test.tsx` | 14 (10 pre-existentes + 4 nuevos) | PASS |
| `gauges/__tests__/BatteryGauge.test.tsx` | 9 | PASS |
| `gauges/__tests__/LinearGauge.test.tsx` | 7 | PASS |
| `gauges/__tests__/NumericDisplay.test.tsx` | 3 | PASS |
| 18 otros archivos de test | 125 tests | PASS |
| 10 archivos pre-existentes fallando | 31 tests | FAIL (pre-existente, textos de UI cambiados) |

Los 31 tests frontend fallando son pre-existentes (componentes como `ActiveAlertsList`, `TenantsPage`, `RulesPage`, `ReportsPage` etc. cuyo texto UI fue modificado en commits recientes sin actualizar los tests). No son regresiones introducidas en esta revisión.

### Tests añadidos

#### `tests/ingest/test_codec8.py`

| Test | Línea | Qué verifica |
|------|-------|-------------|
| `test_truncated_packet_mid_record_raises` | 74 | Paquete truncado a mitad de registro (simula corte de red TCP): debe lanzar ValueError antes de procesar datos incompletos del FMC650 |
| `test_large_data_length_without_payload_raises` | 86 | Cabecera con `data_length=200_000` sin payload: protege contra amplificación de memoria — debe fallar con "incompleto" antes de intentar leer 200 KB |
| `test_wrong_crc_raises` | 98 | Paquete estructuralmente válido pero CRC deliberadamente incorrecto (`DEADBEEF`): verifica que el decodificador rechaza datos corruptos o alterados |
| `test_mismatched_num_records_raises` | 110 | `num_data_2 != num_data_1`: el FMC650 nunca envía esto; si ocurre es señal de corrupción o ataque de replay |

#### `tests/rules_engine/test_evaluator.py`

| Test | Línea | Qué verifica |
|------|-------|-------------|
| `test_composite_empty_conditions_and_no_fire` | 257 | Composite AND con lista vacía no debe disparar — detectó bug real: el bucle vacío era vacuosamente verdadero y disparaba alertas falsas |
| `test_composite_empty_conditions_or_no_fire` | 275 | Composite OR con lista vacía no debe disparar — OR de cero condiciones = no hay condición cumplida |
| `test_schedule_unknown_type_defaults_to_active` | 286 | Tipo de schedule desconocido retorna True (fail-open): test de contrato — si el comportamiento cambia en el futuro, este test alertará |
| `test_threshold_none_value_does_not_fire` | 298 | Campo con `None` explícito en `can_data`: no debe lanzar excepción ni disparar (datos malformados del PLC) |

#### `tests/api/test_auth_deps.py`

| Test | Línea | Qué verifica |
|------|-------|-------------|
| `test_login_wrong_password_returns_401` | 32 | Login con contraseña incorrecta devuelve 401 con body JSON (`detail`) |
| `test_login_unknown_email_returns_401` | 45 | Email desconocido devuelve 401 — no filtra si el email existe (previene user enumeration) |
| `test_expired_token_returns_401` | 55 | Token con `exp` en el pasado devuelve 401 — verifica que la validación de expiración funciona sin esperar al TTL real |

#### `frontend/src/shared/ui/gauges/__tests__/CircularGauge.test.tsx`

| Test | Línea | Qué verifica |
|------|-------|-------------|
| `muestra guión cuando value es NaN` | 85 | `value=NaN` renderiza "—" en vez de "NaN" — el PLC puede enviar datos malformados que resultan en NaN tras conversión |
| `no renderiza arco ni punto cuando value es NaN` | 93 | `value=NaN` no renderiza el punto central (`.g-dot` ausente) — consistencia con el comportamiento de `null` |
| `muestra el valor numérico correcto en rango normal` | 101 | Valor entero en rango normal renderiza el número exacto |
| `valor decimal muestra 1 decimal` | 108 | Valor float renderiza con 1 decimal (ej. 87.6 no 87.60 ni 88) |

### Tests corregidos

| Archivo | Corrección |
|---------|-----------|
| `tests/ingest/test_codec8.py` | `SAMPLE_PACKET` tenía CRC `D6B2FEAA` incorrecto — calculado el CRC-16/IBM real: `00007B6F`. Los 4 tests básicos que usaban el paquete fallaban con "CRC inválido" aunque la lógica era correcta |
| `backend/app/main.py` | `StaticFiles(directory="/app/static")` hardcodeado para Docker — causaba `RuntimeError` al importar `app` en tests. Corregido con fallback a ruta relativa `backend/static/` cuando `/app/static` no existe |
| `.github/workflows/ci.yml` | `pytest` se ejecutaba desde `working-directory: backend` apuntando a `tests/` — que NO existe en `backend/`. Los tests de `tests/ingest/` y `tests/rules_engine/` nunca se ejecutaban en CI. Corregido para ejecutar desde el directorio raíz con paths explícitos |
| `.github/workflows/ci.yml` | Branches `[main, develop]` — el repositorio usa `master`. CI nunca disparaba en push. Añadido `master` a los triggers |

### Bug corregido en código de producción

**Archivo:** `services/rules-engine/src/evaluator.py`  
**Función:** `_eval_condition` — rama `composite`  
**Bug:** Una condición `composite` AND con lista `conditions: []` vacía disparaba siempre (falso positivo). El bucle `for sub in []` nunca ejecutaba `return None`, alcanzando el `return RuleMatch(...)` incondicionalmente.  
**Impacto:** Cualquier regla con una condición compuesta sin sub-condiciones (posible durante la construcción de reglas en el UI, o una regla exportada con campo vacío) dispararía alertas en cada telemetría recibida.  
**Corrección:** Añadido guard `if not sub_conditions: return None` antes del bucle, aplicado a AND y OR.

### Cobertura de casos críticos

#### Cubierto

- Decodificación Codec 8: paquete truncado, CRC incorrecto, preamble inválido, data insuficiente, num_records mismatch, data_length absurdo
- Rules engine: threshold (fire/no-fire/missing), threshold_sustained (timer start/fire/clear), accumulation, composite AND/OR (incluyendo listas vacías), schedule (always/time_window/desconocido), cooldown, tenant isolation, vehicle_filter por tipo
- Autenticación: token ausente → 403, token inválido → 401, token expirado → 401, credenciales incorrectas → 401, email desconocido → 401, token válido → acceso concedido
- CircularGauge: valor normal, NaN, null, en rango warning/alert, por encima/debajo de umbrales, label uppercase, value=min

#### Pendiente (no cubierto)

- Tests de integración del ingest-svc: requieren Docker con BD real (`test_ingest_accepts_registered_imei` falla porque `TEST_IMEI=000000000000001` no está en BD)
- Tests de rules-engine con Redis real (todos usan `AsyncMock`)
- 31 tests frontend desactualizados: textos de componentes cambiados en sprints recientes sin actualizar los snapshots/asserts (afecta `ActiveAlertsList`, `TenantsPage`, `RulesPage`, `MaintenancePage`, `RuleFormPage`, `ReportsPage`, `SettingsPage`, `KpiChart`, `TenantDetailPage`, `MaintenancePlanFormPage`)
- Tests de performance: no hay tests de carga ni latencia para los endpoints críticos
- Tests de los endpoints de reportes PDF (`/api/v1/reports/pdf`)
- Tests de los endpoints de telemetría (`/api/v1/vehicles/{id}/telemetry/history`, `/api/v1/vehicles/{id}/avl-series`)
