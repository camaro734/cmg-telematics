# CMG Telematic1 — Handoff Document
> Última actualización: 2026-04-20

## Estado actual

Plataforma SaaS de telemetría industrial en desarrollo activo. **10 sprints completados.** Código en `/opt/cmg-telematic1`, rama `master`, commit `549ede9`.

**Tests:** 64 backend + 107 frontend = 171 pasando. Build de producción limpio.

---

## Lo que está construido

| Módulo | Estado | Descripción |
|--------|--------|-------------|
| Ingest service | ✅ | TCP Teltonika FMC650, Codec 8, escribe TimescaleDB |
| Core API | ✅ | FastAPI REST + WebSocket, auth JWT multi-tenant |
| Rules engine | ✅ | Evaluador JSONB, hot-reload, scope all/vehicle/type |
| Notify service | ✅ | Email SMTP, in-app, webhook, escalación con timers |
| Fleet page | ✅ | Mapa Leaflet, lista vehículos, estado online/offline |
| Vehicle detail | ✅ | Gauges SVG (presión, temperatura, batería), KPI charts, track GPS |
| Alerts page | ✅ | Alertas activas con ack, historial con filtros fecha/vehículo |
| Settings page | ✅ | Email de notificación por tenant, solo admin |
| **Rule builder** | ✅ | Lista reglas + formulario crear/editar (Sprint 8) |
| **Mantenimiento predictivo** | ✅ | Planes por horas PTO/motor/días, historial intervenciones, badge vehículo (Sprint 10) |

---

## Último sprint completado: Sprint 10 — Mantenimiento Predictivo

### Qué se hizo

**Backend:**
- `backend/app/models/maintenance.py` — modelos `MaintenancePlan` + `MaintenanceLog` con `created_at`
- `backend/alembic/versions/003_004` — migraciones: `created_at`, FK `tenant_id` CASCADE, FK `plan_id` SET NULL
- `backend/app/schemas/maintenance.py` — schemas Pydantic completos con `MaintenancePlanOut`, `MaintenanceProgress`, `ThresholdProgress`
- `backend/app/api/v1/maintenance.py` — 7 endpoints CRUD + progreso calculado dinámicamente desde `telemetry_1h`
  - Progreso por `pto_hours`, `engine_hours`, `calendar_days`
  - Baseline: último `MaintenanceLog` con `reset_counters @> [tipo]`, fallback a `plan.created_at`
  - Batch query de baselines en `list_plans` (evita N+1)
  - Permisos: admin o `permission_grant(resource_type='maintenance', 'log')`
- `backend/app/api/v1/vehicles.py` — endpoint `/vehicles/:id/maintenance` añadido

**Frontend:**
- `frontend/src/features/maintenance/` — 6 componentes nuevos:
  - `ProgressBar.tsx` — barra verde/naranja/rojo según estado
  - `MaintenancePage.tsx` — tabla global ordenada por urgencia (vencido > próximo > ok)
  - `ThresholdBuilder.tsx` — añadir/quitar umbrales (tipo + valor)
  - `MaintenancePlanFormPage.tsx` — crear/editar plan con ThresholdBuilder
  - `MaintenancePlanDetailPage.tsx` — detalle + tarjetas de progreso + historial intervenciones
  - `LogInterventionModal.tsx` — modal registro intervención con checkboxes reset contadores
- `frontend/src/lib/types.ts` — tipos nuevos: `MaintenancePlanOut`, `MaintenancePlanUpdate`, `MaintenanceProgress`, etc.
- `VehicleDetailPage.tsx` — badge de mantenimiento pendiente/vencido
- Sidebar + App.tsx — entrada `/maintenance` wired

---

## Cómo arrancar el entorno

```bash
cd /opt/cmg-telematic1

# Stack completo (PostgreSQL + Redis + todos los servicios)
docker-compose up -d

# Solo para desarrollo backend
cd backend && uvicorn app.main:app --reload --port 8010

# Solo para desarrollo frontend
cd frontend && npm run dev
```

**Credenciales de desarrollo:**
- Admin CMG: `admin@cmg.es` / `CMGadmin2024!` (ver `backend/scripts/seed.py`)
- URL local: `http://localhost:5173` (frontend), `http://localhost:8010` (API)

---

## Estructura de directorios clave

```
/opt/cmg-telematic1/
├── backend/app/api/v1/          — endpoints REST
├── frontend/src/features/       — páginas y componentes React
│   ├── fleet/                   — mapa y lista de vehículos
│   ├── vehicle/                 — detalle con gauges
│   ├── alerts/                  — alertas e historial
│   ├── rules/                   — rule builder
│   ├── maintenance/             — mantenimiento predictivo (nuevo)
│   └── settings/                — configuración tenant
├── services/rules-engine/src/   — evaluador de reglas
├── services/notify/src/         — despachador de notificaciones
├── services/ingest/src/         — receptor Teltonika TCP
├── docs/superpowers/
│   ├── specs/                   — diseños aprobados por sprint
│   └── plans/                   — planes de implementación por sprint
└── tests/                       — tests backend (pytest)
```

---

## Próximos sprints sugeridos (por prioridad)

### Sprint 9 — Infraestructura de producción *(si quieres desplegar)*
- `docker-compose.yml` completo y validado para producción
- Caddy como reverse proxy con HTTPS automático
- Variables de entorno documentadas (`.env.example`)
- Script de despliegue inicial (seed + migraciones)

### Sprint 10 — Mantenimiento predictivo ✅ *completado*

### Sprint 11 — Gestión multi-tenant *(para incorporar clientes reales)*
- Página admin CMG para crear/gestionar tenants (Wasterent, PREZERO, etc.)
- Asignación de vehículos a clientes
- `permission_grant` UI — qué campos CAN puede ver cada cliente
- White-label: aplicar `brand_tokens` del tenant en runtime

---

## Cómo retomar con Claude Code

Al abrir una nueva sesión, Claude tendrá acceso al historial del proyecto. Para ponerse al día rápido, di:

> *"Continúa el proyecto CMG Telematic1. Lee el handoff en `docs/handoff.md` y el estado actual del código."*

Si quieres empezar el siguiente sprint:

> *"Empieza el Sprint 9 — infraestructura de producción"* (o Sprint 11)

---

## Notas técnicas importantes

- **Python binary**: `python3` (no `python`)
- **docker-compose**: versión v1 (`docker-compose`, no `docker compose`)
- **Tests frontend**: Vitest + RTL, correr con `npm test -- --run` desde `frontend/`
- **Tests backend**: pytest desde la raíz `/opt/cmg-telematic1/`
- `trend_rising` en el evaluador está pendiente de implementar (el formulario lo guarda, el engine lo ignora)
- Los sensores boolean (`unit: null`) no aparecen en condiciones numéricas (acumulador, tendencia)
