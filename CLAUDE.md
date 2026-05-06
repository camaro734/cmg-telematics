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
/* Paleta base — warm grays + energy orange + efficiency green */
--bg-base:       #1C1917;   /* fondo principal (warm dark) */
--bg-surface:    #292524;   /* cards, paneles */
--bg-elevated:   #3C3330;   /* modales, dropdowns */
--bg-border:     #57534E;   /* bordes sutiles */

/* Acentos funcionales */
--accent-energy: #F97316;   /* naranja — hidráulica, energía, CTAs */
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
## 10. ESTADO ACTUAL DEL PROYECTO (actualizado 2026-05-05)
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
001 → 019 (última: `019_work_order_stops`)

| Migración | Contenido |
|-----------|-----------|
| 001–014 | Schema inicial, dispositivos, ciclos, mantenimiento, SIM phone |
| 015 | Tabla `driver` + `vehicle_driver_assignment` |
| 016 | Tabla `work_order` (órdenes de trabajo) |
| 017 | Tabla `work_report` (informes con fotos, firma, PDF) |
| 018 | Campo `portal_access_token` en `tenant` |
| 019 | Tabla `work_order_stop` (paradas con lat/lon, arrival_radius_m, telemetría) |

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
- **Dropdown "Operaciones"** (admin/operator): Órdenes de trabajo, Conductores, Geocercas
- **Dropdown "Admin"** (solo CMG admin): Clientes, Flota todos, Plantillas, Dispositivos, CAN Scanner, Ajustes
- **TenantSelector**: visible solo para CMG admins — filtra datos de FleetDashboard, AlertsPage y WorkOrdersPage

### Funcionalidades clave implementadas
- **Codec 8 + Codec 8 Extended**: decodificación correcta incluyendo grupo X-byte del Extended
- **CAN Manual slots 0–19**: AVL IDs 145–154 (Codec 8) y 380–389 (Codec 8 Extended)
- **Buffer offline FMC650**: el dispositivo guarda hasta ~130.000 registros en flash interna (10 MB) o microSD (hasta 32 GB). Al reconectar envía todo en Codec 8 idéntico. El ingest-svc lo maneja transparentemente — `ON CONFLICT DO NOTHING` + timestamp original del AVL. No se pierde ningún dato CAN/PTO.
- **DOUT**: control salidas digitales vía Codec 12, persistencia Redis, restore automático
- **Ignición con fallback DIN1**: `avl_1`/`avl_239` como fallback si no hay CAN ignition (corregido en status endpoint y bulk endpoint)
- **sensor_schema**: por tipo de vehículo con canal CAN, modo Byte/Bit, scale y offset
- **Mantenimiento predictivo**: planes, templates, intervenciones con reset de acumuladores
- **Alertas / Rules engine**: threshold, sustained, accumulation, trend, composite, schedule, **geofence** (ray-casting, estado inside/outside en Redis por regla+vehículo)
- **Geocercas**: polígono JSONB en condition, editor Leaflet con clic para vértices, evaluación por transición enter/exit, visualización en FleetMap
- **Conductores**: entidad Driver con historial de asignaciones a vehículos
- **Órdenes de trabajo**: creación con paradas inline (título, cliente, dirección, lat/lon, radio de llegada ajustable); geocoding Nominatim integrado en StopLocationPicker (buscar por dirección + clic en mapa); marcadores DivIcon SVG; telemetría capturada por parada (PTO min, RPM, combustible, presión)
- **Informes de trabajo**: firma digital canvas, upload fotos, generación PDF WeasyPrint con logo tenant
- **Portal cliente**: URL `/portal/:token` pública sin login; mapa de flota, lista de vehículos, órdenes completadas; token generado y copiado desde TenantDetailPage
- **TenantSelector CMG**: Zustand store `useTenantContext`; filtra queries en FleetDashboard, AlertsPage, WorkOrdersPage
- **WebSocket telemetría**: CMG admins registrados bajo sentinel `"__cmg__"`, broadcast siempre incluye `"__cmg__"` además del tenant del vehículo — admins ven todos los tenants en tiempo real
- **Bulk status endpoint**: `GET /api/v1/vehicles/statuses?ids=...` — pipeline Redis, hasta 200 IDs
- **SensorGrid compact**: modo lista plana (label→valor) para panel lateral de VehicleDetailPage
- **White-label**: brand_tokens JSONB; CSS variables inyectadas en runtime; portal también respeta branding del tenant
- **Sentry**: backend + frontend con DSN en .env; logging JSON estructurado

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
