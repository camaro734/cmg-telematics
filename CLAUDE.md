# CMG Telematics 2 — Orquestador

## IDENTIDAD
SaaS telemetría industrial (cisternas, barredoras, UME, maquinaria hidráulica).
CMG Metalhidráulica S.L. — Massanassa, Valencia. Clientes: Wasterent, PREZERO.
Repo activo: `/opt/cmg-telematic1` | Repo anterior (solo consulta): `/opt/cmg-telematics`
Diferenciador: CAN bus profundo vía IFM CR2530 + mantenimiento predictivo por ciclos hidráulicos.

## HARDWARE
- FMC650 Teltonika — Codec 8 TCP puerto 5027, IMEI = identificador único
- IFM CR2530 — CANopen 250 kbps / J1939
- CAN Manual slots 0–19: AVL IDs 145–154 (Codec 8), 380–389 (Codec 8E)
- Buffer offline: flash 10 MB (~130k registros) o microSD hasta 32 GB
- Ignición: RPM primario (`avl_30/36/85/269/10309` > 200 raw = ON); DIN1 (`avl_1`) fallback si no hay RPM CAN; DIN2 reservado para PTO (junto a `avl_179`) — toda la flota cablea el PTO a DIN2
- `_compute_ignition()` en `ingest/src/{writer,publisher}.py` y `_ignition_from_can()` en `backend/app/api/v1/vehicles.py` — misma lógica en los tres puntos

## STACK
**Backend:** FastAPI + asyncio | SQLAlchemy 2.x async + Alembic | TimescaleDB (PG16) | Redis 7 (Streams/Hash/SortedSet) | Pydantic v2
**Frontend:** React 18 + Vite | React Query (TanStack) | Zustand | Leaflet | Recharts | Gauges SVG propios
**Infra:** Docker Compose | Caddy (HTTPS) | HAProxy (TCP balancing ingest) | Sentry (backend+frontend)
**Mobile (fase 2):** React Native + Expo — mismos endpoints

## ARQUITECTURA
```
FMC650 ──TCP:5027──▶ ingest-svc ──Stream:telemetry.raw──▶ rules-engine (Consumer Group)
                          │ TimescaleDB                         │ Stream:alerts.fire
                          ▼                                     ▼
                     core-api (FastAPI REST/WS :8010)      notify-svc
                          │
                     frontend (:3000)
Caddy → HTTPS → core-api + frontend | HAProxy (opcional) → ingest-svc
```
Escalado horizontal: N instancias en cada capa. rules-engine: Consumer Group garantiza no-duplicados.

## MODELO DE DATOS
```
tenant          — tier: cmg | client | subclient
user            — role: admin | operator | viewer | driver
permission_grant — grantor_id, grantee_id, resource_type, allowed_actions[], constraints JSONB
vehicle_type    — sensor_schema JSONB (canal CAN, Byte/Bit, scale, offset)
vehicle         — pertenece a tenant + vehicle_type
device          — IMEI único, 1:1 con vehicle
telemetry_record — hypertable, chunk 1d, compresión 7d, can_data JSONB
telemetry_1h     — continuous aggregate (KPIs por hora); NO existe telemetry_1d
alert_rule      — condition JSONB (threshold|sustained|accumulation|trend|composite|schedule|geofence)
alert_instance  — firing|acknowledged|resolved|escalated
maintenance_plan/log — umbrales + reset de acumuladores
tenant_doc_counter   — numeración PT-{año}-{NNNNN} atómica por tenant
```
**Regla de hierro:** tenant nunca delega más permisos de los que tiene.
**Permisos:** cmg admin → todo | client admin → su tenant + subclients (parent_id==user.tenant_id) | subclient admin → solo su tenant
`assert_can_manage_tenant` en `backend/app/api/v1/deps.py` centraliza esta regla.

## DISEÑO VISUAL — TOKENS
```css
--bg-base:#0F1117; --bg-surface:#1A1D27; --bg-card:#1E2532; --bg-elevated:#22263A; --border:#2D3148;
--cmg-teal:#1D9E75; --accent-ok:#22C55E; --accent-warn:#EAB308; --accent-crit:#EF4444;
--accent-info:#38BDF8; --accent-off:#78716C;
--font-data:'JetBrains Mono',monospace; --font-ui:'Inter','DM Sans',sans-serif;
--gauge-track:#3C3330; --gauge-fill:#F97316; --gauge-warn:#EAB308; --gauge-crit:#EF4444;
```
White-label: `tenant.brand_tokens` JSONB → CSS variables inyectadas en runtime (sin compilación).
Logo: `backend/static/logos/cmgtrack.png` (668×187). Topbar: 62px (`--topbar-h`).

## ESTADO DEL PROYECTO

### Contenedores en producción (VPS 213.210.20.183)
| Contenedor | Estado |
|---|---|
| ingest-svc | ✅ TCP 5027, recibiendo FMC650 reales |
| core-api | ✅ :8010, Sentry activo |
| frontend | ✅ nginx, rebuild manual obligatorio (ver §DEPLOY) |
| caddy | ✅ HTTPS 443 |
| timescaledb | ✅ PostgreSQL + TimescaleDB |
| redis | ✅ |

### Migraciones Alembic: 001→062 aplicadas (producción)
Última: `062` — esqueleto intervención (fin/ventana/radio en work_cycle_definition, OT opcional en work_cycle). Cadena lineal 001→062, head único.

### Páginas frontend implementadas
`/fleet` `/vehicles` `/tipos-vehiculo` `/vehicles/:id` `/alerts` `/reports` `/devices`
`/maintenance` `/rules` `/geofences` `/settings` `/clientes` `/drivers`
`/work-orders` `/portal/:token` `/dashboard` `/diagnostics/can-scanner`

### Funcionalidades clave
- Codec 8 + 8E (incluye grupo X-byte) + Codec 12 (DOUT)
- DOUT: Codec 12, persistencia Redis, restore automático
- WebSocket: CMG admins bajo sentinel `"__cmg__"`, broadcast parchea AMBAS caches (`['vehicles',id,'status']` y bulk `['vehicles','statuses',...]`); sin esto bulk queda congelado por `staleTime:Infinity`
- Bulk status: `GET /api/v1/vehicles/statuses?ids=...` — pipeline Redis, hasta 200 IDs
- Fleet KPIs: `GET /api/v1/fleet/kpis?range=1d|7d|30d` — agrega `telemetry_1h`
- Geofences: polígono JSONB, ray-casting, estado inside/outside en Redis por regla+vehículo
- Órdenes de trabajo: paradas con telemetría capturada, geocoding Nominatim, PDF WeasyPrint multi-tenant
- Partes de servicio: firma+DNI cliente (canvas mobile), numeración PT-{año}-{NNNNN} atómica
- Portal cliente: `/portal/:token` público sin login; token desde TenantDetailPage
- TenantSelector CMG: Zustand `useTenantContext`, filtra FleetDashboard/AlertsPage/WorkOrdersPage
- isOnline: regla unificada 60 min por `device_last_seen ?? last_seen` en `lib/staleStatus.ts`
- `staleTime:Infinity` solo en `useVehicleStatuses` (parcheado por WS); resto 60_000

### ⚠️ DEPLOY FRONTEND — procedimiento obligatorio
`docker compose up -d frontend` NO funciona (bug docker-compose v1.29.2 + nginx:alpine).
```bash
docker-compose build frontend
OLD=$(docker ps -q --filter "name=cmg-telematic1_frontend_1")
docker stop $OLD && docker rm $OLD
docker run -d --name cmg-telematic1_frontend_1 \
  --network cmg-telematic1_default --network-alias frontend \
  --restart unless-stopped cmg-telematic1_frontend
```
Deploy core-api requiere: `--env-file /opt/cmg-telematic1/.env -v cmg-telematic1_uploads_data:/app/uploads --network-alias core-api`

## ⚠️ ESTE SERVIDOR ES PRODUCCIÓN
No existe staging. No existe BD local. La BD de Docker = BD de producción de Wasterent y PREZERO.

**Requieren confirmación explícita antes de ejecutar:**
`alembic upgrade/downgrade` | `docker compose down/restart` | `docker stop/rm/kill` | cualquier `psql` no-SELECT | modificar `.env`/`docker-compose.yml`/`Caddyfile` | `docker volume rm` | cualquier `git push`

Si un prompt menciona "local", "staging" o "entorno de desarrollo": PARAR y avisar.

## REGLAS GLOBALES

**Nunca:**
- Exponer puertos 5432/6379 al exterior
- SELECT sin filtro `time` en telemetry_record
- Devolver datos de un tenant fuera del scope del usuario autenticado
- Usar threading — todo async/await
- Hardcodear credenciales
- Romper protocolo Codec 8
- Delegar más permisos de los que tiene el grantor
- AsyncStorage para JWT en mobile (usar SecureStore)
- Añadir dependencias sin justificación

**Siempre:**
- Leer CLAUDE.md del subdirectorio antes de editar ficheros en él
- Leer fichero existente antes de modificarlo
- `time_bucket()` en todas las agregaciones sobre telemetry_record
- Filtrar por `tenant_id` antes de devolver cualquier dato
- Type hints en toda función pública (Python), TypeScript estricto (no `any`)
- Logs estructurados con `request_id`/`tenant_id`/`imei`
- Comentarios en español, código en inglés

**No tocar sin aviso explícito:**
`/opt/cmg-telematics` | `alembic/versions/*` antiguas | puerto 5027 | `.env`/`.env.production` | hypertables ya creadas | `tenant_doc_counter` | archivos `.prod.*`

**Referencia Codec 8:** `/opt/cmg-telematics/backend/app/services/teltonika/` (solo consulta)

## REGLAS DE TRABAJO CLAUDE CODE

**Tras cada cambio — bloque "Validación" obligatorio:**
- Backend: `pytest backend/tests/test_X.py::test_Y -xvs`
- Endpoint: `curl -H "Authorization: Bearer $TOKEN" ...`
- Servicio: `docker compose logs <svc> --tail 100 | grep ERROR`
- Migración: `alembic upgrade head` + verificar SQL

**Preguntar SIEMPRE antes de:** cambios esquema DB | lógica ingestor TCP | auth/JWT/permission_grant | docker-compose.yml/.env | borrar/renombrar endpoints | protocolo Codec 8/8E/12 | refactorizar >200 líneas | continuous aggregates TimescaleDB

**Asumir sin preguntar:** estilo código | naming | imports | campo opcional Pydantic | endpoint nuevo no destructivo | toast/confirm siguiendo patrón existente

**Calidad:** no `print()` (usar structlog) | no `except:` desnudo | funciones ≤50 líneas | archivos ≤500 líneas (excepción: ReportsPage.tsx 1196 líneas) | imports: stdlib→terceros→locales

**Escalabilidad (N=1000 vehículos):**
- N+1: usar `selectinload`/`JOIN`
- Redis: usar `pipeline()` no loop
- Bulk: `WHERE id = ANY(:ids)` no loop
- Series temporales: `LIMIT 5000` defensivo + `time_bucket()`
- WS broadcast: `asyncio.gather` con `wait_for(timeout=2.0)`

**Multi-tenant — checklist en cada endpoint:**
1. ¿Filtra por `tenant_id`?
2. ¿Respeta jerarquía cmg/client/subclient?
3. ¿Usa `assert_can_manage_tenant` para gestión usuarios/recursos?
4. ¿CMG admin sin filtro ve todo?
5. ¿WS broadcast incluye sentinel `"__cmg__"`?

**Lectura de archivos:** NUNCA `find`/`ls -R` sobre repo completo | NUNCA abrir "por si acaso" | NUNCA leer repo anterior sin pedirlo | una sola vez `tree -L 2` o `git status` al inicio de sesión

**Caché:** NO modificar este CLAUDE.md a mitad de sesión (rompe caché → multiplica coste).

## MODELOS

| Modelo | Cuándo |
|---|---|
| **Sonnet 4.6** (default) | Todo el desarrollo normal |
| **Opus 4.7/4.8** | Arquitectura nueva, debugging >2 servicios, race conditions, modelado crítico, Sonnet falla 2+ veces, auditoría seguridad |
| **Haiku 4.5** | Solo si Carlos lo pide: lecturas masivas, renombrados mecánicos |

Thinking mode OFF por defecto; ON para arquitectura/race conditions/modelado/escalabilidad.
`permissions.default: "ask"` — no cambiar a "always".

## INICIO DE SESIÓN
1. cwd = `/opt/cmg-telematic1`
2. Esperar tarea de Carlos
3. Si tarea afecta subdir con CLAUDE.md propio, leerlo antes de tocar
4. Al final de cada respuesta con cambios: resumen 1-2 líneas + bloque "Validación"

## GITHUB
Repositorio: https://github.com/camaro734/cmg-telematics (rama master)
