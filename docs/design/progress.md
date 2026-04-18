# CMG Telematics 2 — Estado del diseño
# Última actualización: 2026-04-18

═══════════════════════════════════════════════════════════════
## CONTEXTO DE LA SESIÓN
═══════════════════════════════════════════════════════════════

Sesión de brainstorming con el usuario Carlos (carlos@cmghidraulica.com).
Diseño de la nueva plataforma desde cero en /opt/cmg-telematic1.
Referencia: /opt/cmg-telematics (plataforma existente, NO modificar).

Propuesta comercial de referencia: Wasterent (Abril 2026).
  → /opt/cmg-telematic1/agents/frontend/temp/CMG_Telematics_Wasterent.pptx

═══════════════════════════════════════════════════════════════
## DECISIONES TOMADAS ✅
═══════════════════════════════════════════════════════════════

### Arquitectura
- **Opción elegida:** Servicios especializados con Redis Streams (Opción B)
- **Escalabilidad:** Diseñado para 100-500+ vehículos desde el inicio
- **Bus de mensajes:** Redis Streams + Consumer Groups (no Kafka)
- **5 servicios:** ingest-svc, rules-engine, notify-svc, core-api, frontend
- **Escalado horizontal:** todos los servicios son stateless, añadir instancias sin cambios

### Sistema de permisos
- **Modelo:** 4 niveles (CMG → cliente → subcliente → dispositivo)
- **Grants explícitos:** tabla permission_grant, sin herencia implícita
- **Regla de hierro:** nunca delegar más de lo que se tiene
- **Sub-clientes ven:** GPS + estado + reportes + datos hidráulicos (si autorizado)

### Modelo de datos
- **TimescaleDB:** hypertable telemetry_record, chunk 1 día, compresión 7 días
- **Continuous aggregates:** telemetry_1h y telemetry_1d para KPIs rápidos
- **can_data JSONB:** flexible, acepta cualquier sensor sin cambiar schema
- **vehicle_type.sensor_schema:** define gauges y umbrales por tipo de vehículo
- **alert_rule JSONB:** reglas como datos, 6 tipos de condición

### Rules Engine
- **Hot-reload:** PostgreSQL NOTIFY/LISTEN, sin restart al añadir reglas
- **Consumer Groups:** múltiples workers evalúan en paralelo sin duplicados
- **6 tipos de condición:** threshold, threshold_sustained, accumulation,
  trend_rising, composite, schedule
- **Cooldown:** configurable por regla (evita spam)
- **Escalado:** Redis Sorted Set como cola de tiempo
- **Nueva regla activa en <1 segundo** tras INSERT en alert_rule

### Notificaciones
- **Canales:** email, push (FCM/APNs), SMS (Twilio), webhook, in_app
- **Escalación:** si no se reconoce en X min → siguiente nivel de contacto

═══════════════════════════════════════════════════════════════
## PENDIENTE DE DISEÑAR ⏳
═══════════════════════════════════════════════════════════════

Al retomar la sesión, continuar por aquí:

---

### SECCIÓN 4 — API REST + WebSocket

Temas a cubrir:
- Estructura de rutas: /api/v1/{recurso}
- Auth: JWT con claims de tenant_id + role
- Multi-tenant scope: cómo se aplica el filtro en cada endpoint
- WebSocket /ws/fleet: stream de telemetría en tiempo real
- Endpoints de reglas: CRUD de alert_rule (el rule builder los llama)
- Endpoints de KPIs: queries sobre continuous aggregates
- Rate limiting y API keys para integraciones ERP de clientes

Preguntas abiertas:
- ¿Quiere API pública documentada (OpenAPI) para que los clientes integren su ERP?
- ¿Necesita versioning de API (/v1, /v2) desde el inicio?

---

### SECCIÓN 5 — Frontend (React + Vite)

Temas a cubrir:
- Estructura de páginas (rutas React Router)
- Dashboard principal: mapa Leaflet + estado de flota
- Página de vehículo: gauges SVG hidráulicos (presión, nivel, temp, PTO)
- Rule builder: formulario visual para crear alert_rule sin código
- Panel de alertas: inbox por severidad, reconocimiento con nota
- Reportes: generación PDF/Excel en backend, descarga desde frontend
- Admin de tenants: CMG gestiona clientes, clientes gestionan sub-clientes
- App móvil: ¿React Native Expo o PWA primero?

Preguntas abiertas:
- ¿Dark mode industrial por defecto o con toggle?
- ¿App móvil en Fase 1 o Fase 2?
- ¿White-label por cliente (logo/colores propios en su portal)?

---

### SECCIÓN 6 — Infraestructura y despliegue

Temas a cubrir:
- docker-compose.yml completo con los 5 servicios
- Variables de entorno por servicio (.env)
- Caddy config: HTTPS, reverse proxy
- Estrategia de migraciones: Alembic + seeds de datos iniciales
- Backup TimescaleDB: pg_dump + política de retención
- Monitoring: healthchecks, logs centralizados

---

### SECCIÓN 7 — Plan de implementación por sprints

Sprint sugeridos (a validar con Carlos):
  Sprint 1 (1-2 días): Scaffolding, docker-compose, BD, auth básico
  Sprint 2 (3-4 días): ingest-svc Codec 8 + TimescaleDB writer
  Sprint 3 (3-4 días): core-api REST multi-tenant + WebSocket
  Sprint 4 (2-3 días): rules-engine + notify-svc básico (email+push)
  Sprint 5 (4-5 días): Frontend dashboard + mapa + gauges hidráulicos
  Sprint 6 (3-4 días): Rule builder UI + panel alertas
  Sprint 7 (2-3 días): Reportes PDF/Excel + KPIs
  Sprint 8 (2-3 días): Admin panel tenants + permisos en cascada UI
  Sprint 9 (2-3 días): App móvil básica (si Fase 1)
  Sprint 10 (2 días): Testing, staging, migración datos desde cmg-telematics

═══════════════════════════════════════════════════════════════
## SCHEMA SQL COMPLETO (copiar en migraciones Alembic)
═══════════════════════════════════════════════════════════════

### tenant
```sql
CREATE TABLE tenant (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id    UUID REFERENCES tenant(id) ON DELETE SET NULL,
    tier         TEXT NOT NULL CHECK (tier IN ('cmg','client','subclient')),
    name         TEXT NOT NULL,
    slug         TEXT UNIQUE NOT NULL,
    active       BOOLEAN DEFAULT true,
    brand_name   TEXT,
    brand_color  CHAR(7),
    logo_url     TEXT,
    custom_domain TEXT UNIQUE,
    created_at   TIMESTAMPTZ DEFAULT now()
);
```

### user
```sql
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
```

### permission_grant
```sql
CREATE TABLE permission_grant (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grantor_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    grantee_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    resource_type   TEXT NOT NULL,
    resource_id     UUID,
    allowed_actions TEXT[] NOT NULL,
    constraints     JSONB,
    granted_by_user UUID REFERENCES "user"(id),
    granted_at      TIMESTAMPTZ DEFAULT now(),
    expires_at      TIMESTAMPTZ,
    active          BOOLEAN DEFAULT true,
    UNIQUE (grantor_id, grantee_id, resource_type, resource_id)
);
```

### vehicle_type
```sql
CREATE TABLE vehicle_type (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    sensor_schema JSONB NOT NULL
);
```

### vehicle
```sql
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
```

### device
```sql
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

### telemetry_record (TimescaleDB)
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
    can_data       JSONB
);
SELECT create_hypertable('telemetry_record', 'time',
    chunk_time_interval => INTERVAL '1 day');
SELECT add_compression_policy('telemetry_record', INTERVAL '7 days');
```

### telemetry_1h (continuous aggregate)
```sql
CREATE MATERIALIZED VIEW telemetry_1h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time)                          AS bucket,
    vehicle_id, tenant_id,
    avg((can_data->>'hydraulic_pressure_1')::float)      AS avg_pressure_1,
    max((can_data->>'hydraulic_pressure_1')::float)      AS max_pressure_1,
    avg((can_data->>'oil_temp_c')::float)                AS avg_oil_temp,
    max((can_data->>'oil_temp_c')::float)                AS max_oil_temp,
    sum(CASE WHEN pto_active THEN 1 ELSE 0 END)          AS pto_active_minutes,
    sum(CASE WHEN ignition   THEN 1 ELSE 0 END)          AS engine_on_minutes,
    count(*)                                             AS record_count
FROM telemetry_record
GROUP BY bucket, vehicle_id, tenant_id;
```

### alert_rule
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
```

### alert_instance
```sql
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

### maintenance_plan
```sql
CREATE TABLE maintenance_plan (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id        UUID NOT NULL REFERENCES vehicle(id),
    tenant_id         UUID NOT NULL,
    name              TEXT NOT NULL,
    trigger_condition JSONB NOT NULL,
    next_due_at       TIMESTAMPTZ,
    warn_before_pct   INTEGER DEFAULT 10,
    active            BOOLEAN DEFAULT true
);
```

### maintenance_log
```sql
CREATE TABLE maintenance_log (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id     UUID NOT NULL,
    plan_id        UUID REFERENCES maintenance_plan(id),
    performed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    performed_by   UUID REFERENCES "user"(id),
    description    TEXT,
    reset_counters TEXT[],
    cost_eur       NUMERIC(10,2),
    photo_urls     TEXT[]
);
```

═══════════════════════════════════════════════════════════════
## CÓMO CONTINUAR ESTA SESIÓN
═══════════════════════════════════════════════════════════════

1. Leer este archivo completo
2. Leer /opt/cmg-telematic1/CLAUDE.md
3. Retomar desde SECCIÓN 4 — API REST + WebSocket
4. Preguntas abiertas a resolver antes de Sección 4:
   - ¿API pública con OpenAPI para que clientes integren ERPs?
   - ¿Dark mode industrial por defecto?
   - ¿App móvil en Fase 1 o Fase 2?
   - ¿White-label (logo/colores) por cliente?
