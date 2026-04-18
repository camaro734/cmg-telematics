# CMG Telematics 2 — Spec de diseño completo
# Fecha: 2026-04-18
# Estado: APROBADO por Carlos (carlos@cmghidraulica.com)

---

## 1. CONTEXTO Y OBJETIVO

Reescritura completa de la plataforma de telemetría industrial CMG desde cero
en `/opt/cmg-telematic1`. El proyecto anterior (`/opt/cmg-telematics`) se mantiene
en producción y se consulta solo como referencia de protocolo y hardware.

**Producto:** SaaS de telemetría para flotas industriales especializadas.
**Clientes iniciales:** Wasterent, PREZERO.
**Escala objetivo:** 100–500+ vehículos.
**Diferenciador único:** datos CAN bus profundos (presiones hidráulicas, válvulas,
ciclos PTO) + sistema de alertas 100% configurable post-desarrollo sin código.

---

## 2. HARDWARE

- **GPS/4G:** Teltonika FMC650, protocolo Codec 8 TCP.
- **PLC:** IFM CR2530 (CANopen 250 kbps / J1939) — gama IFM según proyecto.
- **Sensores propios:** CMG instala cuando el fabricante no proporciona CAN.
- **Arquitectura híbrida:** datos CAN existentes + sensores adicionales propios.
- **IMEI:** identificador único e inmutable del dispositivo.

---

## 3. STACK TECNOLÓGICO

| Capa | Tecnología |
|------|-----------|
| Backend | Python 3.12, FastAPI, asyncio, SQLAlchemy 2 async, Alembic |
| Base de datos | PostgreSQL 16 + TimescaleDB (series temporales) |
| Cache / bus | Redis 7 (Streams, Hash, Sorted Set) |
| Frontend | React 18, Vite, React Query, Zustand, Leaflet, Recharts |
| Gauges | SVG puro (sin librerías externas) |
| Proxy | Caddy 2 (HTTPS automático) |
| Contenedores | Docker + Docker Compose |
| Mobile (Fase 2) | React Native + Expo |

---

## 4. ARQUITECTURA DE SERVICIOS

### 4.1 Mapa de servicios

```
[FMC650 x500] ──TCP:5027──▶ ingest-svc (asyncio)
                                  │ escribe TimescaleDB
                                  │ publica Stream: telemetry.raw
                                  ▼
                           rules-engine (N workers)
                           Consumer Group: rules-workers
                                  │ evalúa reglas JSONB
                                  │ publica Stream: alerts.fire
                                  ▼
                            notify-svc
                            email / push / SMS / webhook / in_app
                                  │
                            core-api (FastAPI)
                            REST /api/v1 + WebSocket /ws
                                  │
                            frontend (React + Vite, PWA)
                                  │
                            Caddy (HTTPS, reverse proxy)
```

### 4.2 Escalado horizontal

| Servicio | Cómo escala | Límite práctico |
|----------|------------|-----------------|
| ingest-svc | N instancias + HAProxy TCP | ~2000 conn/instancia |
| rules-engine | N workers en Consumer Group | sin límite teórico |
| notify-svc | N instancias (idempotente por msg ID) | sin límite |
| core-api | N instancias stateless detrás Caddy | sin límite |
| TimescaleDB | chunk 1d + compresión 7d + aggregates | millones de filas |
| Redis | Sentinel 3 nodos para HA | 200k msg/s |

Con 500 vehículos a 30s por envío = ~17 msg/s. Redis aguanta 200k msg/s.
Margen de 10.000x antes de necesitar cambio de arquitectura.

---

## 5. MODELO DE DATOS

### 5.1 Tenants y permisos

```sql
CREATE TABLE tenant (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id     UUID REFERENCES tenant(id) ON DELETE SET NULL,
    tier          TEXT NOT NULL CHECK (tier IN ('cmg','client','subclient')),
    name          TEXT NOT NULL,
    slug          TEXT UNIQUE NOT NULL,
    active        BOOLEAN DEFAULT true,
    brand_name    TEXT,
    brand_color   CHAR(7),
    logo_url      TEXT,
    custom_domain TEXT UNIQUE,
    brand_tokens  JSONB,   -- CSS variables sobreescritas para white-label
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE "user" (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    email           TEXT UNIQUE NOT NULL,
    hashed_password TEXT NOT NULL,
    full_name       TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('admin','operator','viewer','driver')),
    active          BOOLEAN DEFAULT true,
    notify_email    BOOLEAN DEFAULT true,
    notify_push     BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Permisos explícitos en cascada. Sin herencia implícita.
CREATE TABLE permission_grant (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grantor_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    grantee_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    resource_type   TEXT NOT NULL,
    -- 'vehicle' | 'device_live' | 'telemetry_history'
    -- 'hydraulic_raw' | 'alerts' | 'reports' | 'maintenance'
    resource_id     UUID,   -- NULL = todos los del grantor
    allowed_actions TEXT[] NOT NULL,
    -- ['view'] | ['view','export'] | ['view','ack_alerts']
    constraints     JSONB,
    -- {"visible_fields": [...], "max_history_days": 30}
    granted_by_user UUID REFERENCES "user"(id),
    granted_at      TIMESTAMPTZ DEFAULT now(),
    expires_at      TIMESTAMPTZ,
    active          BOOLEAN DEFAULT true,
    UNIQUE (grantor_id, grantee_id, resource_type, resource_id)
);
```

**Regla de hierro (aplicada en código, no solo en BD):**
Un tenant nunca puede crear un grant con acciones que él mismo no posee.
CMG puede revocar cualquier grant en cualquier nivel en tiempo real.

### 5.2 Vehículos y dispositivos

```sql
-- Tipos configurables sin código. sensor_schema define los gauges.
CREATE TABLE vehicle_type (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          TEXT UNIQUE NOT NULL,  -- 'vacuum', 'sweeper', 'cistern'
    name          TEXT NOT NULL,
    sensor_schema JSONB NOT NULL
    -- [{
    --   "key": "hydraulic_pressure_1",
    --   "label": "Presión bomba principal",
    --   "unit": "bar", "min": 0, "max": 300,
    --   "gauge_type": "circular",
    --   "warn_above": 220, "alert_above": 250,
    --   "avl_id": 305
    -- }]
);

CREATE TABLE vehicle (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    vehicle_type_id UUID NOT NULL REFERENCES vehicle_type(id),
    name            TEXT NOT NULL,
    license_plate   TEXT,
    vin             TEXT UNIQUE,
    year            SMALLINT,
    notes           TEXT,
    active          BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE device (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id   UUID REFERENCES vehicle(id) ON DELETE SET NULL,
    imei         TEXT UNIQUE NOT NULL,
    model        TEXT DEFAULT 'FMC650',
    firmware_ver TEXT,
    online       BOOLEAN DEFAULT false,
    last_seen    TIMESTAMPTZ,
    active       BOOLEAN DEFAULT true,
    created_at   TIMESTAMPTZ DEFAULT now()
);
```

### 5.3 Series temporales (TimescaleDB)

```sql
CREATE TABLE telemetry_record (
    time           TIMESTAMPTZ NOT NULL,
    device_id      UUID NOT NULL,
    vehicle_id     UUID NOT NULL,
    tenant_id      UUID NOT NULL,
    lat            DOUBLE PRECISION,
    lon            DOUBLE PRECISION,
    speed_kmh      REAL,
    heading        SMALLINT,
    altitude_m     REAL,
    ignition       BOOLEAN,
    pto_active     BOOLEAN,
    ext_voltage_mv INTEGER,
    can_data       JSONB   -- acepta cualquier sensor sin cambiar schema
);

SELECT create_hypertable('telemetry_record', 'time',
    chunk_time_interval => INTERVAL '1 day');
SELECT add_compression_policy('telemetry_record', INTERVAL '7 days');

-- KPIs precomputados — queries del dashboard son instantáneas
CREATE MATERIALIZED VIEW telemetry_1h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time)                         AS bucket,
    vehicle_id, tenant_id,
    avg((can_data->>'hydraulic_pressure_1')::float)     AS avg_pressure_1,
    max((can_data->>'hydraulic_pressure_1')::float)     AS max_pressure_1,
    avg((can_data->>'oil_temp_c')::float)               AS avg_oil_temp,
    max((can_data->>'oil_temp_c')::float)               AS max_oil_temp,
    sum(CASE WHEN pto_active THEN 1 ELSE 0 END)         AS pto_active_minutes,
    sum(CASE WHEN ignition   THEN 1 ELSE 0 END)         AS engine_on_minutes,
    count(*)                                            AS record_count
FROM telemetry_record
GROUP BY bucket, vehicle_id, tenant_id;

CREATE MATERIALIZED VIEW telemetry_1d
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 day', bucket) AS day,
       vehicle_id, tenant_id,
       avg(avg_pressure_1)     AS avg_pressure_1,
       max(max_pressure_1)     AS max_pressure_1,
       sum(pto_active_minutes) AS pto_hours_x60,
       sum(engine_on_minutes)  AS engine_hours_x60
FROM telemetry_1h
GROUP BY day, vehicle_id, tenant_id;
```

### 5.4 Rules Engine

```sql
CREATE TABLE alert_rule (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    description        TEXT,
    active             BOOLEAN DEFAULT true,
    vehicle_filter     JSONB NOT NULL DEFAULT '{"scope":"all"}',
    condition          JSONB NOT NULL,
    severity           TEXT NOT NULL DEFAULT 'warning'
                       CHECK (severity IN ('info','warning','critical')),
    actions            JSONB NOT NULL DEFAULT '[]',
    escalation         JSONB DEFAULT '[]',
    schedule           JSONB DEFAULT '{"type":"always"}',
    cooldown_minutes   INTEGER DEFAULT 30,
    created_at         TIMESTAMPTZ DEFAULT now(),
    created_by_user_id UUID REFERENCES "user"(id)
);

-- Trigger para hot-reload automático en rules-engine
CREATE OR REPLACE FUNCTION notify_rule_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('rules_changed', row_to_json(NEW)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER alert_rule_changed
  AFTER INSERT OR UPDATE OR DELETE ON alert_rule
  FOR EACH ROW EXECUTE FUNCTION notify_rule_change();

CREATE TABLE alert_instance (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id        UUID NOT NULL REFERENCES alert_rule(id),
    vehicle_id     UUID NOT NULL REFERENCES vehicle(id),
    tenant_id      UUID NOT NULL,
    triggered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at    TIMESTAMPTZ,
    status         TEXT NOT NULL DEFAULT 'firing'
                   CHECK (status IN ('firing','acknowledged','resolved','escalated')),
    trigger_value  JSONB,
    ack_by_user_id UUID REFERENCES "user"(id),
    ack_at         TIMESTAMPTZ,
    ack_note       TEXT
);
```

**6 tipos de condición soportados:**

| Tipo | Descripción | Estado en Redis |
|------|-------------|-----------------|
| `threshold` | Valor instantáneo op threshold | ninguno |
| `threshold_sustained` | Condición sostenida X minutos | `first_triggered_at` |
| `accumulation` | Acumulador >= límite (horas PTO, ciclos) | contador float |
| `trend_rising` | Pendiente > threshold en ventana temporal | ninguno (query 1h) |
| `composite` | AND/OR de otras condiciones | delegado a sub-condiciones |
| `schedule` | Estado inesperado fuera de horario laboral | ninguno |

### 5.5 Mantenimiento

```sql
CREATE TABLE maintenance_plan (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id        UUID NOT NULL REFERENCES vehicle(id),
    tenant_id         UUID NOT NULL,
    name              TEXT NOT NULL,
    trigger_condition JSONB NOT NULL,  -- mismo formato que alert_rule.condition
    next_due_at       TIMESTAMPTZ,
    warn_before_pct   INTEGER DEFAULT 10,
    active            BOOLEAN DEFAULT true
);

CREATE TABLE maintenance_log (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id     UUID NOT NULL,
    plan_id        UUID REFERENCES maintenance_plan(id),
    performed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    performed_by   UUID REFERENCES "user"(id),
    description    TEXT,
    reset_counters TEXT[],   -- acumuladores en Redis a resetear
    cost_eur       NUMERIC(10,2),
    photo_urls     TEXT[]
);
```

---

## 6. RULES ENGINE

### 6.1 Principios
- Reglas cargadas de PostgreSQL al arrancar. Hot-reload vía `LISTEN rules_changed`.
- Redis Streams Consumer Group: N workers procesan en paralelo, sin duplicados.
- Nueva regla activa en menos de 1 segundo tras INSERT. Sin deploy.
- Cooldown configurable: evita spam de alertas repetidas.
- Escalación: Redis Sorted Set como cola de tiempo, worker cada 30s.

### 6.2 Flujo por mensaje
```
Redis XREADGROUP "telemetry.raw"
  → filtrar reglas aplicables al vehicle_id / tenant_id
  → para cada regla: verificar schedule
  → evaluar condición según tipo
  → si dispara y no en cooldown:
      crear alert_instance en DB
      publicar a "alerts.fire"
      activar cooldown en Redis (setex)
  → XACK del mensaje
```

### 6.3 Estado en Redis
```
rule:state:{rule_id}:{vehicle_id}  HASH  → {first_triggered_at}
rule:accum:{rule_id}:{vehicle_id}  FLOAT → acumulador running
rule:cooldown:{rule_id}:{vehicle_id} STR → TTL = cooldown_minutes * 60
escalation                         ZSET  → score=unix_ts_fire, val=JSON
```

---

## 7. API REST

### 7.1 Principios
- Prefijo: `/api/v1/`
- Auth: JWT Bearer (dashboard) + API Key header (integraciones ERP)
- Tenant scope automático en cada query según claims del token
- OpenAPI/Swagger en `/docs`, ReDoc en `/redoc`
- Rate limiting: 1000 req/min JWT, 200 req/min API Key

### 7.2 Rutas principales
```
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh

GET    /api/v1/tenants
POST   /api/v1/tenants
GET    /api/v1/tenants/{id}/brand-tokens
PUT    /api/v1/tenants/{id}/brand-tokens

GET    /api/v1/grants
POST   /api/v1/grants
DELETE /api/v1/grants/{id}

GET    /api/v1/vehicles
GET    /api/v1/vehicles/{id}/status
GET    /api/v1/vehicles/{id}/telemetry/latest
GET    /api/v1/vehicles/{id}/telemetry/history
GET    /api/v1/vehicles/{id}/track/today
GET    /api/v1/vehicles/{id}/kpis

GET    /api/v1/alerts
POST   /api/v1/alerts/{id}/acknowledge

GET    /api/v1/rules
POST   /api/v1/rules
PUT    /api/v1/rules/{id}
DELETE /api/v1/rules/{id}
POST   /api/v1/rules/{id}/test

GET    /api/v1/maintenance/plans
POST   /api/v1/maintenance/logs

POST   /api/v1/reports/generate
GET    /api/v1/reports/{job_id}/download

GET    /api/v1/vehicle-types
POST   /api/v1/vehicle-types

GET    /api/v1/api-keys
POST   /api/v1/api-keys
```

### 7.3 WebSocket
```
WS /ws/fleet?token={jwt}
Mensajes: telemetry | alert | vehicle_status
Fuente: core-api subscribe a Redis "telemetry.raw" (read-only, no consume group)
        → rebroadcast a conexiones WS del tenant correspondiente
```

---

## 8. FRONTEND

### 8.1 Design system — tokens base

```css
--bg-base:       #1C1917;   /* warm dark */
--bg-surface:    #292524;
--bg-elevated:   #3C3330;
--bg-border:     #57534E;
--accent-energy: #F97316;   /* naranja — hidráulica */
--accent-ok:     #22C55E;   /* verde — eficiencia */
--accent-warn:   #EAB308;
--accent-crit:   #EF4444;
--accent-info:   #38BDF8;
--accent-off:    #78716C;
--font-data:     'JetBrains Mono', monospace;
--font-ui:       'Inter', sans-serif;
```

White-label: `GET /api/v1/tenants/{id}/brand-tokens` devuelve overrides de tokens.
Se aplican como CSS variables en `document.documentElement` al login. Sin recompilación.

### 8.2 Páginas
```
/dashboard              → mapa flota + resumen estado
/vehicles               → lista con filtros
/vehicles/:id           → gauges hidráulicos + telemetría live
/vehicles/:id/history   → histórico + SensorChart
/alerts                 → inbox por severidad + reconocimiento
/rules                  → lista + rule builder visual
/reports                → generar PDF/Excel
/kpis                   → comparativa flota
/admin/*                → tenants, devices, vehicle-types, api-keys
/settings/branding      → white-label UI
```

### 8.3 Componentes clave
- `CircularGauge.tsx` — SVG puro, inspirado en manómetros reales
- `FleetMap.tsx` — Leaflet + marcadores SVG custom por estado
- `RuleBuilder.tsx` — formulario visual → condition JSONB
- `AlertInbox.tsx` — ordenado por severidad, ack con nota
- `SensorChart.tsx` — Recharts, rangos 1h/6h/24h/7d
- `useTenantTheme.ts` — carga y aplica brand_tokens en runtime

### 8.4 PWA (Fase 1)
- `manifest.json` + service worker
- Offline: último estado de flota cacheado
- Funciona en móvil desde navegador sin instalar app nativa
- App nativa React Native + Expo en Fase 2

---

## 9. INFRAESTRUCTURA

### 9.1 Servicios Docker
- `postgres` (TimescaleDB) — solo localhost:5432
- `redis` — solo localhost:6379
- `ingest-svc` — expuesto :5027 (TCP devices)
- `rules-engine` — interno, 2+ réplicas
- `notify-svc` — interno
- `core-api` — interno, Caddy hace proxy
- `caddy` — puertos 80/443

### 9.2 Backup
- pg_dump diario a las 03:00 → comprimido → retención 30 días
- Sync opcional a S3/B2

### 9.3 Primer despliegue
```bash
docker compose up -d postgres redis
docker compose run --rm core-api alembic upgrade head
docker compose run --rm core-api python -m app.seeds.initial
docker compose up -d
```

---

## 10. PLAN DE IMPLEMENTACIÓN

| Sprint | Contenido | Días |
|--------|-----------|------|
| 1 | Scaffolding, docker-compose, schema, auth | 2 |
| 2 | ingest-svc Codec 8 + TimescaleDB writer | 3 |
| 3 | core-api REST multi-tenant + WebSocket | 4 |
| 4 | rules-engine + notify-svc | 4 |
| 5 | Frontend: layout + mapa + lista vehículos | 4 |
| 6 | Frontend: gauges SVG + detalle vehículo + WS live | 3 |
| 7 | Frontend: alertas + rule builder | 4 |
| 8 | Reportes PDF/Excel + KPIs dashboard | 3 |
| 9 | Admin tenants + white-label UI + API Keys | 2 |
| 10 | PWA + migración datos + tests e2e + staging | 3 |
| **Total** | | **~32 días** |

---

## 11. DECISIONES DE DISEÑO CLAVE

1. **Redis Streams en lugar de Kafka**: suficiente para 500+ vehículos (17 msg/s vs 200k cap), sin overhead operativo de Kafka.
2. **can_data JSONB**: schema flexible, acepta nuevos sensores sin migración.
3. **sensor_schema en vehicle_type**: los gauges del frontend se generan desde aquí, sin código nuevo para añadir tipos de vehículo.
4. **Rules como datos**: toda la lógica de alertas en PostgreSQL JSONB. Sin deploy para nuevas reglas.
5. **Hot-reload vía NOTIFY**: el evaluador actualiza reglas en <1s sin restart.
6. **White-label en runtime**: tokens CSS aplicados en el cliente. Sin compilar frontend por cliente.
7. **Permisos explícitos**: tabla permission_grant sin herencia implícita. Más verbose pero auditable y reversible.
8. **Continuous aggregates**: KPIs precomputados en TimescaleDB. El dashboard no hace queries pesadas en tiempo real.
