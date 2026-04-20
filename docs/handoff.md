# CMG Telematic1 — Handoff Document
> Última actualización: 2026-04-19

## Estado actual

Plataforma SaaS de telemetría industrial en desarrollo activo. **8 sprints completados.** Código en `/opt/cmg-telematic1`, rama `master`, commit `1ffda5a`.

**Tests:** 56 backend + 93 frontend = 149 pasando. Build de producción limpio.

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
| **Rule builder** | ✅ | Lista reglas + formulario crear/editar (Sprint 8, recién terminado) |

---

## Último sprint completado: Sprint 8 — Rule Builder

### Qué se hizo

**Backend (rules-engine):**
- `evaluator.py` + `loader.py` + `main.py`: soporte `vehicle_filter scope:"type"` con `vehicle_type_map` cache
- Bug fix: OR composite siempre evaluaba como AND → corregido con `op_composite`

**Frontend:**
- `frontend/src/features/rules/` — 6 nuevos componentes:
  - `RulesPage.tsx` — tabla con toggle activo/inactivo y delete inline
  - `RuleFormPage.tsx` — formulario crear/editar, orquestador
  - `ConditionBuilder.tsx` — 6 tipos: threshold, threshold_sustained, accumulation, trend_rising, schedule, composite (AND/OR)
  - `VehicleFilterPicker.tsx` — scope all/tipo/vehículo con sensores filtrados dinámicamente
  - `ActionsList.tsx` — in-app, email (multi-recipient), webhook
  - `EscalationBuilder.tsx` — escalones con delay y destinatarios
- `frontend/src/lib/types.ts` — tipos completos: `RuleOut`, `RuleCreate`, `ConditionDef`, `ActionDef`, `EscalationStep`, `VehicleFilter`
- Rutas `/rules`, `/rules/new`, `/rules/:id` activadas en `App.tsx`
- Sidebar `/rules` activado

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
│   ├── rules/                   — rule builder (nuevo)
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

### Sprint 10 — Mantenimiento predictivo *(diferenciador clave de CMG)*
- Endpoints backend para `maintenance_plan` y `maintenance_log`
- UI: umbrales por ciclos hidráulicos reales (no por km)
- Reset de acumuladores tras intervención
- Historial de mantenimientos por vehículo

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

> *"Empieza el Sprint 9 — infraestructura de producción"* (o Sprint 10 / Sprint 11)

---

## Notas técnicas importantes

- **Python binary**: `python3` (no `python`)
- **docker-compose**: versión v1 (`docker-compose`, no `docker compose`)
- **Tests frontend**: Vitest + RTL, correr con `npm test -- --run` desde `frontend/`
- **Tests backend**: pytest desde la raíz `/opt/cmg-telematic1/`
- `trend_rising` en el evaluador está pendiente de implementar (el formulario lo guarda, el engine lo ignora)
- Los sensores boolean (`unit: null`) no aparecen en condiciones numéricas (acumulador, tendencia)
