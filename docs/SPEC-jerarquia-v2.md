# Especificación: Jerarquía CMG Track v2

**Estado:** Aprobada por Carlos
**Fecha:** 2026-05-19
**Reemplaza:** Secciones 5 y 7 del CLAUDE.md (jerarquía cmg/client/subclient)
**Audiencia:** Claude Code en `/opt/cmg-telematic1`

═══════════════════════════════════════════════════════════════
## 0. RESUMEN EJECUTIVO
═══════════════════════════════════════════════════════════════

Pasamos de 3 niveles (`cmg | client | subclient`) a **4 niveles + 1 sin tenant**:

```
CMG (super-admin)
 └── Fabricante                      tier=manufacturer  (NUEVO)
      └── Cliente operador           tier=client
           ├── Conductor              role=driver dentro del cliente
           └── Cliente final          solo portal token (sin tenant)
```

Cambios principales:
- Nuevo tier `manufacturer` entre CMG y Cliente
- Modelo de revenue: licencia base + por dispositivo activo
- Branding por herencia: Cliente → Fabricante → CMG (sin subdominios)
- Login individual obligatorio para Conductores (no genérico)
- Flag `compliance_level` para UME / defensa (no nivel jerárquico)

═══════════════════════════════════════════════════════════════
## 1. DEFINICIONES — quién es quién
═══════════════════════════════════════════════════════════════

### 1.1 CMG (tier=cmg)
- **Quién:** CMG Metalhidráulica S.L.
- **Crea:** Fabricantes, Clientes (excepcionalmente)
- **Ve:** TODO
- **Modelo de negocio:** Tú eres el dueño de la plataforma

### 1.2 Fabricante (tier=manufacturer)  [NUEVO]
- **Quién:** MAX Equipment, Aebi Schmidt, Bezares, INCLISAFE, etc.
- **Crea:** Sus Clientes operadores
- **Ve:** Solo vehículos que él fabricó. Datos técnicos (CAN, mantenimiento).
- **NO ve:** Datos operativos del cliente (rutas, conductores, partes) salvo
  que el Cliente lo autorice explícitamente (flag por Cliente).
- **Modelo de negocio:** Paga licencia anual + cuota mensual por dispositivo activo

### 1.3 Cliente operador (tier=client)
- **Quién:** Wasterent, PREZERO, UME, etc.
- **Crea:** Conductores, tokens de Cliente Final, órdenes de trabajo
- **Ve:** Solo sus vehículos. Todo: técnico + operativo.
- **Modelo de negocio:** Paga al Fabricante (o a CMG en venta directa)

### 1.4 Conductor (tier=client, role=driver)
- **Quién:** Operario individual de Wasterent/PREZERO/UME
- **Crea:** Partes de servicio, paradas
- **Ve:** Solo SU vehículo asignado HOY
- **App:** Móvil (React Native + Expo)
- **CRÍTICO:** login individual obligatorio (DNI + contraseña, NO genérico)

### 1.5 Cliente final (sin tenant)
- **Quién:** Ayto. Valencia, comunidad de vecinos, etc.
- **Acceso:** Solo portal con token (URL pública)
- **Ve:** Lo que el Cliente operador le autorice por token
- **NO requiere cambios:** el sistema actual de portal_access_token sigue igual

═══════════════════════════════════════════════════════════════
## 2. SCHEMA SQL — migraciones a aplicar
═══════════════════════════════════════════════════════════════

**IMPORTANTE:** Todas las migraciones de Fase 1 son **aditivas y nullable**.
La API sigue funcionando exactamente igual durante toda la Fase 1.

### Migración 023 — Añadir `manufacturer` al enum tier

```python
# alembic/versions/023_add_manufacturer_tier.py
"""Add manufacturer tier to tenant_tier_enum

Revision ID: 023
Revises: 022
Create Date: 2026-05-19
"""

from alembic import op

revision = '023'
down_revision = '022'
branch_labels = None
depends_on = None


def upgrade():
    # Postgres no permite añadir valores a un enum dentro de transacción.
    # Hay que cerrar la transacción explícitamente.
    op.execute("COMMIT")
    op.execute("ALTER TYPE tenant_tier_enum ADD VALUE IF NOT EXISTS 'manufacturer' BEFORE 'client'")


def downgrade():
    # No se puede quitar un valor de enum en Postgres sin recrear el tipo.
    # Si hace falta downgrade, hacerlo manualmente con backup previo.
    pass
```

### Migración 024 — Columna `parent_manufacturer_id` en tenant

```python
# alembic/versions/024_tenant_parent_manufacturer.py
"""Add parent_manufacturer_id to tenant

Revision ID: 024
Revises: 023
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '024'
down_revision = '023'


def upgrade():
    op.add_column(
        'tenant',
        sa.Column(
            'parent_manufacturer_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('tenant.id', ondelete='RESTRICT'),
            nullable=True,
        ),
    )
    op.create_index(
        'ix_tenant_parent_manufacturer_id',
        'tenant',
        ['parent_manufacturer_id'],
        postgresql_where=sa.text('parent_manufacturer_id IS NOT NULL'),
    )
    # CHECK constraint: solo clientes pueden tener fabricante asignado
    op.create_check_constraint(
        'chk_only_clients_have_manufacturer',
        'tenant',
        "parent_manufacturer_id IS NULL OR tier = 'client'",
    )


def downgrade():
    op.drop_constraint('chk_only_clients_have_manufacturer', 'tenant')
    op.drop_index('ix_tenant_parent_manufacturer_id', 'tenant')
    op.drop_column('tenant', 'parent_manufacturer_id')
```

### Migración 025 — Columna `manufacturer_tenant_id` en vehicle

```python
# alembic/versions/025_vehicle_manufacturer.py
"""Add manufacturer_tenant_id to vehicle (denormalized for performance)

Revision ID: 025
Revises: 024
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '025'
down_revision = '024'


def upgrade():
    op.add_column(
        'vehicle',
        sa.Column(
            'manufacturer_tenant_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('tenant.id', ondelete='RESTRICT'),
            nullable=True,
        ),
    )
    op.create_index(
        'ix_vehicle_manufacturer_tenant_id',
        'vehicle',
        ['manufacturer_tenant_id'],
        postgresql_where=sa.text('manufacturer_tenant_id IS NOT NULL'),
    )


def downgrade():
    op.drop_index('ix_vehicle_manufacturer_tenant_id', 'vehicle')
    op.drop_column('vehicle', 'manufacturer_tenant_id')
```

### Migración 026 — Trigger de sincronización vehicle ↔ tenant

```python
# alembic/versions/026_vehicle_manufacturer_trigger.py
"""Auto-sync vehicle.manufacturer_tenant_id from tenant.parent_manufacturer_id

Revision ID: 026
Revises: 025
"""

from alembic import op

revision = '026'
down_revision = '025'


def upgrade():
    op.execute("""
        CREATE OR REPLACE FUNCTION sync_vehicle_manufacturer()
        RETURNS TRIGGER AS $$
        BEGIN
          SELECT parent_manufacturer_id INTO NEW.manufacturer_tenant_id
          FROM tenant WHERE id = NEW.tenant_id;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER trg_vehicle_manufacturer_sync
          BEFORE INSERT OR UPDATE OF tenant_id ON vehicle
          FOR EACH ROW EXECUTE FUNCTION sync_vehicle_manufacturer();
    """)


def downgrade():
    op.execute("DROP TRIGGER IF EXISTS trg_vehicle_manufacturer_sync ON vehicle")
    op.execute("DROP FUNCTION IF EXISTS sync_vehicle_manufacturer()")
```

### Migración 027 — Flags de visibilidad y compliance

```python
# alembic/versions/027_tenant_visibility_compliance.py
"""Add visibility flags for manufacturer and compliance_level

Revision ID: 027
Revises: 026
"""

import sqlalchemy as sa
from alembic import op

revision = '027'
down_revision = '026'


def upgrade():
    op.add_column(
        'tenant',
        sa.Column('manufacturer_can_view_operations', sa.Boolean(), server_default='false', nullable=False),
    )
    op.add_column(
        'tenant',
        sa.Column('manufacturer_can_view_can_data', sa.Boolean(), server_default='true', nullable=False),
    )
    op.add_column(
        'tenant',
        sa.Column('manufacturer_can_create_rules', sa.Boolean(), server_default='true', nullable=False),
    )
    op.add_column(
        'tenant',
        sa.Column(
            'compliance_level',
            sa.String(20),
            server_default='standard',
            nullable=False,
        ),
    )
    op.create_check_constraint(
        'chk_compliance_level',
        'tenant',
        "compliance_level IN ('standard', 'enhanced', 'defense')",
    )


def downgrade():
    op.drop_constraint('chk_compliance_level', 'tenant')
    op.drop_column('tenant', 'compliance_level')
    op.drop_column('tenant', 'manufacturer_can_create_rules')
    op.drop_column('tenant', 'manufacturer_can_view_can_data')
    op.drop_column('tenant', 'manufacturer_can_view_operations')
```

### Migración 028 — Campos de driver en user

```python
# alembic/versions/028_user_driver_fields.py
"""Add driver-specific fields to user

Revision ID: 028
Revises: 027
"""

import sqlalchemy as sa
from alembic import op

revision = '028'
down_revision = '027'


def upgrade():
    op.add_column('user', sa.Column('driver_dni', sa.String(20), nullable=True))
    op.add_column('user', sa.Column('driver_license', sa.String(20), nullable=True))
    op.add_column('user', sa.Column('driver_license_expiry', sa.Date(), nullable=True))
    op.add_column('user', sa.Column('mobile_device_id', sa.String(100), nullable=True))
    op.add_column('user', sa.Column('last_mobile_login', sa.TIMESTAMP(timezone=True), nullable=True))

    op.create_index('ix_user_driver_dni', 'user', ['driver_dni'], unique=True,
                    postgresql_where=sa.text('driver_dni IS NOT NULL'))


def downgrade():
    op.drop_index('ix_user_driver_dni', 'user')
    op.drop_column('user', 'last_mobile_login')
    op.drop_column('user', 'mobile_device_id')
    op.drop_column('user', 'driver_license_expiry')
    op.drop_column('user', 'driver_license')
    op.drop_column('user', 'driver_dni')
```

═══════════════════════════════════════════════════════════════
## 3. ALGORITMO DE PERMISOS — nuevo helper
═══════════════════════════════════════════════════════════════

Crear `backend/app/api/v1/access_v2.py` (NO modificar el helper actual todavía):

```python
"""Sistema de permisos v2 — soporta jerarquía CMG → Fabricante → Cliente.

Coexiste con el helper v1 (_check_vehicle_access) durante la fase de migración.
Los endpoints irán migrando uno a uno al v2.
"""

from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tenant import Tenant
from app.models.user import User
from app.models.vehicle import Vehicle, VehicleDriverAssignment


async def assert_can_access_vehicle(
    user: User,
    vehicle_id: UUID,
    db: AsyncSession,
    operation: Literal["read", "write", "delete"] = "read",
    scope: Literal["all", "technical", "operational"] = "all",
) -> Vehicle:
    """
    Verifica permiso de acceso al vehículo.

    Reglas:
    - CMG: acceso total siempre
    - Cliente operador (mismo tenant): acceso total a sus vehículos
    - Driver (mismo tenant + role=driver): solo su vehículo asignado HOY
    - Manufacturer: acceso técnico a vehículos que él fabricó.
      Solo operativo si el cliente lo autoriza vía flag.

    Returns:
        Vehicle si tiene acceso

    Raises:
        HTTPException 404 si no tiene acceso (NUNCA 403 — evitamos enumeración)
    """
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(404, "Vehicle not found")

    user_tenant = await db.get(Tenant, user.tenant_id)
    if not user_tenant:
        raise HTTPException(404, "Vehicle not found")

    # CMG ve todo
    if user_tenant.tier == "cmg":
        return vehicle

    # Mismo tenant que el vehículo (cliente operador)
    if vehicle.tenant_id == user.tenant_id:
        # Driver: solo si está asignado AL vehículo HOY
        if user.role == "driver":
            today = date.today()
            assignment = await db.scalar(
                select(VehicleDriverAssignment).where(
                    VehicleDriverAssignment.vehicle_id == vehicle_id,
                    VehicleDriverAssignment.driver_user_id == user.id,
                    VehicleDriverAssignment.date == today,
                )
            )
            if not assignment:
                raise HTTPException(404, "Vehicle not found")
            # Driver es solo lectura excepto operaciones del parte
            if operation in ("write", "delete") and scope != "operational":
                raise HTTPException(403, "Driver cannot modify vehicle")
        return vehicle

    # Manufacturer: ve vehículos que él fabricó
    if user_tenant.tier == "manufacturer":
        if vehicle.manufacturer_tenant_id == user.tenant_id:
            # Operativo requiere flag del Cliente
            if scope == "operational":
                client = await db.get(Tenant, vehicle.tenant_id)
                if not client or not client.manufacturer_can_view_operations:
                    raise HTTPException(404, "Vehicle not found")
            # Manufacturer NO puede modificar vehículos
            if operation in ("write", "delete"):
                raise HTTPException(403, "Manufacturer cannot modify vehicle")
            return vehicle

    # Sin acceso
    raise HTTPException(404, "Vehicle not found")


async def list_accessible_vehicle_ids(
    user: User,
    db: AsyncSession,
) -> list[UUID] | Literal["ALL"]:
    """
    Devuelve lista de IDs de vehículos accesibles para este usuario.
    Para CMG devuelve "ALL" como marca especial (no listar todo).

    Útil para endpoints de listado.
    """
    user_tenant = await db.get(Tenant, user.tenant_id)
    if not user_tenant:
        return []

    if user_tenant.tier == "cmg":
        return "ALL"

    if user_tenant.tier == "manufacturer":
        result = await db.scalars(
            select(Vehicle.id).where(Vehicle.manufacturer_tenant_id == user.tenant_id)
        )
        return list(result)

    # Cliente o driver: solo su tenant
    if user.role == "driver":
        today = date.today()
        result = await db.scalars(
            select(VehicleDriverAssignment.vehicle_id).where(
                VehicleDriverAssignment.driver_user_id == user.id,
                VehicleDriverAssignment.date == today,
            )
        )
        return list(result)

    result = await db.scalars(
        select(Vehicle.id).where(Vehicle.tenant_id == user.tenant_id)
    )
    return list(result)
```

═══════════════════════════════════════════════════════════════
## 4. MODELO DE REVENUE — billing del Fabricante
═══════════════════════════════════════════════════════════════

### 4.1 Schema adicional

```python
# Migración 029 (Fase 2, no Fase 1)
"""Add subscription tracking for manufacturers

Revision ID: 029
Revises: 028
"""

# Tabla manufacturer_subscription
op.create_table(
    'manufacturer_subscription',
    sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
    sa.Column('tenant_id', postgresql.UUID(as_uuid=True),
              sa.ForeignKey('tenant.id', ondelete='CASCADE'), nullable=False),
    sa.Column('plan_name', sa.String(50), nullable=False),
    sa.Column('annual_base_eur', sa.Numeric(10, 2), nullable=False, server_default='500.00'),
    sa.Column('monthly_per_device_eur', sa.Numeric(6, 2), nullable=False, server_default='8.00'),
    sa.Column('started_at', sa.Date(), nullable=False),
    sa.Column('ends_at', sa.Date(), nullable=True),
    sa.Column('status', sa.String(20), nullable=False, server_default='active'),
    sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()')),
)

# View para conteo de dispositivos activos por fabricante
op.execute("""
    CREATE OR REPLACE VIEW v_manufacturer_active_devices AS
    SELECT
        v.manufacturer_tenant_id AS manufacturer_id,
        COUNT(DISTINCT d.id) AS active_devices,
        COUNT(DISTINCT v.tenant_id) AS active_clients
    FROM vehicle v
    JOIN device d ON d.vehicle_id = v.id
    WHERE v.manufacturer_tenant_id IS NOT NULL
      AND d.last_seen > now() - interval '7 days'
    GROUP BY v.manufacturer_tenant_id;
""")
```

### 4.2 Endpoint de facturación mensual

```python
# backend/app/api/v1/billing.py — NUEVO archivo
"""Endpoints de facturación para fabricantes."""

@router.get("/manufacturer/{manufacturer_id}/invoice-preview", response_model=InvoicePreview)
async def manufacturer_invoice_preview(
    manufacturer_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Previsualización de factura del mes corriente para un fabricante.
    Solo accesible por CMG o el propio fabricante."""
    # Verificación de permisos
    user_tenant = await db.get(Tenant, user.tenant_id)
    if user_tenant.tier not in ("cmg", "manufacturer"):
        raise HTTPException(403)
    if user_tenant.tier == "manufacturer" and user.tenant_id != manufacturer_id:
        raise HTTPException(404)

    # Suscripción activa
    sub = await db.scalar(
        select(ManufacturerSubscription).where(
            ManufacturerSubscription.tenant_id == manufacturer_id,
            ManufacturerSubscription.status == "active",
        )
    )
    if not sub:
        raise HTTPException(404, "No active subscription")

    # Dispositivos activos
    row = await db.execute(
        text("SELECT active_devices, active_clients FROM v_manufacturer_active_devices WHERE manufacturer_id = :mid"),
        {"mid": manufacturer_id},
    )
    devices_data = row.first()
    active_devices = devices_data.active_devices if devices_data else 0
    active_clients = devices_data.active_clients if devices_data else 0

    # Cálculo
    annual_base_monthly = sub.annual_base_eur / 12
    devices_charge = active_devices * sub.monthly_per_device_eur
    total = annual_base_monthly + devices_charge

    return InvoicePreview(
        manufacturer_id=manufacturer_id,
        period=date.today().strftime("%Y-%m"),
        active_devices=active_devices,
        active_clients=active_clients,
        annual_base_monthly=annual_base_monthly,
        devices_charge=devices_charge,
        total=total,
    )
```

═══════════════════════════════════════════════════════════════
## 5. BRANDING POR HERENCIA — implementación simple
═══════════════════════════════════════════════════════════════

**Principio:** Sin subdominios, sin DNS, sin SSL personalizado. Solo
herencia de `brand_tokens` JSONB en cascada.

### 5.1 Lógica de resolución

```python
# backend/app/services/branding.py — NUEVO
"""Resuelve los brand_tokens efectivos siguiendo la cadena de herencia."""

CMG_DEFAULT_TOKENS = {
    "logo_url": "/static/logos/cmgtrack.png",
    "brand_name": "CMG Track",
    "primary_color": "#F97316",  # naranja CMG
    "secondary_color": "#22C55E",
}


async def resolve_brand_tokens(tenant_id: UUID, db: AsyncSession) -> dict:
    """Resuelve los brand_tokens efectivos en orden:
    1. Tokens propios del tenant (si existen)
    2. Tokens del fabricante (si tiene parent_manufacturer_id)
    3. Defaults de CMG
    """
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        return CMG_DEFAULT_TOKENS

    tokens = dict(CMG_DEFAULT_TOKENS)

    # Si tiene fabricante, aplicar sus tokens
    if tenant.parent_manufacturer_id:
        manuf = await db.get(Tenant, tenant.parent_manufacturer_id)
        if manuf and manuf.brand_tokens:
            tokens.update(manuf.brand_tokens)

    # Aplicar tokens propios del tenant (override final)
    if tenant.brand_tokens:
        tokens.update(tenant.brand_tokens)

    return tokens
```

### 5.2 Endpoint público de tokens

Ya existe (sirve los `brand_tokens` en `/tenant/me`). Modificarlo para
que use `resolve_brand_tokens` en vez de devolver el JSONB crudo.

### 5.3 Permisos de edición

- CMG: edita los tokens de cualquier tenant
- Fabricante: edita SUS tokens (que cascadean a sus clientes que no
  tengan los propios) + tokens de SUS clientes
- Cliente: solo edita los SUYOS

═══════════════════════════════════════════════════════════════
## 6. COMPLIANCE — flag para UME / defensa
═══════════════════════════════════════════════════════════════

**Estado:** Solo se crea la infraestructura. La activación de features
de compliance se hace cuando UME firme (decisión postpuesta por Carlos).

### 6.1 Lo que añadimos ahora

- Columna `tenant.compliance_level` (migración 027) con valores:
  - `standard`: clientes normales (Wasterent, PREZERO)
  - `enhanced`: clientes con requisitos extra (GDPR avanzado, banca)
  - `defense`: UME y otros militares (auditoría inmutable, retención larga)

### 6.2 Lo que NO hacemos ahora

- NO activamos auditoría inmutable
- NO cambiamos retención de logs
- NO añadimos cifrado en reposo extra
- NO aislamos infraestructura

Esto se discute cuando UME firme. Pero el flag está listo en BD.

═══════════════════════════════════════════════════════════════
## 7. PLAN DE MIGRACIÓN — 6 FASES
═══════════════════════════════════════════════════════════════

### Fase 1 — Schema sin breaking changes (2-3h) ★ ESTA PRIMERO
1. Crear migraciones 023-028 según sección 2
2. Aplicar en local con docker compose, verificar que la API arranca
3. Verificar que TODOS los tests existentes siguen pasando
4. Aplicar en producción con `alembic upgrade head`
5. Verificar que Wasterent y PREZERO siguen viendo lo mismo

**Criterio éxito:** API se comporta idéntico antes y después.

### Fase 2 — Helper v2 + tests (2-3h)
1. Crear `backend/app/api/v1/access_v2.py` (sección 3)
2. Tests unitarios exhaustivos:
   - CMG ve todo
   - Manufacturer ve solo sus vehículos
   - Manufacturer NO ve operacional si flag OFF
   - Manufacturer ve operacional si flag ON
   - Client solo ve sus vehículos
   - Driver solo ve su asignado HOY
   - Driver NO puede acceder a otro día
3. NO migrar endpoints todavía. Solo helper + tests.

**Criterio éxito:** 100% tests del helper v2 verdes.

### Fase 3 — Crear primer Fabricante de prueba (30 min)
1. SQL manual para crear tenant tier=manufacturer "MAX Equipment (test)"
2. SQL manual para vincular 1-2 vehículos de test a este fabricante
3. Verificar que Wasterent/PREZERO siguen sin verse afectados
4. Login con usuario manufacturer y comprobar que ve solo esos 1-2 vehículos

**Criterio éxito:** Manufacturer ve sus vehículos vía endpoint actual
(que sigue usando helper v1 — esto es zero-impact test del schema).

### Fase 4 — Migración endpoint por endpoint (4-6h)
Orden recomendado (menos crítico → más crítico):
1. `GET /maintenance-plans` (informativo, no afecta operación)
2. `GET /maintenance-log`
3. `GET /alerts`
4. `GET /vehicles` y `GET /vehicles/{id}`
5. `GET /vehicles/{id}/track`
6. `GET /vehicles/{id}/avl-series`
7. `GET /work-orders`, `POST /work-orders`
8. Endpoints de gestión (`POST /tenants`, `POST /users`)

Para cada endpoint:
- Cambiar import del helper v1 al v2
- Adaptar el `scope` (technical/operational/all) según el endpoint
- Test smoke: probar como cada nivel (cmg/manufacturer/client/driver)

**Criterio éxito:** Tras migrar TODOS los endpoints, eliminar helper v1.

### Fase 5 — Login individual conductores (3-4h)
1. Endpoint `POST /auth/driver-login` separado del genérico
   - Acepta DNI + contraseña en lugar de email
   - Devuelve JWT con `role=driver`
2. App móvil React Native: pantalla de login propia con campo DNI
3. Migración de datos: si Wasterent/PREZERO tienen "conductor genérico",
   crear N conductores individuales con DNIs reales (necesita coordinación
   con el cliente)
4. Validación de DNI español (letra de control)

**Criterio éxito:** Cada conductor entra con su DNI. El conductor
genérico anterior queda deshabilitado.

### Fase 6 — UI Manufacturer + facturación (4-6h)
1. Ruta `/manufacturer/dashboard` con vista propia
2. Componente `<ManufacturerVehiclesList />` filtrado
3. Endpoint y página `/manufacturer/billing` con preview de factura
4. Migración 029 (subscription)

**Criterio éxito:** Demo funcional para enseñar a MAX Equipment.

═══════════════════════════════════════════════════════════════
## 8. CAMBIOS EN EL FRONTEND
═══════════════════════════════════════════════════════════════

### 8.1 TopNav adaptado por tier

```typescript
// frontend/src/shared/nav/topNavConfig.ts — NUEVO

export const NAV_CONFIG_BY_TIER = {
  cmg: {
    main: ["Dashboard", "Flota", "Alertas", "Mantenimiento", "Reportes"],
    operations: ["Órdenes", "Conductores", "Geocercas"],
    admin: ["Fabricantes", "Clientes", "Dispositivos", "CAN Scanner", "Plantillas", "Ajustes"],
  },
  manufacturer: {
    main: ["Dashboard fabricante", "Mis vehículos", "Mis clientes"],
    operations: ["Alertas técnicas", "Mantenimiento"],
    admin: ["Facturación", "Ajustes"],
  },
  client: {
    main: ["Dashboard", "Flota", "Alertas", "Mantenimiento", "Reportes"],
    operations: ["Órdenes", "Conductores", "Geocercas"],
    admin: ["Mis clientes finales", "Ajustes"],
  },
  driver: {
    main: ["Mi vehículo", "Mis órdenes"],
  },
};
```

### 8.2 Nueva página `/fabricantes` (solo CMG)

CRUD de fabricantes. Idéntico al de Clientes actual pero con campos extra:
- Plan de suscripción (annual base + per device)
- Lista de clientes que ha creado
- Métrica de dispositivos activos

### 8.3 Modificación TenantsPage existente

Cuando es admin de tier=manufacturer, el listado filtra automáticamente
a tenants con `parent_manufacturer_id = user.tenant_id`.

═══════════════════════════════════════════════════════════════
## 9. CRITERIOS DE ACEPTACIÓN FINAL
═══════════════════════════════════════════════════════════════

Esta v2 se considera lista para producción cuando:

1. ✅ Las 6 fases están completadas
2. ✅ Wasterent confirma zero regresión en lo que ve
3. ✅ PREZERO confirma zero regresión en lo que ve
4. ✅ Existe al menos 1 manufacturer real (MAX, Aebi, Bezares o similar)
   con al menos 1 cliente y al menos 5 vehículos vinculados
5. ✅ Cada conductor entra con su DNI individual (no genérico)
6. ✅ Cobertura de tests en helper v2 ≥ 95%
7. ✅ CLAUDE.md actualizado: secciones 5 y 7 reflejan v2
8. ✅ Documentación comercial para vender a fabricantes

═══════════════════════════════════════════════════════════════
## 10. RIESGOS CONOCIDOS Y MITIGACIONES
═══════════════════════════════════════════════════════════════

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Bug en helper v2 filtra datos entre fabricantes | Media | Alto | Helper v1 y v2 coexisten 2 semanas, tests exhaustivos |
| Trigger sync ralentiza inserts en vehicle | Baja | Bajo | Trigger solo en INSERT/UPDATE de tenant_id, no en cada UPDATE |
| Cliente protesta por "datos compartidos con fabricante" | Alta | Medio | Flags por cliente, defaults conservadores, documentar contractualmente |
| Migración rompe queries existentes | Baja | Alto | Columnas nullable, NO se cambia ninguna existente |
| Conductor pierde acceso por bug de fecha | Media | Alto | Logs específicos, alerta a Carlos si rechazos masivos |

═══════════════════════════════════════════════════════════════
## 11. DECISIONES TOMADAS POR CARLOS
═══════════════════════════════════════════════════════════════

Para que Claude Code no las cuestione en cada fase:

1. **Fabricante es nivel propio** (no flag) — entre CMG y Cliente
2. **Conductor con login individual** — no se acepta login genérico
3. **Cliente Final sigue solo portal token** — NO se le da JWT
4. **Modelo revenue** — licencia anual base + cuota mensual por dispositivo
5. **Branding por herencia simple** — sin subdominios, sin DNS, sin SSL custom
6. **UME = flag `compliance_level='defense'`** — no nivel propio
7. **Helpers v1 y v2 coexisten 2 semanas mínimo** — para revertir si falla
8. **Migraciones 023-028 son aditivas** — zero breaking changes en Fase 1
