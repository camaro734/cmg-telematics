# CMG Telematics 2 — Agente Orquestador
# Versión 1.0 — Reescritura completa desde diseño

═══════════════════════════════════════════════════════════════
## 1. IDENTIDAD Y OBJETIVO
═══════════════════════════════════════════════════════════════

Plataforma SaaS de telemetría industrial para flotas especializadas
(camiones cisterna, barredoras municipales, UME, maquinaria hidráulica).

**Empresa:** CMG Metalhidráulica S.L. — Massanassa, Valencia
**Repo nuevo:** /opt/cmg-telematic1  (reescritura completa)
**Repo anterior (referencia):** /opt/cmg-telematics  (NO tocar, solo consultar)

**Clientes actuales:** Wasterent, PREZERO
**Escala objetivo:** 100–500 vehículos (diseñado para crecer)

**Diferenciador único vs Samsara/Geotab/Teletrac:**
- Acceso a datos CAN bus profundos vía IFM CR2530
- Presiones hidráulicas, estados válvulas, temperatura aceite, ciclos PTO
- Sensores propios instalados cuando el fabricante no proporciona CAN
- Mantenimiento predictivo por ciclos hidráulicos reales (no por km)
- Sistema de alertas 100% configurable post-desarrollo sin tocar código

═══════════════════════════════════════════════════════════════
## 2. HARDWARE
═══════════════════════════════════════════════════════════════

- **GPS/4G:** Teltonika FMC650 — protocolo Codec 8 TCP
- **PLC:** Gama IFM (CR2530, etc.) — CANopen 250 kbps / J1939
- **Sensores:** instalación propia CMG cuando no hay CAN disponible
- **Arquitectura híbrida:** datos CAN existentes + sensores adicionales
- **IMEI:** identificador único e inmutable del dispositivo

Protocolo de ingestión: Codec 8 TCP sobre puerto 5027
Cada paquete AVL contiene: GPS, IO elements (datos CAN mapeados como AVL IDs)

═══════════════════════════════════════════════════════════════
## 3. STACK TECNOLÓGICO
═══════════════════════════════════════════════════════════════

```
Backend (Python):
  - FastAPI + asyncio (core-api, ingest-svc, rules-engine, notify-svc)
  - SQLAlchemy 2.x async + Alembic (migraciones)
  - TimescaleDB (PostgreSQL + extensión timescaledb)
  - Redis (Streams, Hash, Sorted Set)
  - Pydantic v2 para validación y serialización

Frontend:
  - React 18 + Vite
  - React Query (TanStack) — data fetching + cache
  - Zustand — estado global
  - Leaflet — mapas
  - Recharts — gráficas de telemetría
  - Gauges SVG propios (sin librerías externas)

Infraestructura:
  - Docker + Docker Compose
  - Caddy — reverse proxy HTTPS automático
  - HAProxy — TCP load balancing para ingest-svc (cuando >1 instancia)
  - PostgreSQL 16 con extensión TimescaleDB
  - Redis 7

Mobile (futuro — fase 2):
  - React Native + Expo
  - Mismos endpoints que el frontend web
```

═══════════════════════════════════════════════════════════════
## 4. ARQUITECTURA DE SERVICIOS
═══════════════════════════════════════════════════════════════

5 servicios independientes. Cada uno tiene una única responsabilidad.
Comunican vía Redis Streams. Estado persistente en PostgreSQL + Redis.

```
[FMC650 x500] ──TCP:5027──▶ ingest-svc
                                │ escribe TimescaleDB
                                │ publica Stream: telemetry.raw
                                ▼
                         rules-engine (N workers)
                         Consumer Group: rules-workers
                                │ evalúa reglas JSONB
                                │ publica Stream: alerts.fire
                                ▼
                          notify-svc
                          email/push/SMS/webhook/in_app
                                │
                          core-api (FastAPI)
                          REST /api/v1 + WebSocket /ws
                                │
                          frontend (React + Vite)
                          dashboard + rule builder + gauges

Caddy → HTTPS termination → core-api (:8010) + frontend (:3000)
HAProxy (opcional) → TCP balancing → ingest-svc (:5027)
```

**Escalado horizontal:**
- `ingest-svc`: N instancias + HAProxy TCP stream
- `rules-engine`: N workers en mismo Consumer Group (Redis garantiza no-duplicados)
- `notify-svc`: N instancias (idempotente por message ID)
- `core-api`: N instancias stateless detrás Caddy

═══════════════════════════════════════════════════════════════
## 5. MODELO DE DATOS — RESUMEN
═══════════════════════════════════════════════════════════════

### Tenants y permisos (ver schema completo en docs/design/schema.md)

```
tenant          — jerarquía árbol (tier: cmg | client | subclient)
user            — usuarios por tenant (role: admin|operator|viewer|driver)
permission_grant — permisos explícitos en cascada (nunca implícitos)
                   campos: grantor_id, grantee_id, resource_type,
                           allowed_actions[], constraints JSONB
```

**Regla de hierro:** un tenant nunca puede delegar más permisos de los que tiene.
CMG puede revocar cualquier permiso en cualquier nivel en tiempo real.

### Vehículos y dispositivos

```
vehicle_type    — define sensor_schema JSONB por tipo (vacuum/sweeper/cistern)
vehicle         — pertenece a un tenant, tiene un vehicle_type
device          — IMEI único, vinculado a un vehicle (1:1)
                  un único tenant propietario
```

### Series temporales (TimescaleDB)

```
telemetry_record   — hypertable, chunk 1 día, compresión tras 7 días
                     can_data JSONB flexible (acepta cualquier sensor)
telemetry_1h       — continuous aggregate: KPIs por hora
telemetry_1d       — continuous aggregate: KPIs diarios (para reportes)
```

### Rules Engine

```
alert_rule      — reglas como datos (JSONB condition + actions + escalation)
alert_instance  — instancias activas (firing|acknowledged|resolved|escalated)
maintenance_plan — umbrales de mantenimiento predictivo
maintenance_log  — registro de intervenciones + reset de acumuladores
```

### Tipos de condición en alert_rule.condition:

| Tipo                  | Descripción                                          |
|-----------------------|------------------------------------------------------|
| threshold             | Valor instantáneo > < == threshold                   |
| threshold_sustained   | Condición sostenida X minutos (estado en Redis)      |
| accumulation          | Acumulador >= límite (ej. horas PTO, ciclos)         |
| trend_rising          | Pendiente > threshold en ventana temporal            |
| composite             | AND/OR de otras condiciones                          |
| schedule              | Sensor en estado inesperado fuera de horario         |

═══════════════════════════════════════════════════════════════
## 6. RULES ENGINE — PRINCIPIOS
═══════════════════════════════════════════════════════════════

- Reglas cargadas de PostgreSQL al arrancar
- Hot-reload vía PostgreSQL NOTIFY/LISTEN — sin restart
- Consumer Group Redis Streams — múltiples workers sin duplicados
- Cooldown configurable por regla (no spam de alertas)
- Escalado: Redis Sorted Set como cola de tiempo
- Nueva regla = INSERT en alert_rule → activa en <1 segundo
- Sin deploy, sin código nuevo

═══════════════════════════════════════════════════════════════
## 7. SISTEMA DE PERMISOS EN CASCADA
═══════════════════════════════════════════════════════════════

```
CMG (tier=cmg)
  └── Cliente directo — ej. Wasterent (tier=client)
        └── Cliente del cliente — ej. Ayuntamiento (tier=subclient)
              └── Ve vehículos asignados vía permission_grant
```

Los sub-clientes pueden ver: GPS, estado operativo, reportes de servicio,
datos hidráulicos en tiempo real (si el cliente directo lo autoriza).

permission_grant.constraints JSONB controla:
- visible_fields: qué campos CAN puede ver
- max_history_days: hasta dónde atrás puede consultar
- schedule: solo en horario laboral, etc.

═══════════════════════════════════════════════════════════════
## 8. ESTRUCTURA DE DIRECTORIOS
═══════════════════════════════════════════════════════════════

```
/opt/cmg-telematic1/
├── CLAUDE.md                        ← estás aquí (orquestador)
├── docker-compose.yml               ← todos los servicios
├── docs/
│   └── design/
│       ├── schema.md                ← SQL completo del schema
│       ├── rules-engine.md          ← diseño del evaluador
│       └── progress.md              ← estado del diseño y pendientes
├── services/
│   ├── ingest/                      ← TCP Teltonika server
│   │   ├── CLAUDE.md
│   │   └── src/
│   ├── rules-engine/                ← evaluador de reglas
│   │   ├── CLAUDE.md
│   │   └── src/
│   └── notify/                      ← despacho notificaciones
│       ├── CLAUDE.md
│       └── src/
├── backend/                         ← core-api FastAPI
│   ├── CLAUDE.md
│   └── app/
│       ├── api/v1/
│       ├── models/
│       ├── core/          (config, auth, database)
│       └── schemas/
└── frontend/                        ← React + Vite
    ├── CLAUDE.md
    └── src/
```

═══════════════════════════════════════════════════════════════
## 9. AGENTES ESPECIALIZADOS (por crear)
═══════════════════════════════════════════════════════════════

Al crear cada subdirectorio, añadir su CLAUDE.md de agente:

- `services/ingest/CLAUDE.md`      — Codec 8, asyncio TCP, TimescaleDB writer
- `services/rules-engine/CLAUDE.md`— evaluador JSONB, Redis Streams, hot-reload
- `services/notify/CLAUDE.md`      — email/push/SMS/webhook, escalation timers
- `backend/CLAUDE.md`              — FastAPI, auth JWT, multi-tenant, REST + WS
- `frontend/CLAUDE.md`             — React, Leaflet, gauges SVG, rule builder UI

═══════════════════════════════════════════════════════════════
## 9B. DISEÑO VISUAL — SISTEMA DE TOKENS
═══════════════════════════════════════════════════════════════

Identidad: industrial-moderno. Inspirado en interfaces SCADA/PLC
pero con estética contemporánea. Único, no derivado de competidores.

```css
/* Paleta base — cold dark */
--bg-base:       #0F1117;   /* fondo principal (cold dark) */
--bg-surface:    #1A1D27;   /* sidebar, topbars */
--bg-card:       #1E2532;   /* cards, paneles */
--bg-elevated:   #22263A;   /* modales, dropdowns */
--border:        #2D3148;   /* bordes sutiles */

/* Acento de marca */
--cmg-teal:      #1D9E75;   /* teal — brand, CTAs, estado online */
--accent-ok:     #22C55E;   /* verde — operativo, eficiencia */
--accent-warn:   #EAB308;   /* amarillo — advertencia */
--accent-crit:   #EF4444;   /* rojo — crítico */
--accent-info:   #38BDF8;   /* azul cielo — info, conexión */
--accent-off:    #78716C;   /* gris cálido — offline, inactivo */

/* Tipografía */
--font-data: 'JetBrains Mono', 'IBM Plex Mono', monospace;  /* valores críticos */
--font-ui:   'Inter', 'DM Sans', sans-serif;                 /* navegación, labels */

/* Gauges (manómetros digitales) */
--gauge-track:   #3C3330;
--gauge-fill:    #F97316;   /* naranja por defecto */
--gauge-warn:    #EAB308;
--gauge-crit:    #EF4444;
```

**Layout "control room":**
- Sidebar vertical izquierdo con secciones claramente delimitadas
- Panel central: dashboard modular con "estaciones de control"
- Gauges circulares SVG inspirados en manómetros reales
- Datos críticos en monospace, labels en sans-serif
- White-label: cada cliente puede sobreescribir tokens vía tenant.brand_tokens JSONB

**White-label:**
- tenant.brand_tokens JSONB → variables CSS inyectadas en runtime
- Afecta: --accent-energy, --bg-base, --bg-surface, logo_url, brand_name
- UX y layout son consistentes entre clientes; solo cambia la identidad visual
- Sin compilación — los tokens se sirven como CSS variables desde el API

**Fase de desarrollo:**
- Fase 1: Web (PWA responsive con características nativas)
- Fase 2: App React Native + Expo

═══════════════════════════════════════════════════════════════
## 10. ESTADO ACTUAL DEL PROYECTO (actualizado 2026-05-12, 17:30 GMT+2)
═══════════════════════════════════════════════════════════════

La plataforma está en producción con datos reales. Los servicios están desplegados como contenedores Docker en el VPS.

### Servicios desplegados

| Contenedor | Imagen | Estado |
|-----------|--------|--------|
| `ingest-svc` | cmg-ingest | ✅ Activo, recibiendo datos FMC650 |
| `core-api` | cmg-core-api | ✅ Activo (Sentry activo, logging JSON estructurado) |
| `frontend` | cmg-frontend | ✅ Activo (nginx, rebuild manual con docker build + docker run) |
| `caddy` | caddy | ✅ HTTPS reverse proxy |
| `timescaledb` | timescaledb | ✅ PostgreSQL + TimescaleDB |
| `redis` | redis | ✅ Activo |

**Nota docker-compose:** hay un bug en docker-compose v1.29.2 con imágenes nginx:alpine que impide usar `up -d`. Para reconstruir el frontend usar:
```bash
docker-compose build frontend
OLD=$(docker ps -q --filter "name=cmg-telematic1_frontend_1")
docker stop $OLD && docker rm $OLD
docker run -d --name cmg-telematic1_frontend_1 --network cmg-telematic1_default --network-alias frontend --restart unless-stopped cmg-telematic1_frontend
```

### Migraciones Alembic aplicadas
001 → 022 (última: `022_indices_tenant_id`)

| Migración | Contenido |
|-----------|-----------|
| 001–014 | Schema inicial, dispositivos, ciclos, mantenimiento, SIM phone |
| 015 | Tabla `driver` + `vehicle_driver_assignment` |
| 016 | Tabla `work_order` (órdenes de trabajo) |
| 017 | Tabla `work_report` (informes con fotos, firma, PDF) |
| 018 | Campo `portal_access_token` en `tenant` |
| 019 | Tabla `work_order_stop` (paradas con lat/lon, arrival_radius_m, telemetría) |
| 020 | Refresh policy de `telemetry_1h` cada 15 min con end_offset 5 min |
| 021 | PDF parte multitenant: `tenant.business_cif/business_address`, `vehicle_type.pdf_metrics`, `work_order.final_client_name/address/doc_number`, `work_report.client_signee_name/dni/unsigned_reason`, tabla `tenant_doc_counter` |
| 022 | Índices `ix_<tabla>_tenant_id` en `vehicle`, `maintenance_plan`, `alert_instance`, `alert_rule` (Postgres no indexa FK por defecto → evita seq-scan al filtrar por tenant). `CREATE INDEX CONCURRENTLY` para no bloquear escrituras. |

### Frontend — páginas implementadas
- `/fleet` — FleetDashboard: mapa Leaflet full-page, sidebar collapsible, tarjeta flotante, TenantSelector para admins CMG
- `/vehicles` — VehiclesPage (lista con CRUD)
- `/tipos-vehiculo` — VehicleTypesPage (sensor_schema, mantenimiento, DOUT, métricas, reglas). Subcomponentes: AlertRulesSection (con editar/eliminar), DoutConfigSection, HistoricMetricsSection, MaintenanceTemplatesSection
- `/diagnostics/can-scanner` — CAN Scanner con histórico, etiquetado, exportación CSV
- `/vehicles/:id` — VehicleDetailPage (mapa dinámico full-height, SensorGrid compact, KPIs live WebSocket, auto-refresh 5 s, ignición con fallback DIN1)
- `/alerts` — AlertsPage (tabs Activas / Reglas, filtro por tenant para CMG admins)
- `/reports` — ReportsPage (filtro vehículo, PDF mensual)
- `/devices` — DevicesPage
- `/maintenance` — MaintenancePage + formulario de planes
- `/rules` — RulesPage + RuleFormPage (constructor visual; soporta ?condition_type=geofence y ?vehicle_id=)
- `/geofences` — GeofencesPage (lista de geocercas con preview SVG del polígono, editar/eliminar, crear)
- `/settings` — SettingsPage (usuarios, notificaciones, ciclos)
- `/clientes` — TenantsPage + TenantDetailPage (Portal cliente con token) + TenantFormPage
- `/drivers` — DriversPage (CRUD conductores, asignación a vehículo)
- `/work-orders` — WorkOrdersPage (órdenes con paradas, mapa, estados, informes PDF, StopsPanel)
- `/portal/:token` — ClientPortalPage (portal público sin autenticación, URL tokenizada por tenant)
- `/dashboard` — DashboardPage

### Navegación TopNav (desktop)
- **Barra principal**: Dashboard, Flota, Alertas, Mantenimiento, Reportes
- **Dropdown "Operaciones"** (admin/operator): Órdenes de trabajo, Conductores, Geocercas. **Para admin tier=client se añade "Mis clientes"** (gestión de subclients propios — el CMG admin lo tiene en su dropdown "Admin").
- **Dropdown "Admin"** (CMG admin): Clientes, Flota todos, Plantillas, Dispositivos, CAN Scanner, Ajustes
- **Dropdown "Cuenta"** (admin tier=client): solo Ajustes (la gestión de subclients vive en Operaciones → Mis clientes)
- **TenantSelector**: visible solo para CMG admins — filtra datos de FleetDashboard, AlertsPage y WorkOrdersPage

### Funcionalidades clave implementadas
- **Codec 8 + Codec 8 Extended**: decodificación correcta incluyendo grupo X-byte del Extended
- **CAN Manual slots 0–19**: AVL IDs 145–154 (Codec 8) y 380–389 (Codec 8 Extended)
- **Buffer offline FMC650**: el dispositivo guarda hasta ~130.000 registros en flash interna (10 MB) o microSD (hasta 32 GB). Al reconectar envía todo en Codec 8 idéntico. El ingest-svc lo maneja transparentemente — `ON CONFLICT DO NOTHING` + timestamp original del AVL. No se pierde ningún dato CAN/PTO.
- **DOUT**: control salidas digitales vía Codec 12, persistencia Redis, restore automático
- **Ignición por RPM (primario) + DIN2 fallback**: la fuente principal de ignición es ahora el régimen del motor. Si cualquier AVL conocido de RPM (`avl_30`, `avl_36`, `avl_85`, `avl_269`, `avl_10309`) supera 200 raw → motor en marcha → ignition ON. Si la trama trae RPM y está en 0 → motor parado. **Sólo si la trama no trae ningún AVL de RPM** (vehículo sin CAN de RPM configurado) se cae a DIN2 (`avl_2`) o `avl_239` como fallback. **DIN1 (`avl_1`) ya no es señal de ignición**: se reserva para fallback de PTO (junto a `avl_179`). Esto refleja el cableado físico nuevo: DIN1 → contacto PTO, DIN2 → contacto ignición. Helper `_compute_ignition()` en `services/ingest/src/{writer.py,publisher.py}` y `_ignition_from_can()` en `backend/app/api/v1/vehicles.py` — misma regla en los tres puntos. Frontend y mobile consumen `status.ignition` como bool, sin cambios.
- **sensor_schema**: por tipo de vehículo con canal CAN, modo Byte/Bit, scale y offset
- **Mantenimiento predictivo**: planes, templates, intervenciones con reset de acumuladores
- **Alertas / Rules engine**: threshold, sustained, accumulation, trend, composite, schedule, **geofence** (ray-casting, estado inside/outside en Redis por regla+vehículo)
- **Geocercas**: polígono JSONB en condition, editor Leaflet con clic para vértices, evaluación por transición enter/exit, visualización en FleetMap
- **Conductores**: entidad Driver con historial de asignaciones a vehículos
- **Órdenes de trabajo**: creación con paradas inline (título, cliente, dirección, lat/lon, radio de llegada ajustable); geocoding Nominatim integrado en StopLocationPicker (buscar por dirección + clic en mapa); marcadores DivIcon SVG; telemetría capturada por parada (PTO min, RPM, combustible, presión). Datos opcionales del **cliente final** (`final_client_name`, `final_client_address`) para imprimir en el PDF como destinatario del servicio.
- **Informes de trabajo (parte de servicio multi-tenant)**: PDF generado con WeasyPrint y branding del tenant emisor (logo + `brand_color` desde `brand_tokens` o columna; CIF y dirección fiscal opcionales). Tabla de paradas con métricas configurables por `vehicle_type.pdf_metrics` (catálogo: pto_minutes, pressure_min/max, rpm_avg, pump_minutes, fuel_l con label/unit/format editables desde `PdfMetricsSection` en `/tipos-vehiculo`). **Firma + DNI del cliente final** capturada en mobile (canvas + DNI/NIE con validación de letra de control); flujo alternativo "no se puede firmar" con motivo (`Cliente ausente`, `Rechaza firmar`, `Menor de edad`, `Otro`) que se imprime como nota gris en el PDF en lugar de la firma. **Numeración secuencial `PT-{año}-{NNNNN}` independiente por tenant emisor** (asignada atómicamente vía `INSERT ... ON CONFLICT ... RETURNING` sobre `tenant_doc_counter` al transicionar la orden a `done`). El backend bloquea `status=done` con 422 si el report no tiene firma+nombre+DNI o `unsigned_reason`. Endpoint `GET /work-orders/{id}/telemetry-detail` devuelve toda la telemetría capturada con flag de qué keys salen en el PDF (tab "Telemetría capturada" en `WorkReportModal`). El operario, tras cerrar el parte, llega a `WorkReportSuccessScreen` con botón "Compartir parte" que descarga el PDF (`expo-file-system`) y abre la Share API nativa (`expo-sharing`) para enviarlo al cliente final por WhatsApp/Mail/AirDrop.
- **Portal cliente**: URL `/portal/:token` pública sin login; mapa de flota, lista de vehículos, órdenes completadas; token generado y copiado desde TenantDetailPage. (Por decisión de producto **no se entrega al cliente final**: el PDF se descarga desde el web autenticado del tenant emisor o se comparte directamente desde el móvil del operario.)
- **Permisos jerárquicos sobre tenants/usuarios**: helper `assert_can_manage_tenant` en `backend/app/api/v1/deps.py` centraliza la regla:
  - tier=cmg admin: cualquier tenant
  - tier=client admin: su propio tenant + cualquier subclient suyo (parent_id == user.tenant_id)
  - tier=subclient admin: solo su propio tenant
  - operator/viewer/driver: nunca
  Aplicado en `list_tenant_users`, `create_tenant_user`, `PUT/DELETE /users/{id}`. Permite a Vacuum admin crear y gestionar usuarios para sus subclients (Aguas de Valencia, etc.).
- **TenantSelector CMG**: Zustand store `useTenantContext`; filtra queries en FleetDashboard, AlertsPage, WorkOrdersPage
- **WebSocket telemetría**: CMG admins registrados bajo sentinel `"__cmg__"`, broadcast siempre incluye `"__cmg__"` además del tenant del vehículo — admins ven todos los tenants en tiempo real. El handler `wsClient.onmessage` parchea **dos** caches en cada mensaje: el individual `['vehicles', id, 'status']` (VehicleDetailPage) y el bulk `['vehicles', 'statuses', ...]` vía `setQueriesData` con match por prefijo (FleetMap, FleetDashboard, DashboardPage). Sin esto el bulk queda congelado por `staleTime: Infinity` y el mapa muestra "sin señal" mientras el detalle se ve online.
- **Bulk status endpoint**: `GET /api/v1/vehicles/statuses?ids=...` — pipeline Redis, hasta 200 IDs. `effective_online` se calcula desde `last_seen < 5 min` en Redis, no desde `device.online` de Postgres (que puede quedar desactualizado).
- **SensorGrid compact**: modo lista plana (label→valor) para panel lateral de VehicleDetailPage
- **White-label**: brand_tokens JSONB; CSS variables inyectadas en runtime; portal también respeta branding del tenant
- **Sentry**: backend + frontend con DSN en .env; logging JSON estructurado

### Sprint vendibilidad (2026-05-12) — estabilidad y UX pre-comercial

Sprint de un día tras auditoría con 4 agentes en paralelo (frontend + backend + scale + rutas). Plan completo en `/root/.claude/plans/snazzy-hatching-crown.md`. Objetivo: pasar la plataforma de "funcional para uso interno CMG" a "vendible a 100-500 vehículos con admins concurrentes".

**Backend — escalabilidad y estabilidad:**
- `backend/app/api/v1/ws.py` — `broadcast_to_tenant` ahora usa `asyncio.gather` con `wait_for(timeout=2.0)` por socket; sockets que timeoutean se descartan y cierran. `broadcast_to_all` paraleliza entre tenants. Antes: un cliente lento (3G, navegador en background) bloqueaba la telemetría EN VIVO de toda la flota; ahora no.
- `backend/app/api/v1/vehicles.py:list_vehicles` — HGETALL Redis migrado a `redis.pipeline()` (1 round-trip en lugar de N). Antes inutilizable a partir de ~150 vehículos.
- `backend/app/api/v1/vehicles.py:get_vehicles_statuses_bulk` — `db.get()` por cada uno de hasta 200 IDs reemplazado por `SELECT WHERE id = ANY(:ids)`. Antes saturaba el pool de 20 conexiones con 50 admins refrescando.
- `backend/app/api/v1/vehicles.py:_apply_templates_to_vehicles` — N×M queries → un SELECT IN + diff en memoria + bulk insert. Antes PATCH `/vehicle-types/{id}/maintenance-templates` con 200 veh × 8 templates = 1.600 SELECT.
- `backend/app/api/v1/vehicles.py:avl-series` — `LIMIT 5000` defensivo. Para rangos > 24 h agrega por hora con `time_bucket('1 hour', time)`. Antes un cliente curioso pidiendo 720 h podía derribar Timescale.
- `services/ingest/src/main.py` — pool asyncpg subido a `min_size=10, max_size=40` (antes 5/20). Aguanta tormenta de reconexiones FMC650 sin bloquear el receive_loop.
- `docker-compose.yml` — `ingest-svc` ahora declara `healthcheck` TCP al 5027, `mem_limit: 512m`, `cpus: 1.0` (el swap en caliente se hizo con `docker run --memory 512m --cpus 1.0` para no reiniciar todo el stack).
- `backend/app/api/v1/fleet.py` (nuevo) — endpoint `GET /api/v1/fleet/kpis?range=1d|7d|30d&tenant_id=…` que agrega `telemetry_1h` por día. Devuelve `engine_hours`, `pto_hours`, `active_vehicles`, `by_day[]`. CMG admin sin tenant_id ve agregado global; resto siempre filtrado por su propio tenant.

**Frontend — UX vendible:**
- `frontend/src/App.tsx` — montados `<ToastContainer />` y `<ConfirmDialogHost />` a nivel raíz.
- `frontend/src/shared/ui/Toast.tsx` — además del hook `useToast()`, exporta API imperativa `toast.error/success/warning/info(msg)` para usar fuera de componentes (p. ej. `downloadOrderPdf` a nivel módulo en WorkOrdersPage).
- `frontend/src/shared/ui/ConfirmDialog.tsx` (nuevo) — modal con backdrop oscuro, soporte Enter/Esc, kinds `danger/warning/info`. Hook `useConfirm()` devuelve `Promise<boolean>`.
- 4 `window.alert()` reemplazados por `toast.error()` en WorkOrdersPage (descarga PDF), ReportFilters, VehicleDetailPage (PDF).
- 9 `window.confirm()` reemplazados por `useConfirm({title, message, confirmLabel, kind})` en DevicesPage, GeofencesPage, AlertRulesSection, DriversPage, WorkReportModal, WorkOrdersPage (StopsPanel y main), PdfMetricsSection, TenantDetailPage.
- **Role guards `isAdmin`** (`user?.role === 'admin'`) en botones destructivos/crear de 8 páginas: DevicesPage, VehiclesPage, DriversPage, TenantsPage, RulesPage, MaintenancePage, WorkOrdersPage, GeofencesPage. Antes `operator`/`viewer` veían los botones y recibían 403 silencioso (sin toast).
- `frontend/src/main.tsx` — `QueryCache({ onError })` y `MutationCache({ onError })` globales: errores 5xx → toast genérico; 401/403/404 los maneja la UI por su cuenta (no spam de toasts). Mensaje específico para 5xx: "El servidor no responde. Reintenta en unos segundos."
- `staleTime: Infinity` bajado a `60_000` en 13 sitios de producción donde los datos sí mutan (MaintenancePage, GeofencesPage, AlertsPage, NotificationSettings, VehicleFilterPicker, RuleFormPage, WorkCycleDefinitionsSection, MaintenancePlanFormPage). Se mantiene `Infinity` solo en `useVehicleStatuses` (intencional, parcheado por WS).
- `Loading...` plano reemplazado por `<SkeletonRow />` en TenantsPage, MaintenancePage, WorkOrdersPage.
- 3 `.bak` huérfanos borrados (`TopNav.tsx.bak`, `ReportsPage.tsx.bak`, `VehicleDetailPage.tsx.bak`).

**Frontend — features pedidas por el dueño:**
- **Bug Reportes vacío resuelto**: `frontend/src/features/reports/useReportData.ts:142` — antes la query estaba `enabled: !isCmg || Boolean(effectiveTenantId)` que bloqueaba a admin CMG sin tenant seleccionado en el TopNav. Ahora, cuando `isCmg && !effectiveTenantId`, llama a `/api/v1/vehicles` sin parámetro y el backend devuelve todos (porque tier=cmg). Sin esto el selector de vehículos quedaba vacío y ninguna tab (Histórico/Mantenimiento/Rutas/Alertas) se podía usar.
- **Selector de fecha en VehicleDetailPage**: `frontend/src/features/vehicle/VehicleDetailPage.tsx` — input `type="date"` superpuesto en la esquina superior derecha del mapa con valor por defecto = hoy. Si `trackDate === hoy` consume `/track/today` (con refetchInterval 30s); si es fecha pasada, llama `/track?from=YYYY-MM-DDT00:00:00&to=YYYY-MM-DDT23:59:59` sin polling. Botón "Hoy" para volver. Comparte `TrackMap.tsx` sin tocar — solo cambia la fuente de datos.
- **DashboardPage con KPIs reales**: `frontend/src/features/dashboard/DashboardPage.tsx` — fila adicional con 3 cards ("Horas motor · 7 días", "Horas PTO · 7 días", "Utilización media h/día/veh") y `<BarChart>` Recharts con utilización diaria (engine_hours naranja + pto_hours verde). Lee el nuevo endpoint `/api/v1/fleet/kpis?range=7d`. Cuando `engine_hours > 0` muestra "% de uso PTO" como sub. Antes el Dashboard solo contaba tarjetas (vehículos online, alertas, órdenes, mantenimiento) — ninguna métrica del diferenciador comercial CAN.

**Despliegue del sprint (12 mayo 2026 ~17:00-17:30 GMT+2):**
- Migración 022 aplicada en caliente: copia del .py al contenedor + `alembic upgrade head` (sin reiniciar core-api). Verificado: 4 índices nuevos creados.
- `frontend` swap: `docker build` + stop/rm/run. Corte real ~2 s. Sin pérdida de sesión (los chunks viejos se sirven hasta F5 manual; ErrorBoundary tiene auto-reload de chunks faltantes).
- `core-api` swap: nuevo contenedor con la imagen reconstruida. Corte real ~11 s. WebSockets de los navegadores se reconectaron automáticamente. Importante: en el `docker run` manual hay que pasar `--env-file /opt/cmg-telematic1/.env` Y `-v cmg-telematic1_uploads_data:/app/uploads` Y `--network-alias core-api` para que Caddy lo encuentre.
- `ingest-svc` swap: `docker run -p 0.0.0.0:5027:5027 --memory 512m --cpus 1.0`. Primer FMC650 (PRUEBA, IMEI 864275075510100) reconectó **60 s** después del swap y subió su lote acumulado al buffer offline. Cero datos perdidos gracias al patrón `ON CONFLICT DO NOTHING` en `writer.py`.

**Limitaciones conocidas / fuera de alcance del sprint:**
- **i18n** — toda la web sigue hardcoded en castellano (`useTranslation` no se usa). Limita TAM angloparlante. Trabajo aparte de ~2-3 días.
- **Responsive tablas** — solo FleetDashboard/VehicleCard/ReportsPage/VehicleDetailPage usan `useIsMobile()`. El resto son tablas con `whiteSpace: nowrap` (scroll horizontal en tablet). No bloqueante mientras exista la app móvil nativa.
- **Refactor de `ReportsPage.tsx` monolítico** (1196 líneas) — estético, no bloqueante.
- **DOUT TTL Redis** — leak controlado, no urgente.

### Logo CMG Track
- Archivo: `backend/static/logos/cmgtrack.png` (668×187 px)
- Topbar height: 62px (`--topbar-h` en tokens.css)

### Hardware FMC650 — notas clave
- **Buffer offline**: flash interna 10 MB (~80k–130k registros AVL completos con todos los IO elements/CAN)
- **MicroSD**: slot físico push-lock, hasta 32 GB FAT32. Configurar en Teltonika Configurator: `Save records to → SD card`
- **Reenvío**: mismo Codec 8/8E, FIFO, espera ACK. Sistema actual lo maneja sin cambios de código.
- **Campo `priority`** (0=low, 1=high, 2=panic): se parsea en codec8.py pero NO se persiste en `telemetry_record` — pendiente si se necesita en el futuro

### GitHub
Repositorio: https://github.com/camaro734/cmg-telematics (rama master)

═══════════════════════════════════════════════════════════════
## 11. REGLAS GLOBALES — APLICAN A TODOS LOS AGENTES
═══════════════════════════════════════════════════════════════

### Nunca hacer
- Nunca exponer puerto 5432 ni 6379 al exterior
- Nunca hacer SELECT sin filtro `time` en telemetry_record (mata el VPS)
- Nunca devolver datos de un tenant fuera del scope del usuario autenticado
- Nunca usar threading — todo async/await
- Nunca hardcodear credenciales — siempre desde .env via settings
- Nunca romper el protocolo Codec 8 — el hardware en campo no se actualiza fácilmente
- Nunca delegar más permisos de los que tiene el grantor
- Nunca usar AsyncStorage para JWT en app móvil (usar SecureStore)
- Nunca añadir dependencias sin justificación

### Siempre hacer
- Leer el CLAUDE.md del subdirectorio antes de editar ficheros en él
- Leer el fichero existente antes de modificarlo — cambios incrementales
- Usar `time_bucket()` para todas las agregaciones sobre telemetry_record
- Filtrar siempre por tenant_id antes de devolver cualquier dato
- Validar permission_grant antes de dar acceso cross-tenant
- Loguear con nivel apropiado: DEBUG en dev, INFO/ERROR en producción
- Tipos Python con Pydantic v2 en todos los schemas
- Comentarios en español, código en inglés

### Referencia al proyecto anterior
- El protocolo Codec 8 está documentado en /opt/cmg-telematics/backend/app/services/teltonika/
- El schema TimescaleDB anterior está en /opt/cmg-telematics/backend/app/models/
- Consultar SOLO como referencia, no copiar código directamente
═══════════════════════════════════════════════════════════════
## 12. REGLAS DE TRABAJO PARA CLAUDE CODE
═══════════════════════════════════════════════════════════════

Esta sección es para el agente Claude que está leyendo este archivo,
no para los desarrolladores. Define cómo trabajar en este repo para
maximizar calidad y minimizar coste sin sacrificar lo primero.

### 12.1 Validación obligatoria después de cada cambio

Esto es innegociable. Hay clientes en producción (Wasterent, PREZERO).
Después de cualquier modificación, Claude DEBE terminar la respuesta con:

1. **Bloque "Validación"** con comandos concretos a ejecutar:
   - Para backend: `pytest backend/tests/test_X.py::test_Y -xvs`
   - Para endpoint nuevo: `curl -H "Authorization: Bearer $TOKEN" ...`
   - Para servicio: `docker compose logs <svc> --tail 100 | grep ERROR`
   - Para migración: `alembic upgrade head` + verificación SQL del cambio
2. **Aviso de migración** si tocas un modelo SQLAlchemy:
   `alembic revision --autogenerate -m "descripción"`
3. **Aviso de breaking change** si afecta a contratos API/WebSocket
4. **Sugerencia de rollback** para cambios destructivos:
   - Cómo revertir si algo falla en producción
   - Qué backup mirar

Una tarea NO está terminada hasta que Carlos puede validarla.

### 12.2 Lectura de archivos — minimalismo extremo

El repo es grande. Para no quemar tokens:

- **NUNCA** leer `/opt/cmg-telematics` (repo anterior) sin que Carlos lo pida explícitamente
- **NUNCA** `find` o `ls -R` sobre el repo completo
- **NUNCA** abrir un archivo "por si acaso"
- Leer SOLO archivos directamente implicados en la tarea
- Antes de leer un archivo grande, comprobar si el CLAUDE.md local del subdir tiene la info
- Si hay un CLAUDE.md en el subdirectorio donde vas a tocar, leerlo PRIMERO
  (este meta-CLAUDE ya lo dice en regla "Siempre hacer" sección 11)
- Si necesitas más contexto del que tienes, pregunta por ruta concreta antes de leer

**Excepción explícita:** al inicio de la sesión puedes pedir `tree -L 2`
o `git status` para orientarte. Una vez. No repetir.

### 12.3 Formato de respuesta

- Directo, sin "Voy a ayudarte con..." ni resúmenes innecesarios
- Carlos conoce el stack — no re-expliques FastAPI, SQLAlchemy, React Query
- Código completo y pegable, no pseudo-código
- Diff mínimo: cambias 5 líneas, muestras 5 líneas + 2 de contexto
- Máximo 1-2 párrafos de contexto antes del código
- Al final: bloque "Validación" con comando(s) concretos (ver 12.1)

### 12.4 Cuándo preguntar vs cuándo asumir

**Pregunta SIEMPRE antes de:**
- Cambios en esquema DB (modelos SQLAlchemy, migraciones Alembic)
- Modificar lógica del ingestor TCP que esté en producción
- Cambios en autenticación, JWT, RLS, permission_grant
- Modificar `docker-compose.yml`, `.env`, `.env.production`
- Borrar o renombrar endpoints existentes
- Modificar el protocolo Codec 8 / 8 Extended / 12
- Refactorizar archivos > 200 líneas
- Tocar continuous aggregates de TimescaleDB
- Cualquier cambio que afecte a clientes en producción

**Asume sin preguntar:**
- Estilo de código (sigue el existente — comentarios en español, código en inglés)
- Naming (sigue convenciones del repo)
- Imports estándar
- Añadir un campo opcional a un Pydantic
- Crear un endpoint nuevo no destructivo
- Añadir un test que no existe
- Añadir un toast/confirm en frontend siguiendo el patrón ya existente

### 12.5 NO TOCAR sin aviso explícito

Adicional a la sección 11 "Nunca hacer":

- `/opt/cmg-telematics` (repo anterior, solo consulta)
- `alembic/versions/*` antiguas — solo crear nuevas
- Configuración del ingestor TCP en producción (puerto 5027)
- `.env`, `.env.production`, variables sensibles
- Estructura de hypertables ya creadas
- Funciones de parsing Codec 8 en `services/ingest/src/` sin tests previos
- `tenant_doc_counter` y lógica de numeración PT-{año}-{NNNNN}
- Cualquier archivo con sufijo `.prod.*` o en carpeta `prod/`

### 12.6 Calidad de código exigida

Producto comercial → estándares altos:

- Type hints en TODA función pública (Python)
- TypeScript estricto en frontend, no `any` salvo justificado
- Docstrings en módulos y clases (Google style)
- No `print()` en código de servicio — `structlog` ya está configurado
- No `except:` desnudo — siempre tipo específico
- No funciones > 50 líneas (refactorizar si crece)
- No archivos > 500 líneas (dividir en módulos)
  - Excepción conocida: `ReportsPage.tsx` (1196 líneas, refactor estético pendiente)
- Imports ordenados: stdlib → terceros → locales
- Logs estructurados con `request_id`, `tenant_id`, `imei` cuando aplique

### 12.7 Testing

- Cada feature nueva con su test correspondiente
- Tests unitarios para lógica de negocio (rules-engine, parsers Codec)
- Tests de integración para endpoints (con DB de test)
- NO ejecutar tests automáticamente — sugerir comando a Carlos
- NO levantar `docker compose up` sin petición explícita (puede afectar prod)
- Cobertura objetivo en módulos críticos: ingestor, rules-engine, auth, permission_grant

### 12.8 Escalabilidad — pensar siempre en N=1000 vehículos

Este producto escala. Antes de implementar algo, comprobar:

- ¿Esta query funciona con 1M filas en `telemetry_record`?
- ¿Estoy haciendo N+1? Usar `selectinload` o `JOIN`
- ¿Hago un round-trip Redis por elemento? Usar `pipeline()`
- ¿Filtro por `tenant_id` y tiene índice? (ver migración 022)
- ¿La agregación temporal usa `time_bucket()` o estoy reinventando?
- ¿El endpoint puede recibir 200 IDs? Usar `WHERE id = ANY(:ids)` no loop

Patrón establecido (ver Sprint vendibilidad 2026-05-12):
- Bulk endpoints en lugar de loops
- `asyncio.gather` con `wait_for` para broadcasts WebSocket
- Pools asyncpg dimensionados (min_size=10, max_size=40 para ingest)
- `LIMIT 5000` defensivo en endpoints de series temporales

### 12.9 Multi-tenant — verificación obligatoria

Cualquier endpoint o query que devuelva datos:

1. ¿Filtra por `tenant_id` o equivalente?
2. ¿Respeta jerarquía cmg/client/subclient?
3. ¿Usa `assert_can_manage_tenant` cuando gestiona usuarios/recursos?
4. ¿Para CMG admins, distingue "sin filtro" (ven todo) vs filtro explícito?
5. ¿WebSocket broadcasts incluyen sentinel `"__cmg__"` cuando aplique?

Un fallo aquí = filtración de datos entre clientes = pérdida del contrato.

### 12.10 Caché de Claude — preservar sesión

- Este CLAUDE.md NO debe modificarse durante una sesión activa
  (cualquier cambio rompe el caché y multiplica el coste del próximo turno)
- Cambios al CLAUDE.md → al final de la sesión, no a mitad
- Si Carlos pide actualizar el CLAUDE.md a mitad de sesión, terminar
  la tarea actual primero y proponer hacerlo al cerrar

═══════════════════════════════════════════════════════════════
## 13. SELECCIÓN DE MODELO Y MODO
═══════════════════════════════════════════════════════════════

Carlos paga API directa, no Pro/Max. Cada token cuenta pero la calidad
manda — esto es producto comercial.

### 13.1 Modelo por defecto

**Claude Sonnet 4.6** para todo el desarrollo normal.

Razón: equilibrio coste/calidad óptimo para coding serio. Haiku 4.5 es
demasiado básico para lógica multi-tenant + async + TimescaleDB.
Opus 4.7 es 5x más caro y solo se justifica en casos concretos.

### 13.2 Cuándo usar Opus 4.7

Carlos puede activarlo con `/model claude-opus-4-7`. Recomendarlo cuando:

- Diseño de arquitectura nueva (nuevo servicio, nuevo flujo de datos)
- Debugging complejo que toca > 2 archivos y > 1 servicio
- Race conditions, problemas de concurrencia, deadlocks
- Decisión de modelado de datos crítico (nuevo agregado, nueva tabla central)
- Sonnet ha fallado 2+ veces en la misma tarea
- Análisis de rendimiento / planes de query / optimización TimescaleDB
- Auditoría de seguridad (RLS, permission_grant, JWT)

Al terminar la tarea compleja, recomendar volver a Sonnet con `/model claude-sonnet-4-6`.

### 13.3 Cuándo usar Haiku 4.5

Solo si Carlos lo pide explícitamente, para:
- Lecturas masivas (consultar muchos archivos sin razonar)
- Renombrados mecánicos
- Búsquedas y greps interpretados
- Resúmenes de logs

NO usar Haiku para escribir código de negocio.

### 13.4 Thinking mode

- **OFF por defecto** para casi todo
- **ON automáticamente** (sugerir activarlo) cuando la tarea sea:
  - Diseño de arquitectura
  - Debugging de race conditions
  - Modelado de datos
  - Decisiones de escalabilidad
- Carlos puede forzar con `/think` o desactivar con `/think off`

Thinking añade tokens de razonamiento (caros) — usarlo cuando aporta valor real.

### 13.5 Modo permisos

`permissions.default: "ask"` en `~/.claude/settings.json`.

En producción Claude pregunta antes de ejecutar comandos destructivos.
No usar `"always"` aquí — el coste de un `rm -rf` mal escrito en este
repo es perder el producto.

═══════════════════════════════════════════════════════════════
## 14. RESUMEN OPERATIVO PARA CADA SESIÓN
═══════════════════════════════════════════════════════════════

Al inicio de cada sesión, Claude:

1. Confirma cwd = `/opt/cmg-telematic1`
2. Lee este CLAUDE.md (ya lo está haciendo)
3. NO lee otros archivos automáticamente
4. Espera la tarea de Carlos
5. Si la tarea afecta a un subdirectorio con su propio CLAUDE.md
   (backend/, frontend/, services/*/), lo lee antes de tocar nada
6. Asume modelo Sonnet 4.6 si Carlos no especifica

Al final de cada respuesta con cambios:

1. Resumen breve de qué se cambió (1-2 líneas)
2. Bloque "Validación" con comandos concretos
3. Aviso de migración / breaking change si aplica
4. Recomendación de modelo si conviene cambiar para la próxima tarea

═══════════════════════════════════════════════════════════════
## 15. ENTORNO DE EJECUCIÓN — LEER ANTES DE CADA SESIÓN
═══════════════════════════════════════════════════════════════

### ⚠️ ESTE SERVIDOR ES PRODUCCIÓN

`/opt/cmg-telematic1` en el VPS 213.210.20.183 es el ÚNICO despliegue.
Los contenedores que levanta docker compose son los que sirven a 
Wasterent y PREZERO ahora mismo.

- Caddy: expone 443 al mundo
- ingest-svc: expone 5027 al mundo, recibe FMC650 reales
- postgres: contiene datos de producción de clientes
- redis: estado en vivo de operaciones reales

NO existe entorno de staging separado en este servidor.
NO existe "BD local" — la BD de Docker ES la BD de producción.
NO existe carpeta de desarrollo aislada.

### Comandos que REQUIEREN confirmación explícita de Carlos

Antes de ejecutar cualquiera de estos, PARAR y preguntar:

- `alembic upgrade head` / `alembic upgrade <revision>`
- `alembic downgrade <revision>`
- `docker compose down` / `docker compose restart`
- `docker stop` / `docker rm` / `docker kill`
- Cualquier `psql` que no sea SELECT puro
- Modificar `.env`, `docker-compose.yml`, `Caddyfile`
- Eliminar volúmenes Docker (`docker volume rm`)
- `git push --force` o cualquier `git push` (sin --force también)
- Cualquier operación de filesystem fuera de `alembic/versions/`,
  `docs/`, `backups/`

### Si un prompt habla de "local" o "staging"

Si un prompt o instrucción menciona:
- "Verificar localmente antes de producción"
- "Probar en local primero"
- "Aplicar en staging"
- "Entorno de desarrollo"

PARAR. En este servidor "local" y "producción" son lo mismo.
Avisar a Carlos antes de ejecutar el comando.

### Identificación rápida de contenedores de producción

### ⚠️ Despliegue del frontend — procedimiento obligatorio

`docker compose up -d frontend` **NO funciona** (bug docker-compose v1.29.2 + nginx:alpine).
Cada vez que se reconstruya el frontend usar siempre este procedimiento:

```bash
docker-compose build frontend
OLD=$(docker ps -q --filter "name=cmg-telematic1_frontend_1")
docker stop $OLD && docker rm $OLD
docker run -d --name cmg-telematic1_frontend_1 \
  --network cmg-telematic1_default \
  --network-alias frontend \
  --restart unless-stopped \
  cmg-telematic1_frontend
```

Verificar que el nuevo build está servido:
```bash
docker exec cmg-telematic1_frontend_1 sh -c \
  "grep -rl 'TOKEN_O_STRING_NUEVO' /usr/share/nginx/html/assets/ | head -3"
```
