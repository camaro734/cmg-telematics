# Auditoría CMG Track — 2026-05-19

## Resumen ejecutivo

La plataforma está **en buen estado para los 20 vehículos actuales** y tiene una base
arquitectónica sólida (TimescaleDB bien configurado, WS con reconexión automática,
multi-tenant con filtros consistentes, pool asyncpg dimensionado). Sin embargo, hay
**tres riesgos que pueden impactar a un cliente en producción hoy mismo** sin necesidad
de 200 vehículos: WeasyPrint bloquea el event loop completo de core-api durante la
generación de PDFs; el rules-engine pierde alertas silenciosamente en errores de
procesamiento; y la tabla `permission_grant` existe en la BD pero solo protege 2
de los 15+ endpoints que la necesitarían para subclientes. Para escalar a 200+
vehículos el cuello de botella real es WeasyPrint, no el ingestor.

---

## Riesgos críticos (acción inmediata)

| # | Riesgo | Archivo:línea | Impacto | Esfuerzo |
|---|--------|---------------|---------|----------|
| 1 | **WeasyPrint síncrono en el event loop** | `backend/app/api/v1/work_reports.py:475` | Mientras genera un PDF (~1-3 s), core-api no responde a NINGUNA request: el mapa se congela, el WS pierde heartbeats, y la telemetría en vivo se interrumpe para **todos** los clientes conectados | S (2 h) |
| 2 | **XACK en error = alerta perdida para siempre** | `services/rules-engine/src/main.py:114-116` | Si `process_message` lanza excepción (p.ej. DB fugaz), hace `xack` de todas formas → el mensaje sale del stream sin haberse procesado → la alerta nunca se genera → un conductor puede cruzar una geocerca o superar un umbral y nadie lo sabe | S (1 h) |
| 3 | **permission_grant solo cubre reports y maintenance** | `backend/app/api/v1/reports.py:56`, `maintenance.py:44` | Los 13 endpoints restantes (vehicles, alerts, work_orders, devices, drivers, etc.) solo validan `vehicle.tenant_id == user.tenant_id`. Un subclient **no puede** acceder a vehículos del client aunque tenga grant activo. Actualmente ningún subclient tiene acceso JWT (solo portal), así que no hay filtración; pero si se da acceso JWT a un subclient, vera 0 vehículos aunque tenga grants. | M (4-6 h) |
| 4 | **Portal sin rate limiting** | `backend/app/api/v1/portal.py:78-134` | Los endpoints `/portal/{token}/vehicles` y `/portal/{token}/orders` son públicos y sin throttle. Un token filtrado (p.ej. por WhatsApp history) permite enumeración/scraping ilimitado de datos de flota del cliente. Auth lo hay (token en BD), pero no hay defensa contra brute-force. | XS (1 h) |

---

## Cuellos de botella de escalabilidad

### WeasyPrint (el único cuello real a corto plazo)

Con 200 vehículos el ingestor, Redis, las queries bulk y el WS escalan bien gracias
al sprint de vendibilidad (2026-05-12). El único componente que NO escala es la
generación de PDF:

- `HTML(string=html_str).write_pdf()` — llamada síncrona, CPU-bound, dura 1-3 s típicamente
- FastAPI es async pero **asyncio es single-threaded**: un PDF bloquea el event loop completo
- Con 5 operarios cerrando partes a la vez → 5-15 s en que el mapa de flota no actualiza

**Fix concreto** (2 líneas):
```python
import asyncio
pdf_bytes = await asyncio.to_thread(HTML(string=html_str).write_pdf)
```

### FleetDashboard: 7 queries en cada carga

Al montar el dashboard se lanzan en paralelo: `vehicles`, `vehicleTypes`, `tenants`,
`firingAlerts`, `rules`, `activeOrders`, `vehicleStatuses`. Con 50 admins conectados
y actualizando la pestaña = 350 queries simultáneas. Mitigado parcialmente por
`staleTime` (5-10 min para tipos/tenants). No es urgente hoy, pero con 50 clientes
concurrentes se notará.

### Redis Stream sin ACK en fallo (rules-engine)

Ver Riesgo #2. Adicionalmente: con MAXLEN=100k y 200 vehículos a 1 pkt/30s ≈ 7 msg/s,
el stream tiene ~4 h de buffer. Si el rules-engine cae >4 h, los paquetes más antiguos
se pierden por el trim aproximado de Redis. Documentado, no crítico en operación normal.

### notify-svc sin retry en SMTP

`dispatcher.py:65` — `_smtp_send` falla → excepción → alerta nunca notificada. No hay
DLQ ni reintento. Con un SMTP transitorio, las alertas de Wasterent se pierden
silenciosamente. Impacto bajo hoy (1-2 alertas), pero inaceptable en producción seria.

---

## Deuda técnica priorizada

### Alta prioridad

- **WeasyPrint bloqueante** — `work_reports.py:475` — Fix: `asyncio.to_thread(...)` —
  **1 h**. Causa downtime observable hoy con dos operarios en el móvil.

- **XACK-on-error en rules-engine** — `main.py:114-116` — Fix: no hacer XACK en el
  `except`, dejar el mensaje para reintento automático de Redis Streams (o moverlo a
  un dead-letter stream) — **1 h**. Actualmente cualquier excepción transitoria (DB
  connection refused 1 s) hace que esa regla nunca evalúe ese instante.

- **permission_grant no usado en vehicles/alerts/work_orders** — Ningún archivo — Si
  Carlos tiene intención de dar acceso JWT a subclientes (Ayuntamientos, etc.), hay que
  extender `_check_vehicle_access` para consultar `permission_grant`. Por ahora solo
  afecta al portal tokenizado, que ya funciona. **Documentar decisión y marcar como
  pendiente** — **1 h** de análisis, 4-6 h de implementación completa.

### Media prioridad

- **notify-svc retry + dead-letter** — `services/notify/src/dispatcher.py:61-68` — SMTP
  falla → alerta nunca llega. Fix: reintentar 3× con backoff exponencial, luego loguear
  como `ERROR` con detalles. **2 h**.

- **Portal rate limiting** — `portal.py` — Añadir el mismo patrón de `_check_login_rate_limit`
  (ya en `auth.py:22`) sobre el `portal_access_token` en Redis. **1 h**.

- **Seed password expuesto en código** — `backend/app/seeds/initial.py:129` — `Admin2026!`
  hardcodeado. El seed no se auto-ejecuta (requiere `python -m app.seeds.initial`),
  pero si alguien lee el repo de GitHub y encuentra que el admin CMG no ha cambiado la
  contraseña, tiene acceso total. Fix: leer de `settings.admin_initial_password` con
  env var, o al menos añadir un warning en los logs para forzar el cambio. **30 min**.

- **avl-series sin tenant_id en query** — `vehicles.py:960-995` — La query filtra por
  `vehicle_id` (no `tenant_id`). Seguridad OK porque `_check_vehicle_access` lo valida
  antes. Rendimiento OK porque usa el índice `ix_telemetry_vehicle_time`. Pero si se
  añade RLS en PostgreSQL en el futuro, fallará. Arreglar de paso al tocar ese bloque.
  **15 min**.

- **ReportsPage.tsx (1196 líneas)** — Ya documentado en CLAUDE.md como pendiente
  estético. No añade aquí más contexto. **8-12 h** de refactor cuando haya tiempo.

### Baja prioridad (NO hacer ahora)

- **14 `as any` en TypeScript** — Concentrados en `GeofencesPage.tsx` y `ReportsPage.tsx`.
  La mayoría son `rule.condition as any` porque `AlertRule.condition` es un JSONB libre.
  No van a causar bugs en runtime; requieren tipar el discriminated union de condiciones.
  **Deuda estética, baja urgencia.**

- **DOUT Redis sin TTL** — Documentado en CLAUDE.md como "leak controlado, no urgente".
  Los DOUT se restauran al reconectar el dispositivo. Con <10 vehículos con DOUT el
  leak de memoria Redis es inapreciable.

- **i18n** — Documentado en CLAUDE.md. No bloqueante.

- **5 console.log restantes** — Son `ErrorBoundary` y `gauge warnings` — comportamiento
  defensivo correcto, no spam de producción.

---

## Quick wins (alto impacto, bajo esfuerzo)

| # | Fix | Archivo:línea | Tiempo | Impacto |
|---|-----|---------------|--------|---------|
| 1 | `asyncio.to_thread` en WeasyPrint | `work_reports.py:475` | 15 min | Elimina congelado del mapa en cada PDF |
| 2 | Quitar XACK en `except` del rules-engine | `main.py:114-116` | 30 min | Alertas dejan de perderse en errores transitorios |
| 3 | Rate limit en portal (copiar patrón auth.py) | `portal.py` | 1 h | Protege tokens de portal de brute-force |
| 4 | Retry SMTP 3× en notify dispatcher | `dispatcher.py:61-68` | 1 h | Alertas llegan aunque haya un fallo SMTP transitorio |
| 5 | Añadir `tenant_id` en avl-series queries | `vehicles.py:960-995` | 15 min | Prepara para RLS y documenta intención |

---

## Lo que está bien hecho

1. **Ingestor TCP** — `_receive_loop` maneja correctamente Codec 8/8E/12, desconexiones
   FMC650, buffer offline (`ON CONFLICT DO NOTHING`), y restaura DOUT al reconectar.
   Pool asyncpg bien dimensionado (10/40). No tocar.

2. **WS con reconexión automática y dual-cache patch** — `wsClient.ts` con backoff
   exponencial (1 s → 30 s), y el patch `setQueriesData` que mantiene el cache bulk
   fresco. Solución no obvia que resolvió el bug de "mapa congelado" del sprint de
   vendibilidad. No tocar.

3. **TimescaleDB bien configurado** — Hypertable con chunk 1 día, compresión a 7 días,
   `compress_segmentby = 'vehicle_id,tenant_id'`, continuous aggregates `telemetry_1h`
   y `telemetry_1d`, índices correctos. Consultas con `time_bucket` correctas en todos
   los endpoints de histórico. Ninguna query sin filtro `time`.

4. **Auth robusta** — JWT con refresh token rotation, JTI blacklist en Redis, rate
   limiting por IP en login (5 intentos / 15 min), `type` field en tokens para
   separar access/refresh. No tocar.

5. **broadcast_to_tenant con timeout** — `ws.py:26-41` — Sockets lentos (3G, pestaña en
   background) se descartan con `wait_for(timeout=2.0)` para no bloquear la telemetría
   del resto. Implementado en el sprint de vendibilidad. No tocar.

---

## Recomendación de siguientes 3 sesiones de desarrollo

### Sesión 1 — Estabilidad crítica (3-4 h)

**Tarea:** Corregir los dos riesgos más urgentes.

1. `work_reports.py:475` — Wrap WeasyPrint con `asyncio.to_thread`:
   ```python
   pdf_bytes = await asyncio.to_thread(HTML(string=html_str).write_pdf)
   ```
2. `rules-engine/main.py:114-116` — No hacer XACK en el `except`. En su lugar,
   loguear y dejar que Redis Streams reintente al reiniciar el worker. Si se quiere
   evitar bucles infinitos en mensajes malformados, mover a un dead-letter stream
   `telemetry.dlq` tras N intentos.

**Criterio de éxito:** Generar un PDF mientras hay 5 vehículos en el mapa y verificar
que el mapa sigue actualizando. Inducir una excepción en el rules-engine y verificar
que el mensaje no se pierde.

---

### Sesión 2 — Seguridad portal y notificaciones (3 h)

**Tarea:** Rate limiting en portal + retry en notify.

1. `portal.py` — Añadir helper `_check_portal_rate_limit(token, redis)` con patrón
   idéntico al de `auth.py:22` pero keyed por `f"ratelimit:portal:{token}"`, límite
   20 req/min (más permisivo que login porque el cliente legítimo refresca el mapa).
2. `notify/dispatcher.py:61-68` — Reintentar `_smtp_send` hasta 3× con `asyncio.sleep(2**(n))`
   antes de loguear error. Para webhooks ya existe timeout de 10 s; añadir mismo patrón.

**Criterio de éxito:** Simular fallo SMTP en dev (SMTP_HOST vacío) y verificar que el
log muestra 3 intentos antes de ERROR, no silencio.

---

### Sesión 3 — permission_grant + cobertura de tests multi-tenant (4-6 h)

**Tarea:** Decidir e implementar acceso JWT para subclientes vía permission_grant.

Carlos debe confirmar primero si **algún subcliente tendrá acceso JWT** (vs. solo portal).
Si la respuesta es sí (ej. Ayuntamiento de Valencia con login propio):

1. Extender `_check_vehicle_access` para consultar `permission_grant` cuando
   `vehicle.tenant_id != user.tenant_id` y el usuario es tier=subclient.
2. Aplicar la misma lógica en `list_vehicles`, `alerts`, `work_orders`.
3. Añadir test `test_subclient_vehicle_access_with_grant` que verifique que sin grant
   devuelve 404 y con grant activo devuelve 200.

Si la respuesta es no (subclientes solo vía portal), documentar explícitamente en
CLAUDE.md para no perder tiempo revisitando esto.

**Criterio de éxito:** Test pasa. Un usuario tier=subclient con grant puede ver los
vehículos del parent; sin grant recibe 404.

---

## Apéndice — comandos de verificación

```bash
# Verificar WeasyPrint fix en producción
# Mientras se descarga un PDF, en otra terminal:
curl -s -o /dev/null -w "%{time_total}" https://cmgtrack.com/api/v1/fleet/kpis

# Verificar rules-engine no pierde mensajes
docker compose logs rules-engine --tail 200 | grep "Error processing\|xack"

# Verificar rate limit portal
for i in $(seq 1 25); do curl -s -o /dev/null -w "%{http_code}\n" https://cmgtrack.com/api/v1/portal/TOKEN/vehicles; done

# Estado general de hypertable en producción
docker exec timescaledb psql -U postgres -c "
  SELECT hypertable_name, num_chunks,
         pg_size_pretty(hypertable_size(format('%I', hypertable_name)::regclass)) AS total_size
  FROM timescaledb_information.hypertables;
"
```
