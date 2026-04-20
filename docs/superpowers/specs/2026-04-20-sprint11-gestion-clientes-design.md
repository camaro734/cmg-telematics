# Sprint 11 — Gestión de Clientes (Multi-Tenant)
> Diseño aprobado: 2026-04-20

## Objetivo

Implementar la gestión completa de clientes multi-tenant: CMG puede crear y gestionar clientes (ej. Wasterent), asignar vehículos directamente a cada cliente, configurar permission grants y aplicar white-label (color + logo). Los admins de cada cliente gestionan sus propios usuarios.

---

## Decisiones de diseño

| Decisión | Elección | Motivo |
|---|---|---|
| Nomenclatura UI | "Cliente" (código: `Tenant`) | Más natural para CMG; "tenant" es técnico |
| Sub-clientes | Fuera de scope (Sprint 12) | YAGNI — ningún cliente real lo necesita ahora |
| Ruta admin | `/clientes` en sidebar | Sección dedicada, solo visible para `tenant_tier=cmg` |
| Gestión usuarios propios | Sección en `/settings` | Separar "mi config" de "gestión de plataforma" |
| Vehículos | `vehicle.tenant_id` = tenant del cliente | CMG ve/edita todos via tier bypass ya implementado |
| White-label campos | `brand_color` + `logo_url` + `brand_name` | Infraestructura ya existe, solo falta la UI |
| Grants tipos | 2 predefinidos: `maintenance/log` y `vehicles/view` | Evitar UI genérica propensa a errores de typo |

---

## Backend

### Endpoints ya existentes (no tocar)

```
GET    /api/v1/tenants                   — lista tenants (CMG ve todos, cliente ve el suyo)
POST   /api/v1/tenants                   — crear tenant [cmg admin]
GET    /api/v1/tenants/{id}/brand-tokens — leer brand tokens
PUT    /api/v1/tenants/{id}/brand-tokens — actualizar brand tokens
GET    /api/v1/grants                    — lista grants del tenant
POST   /api/v1/grants                    — crear grant [admin]
DELETE /api/v1/grants/{id}              — revocar grant
```

### Endpoints nuevos

```
GET    /api/v1/tenants/{id}              — detalle de un tenant [cmg admin]
PUT    /api/v1/tenants/{id}              — editar nombre, slug, active [cmg admin]
GET    /api/v1/tenants/{id}/users        — usuarios del tenant [cmg admin o propio admin]
POST   /api/v1/tenants/{id}/users        — crear usuario en tenant [cmg admin o propio admin]
PUT    /api/v1/users/{id}               — editar usuario (rol, active, full_name)
DELETE /api/v1/users/{id}               — desactivar usuario (soft delete: active=False)
```

### Endpoints modificados

```
POST   /api/v1/vehicles                  — CMG admin puede especificar tenant_id
                                           (actualmente hereda tenant del usuario)

GET    /api/v1/vehicles                  — añadir filtro opcional ?tenant_id=
                                           para que CMG admin filtre por cliente
                                           (ya filtra por vehicle_id — mismo patrón)
```

### Schemas Pydantic nuevos

```python
# backend/app/schemas/tenant.py (nuevos en el existente)

class TenantCreate(BaseModel):
    name: str
    slug: str
    tier: Literal['client'] = 'client'

class TenantUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
    active: bool | None = None

# backend/app/schemas/user.py (nuevo fichero)

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    tenant_id: UUID
    email: str
    full_name: str | None
    role: Literal['admin', 'operator', 'viewer', 'driver']
    active: bool
    created_at: datetime

class UserCreate(BaseModel):
    email: str
    full_name: str | None = None
    role: Literal['admin', 'operator', 'viewer', 'driver'] = 'operator'
    password: str

class UserUpdate(BaseModel):
    full_name: str | None = None
    role: Literal['admin', 'operator', 'viewer', 'driver'] | None = None
    active: bool | None = None
```

### Permisos

| Acción | Quién puede |
|---|---|
| Ver detalle tenant | CMG admin O propio admin del tenant (`user.tenant_id == id`) |
| Crear/editar tenant | `tenant_tier == 'cmg'` AND `role == 'admin'` |
| Listar/crear usuarios de un tenant | CMG admin O admin propio del tenant (`user.tenant_id == tenant_id`) |
| Editar/desactivar usuario | CMG admin O admin propio del tenant |
| Crear vehículo con `tenant_id` ajeno | Solo CMG admin |

---

## Frontend

### Rutas nuevas

```
/clientes              → TenantsPage       (CMG only)
/clientes/new          → TenantFormPage
/clientes/:id          → TenantDetailPage
/clientes/:id/edit     → TenantFormPage (modo edición)
```

### Rutas extendidas

```
/settings              → SettingsPage (añade sección Usuarios para role=admin)
```

### Componentes nuevos

| Fichero | Responsabilidad |
|---|---|
| `features/clientes/TenantsPage.tsx` | Tabla de clientes con badge activo/inactivo y enlace a detalle |
| `features/clientes/TenantFormPage.tsx` | Crear/editar cliente (nombre, slug, activo) |
| `features/clientes/TenantDetailPage.tsx` | Detalle con 5 secciones: info, usuarios, vehículos, grants, white-label |
| `features/clientes/UserFormModal.tsx` | Modal crear/editar usuario (email, nombre, rol, contraseña en creación) |
| `features/clientes/BrandTokensEditor.tsx` | Editor brand_color + logo_url + brand_name con preview live |
| `features/clientes/GrantsSection.tsx` | Lista grants + crear (selector predefinido) + revocar |

### Componentes modificados

| Fichero | Qué cambia |
|---|---|
| `features/settings/SettingsPage.tsx` | Añade sección "Usuarios" visible para `role=admin` |
| `shared/ui/Sidebar.tsx` | Entrada "Clientes" solo para `tenant_tier=cmg` |
| `App.tsx` | Rutas `/clientes` lazy-loaded |
| `lib/types.ts` | `TenantCreate`, `TenantUpdate`, `UserOut`, `UserCreate`, `UserUpdate` |
| `lib/queryKeys.ts` | `clientes()`, `cliente(id)`, `clienteUsers(id)`, `clienteVehicles(id)` |

### TenantDetailPage — secciones

1. **Cabecera**: nombre, slug, badge activo, botón Editar
2. **Usuarios**: tabla (email, nombre, rol, activo) + botón "Añadir usuario" → `UserFormModal`
3. **Vehículos**: tabla read-only (nombre, matrícula) + enlace "Ver en Flota"
4. **Permission grants**: tabla (tipo, acciones) + "Añadir grant" + "Revocar"
5. **White-label**: `BrandTokensEditor` con preview de barra lateral

### BrandTokensEditor — comportamiento

- `<input type="color">` para `brand_color` — preview actualiza CSS variable `--accent-energy` en tiempo real sobre un mini mockup
- Input URL para `logo_url` + `<img>` preview
- Input texto para `brand_name`
- Botón "Guardar" llama a `PUT /api/v1/tenants/:id/brand-tokens`

### GrantsSection — tipos predefinidos

```typescript
const GRANT_TYPES = [
  {
    resource_type: 'maintenance',
    label: 'Registrar intervenciones de mantenimiento',
    allowed_actions: ['log'],
  },
  {
    resource_type: 'vehicles',
    label: 'Ver datos CAN (campos visibles)',
    allowed_actions: ['view'],
  },
]
```

---

## Testing

### Backend (pytest)

| Test | Qué verifica |
|---|---|
| `test_create_tenant_cmg_admin` | CMG admin puede crear; operator recibe 403 |
| `test_list_tenants_scoped` | CMG ve todos; cliente solo ve el suyo |
| `test_get_tenant_detail` | CMG puede ver detalle; cliente ajeno recibe 404 |
| `test_update_tenant` | CMG puede editar; cliente no puede |
| `test_create_user_in_tenant_cmg` | CMG admin crea usuario en cualquier tenant |
| `test_create_user_in_tenant_own_admin` | Admin propio crea usuario en su tenant |
| `test_create_user_in_tenant_foreign_admin` | Admin ajeno recibe 403 |
| `test_update_user_role` | Solo admin puede cambiar rol |
| `test_deactivate_user` | Soft delete: `user.active = False` |
| `test_vehicle_tenant_assignment` | CMG crea vehículo en tenant ajeno; cliente no puede |

### Frontend (Vitest + RTL)

| Test | Qué verifica |
|---|---|
| `TenantsPage.test.tsx` | Lista renderiza clientes; entrada sidebar solo CMG |
| `TenantFormPage.test.tsx` | Submit llama a POST/PUT con payload correcto |
| `TenantDetailPage.test.tsx` | Renderiza las 5 secciones con datos mockeados |
| `UserFormModal.test.tsx` | Crea usuario con rol y contraseña; PUT no envía contraseña |
| `BrandTokensEditor.test.tsx` | Cambiar color actualiza preview; submit llama a PUT |
| `GrantsSection.test.tsx` | Añadir grant llama a POST; revocar llama a DELETE |

---

## Fuera de scope (Sprint 12)

- Sub-clientes (`tier=subclient`) y su gestión
- Asignación de vehículos específicos a sub-clientes via `permission_grant`
- White-label: CSS variables adicionales más allá de color + logo + nombre
- Invitación de usuarios por email (ahora se crea con contraseña directa)
- `constraints.visible_fields` UI para el grant de tipo `vehicles/view`
