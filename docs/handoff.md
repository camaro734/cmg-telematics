# CMG Telematic1 — Handoff Document
> Última actualización: 2026-04-20

## Estado actual

Plataforma SaaS de telemetría industrial en desarrollo activo. **12 sprints completados.** Código en `/opt/cmg-telematic1`, rama `master`. **En producción en https://cmgtrack.com**

**Tests:** 82 backend + 122 frontend = 204 pasando. Build de producción limpio.

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
| Settings page | ✅ | Email de notificación por tenant + gestión de usuarios propios |
| Rule builder | ✅ | Lista reglas + formulario crear/editar (Sprint 8) |
| Mantenimiento predictivo | ✅ | Planes por horas PTO/motor/días, historial intervenciones, badge vehículo (Sprint 10) |
| **Gestión clientes (multi-tenant)** | ✅ | CRUD tenants, usuarios, vehículos por cliente, grants, white-label (Sprint 11) |
| **Infraestructura producción** | ✅ | Docker Compose, Caddy HTTPS, dominio cmgtrack.com (Sprint 9) |

---

## Último sprint completado: Sprint 11 — Gestión de Clientes Multi-Tenant

### Qué se hizo

**Backend:**
- `backend/app/schemas/user.py` — schemas `UserOut`, `UserCreate`, `UserUpdate` (con `EmailStr`, `Field(min_length=8)`)
- `backend/app/schemas/tenant.py` — añadidos `TenantUpdate`, `TenantCreate.tier` restringido a `'client'`
- `backend/app/schemas/vehicle.py` — añadido `VehicleCreate` con `tenant_id` opcional
- `backend/app/api/v1/tenants.py` — `GET/PUT /tenants/{id}`, `GET/POST /tenants/{id}/users` con permisos CMG-o-admin-propio
- `backend/app/api/v1/users.py` — nuevo: `PUT /users/{id}`, `DELETE /users/{id}` (soft delete)
- `backend/app/api/v1/vehicles.py` — `GET /vehicles?tenant_id=`, `POST /vehicles` con `tenant_id` para CMG
- `backend/app/api/v1/router.py` — registrado `users_router`
- `backend/pyproject.toml` — añadido `psycopg2-binary` para migraciones Alembic
- Tests: `test_tenant_detail_api.py`, `test_users_api.py`, `test_vehicle_tenant_api.py`

**Frontend:**
- `features/clientes/` — 6 componentes: `TenantsPage`, `TenantFormPage`, `TenantDetailPage`, `UserFormModal`, `GrantsSection`, `BrandTokensEditor`
- `features/settings/UsersSection.tsx` — gestión de usuarios propios para admins de cliente
- `shared/ui/Sidebar.tsx` — entrada "Clientes" solo para `tenant_tier=cmg`
- `lib/types.ts` — `TenantCreate`, `TenantUpdate`, `UserOut`, `UserCreate`, `UserUpdate`, `GrantOut`, `GrantCreate`, `VehicleCreate`
- `lib/queryKeys.ts` — `cliente()`, `clienteUsers()`, `clienteVehicles()`, `clienteGrants()`
- Tests: 6 ficheros en `features/clientes/__tests__/`

---

## Producción (Sprint 9)

- **URL:** https://cmgtrack.com
- **Servidor:** VPS 213.210.20.183
- **Stack:** docker-compose en `/opt/cmg-telematic1`
- **Credenciales iniciales:** `admin@cmg.es` / `Admin2026!`
- **Arrancar/actualizar:** `docker-compose down && docker-compose up -d --build` (no usar `up -d` directo — bug docker-compose v1 con ContainerConfig)
- **Migraciones:** `docker-compose exec -T core-api alembic upgrade head`
- **Seed:** `docker-compose exec -T core-api python3 -m app.seeds.initial`
- **cmgnexus.es** también gestionado por el mismo Caddy (proxy a `10.0.0.2:8000`)

---

## Cómo arrancar el entorno de desarrollo

```bash
# Solo para desarrollo backend
cd /opt/cmg-telematic1/backend && uvicorn app.main:app --reload --port 8010

# Solo para desarrollo frontend
cd /opt/cmg-telematic1/frontend && npm run dev
```

**Credenciales de desarrollo:** `admin@cmg.es` / `Admin2026!`
**URL local:** `http://localhost:5173` (frontend), `http://localhost:8010` (API)

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
│   ├── maintenance/             — mantenimiento predictivo
│   ├── clientes/                — gestión multi-tenant (nuevo)
│   └── settings/                — configuración tenant + usuarios
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

### Sprint 12 — White-label runtime
- Aplicar `brand_tokens` del tenant como CSS variables en el frontend en tiempo real
- El backend ya sirve los tokens; falta inyectarlos en `index.html` o vía endpoint al arrancar
- Preview de colores ya funciona en `BrandTokensEditor`; falta que apliquen globalmente

### Sprint 13 — Reportes y exportación
- Exportar historial de alertas, telemetría, intervenciones a PDF/Excel
- Informe mensual por cliente (KPIs: horas operación, alertas, mantenimientos)

### Sprint 14 — Sub-clientes
- `tier=subclient`: clientes del cliente (ej. Ayuntamiento contratado por Wasterent)
- UI de gestión en `/clientes/:id` (pestaña "Sub-clientes")
- Herencia de `permission_grant` en cascada

### Sprint 15 — App móvil
- React Native + Expo
- Mismos endpoints que el frontend web
- Notificaciones push para alertas

---

## Notas técnicas importantes

- **Python binary**: `python3` (no `python`)
- **docker-compose**: versión v1 — usar `down` + `up -d` por separado (bug ContainerConfig al recrear)
- **Tests frontend**: Vitest + RTL, correr con `npx vitest run` desde `frontend/`
- **Tests backend**: pytest desde la raíz `/opt/cmg-telematic1/`
- `trend_rising` en el evaluador está pendiente de implementar (el formulario lo guarda, el engine lo ignora)
- Los sensores boolean (`unit: null`) no aparecen en condiciones numéricas (acumulador, tendencia)
- **`.env` nunca commitear** — contiene credenciales de producción
