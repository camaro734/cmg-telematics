# Entrega de camiones + autogestión del fabricante — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la cajita GPS viaje con el camión al entregarlo, y que un fabricante con permiso de CMG pueda crear sus clientes y traspasar/recuperar sus camiones sin depender de CMG.

**Architecture:** Dos flags booleanos nuevos en `tenant` (`manufacturer_can_manage_clients`, `manufacturer_can_transfer_vehicles`) que gatean operaciones del fabricante en backend. La reasignación de vehículo mueve también `device.tenant_id`. El frontend lee los flags vía `/auth/me`, gatea menús/botones, y reetiqueta "Reasignar" → "Entregar/Traspasar".

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic + Pydantic v2 (backend); React 18 + Vite + React Query + Zustand + TypeScript estricto (frontend); pytest con mocks (tests backend).

## Global Constraints

- Comentarios en español, código en inglés.
- Type hints en toda función pública (Python); TypeScript estricto, sin `any`.
- Multi-tenant: filtrar por `tenant_id`, respetar jerarquía cmg/manufacturer/client/subclient, regla de hierro (nadie delega más de lo que tiene).
- Migración additive; en producción aplicar con `docker-compose run --rm --no-deps core-api alembic -c /app/alembic.ini upgrade head` (requiere confirmación explícita de Carlos).
- Deploy: BUILD con `docker-compose build`, SWAP con `docker run` (recipe de CLAUDE.md). No `docker-compose up` para recrear.
- Tests backend con `python3 -m pytest` (no existe binario `python`).
- Flags nuevos por defecto `false`; los 3 existentes (`view_operations`, `view_can_data`, `create_rules`) por defecto `true`.

---

## File Structure

**Backend:**
- `backend/app/models/tenant.py` — +2 columnas flag.
- `backend/alembic/versions/056_manufacturer_self_service_flags.py` — migración nueva.
- `backend/app/schemas/tenant.py` — exponer 5 flags en `TenantOut` y `TenantUpdate`.
- `backend/app/api/v1/tenants.py` — gating create_tenant/create_tenant_user; proteger flags en patch_tenant.
- `backend/app/schemas/vehicle.py` — `VehicleReassignOut` +`device_imei`,`device_moved`.
- `backend/app/api/v1/vehicles.py` — reassign mueve la cajita + gate transfer del fabricante.
- `backend/app/api/v1/auth.py` — `/auth/me` devuelve los 2 flags de autogestión.
- `backend/tests/api/test_manufacturer_self_service.py` — tests nuevos.

**Frontend:**
- `frontend/src/lib/types.ts` — flags en `TenantOut`/`TenantUpdate`, device en `VehicleReassignOut`, tipo `MyProfile`.
- `frontend/src/lib/useMyProfile.ts` — hook React Query a `/auth/me` (nuevo).
- `frontend/src/features/clientes/TenantFormPage.tsx` — sección "Permisos del fabricante" (5 checkboxes).
- `frontend/src/shared/ui/TopNav.tsx` — gatear "Mis clientes" por `manage_clients`.
- `frontend/src/features/vehicles/VehiclesPage.tsx` — renombrar a "Entregar/Traspasar", gatear por `transfer_vehicles`, resumen con cajita.

---

## Task 1: Migración 056 + columnas en el modelo Tenant

**Files:**
- Modify: `backend/app/models/tenant.py:32-34`
- Create: `backend/alembic/versions/056_manufacturer_self_service_flags.py`

**Interfaces:**
- Produces: `Tenant.manufacturer_can_manage_clients: bool`, `Tenant.manufacturer_can_transfer_vehicles: bool` (ambos default false).

- [ ] **Step 1: Añadir columnas al modelo**

En `backend/app/models/tenant.py`, justo debajo de la línea 34 (`manufacturer_can_create_rules`):

```python
    manufacturer_can_view_operations: Mapped[bool] = mapped_column(Boolean, server_default="true", nullable=False)
    manufacturer_can_view_can_data: Mapped[bool] = mapped_column(Boolean, server_default="true", nullable=False)
    manufacturer_can_create_rules: Mapped[bool] = mapped_column(Boolean, server_default="true", nullable=False)
    # Autogestión del fabricante (solo CMG las activa). Por defecto false.
    manufacturer_can_manage_clients: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    manufacturer_can_transfer_vehicles: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
```

(Las 3 primeras líneas ya existen; añade solo las 2 últimas.)

- [ ] **Step 2: Crear la migración 056**

Crear `backend/alembic/versions/056_manufacturer_self_service_flags.py`:

```python
"""manufacturer_self_service_flags: el fabricante puede gestionar sus clientes y traspasar vehículos.

Dos flags que CMG activa por fabricante. Por defecto false (no autogestiona hasta que CMG lo habilita).

Revision ID: 056
Revises: 055
Create Date: 2026-06-18
"""
from alembic import op
import sqlalchemy as sa

revision = "056"
down_revision = "055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tenant",
        sa.Column("manufacturer_can_manage_clients", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "tenant",
        sa.Column("manufacturer_can_transfer_vehicles", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("tenant", "manufacturer_can_transfer_vehicles")
    op.drop_column("tenant", "manufacturer_can_manage_clients")
```

- [ ] **Step 3: Verificar que el modelo importa**

Run: `cd /opt/cmg-telematic1/backend && python3 -c "from app.models.tenant import Tenant; print(Tenant.manufacturer_can_manage_clients, Tenant.manufacturer_can_transfer_vehicles)"`
Expected: imprime dos atributos InstrumentedAttribute sin error.

- [ ] **Step 4: Commit**

```bash
git add backend/app/models/tenant.py backend/alembic/versions/056_manufacturer_self_service_flags.py
git commit -m "feat(tenant): flags manufacturer_can_manage_clients/transfer_vehicles (migración 056)"
```

> Nota: NO ejecutar `alembic upgrade` aquí. La migración se aplica en producción en la Task 10, con confirmación explícita.

---

## Task 2: Exponer los 5 flags en los schemas de Tenant + proteger en patch

**Files:**
- Modify: `backend/app/schemas/tenant.py:9-26` (TenantOut), `:41-47` (TenantUpdate)
- Modify: `backend/app/api/v1/tenants.py:177-225` (patch_tenant)
- Test: `backend/tests/api/test_manufacturer_self_service.py`

**Interfaces:**
- Produces: `TenantOut` y `TenantUpdate` con campos `manufacturer_can_view_operations`, `manufacturer_can_view_can_data`, `manufacturer_can_create_rules`, `manufacturer_can_manage_clients`, `manufacturer_can_transfer_vehicles`.
- Consumes: `Tenant` flags de Task 1.

- [ ] **Step 1: Escribir el test (patch protege flags de no-CMG)**

Crear `backend/tests/api/test_manufacturer_self_service.py` con este primer test:

```python
import uuid
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db
from app.schemas.auth import CurrentUser
from app.models.tenant import Tenant

CMG_ID = uuid.UUID("ee100000-0000-0000-0000-000000000001")
MFR_ID = uuid.UUID("aa100000-0000-0000-0000-000000000001")
CLIENT_ID = uuid.UUID("bb100000-0000-0000-0000-000000000001")

CMG_ADMIN = CurrentUser(user_id=uuid.uuid4(), tenant_id=CMG_ID, tenant_tier="cmg", role="admin", email="cmg@t.com")
MFR_ADMIN = CurrentUser(user_id=uuid.uuid4(), tenant_id=MFR_ID, tenant_tier="manufacturer", role="admin", email="m@t.com")


def _setup(user, db):
    app.dependency_overrides[get_current_user] = lambda: user
    async def _g():
        yield db
    app.dependency_overrides[get_db] = _g


@pytest.fixture(autouse=True)
def clear():
    yield
    app.dependency_overrides.clear()


class _MfrTenant:
    """Tenant fabricante mutable."""
    def __init__(self):
        self.id = MFR_ID
        self.tier = "manufacturer"
        self.parent_id = None
        self.parent_manufacturer_id = None
        self.name = "VPS"
        self.slug = "vps"
        self.active = True
        self.brand_name = None; self.brand_color = None; self.logo_url = None
        self.custom_domain = None; self.brand_tokens = None
        self.enabled_modules = []
        self.business_cif = None; self.business_address = None
        self.created_at = datetime.now(timezone.utc)
        self.manufacturer_can_view_operations = True
        self.manufacturer_can_view_can_data = True
        self.manufacturer_can_create_rules = True
        self.manufacturer_can_manage_clients = False
        self.manufacturer_can_transfer_vehicles = False


def test_cmg_can_set_manufacturer_flags():
    tenant = _MfrTenant()
    db = AsyncMock()
    db.get = AsyncMock(return_value=tenant)
    db.refresh = AsyncMock()
    _setup(CMG_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).patch(
        f"/api/v1/tenants/{MFR_ID}",
        json={"manufacturer_can_manage_clients": True, "manufacturer_can_transfer_vehicles": True},
    )
    assert resp.status_code == 200
    assert tenant.manufacturer_can_manage_clients is True
    assert tenant.manufacturer_can_transfer_vehicles is True
    body = resp.json()
    assert body["manufacturer_can_manage_clients"] is True
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `cd /opt/cmg-telematic1/backend && python3 -m pytest tests/api/test_manufacturer_self_service.py::test_cmg_can_set_manufacturer_flags -xvs`
Expected: FAIL (los campos no están en TenantUpdate ni TenantOut → no se setean / no salen en la respuesta).

- [ ] **Step 3: Añadir los flags a TenantOut**

En `backend/app/schemas/tenant.py`, dentro de `class TenantOut`, antes de `created_at: datetime`:

```python
    manufacturer_can_view_operations: bool = True
    manufacturer_can_view_can_data: bool = True
    manufacturer_can_create_rules: bool = True
    manufacturer_can_manage_clients: bool = False
    manufacturer_can_transfer_vehicles: bool = False
```

- [ ] **Step 4: Añadir los flags a TenantUpdate**

En `backend/app/schemas/tenant.py`, dentro de `class TenantUpdate`:

```python
    manufacturer_can_view_operations: bool | None = None
    manufacturer_can_view_can_data: bool | None = None
    manufacturer_can_create_rules: bool | None = None
    manufacturer_can_manage_clients: bool | None = None
    manufacturer_can_transfer_vehicles: bool | None = None
```

- [ ] **Step 5: Proteger los flags en patch_tenant (solo CMG)**

En `backend/app/api/v1/tenants.py`, dentro de `patch_tenant`, justo ANTES del bucle `for field, value in body.model_dump(...)` (línea ~216):

```python
    # Los flags de fabricante solo los puede tocar CMG; un cliente/fabricante que
    # edite otros campos no debe poder auto-concederse permisos.
    update_data = body.model_dump(exclude_unset=True, exclude={"enabled_modules"})
    if user.tenant_tier != "cmg":
        for f in (
            "manufacturer_can_view_operations", "manufacturer_can_view_can_data",
            "manufacturer_can_create_rules", "manufacturer_can_manage_clients",
            "manufacturer_can_transfer_vehicles",
        ):
            update_data.pop(f, None)
    for field, value in update_data.items():
        setattr(tenant, field, value)
```

Y ELIMINAR el bucle anterior `for field, value in body.model_dump(exclude_unset=True, exclude={"enabled_modules"}).items(): setattr(tenant, field, value)` (queda sustituido por el de arriba).

- [ ] **Step 6: Ejecutar y ver pasar**

Run: `cd /opt/cmg-telematic1/backend && python3 -m pytest tests/api/test_manufacturer_self_service.py::test_cmg_can_set_manufacturer_flags -xvs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/tenant.py backend/app/api/v1/tenants.py backend/tests/api/test_manufacturer_self_service.py
git commit -m "feat(tenant): exponer flags de fabricante en schemas; solo CMG los modifica"
```

---

## Task 3: Gatear creación de clientes/usuarios del fabricante por `manage_clients`

**Files:**
- Modify: `backend/app/api/v1/tenants.py:56-123` (create_tenant), `:403-427` (create_tenant_user)
- Test: `backend/tests/api/test_manufacturer_self_service.py`

**Interfaces:**
- Consumes: `Tenant.manufacturer_can_manage_clients` (Task 1).

- [ ] **Step 1: Escribir tests (fabricante sin/con flag crea cliente)**

Añadir a `backend/tests/api/test_manufacturer_self_service.py`:

```python
def test_manufacturer_without_flag_cannot_create_client_403():
    mfr = _MfrTenant()  # manage_clients = False
    db = AsyncMock()
    db.get = AsyncMock(return_value=mfr)
    _setup(MFR_ADMIN, db)
    resp = TestClient(app, raise_server_exceptions=False).post(
        "/api/v1/tenants",
        json={"tier": "client", "name": "Delimex", "slug": "delimex"},
    )
    assert resp.status_code == 403


def test_manufacturer_with_flag_creates_client_201():
    mfr = _MfrTenant()
    mfr.manufacturer_can_manage_clients = True
    db = AsyncMock()
    # db.get(Tenant, MFR_ID) → mfr;  slug-check select → None
    db.get = AsyncMock(return_value=mfr)
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None)))
    db.refresh = AsyncMock()
    _setup(MFR_ADMIN, db)
    resp = TestClient(app, raise_server_exceptions=False).post(
        "/api/v1/tenants",
        json={"tier": "client", "name": "Delimex", "slug": "delimex"},
    )
    assert resp.status_code == 201
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `cd /opt/cmg-telematic1/backend && python3 -m pytest tests/api/test_manufacturer_self_service.py -k "create_client" -xvs`
Expected: `test_manufacturer_without_flag_cannot_create_client_403` FALLA (hoy crea sin flag → 201).

- [ ] **Step 3: Gatear create_tenant (rama manufacturer)**

En `backend/app/api/v1/tenants.py`, dentro de `create_tenant`, en la rama `elif user.tenant_tier == "manufacturer":`, justo después de la comprobación de `body.tier != "client"`:

```python
    elif user.tenant_tier == "manufacturer":
        if user.role != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin para crear clientes")
        if body.tier != "client":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Un fabricante solo puede crear tenants tier=client")
        mfr = await db.get(Tenant, user.tenant_id)
        if not mfr or not mfr.manufacturer_can_manage_clients:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CMG no ha habilitado la gestión de clientes para este fabricante")
        body = body.model_copy(update={
            "tier": "client",
            "parent_id": user.tenant_id,
            "parent_manufacturer_id": user.tenant_id,
        })
```

- [ ] **Step 4: Gatear create_tenant_user (actor fabricante)**

En `backend/app/api/v1/tenants.py`, dentro de `create_tenant_user`, después de `await assert_can_manage_tenant(user, tenant_id, db)`:

```python
    await assert_can_manage_tenant(user, tenant_id, db)
    if user.tenant_tier == "manufacturer":
        mfr = await db.get(Tenant, user.tenant_id)
        if not mfr or not mfr.manufacturer_can_manage_clients:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CMG no ha habilitado la gestión de clientes para este fabricante")
```

- [ ] **Step 5: Ejecutar y ver pasar**

Run: `cd /opt/cmg-telematic1/backend && python3 -m pytest tests/api/test_manufacturer_self_service.py -k "create_client" -xvs`
Expected: ambos PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/tenants.py backend/tests/api/test_manufacturer_self_service.py
git commit -m "feat(tenant): gatear creación de clientes/usuarios del fabricante por manage_clients"
```

---

## Task 4: La reasignación mueve la cajita + gate de traspaso del fabricante

**Files:**
- Modify: `backend/app/schemas/vehicle.py:158-164` (VehicleReassignOut)
- Modify: `backend/app/api/v1/vehicles.py:988-1089` (reassign_vehicle)
- Test: `backend/tests/api/test_vehicle_reassignment.py`

**Interfaces:**
- Consumes: `Tenant.manufacturer_can_transfer_vehicles` (Task 1).
- Produces: `VehicleReassignOut` con `device_imei: str | None`, `device_moved: bool`.

- [ ] **Step 1: Ampliar VehicleReassignOut**

En `backend/app/schemas/vehicle.py`, en `class VehicleReassignOut`, añadir al final:

```python
class VehicleReassignOut(BaseModel):
    vehicle_id: uuid.UUID
    from_tenant_id: uuid.UUID
    to_tenant_id: uuid.UUID
    reassigned_at: datetime
    alert_rules_deactivated: int
    grants_revoked: int
    device_moved: bool = False
    device_imei: str | None = None
```

- [ ] **Step 2: Escribir test (la cajita se mueve con el vehículo)**

Añadir a `backend/tests/api/test_vehicle_reassignment.py` (reutiliza sus helpers `_MockVehicle`, `_MockTenant`, `_default_executes`, `_setup`, IDs):

```python
class _MockDevice:
    def __init__(self, tenant_id):
        self.imei = "356938035643809"
        self.vehicle_id = VEHICLE_ID
        self.tenant_id = tenant_id
        self.active = True


def test_reassign_moves_device_with_vehicle():
    vehicle = _MockVehicle(AGUAS_ID, VPS_ID)
    target = _MockTenant(RENTA_ID, VPS_ID)
    device = _MockDevice(AGUAS_ID)
    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, pk: vehicle if model is Vehicle else target)
    # Orden de executes: WorkOrder(none), AlertRule([]), PermissionGrant([]), MaintenancePlan([]), Device(device)
    from app.models.device import Device
    def _exec(*a, **k):
        return None
    execs = _default_executes() + [_scalar_val(device)]
    db.execute = AsyncMock(side_effect=execs)
    db.delete = AsyncMock()
    _setup(CMG_ADMIN, db)

    resp = TestClient(app, raise_server_exceptions=False).post(
        f"/api/v1/vehicles/{VEHICLE_ID}/reassign",
        json={"target_tenant_id": str(RENTA_ID)},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["device_moved"] is True
    assert data["device_imei"] == "356938035643809"
    assert device.tenant_id == RENTA_ID
```

- [ ] **Step 3: Ejecutar y ver fallar**

Run: `cd /opt/cmg-telematic1/backend && python3 -m pytest tests/api/test_vehicle_reassignment.py::test_reassign_moves_device_with_vehicle -xvs`
Expected: FAIL (`device_moved` no existe / la query del device no se hace).

- [ ] **Step 4: Mover la cajita en reassign_vehicle**

En `backend/app/api/v1/vehicles.py`, asegurar el import del modelo Device al principio del fichero (si no está):

```python
from app.models.device import Device
```

Luego, en `reassign_vehicle`, justo después del bloque que migra los planes de mantenimiento y ANTES de `await db.commit()`:

```python
    # 5) La cajita viaja con el camión: el device montado pasa al nuevo dueño.
    device_result = await db.execute(
        select(Device).where(Device.vehicle_id == vehicle_id, Device.active == True)
    )
    moved_device = device_result.scalar_one_or_none()
    device_moved = False
    device_imei = None
    if moved_device is not None:
        moved_device.tenant_id = body.target_tenant_id
        device_moved = True
        device_imei = moved_device.imei

    await db.commit()

    return VehicleReassignOut(
        vehicle_id=vehicle_id,
        from_tenant_id=from_tenant_id,
        to_tenant_id=body.target_tenant_id,
        reassigned_at=datetime.now(timezone.utc),
        alert_rules_deactivated=deactivated,
        grants_revoked=revoked,
        device_moved=device_moved,
        device_imei=device_imei,
    )
```

(Sustituye el `await db.commit()` + `return VehicleReassignOut(...)` actuales por este bloque.)

- [ ] **Step 5: Escribir test (gate de traspaso del fabricante)**

Añadir a `backend/tests/api/test_vehicle_reassignment.py`. Nota: `_MockTenant` actual no tiene el flag; añádeselo en estos tests creando el tenant del fabricante con el flag:

```python
def test_manufacturer_without_transfer_flag_403():
    vehicle = _MockVehicle(AGUAS_ID, VPS_ID)
    mfr = _MockTenant(VPS_ID, None)
    mfr.manufacturer_can_transfer_vehicles = False
    db = AsyncMock()
    # db.get: Vehicle → vehicle; Tenant(VPS_ID, flag) → mfr; Tenant(target) → target
    target = _MockTenant(RENTA_ID, VPS_ID)
    def _get(model, pk):
        if model is Vehicle:
            return vehicle
        return mfr if str(pk) == str(VPS_ID) else target
    db.get = AsyncMock(side_effect=_get)
    _setup(VPS_ADMIN, db)
    resp = TestClient(app, raise_server_exceptions=False).post(
        f"/api/v1/vehicles/{VEHICLE_ID}/reassign",
        json={"target_tenant_id": str(RENTA_ID)},
    )
    assert resp.status_code == 403
```

- [ ] **Step 6: Ejecutar y ver fallar**

Run: `cd /opt/cmg-telematic1/backend && python3 -m pytest tests/api/test_vehicle_reassignment.py::test_manufacturer_without_transfer_flag_403 -xvs`
Expected: FAIL (hoy el fabricante reasigna sin flag → 200).

- [ ] **Step 7: Gatear el traspaso del fabricante**

En `backend/app/api/v1/vehicles.py`, en `reassign_vehicle`, dentro del bloque `if user.tenant_tier == "manufacturer":` que ya valida la propiedad del vehículo, añadir al final de ese bloque:

```python
    if user.tenant_tier == "manufacturer":
        if vehicle.manufacturer_tenant_id is None or str(vehicle.manufacturer_tenant_id) != str(user.tenant_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo puedes reasignar vehículos de tu fabricante",
            )
        mfr_tenant = await db.get(Tenant, user.tenant_id)
        if not mfr_tenant or not mfr_tenant.manufacturer_can_transfer_vehicles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="CMG no ha habilitado el traspaso de vehículos para este fabricante",
            )
```

- [ ] **Step 8: Ejecutar toda la suite de reasignación**

Run: `cd /opt/cmg-telematic1/backend && python3 -m pytest tests/api/test_vehicle_reassignment.py tests/api/test_vehicle_decommission.py -q`
Expected: todos PASS (los tests de fabricante existentes ya pasaban `_MockTenant` sin flag → AÑADIR `self.manufacturer_can_transfer_vehicles = True` en el `__init__` de `_MockTenant`, o setearlo en los tests de manufacturer que esperan 200: `test_manufacturer_reassigns_client_vehicle_200`. Actualízalos para setear el flag a True en el tenant del fabricante).

> Acción concreta: en `_MockTenant.__init__` añadir `self.manufacturer_can_transfer_vehicles = True` por defecto, de modo que los tests 200 existentes sigan pasando y solo el test del Step 5 (que lo pone a False explícitamente) dé 403.

- [ ] **Step 9: Commit**

```bash
git add backend/app/schemas/vehicle.py backend/app/api/v1/vehicles.py backend/tests/api/test_vehicle_reassignment.py
git commit -m "feat(vehicles): la cajita viaja con el camión + gate de traspaso del fabricante"
```

---

## Task 5: `/auth/me` devuelve los flags de autogestión

**Files:**
- Modify: `backend/app/api/v1/auth.py:231-241`
- Test: `backend/tests/api/test_manufacturer_self_service.py`

**Interfaces:**
- Produces: `GET /api/v1/auth/me` JSON con `manufacturer_can_manage_clients: bool`, `manufacturer_can_transfer_vehicles: bool` (además de los campos actuales).

- [ ] **Step 1: Escribir el test**

Añadir a `backend/tests/api/test_manufacturer_self_service.py`:

```python
def test_auth_me_returns_self_service_flags():
    mfr = _MfrTenant()
    mfr.manufacturer_can_manage_clients = True
    mfr.manufacturer_can_transfer_vehicles = False
    db = AsyncMock()
    db.get = AsyncMock(return_value=mfr)
    _setup(MFR_ADMIN, db)
    resp = TestClient(app, raise_server_exceptions=False).get("/api/v1/auth/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["manufacturer_can_manage_clients"] is True
    assert body["manufacturer_can_transfer_vehicles"] is False
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `cd /opt/cmg-telematic1/backend && python3 -m pytest tests/api/test_manufacturer_self_service.py::test_auth_me_returns_self_service_flags -xvs`
Expected: FAIL (KeyError — los flags no están en la respuesta).

- [ ] **Step 3: Ampliar /auth/me**

En `backend/app/api/v1/auth.py`, sustituir el cuerpo de `get_me`:

```python
@router.get("/me")
async def get_me(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, current_user.tenant_id)
    return {
        "tenant_id": str(current_user.tenant_id),
        "tier": current_user.tenant_tier,
        "enabled_modules": tenant.enabled_modules if tenant else [],
        "manufacturer_can_manage_clients": bool(getattr(tenant, "manufacturer_can_manage_clients", False)) if tenant else False,
        "manufacturer_can_transfer_vehicles": bool(getattr(tenant, "manufacturer_can_transfer_vehicles", False)) if tenant else False,
    }
```

(`Tenant` ya se importa en este fichero, pues el endpoint ya hacía `db.get(Tenant, ...)`.)

- [ ] **Step 4: Ejecutar y ver pasar**

Run: `cd /opt/cmg-telematic1/backend && python3 -m pytest tests/api/test_manufacturer_self_service.py -q`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/auth.py backend/tests/api/test_manufacturer_self_service.py
git commit -m "feat(auth): /auth/me expone flags de autogestión del fabricante"
```

---

## Task 6: Tipos frontend (flags, device en reassign, perfil)

**Files:**
- Modify: `frontend/src/lib/types.ts:117-134` (TenantOut), `:575-582` (TenantUpdate), `VehicleReassignOut`

**Interfaces:**
- Produces: campos TS para que las tareas 7-9 compilen.

- [ ] **Step 1: Añadir flags a TenantOut**

En `frontend/src/lib/types.ts`, dentro de `interface TenantOut`, antes de `created_at`:

```typescript
  manufacturer_can_view_operations: boolean
  manufacturer_can_view_can_data: boolean
  manufacturer_can_create_rules: boolean
  manufacturer_can_manage_clients: boolean
  manufacturer_can_transfer_vehicles: boolean
```

- [ ] **Step 2: Añadir flags a TenantUpdate**

En `interface TenantUpdate`:

```typescript
  manufacturer_can_view_operations?: boolean
  manufacturer_can_view_can_data?: boolean
  manufacturer_can_create_rules?: boolean
  manufacturer_can_manage_clients?: boolean
  manufacturer_can_transfer_vehicles?: boolean
```

- [ ] **Step 3: Añadir device a VehicleReassignOut**

Localiza `interface VehicleReassignOut` en `frontend/src/lib/types.ts` y añade:

```typescript
  device_moved: boolean
  device_imei: string | null
```

- [ ] **Step 4: Añadir tipo MyProfile**

Al final de `frontend/src/lib/types.ts`:

```typescript
export interface MyProfile {
  tenant_id: string
  tier: string
  enabled_modules: string[]
  manufacturer_can_manage_clients: boolean
  manufacturer_can_transfer_vehicles: boolean
}
```

- [ ] **Step 5: Verificar tipos**

Run: `cd /opt/cmg-telematic1/frontend && npx tsc -b`
Expected: EXIT 0 (puede haber errores en TenantFormPage/VehiclesPage si ya las tocaste; si es la primera tarea de tipos, debe compilar).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/types.ts
git commit -m "feat(types): flags de fabricante, device en reassign, MyProfile"
```

---

## Task 7: Hook `useMyProfile` + gating del menú "Mis clientes"

**Files:**
- Create: `frontend/src/lib/useMyProfile.ts`
- Modify: `frontend/src/shared/ui/TopNav.tsx:410-413` y bloque de "Operaciones" (~642-670)

**Interfaces:**
- Consumes: `MyProfile` (Task 6), `/auth/me` (Task 5).
- Produces: `useMyProfile(): { data?: MyProfile }`.

- [ ] **Step 1: Crear el hook**

Crear `frontend/src/lib/useMyProfile.ts`:

```typescript
import { useQuery } from '@tanstack/react-query'
import { apiClient } from './apiClient'
import { useAuthStore } from '../features/auth/useAuthStore'
import type { MyProfile } from './types'

// Perfil del usuario actual (incluye flags de autogestión del fabricante).
// Se usa para gatear menús/botones que el JWT no transporta.
export function useMyProfile() {
  const token = useAuthStore(s => s.accessToken)
  return useQuery<MyProfile>({
    queryKey: ['me'],
    queryFn: () => apiClient.get<MyProfile>('/api/v1/auth/me'),
    enabled: !!token,
    staleTime: 5 * 60_000,
  })
}
```

- [ ] **Step 2: Gatear "Mis clientes" por el flag**

En `frontend/src/shared/ui/TopNav.tsx`:

1. Importar el hook al principio:

```typescript
import { useMyProfile } from '../../lib/useMyProfile'
```

2. Dentro del componente, junto a `const isManufacturer = ...`:

```typescript
  const { data: profile } = useMyProfile()
  const mfrCanManageClients = profile?.manufacturer_can_manage_clients ?? false
```

3. En el bloque de "Operaciones", cambiar la condición que añade `MIS_CLIENTES_ITEM`:

```tsx
                    items={
                      (isManufacturer && isAdmin && mfrCanManageClients
                        ? [...visibleOperatorBase, MIS_CLIENTES_ITEM]
                        : visibleOperatorBase
                      ) as unknown as typeof CMG_ADMIN_ITEMS
                    }
```

- [ ] **Step 3: Verificar tipos**

Run: `cd /opt/cmg-telematic1/frontend && npx tsc -b`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/useMyProfile.ts frontend/src/shared/ui/TopNav.tsx
git commit -m "feat(nav): gatear 'Mis clientes' del fabricante por manage_clients"
```

---

## Task 8: Sección "Permisos del fabricante" en TenantFormPage

**Files:**
- Modify: `frontend/src/features/clientes/TenantFormPage.tsx`

**Interfaces:**
- Consumes: `TenantOut`/`TenantUpdate` flags (Task 6).

- [ ] **Step 1: Añadir estado de los 5 flags**

En `TenantFormPage.tsx`, junto al resto de `useState` del formulario (cerca de `businessCif`):

```tsx
  const [mfrViewOps, setMfrViewOps] = useState(tenant?.manufacturer_can_view_operations ?? true)
  const [mfrViewCan, setMfrViewCan] = useState(tenant?.manufacturer_can_view_can_data ?? true)
  const [mfrCreateRules, setMfrCreateRules] = useState(tenant?.manufacturer_can_create_rules ?? true)
  const [mfrManageClients, setMfrManageClients] = useState(tenant?.manufacturer_can_manage_clients ?? false)
  const [mfrTransferVehicles, setMfrTransferVehicles] = useState(tenant?.manufacturer_can_transfer_vehicles ?? false)
```

(Si el `useState` inicial no tiene acceso a `tenant` por orden de declaración, inicialízalos en el `useEffect` que ya rellena el formulario al cargar el tenant, replicando el patrón de `businessCif`.)

- [ ] **Step 2: Añadir la sección de checkboxes (solo fabricantes, en edición)**

En el JSX, después de la sección "Datos legales" (línea ~327), añadir:

```tsx
            {isEdit && tenant?.tier === 'manufacturer' && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Permisos del fabricante
                </div>
                {[
                  { label: 'Puede ver operaciones de sus máquinas', checked: mfrViewOps, set: setMfrViewOps },
                  { label: 'Puede ver datos CAN de sus máquinas', checked: mfrViewCan, set: setMfrViewCan },
                  { label: 'Puede crear reglas de alerta', checked: mfrCreateRules, set: setMfrCreateRules },
                  { label: 'Puede gestionar sus clientes', checked: mfrManageClients, set: setMfrManageClients },
                  { label: 'Puede traspasar vehículos a sus clientes', checked: mfrTransferVehicles, set: setMfrTransferVehicles },
                ].map(row => (
                  <label key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={row.checked} onChange={e => row.set(e.target.checked)} style={{ cursor: 'pointer' }} />
                    <span style={{ fontSize: 13, color: 'var(--fg-primary)' }}>{row.label}</span>
                  </label>
                ))}
              </div>
            )}
```

- [ ] **Step 3: Incluir los flags en el payload del PATCH**

En la llamada a `mutation.mutate({...} satisfies TenantUpdate)` (línea ~207), añadir los 5 campos solo si es fabricante:

```tsx
    mutation.mutate({
      name: name.trim(),
      slug: slug.trim(),
      active,
      enabled_modules: formModules,
      business_cif: businessCif.trim() || null,
      business_address: businessAddress.trim() || null,
      ...(tenant?.tier === 'manufacturer' ? {
        manufacturer_can_view_operations: mfrViewOps,
        manufacturer_can_view_can_data: mfrViewCan,
        manufacturer_can_create_rules: mfrCreateRules,
        manufacturer_can_manage_clients: mfrManageClients,
        manufacturer_can_transfer_vehicles: mfrTransferVehicles,
      } : {}),
    } satisfies TenantUpdate)
```

- [ ] **Step 4: Verificar tipos**

Run: `cd /opt/cmg-telematic1/frontend && npx tsc -b`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/clientes/TenantFormPage.tsx
git commit -m "feat(clientes): editar permisos del fabricante (5 flags) en TenantFormPage"
```

---

## Task 9: "Entregar/Traspasar" en VehiclesPage (renombrar + gate + resumen con cajita)

**Files:**
- Modify: `frontend/src/features/vehicles/VehiclesPage.tsx`

**Interfaces:**
- Consumes: `useMyProfile` (Task 7), `VehicleReassignOut.device_moved/device_imei` (Task 6).

- [ ] **Step 1: Importar y leer el flag**

En `VehiclesPage.tsx`, añadir import:

```tsx
import { useMyProfile } from '../../lib/useMyProfile'
```

Y dentro del componente, junto a los otros hooks:

```tsx
  const { data: profile } = useMyProfile()
  const mfrCanTransfer = profile?.manufacturer_can_transfer_vehicles ?? false
```

- [ ] **Step 2: Renombrar el botón y gatear para fabricante**

Localiza el botón "Reasignar" (texto `Reasignar`, ~línea 441 original / desplazada). Cambiar el texto a `Entregar / Traspasar` y la condición de visibilidad:

```tsx
                              {isAdmin && (userTier === 'cmg' || (userTier === 'manufacturer' && mfrCanTransfer && (v.manufacturer_tenant_id === userTenantId || v.tenant_id === userTenantId))) && (
                                <button
                                  onClick={() => openReassign(v)}
                                  style={{
                                    background: 'transparent',
                                    color: 'var(--accent-info)',
                                    border: '1px solid var(--accent-info)',
                                    borderRadius: 4,
                                    padding: '4px 10px',
                                    fontSize: 12,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Entregar / Traspasar
                                </button>
                              )}
```

- [ ] **Step 3: Cambiar el título del modal**

Localiza el título del modal de reasignación (texto `Reasignar vehículo`, ~línea 679) y cámbialo a:

```tsx
                Entregar / Traspasar vehículo
```

- [ ] **Step 4: Mostrar la cajita en el resumen de resultado**

En el bloque de resultado (`reassignResult ?`), tras la línea que muestra reglas/permisos, añadir:

```tsx
                  {reassignResult.device_moved && (
                    <span style={{ display: 'block', marginTop: 4 }}>
                      Cajita {reassignResult.device_imei} movida al nuevo dueño.
                    </span>
                  )}
                  <span style={{ display: 'block', marginTop: 4, color: 'var(--fg-muted)' }}>
                    El fabricante conserva acceso técnico al vehículo.
                  </span>
```

- [ ] **Step 5: Verificar tipos**

Run: `cd /opt/cmg-telematic1/frontend && npx tsc -b`
Expected: EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/vehicles/VehiclesPage.tsx
git commit -m "feat(vehicles): 'Entregar/Traspasar' con gate de fabricante y resumen de cajita"
```

---

## Task 10: Migración + despliegue a producción (requiere confirmación de Carlos)

**Files:** ninguno (operativa de deploy).

- [ ] **Step 1: Confirmación explícita**

Pedir a Carlos OK explícito para aplicar la migración 056 (recordar: pone los flags a `false` por defecto → un fabricante existente dejará de poder autogestionar hasta que CMG lo active).

- [ ] **Step 2: Build de imágenes**

```bash
cd /opt/cmg-telematic1 && docker-compose build core-api frontend
```
Expected: `Successfully built` para ambas.

- [ ] **Step 3: Aplicar la migración (additive, sin parar nada)**

```bash
cd /opt/cmg-telematic1 && docker-compose run --rm --no-deps core-api alembic -c /app/alembic.ini upgrade head
```
Expected: `Running upgrade 055 -> 056`.

- [ ] **Step 4: Verificar columnas en BD (SELECT, solo lectura)**

```bash
docker exec cmg-telematic1_postgres_1 sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -c '\\d tenant' " | grep manufacturer_can
```
Expected: aparecen las 5 columnas (3 antiguas + 2 nuevas).

- [ ] **Step 5: Swap core-api (recipe docker run)**

```bash
docker stop cmg-telematic1_core-api_1 && docker rm cmg-telematic1_core-api_1 && docker run -d --name cmg-telematic1_core-api_1 \
  --env-file /opt/cmg-telematic1/.env \
  -v cmg-telematic1_uploads_data:/app/uploads \
  --network cmg-telematic1_default --network-alias core-api \
  -p 127.0.0.1:8010:8010 \
  --restart unless-stopped cmg-telematic1_core-api
```
Expected: contenedor `Up`, logs "Application startup complete".

- [ ] **Step 6: Swap frontend (recipe docker run)**

```bash
docker stop cmg-telematic1_frontend_1 && docker rm cmg-telematic1_frontend_1 && docker run -d --name cmg-telematic1_frontend_1 \
  --network cmg-telematic1_default --network-alias frontend \
  --restart unless-stopped cmg-telematic1_frontend
```
Expected: contenedor `Up`; Caddy → frontend:3000 sirve el HTML.

- [ ] **Step 7: Verificación funcional**

- `GET /api/v1/auth/me` con token CMG → incluye los 2 flags.
- Editar un tenant fabricante en la UI → aparece "Permisos del fabricante" con 5 casillas.
- Activar `transfer_vehicles` y entregar un camión → el resumen indica que la cajita se movió.

---

## Self-Review (cobertura spec → tareas)

- Modelo "cajita viaja con el camión" → Task 4 (mueve `device.tenant_id`). ✅
- Flags separados `manage_clients` / `transfer_vehicles` → Task 1 (columnas), Task 3 (gate clientes), Task 4 (gate traspaso). ✅
- Default `false` → Task 1 (server_default false). ✅
- Interruptores en UI (CMG) → Task 8. ✅
- Autogestión fabricante (crear clientes / traspasar) → Task 3 + Task 7 (menú) + Task 9 (botón). ✅
- Recuperar vehículo (destino = flota del fabricante) → cubierto por la lógica de destinos existente en reassign (no requiere código nuevo; queda verificado en Step 7 funcional). ✅
- "Reasignar" → "Entregar/Traspasar" → Task 9. ✅
- `/auth/me` expone flags → Task 5. ✅
- Migración 056 + deploy con confirmación → Task 1 (crea) + Task 10 (aplica). ✅
- No-objetivos (fabricante no crea camiones ni monta cajitas; no se fusionan páginas) → respetado (ninguna tarea los añade). ✅
