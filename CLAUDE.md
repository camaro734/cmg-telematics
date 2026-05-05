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
001 → 014 (última: `014_device_sim_phone`)

### Frontend — páginas implementadas
- `/fleet` — FleetDashboard: mapa Leaflet full-page, sidebar collapsible con lista de vehículos, tarjeta flotante al seleccionar vehículo con botón "Ver detalle →"
- `/vehicles` — VehiclesPage (lista de vehículos con CRUD)
- `/tipos-vehiculo` — VehicleTypesPage (sensor_schema con scale+offset, mantenimiento templates, DOUT config, métricas históricas, ciclos de trabajo, reglas de alerta, icono). Dividida en sub-componentes: AlertRulesSection, DoutConfigSection, HistoricMetricsSection, MaintenanceTemplatesSection
- `/diagnostics/can-scanner` — CAN Scanner con histórico, etiquetado, exportación CSV
- `/vehicles/:id` — VehicleDetailPage (live con mapa ampliado, KPIs en tiempo real, histórico, ciclos, mantenimiento; paneles CHASIS/COMANDOS/INCIDENCIAS colapsables)
- `/alerts` — AlertsPage (tabs Activas / Reglas)
- `/reports` — ReportsPage (filtro por vehículo, PDF mensual). Hook useReportData extraído
- `/devices` — DevicesPage
- `/maintenance` — MaintenancePage + formulario de planes
- `/rules` — RulesPage + RuleFormPage (constructor visual)
- `/settings` — SettingsPage (usuarios, notificaciones, ciclos)
- `/clientes` — TenantsPage + TenantDetailPage + TenantFormPage (módulos habilitados, brand tokens, grants)

### Funcionalidades clave implementadas
- **Codec 8 + Codec 8 Extended**: decodificación correcta incluyendo el grupo X-byte del Extended
- **CAN Manual slots 0–19**: AVL IDs 145–154 (Codec 8) y 380–389 (Codec 8 Extended)
- **DOUT**: control de salidas digitales vía Codec 12, persistencia en Redis, restore automático al reconectar; historial de comandos con ACK FMC650
- **sensor_schema**: definición por tipo de vehículo con canal CAN, modo Byte/Bit, scale y **offset** (fórmula: `valor = raw × scale + offset`, ej: offset=-40 para temperatura)
- **CAN Scanner**: indicador de antigüedad de datos (badge + banner cuando PLC apagado)
- **Mantenimiento predictivo**: planes por vehículo, templates por tipo, intervenciones con reset
- **Alertas**: rules engine con condiciones JSONB (threshold, sustained, accumulation, trend, composite, schedule), instancias, escalación
- **Exportación CSV**: CAN Scanner, ciclos de trabajo, intervenciones de mantenimiento
- **Iconos por tipo de vehículo**: upload PNG, StaticFiles en /uploads; logo PNG del tipo mostrado en header de detalle y tarjeta flotante de flota
- **White-label**: brand_tokens JSONB por tenant; login devuelve logo_url + brand_name; tokens inyectados como CSS variables en runtime; `refresh()` también aplica brand tokens (fix: logo visible al recargar página)
- **AVL series endpoint**: datos CAN del PLC en serie temporal para gráficos con nombre personalizado
- **KpiChart**: gráficos configurables por tipo de vehículo (line, donut, bar), agrupación multi-serie, transform/offset, filtro por vehículo
- **Métricas históricas por tipo**: hasta 5 métricas configurables en VehicleTypesPage, visibles en reportes PDF
- **Módulos por tenant**: `enabled_modules TEXT[]` en tenant; TopNav filtra secciones según módulos activos
- **Paneles colapsables en VehicleDetailPage**: ESTADO CHASIS, HISTORIAL DE COMANDOS e INCIDENCIAS ocultos por defecto, expandibles con toggle; badge rojo si hay incidencias activas
- **Sentry**: backend (sentry-sdk[fastapi]) + frontend (@sentry/react) con DSN en .env; logging JSON estructurado en backend
- **Bulk status endpoint**: `GET /api/v1/vehicles/statuses?ids=...` — pipeline Redis, hasta 200 IDs, reduce N peticiones a 1
- **SensorGrid live indicators**: tarjetas TimeCard/CounterCard/NumericDisplay con punto verde pulsante y borde de acento cuando hay dato activo
- **FleetDashboard mapa protagonista**: mapa full-viewport, sidebar semi-transparente collapsible (z-index 1000), tarjeta flotante de vehículo seleccionado

### Logo CMG Track
- Archivo: `backend/static/logos/cmgtrack.png` (668×187 px, recortado de 1280×853 con márgenes transparentes)
- Original guardado en: `backend/static/logos/cmgtrack_original.png`
- Topbar height: 62px (tokens.css `--topbar-h`)

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
