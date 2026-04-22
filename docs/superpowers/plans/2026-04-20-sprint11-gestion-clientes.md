# Sprint 11 — Gestión de Clientes (Multi-Tenant) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full client management for CMG admins: create/edit tenants, manage their users, assign vehicles, configure permission grants, and apply white-label branding — plus extend `/settings` with user management for client admins.

**Architecture:** Backend adds tenant detail + user CRUD + vehicle assignment endpoints (all behind existing `require_tier`/`require_role` guards). Frontend adds `/clientes` section (CMG only) with 6 new components and extends `/settings` with a users section for client admins.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Pydantic v2 + React 18 + TanStack Query + inline CSS vars + Vitest/RTL

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/app/schemas/tenant.py` | Modify | Add `TenantUpdate` |
| `backend/app/schemas/user.py` | Create | `UserOut`, `UserCreate`, `UserUpdate` |
| `backend/app/schemas/vehicle.py` | Modify | Add `VehicleCreate` |
| `backend/app/api/v1/tenants.py` | Modify | GET/PUT /tenants/{id}, GET/POST /tenants/{id}/users, grantee_id filter on GET /grants |
| `backend/app/api/v1/users.py` | Create | PUT/DELETE /users/{id} |
| `backend/app/api/v1/vehicles.py` | Modify | POST /vehicles, tenant_id filter on GET /vehicles |
| `backend/app/api/v1/router.py` | Modify | Wire users_router |
| `tests/api/test_tenant_detail_api.py` | Create | Tenant detail + grants filter tests |
| `tests/api/test_users_api.py` | Create | User CRUD endpoint tests |
| `tests/api/test_vehicle_tenant_api.py` | Create | Vehicle tenant assignment tests |
| `frontend/src/lib/types.ts` | Modify | TenantCreate, TenantUpdate, UserOut, UserCreate, UserUpdate, GrantOut, GrantCreate, VehicleCreate |
| `frontend/src/lib/queryKeys.ts` | Modify | cliente, clienteUsers, clienteVehicles, clienteGrants |
| `frontend/src/shared/ui/icons.tsx` | Modify | IconClientes |
| `frontend/src/shared/ui/Sidebar.tsx` | Modify | Clientes entry gated on tenant_tier=cmg |
| `frontend/src/App.tsx` | Modify | Lazy routes for /clientes/** |
| `frontend/src/features/clientes/TenantsPage.tsx` | Create | Table of clients with active badge |
| `frontend/src/features/clientes/TenantFormPage.tsx` | Create | Create/edit client form |
| `frontend/src/features/clientes/TenantDetailPage.tsx` | Create | 5-section detail page |
| `frontend/src/features/clientes/UserFormModal.tsx` | Create | Create/edit user modal |
| `frontend/src/features/clientes/GrantsSection.tsx` | Create | Grants list + add predefined + revoke |
| `frontend/src/features/clientes/BrandTokensEditor.tsx` | Create | Color/logo/name editor with live preview |
| `frontend/src/features/settings/UsersSection.tsx` | Create | User table for client admins |
| `frontend/src/features/settings/SettingsPage.tsx` | Modify | Add UsersSection for role=admin |
| `frontend/src/features/clientes/__tests__/*.test.tsx` | Create | 6 test files |

---

### Task 1: Backend — TenantUpdate schema + tenant detail endpoints + grants filter

**Files:**
- Modify: `backend/app/schemas/tenant.py`
- Modify: `backend/app/api/v1/tenants.py`
- Create: `tests/api/test_tenant_detail_api.py`

- [ ] **Step 1: Write failing tests**

Create `tests/api/test_tenant_detail_api.py`:

```python
import uuid
import pytest
from sqlalchemy import select


async def _cmg_tenant_id(db) -> str:
    from app.models.tenant import Tenant
    result = await db.execute(select(Tenant).where(Tenant.tier == "cmg"))
    return str(result.scalar_one().id)


async def _create_client_tenant(db, cmg_id: str):
    from app.models.tenant import Tenant
    t = Tenant(
        parent_id=uuid.UUID(cmg_id),
        tier="client",
        name="Wasterent Test",
        slug=f"wasterent-{uuid.uuid4().hex[:8]}",
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


async def _create_client_admin_token(db, tenant_id: uuid.UUID, client) -> str:
    from app.models.user import User
    from app.core.security import hash_password
    email = f"admin-{uuid.uuid4().hex[:8]}@wasterent.com"
    u = User(
        tenant_id=tenant_id,
        email=email,
        hashed_password=hash_password("Test1234!"),
        full_name="Admin Wasterent",
        role="admin",
    )
    db.add(u)
    await db.commit()
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": "Test1234!"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


async def test_get_tenant_detail_cmg_admin(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    resp = await client.get(
        f"/api/v1/tenants/{tenant.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == str(tenant.id)
    assert resp.json()["name"] == "Wasterent Test"


async def test_get_tenant_detail_own_admin(client, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    token = await _create_client_admin_token(db, tenant.id, client)
    resp = await client.get(
        f"/api/v1/tenants/{tenant.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200


async def test_get_tenant_detail_foreign_admin_404(client, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    other = await _create_client_tenant(db, cmg_id)
    token = await _create_client_admin_token(db, other.id, client)
    resp = await client.get(
        f"/api/v1/tenants/{tenant.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


async def test_update_tenant_cmg_admin(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    resp = await client.put(
        f"/api/v1/tenants/{tenant.id}",
        json={"name": "Wasterent Renombrado"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Wasterent Renombrado"


async def test_update_tenant_client_admin_forbidden(client, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    token = await _create_client_admin_token(db, tenant.id, client)
    resp = await client.put(
        f"/api/v1/tenants/{tenant.id}",
        json={"name": "Intento"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


async def test_list_grants_grantee_filter(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    await client.post(
        "/api/v1/grants",
        json={"grantee_id": str(tenant.id), "resource_type": "maintenance", "allowed_actions": ["log"]},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    resp = await client.get(
        f"/api/v1/grants?grantee_id={tenant.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert all(g["grantee_id"] == str(tenant.id) for g in resp.json())
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /opt/cmg-telematic1 && python -m pytest tests/api/test_tenant_detail_api.py -v 2>&1 | tail -20
```
Expected: 6 FAILED (endpoints don't exist yet)

- [ ] **Step 3: Add TenantUpdate schema to backend/app/schemas/tenant.py**

After the existing `TenantCreate` class, add:

```python
class TenantUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
    active: bool | None = None
```

- [ ] **Step 4: Add GET/PUT /tenants/{id} endpoints and grantee_id filter**

In `backend/app/api/v1/tenants.py`:

**4a.** Add `Query` to the fastapi import on line 3:
```python
from fastapi import APIRouter, Depends, HTTPException, Query, status
```

**4b.** Add `TenantUpdate` to the schema import on line 10:
```python
from app.schemas.tenant import TenantOut, TenantCreate, TenantUpdate, BrandTokensUpdate, GrantOut, GrantCreate
```

**4c.** After the `create_tenant` endpoint (after line 75), add:

```python
@router.get("/tenants/{tenant_id}", response_model=TenantOut)
async def get_tenant(
    tenant_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    if user.tenant_tier != "cmg" and str(tenant.id) != str(user.tenant_id):
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return tenant


@router.put("/tenants/{tenant_id}", response_model=TenantOut)
async def update_tenant(
    tenant_id: uuid.UUID,
    body: TenantUpdate,
    user: CurrentUser = Depends(require_tier("cmg")),
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    if body.name is not None:
        tenant.name = body.name
    if body.slug is not None:
        tenant.slug = body.slug
    if body.active is not None:
        tenant.active = body.active
    await db.commit()
    await db.refresh(tenant)
    return tenant
```

**4d.** Replace the existing `list_grants` function (lines 109–126) with:

```python
@router.get("/grants", response_model=list[GrantOut])
async def list_grants(
    grantee_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(PermissionGrant).where(PermissionGrant.active == True)
    if user.tenant_tier != "cmg":
        query = query.where(
            or_(
                PermissionGrant.grantor_id == user.tenant_id,
                PermissionGrant.grantee_id == user.tenant_id,
            )
        )
    if grantee_id is not None:
        query = query.where(PermissionGrant.grantee_id == grantee_id)
    result = await db.execute(query)
    return result.scalars().all()
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /opt/cmg-telematic1 && python -m pytest tests/api/test_tenant_detail_api.py -v
```
Expected: 6/6 PASSED

- [ ] **Step 6: Run full suite — no regressions**

```bash
cd /opt/cmg-telematic1 && python -m pytest tests/ -q 2>&1 | tail -5
```
Expected: all passing

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/tenant.py backend/app/api/v1/tenants.py tests/api/test_tenant_detail_api.py
git commit -m "feat: TenantUpdate schema + GET/PUT /tenants/:id + grantee_id filter on GET /grants"
```

---

### Task 2: Backend — User schemas + user management endpoints

**Files:**
- Create: `backend/app/schemas/user.py`
- Create: `backend/app/api/v1/users.py`
- Modify: `backend/app/api/v1/tenants.py` — add GET/POST /tenants/{id}/users
- Modify: `backend/app/api/v1/router.py` — wire users_router
- Create: `tests/api/test_users_api.py`

- [ ] **Step 1: Write failing tests**

Create `tests/api/test_users_api.py`:

```python
import uuid
import pytest
from sqlalchemy import select


async def _cmg_tenant_id(db) -> str:
    from app.models.tenant import Tenant
    result = await db.execute(select(Tenant).where(Tenant.tier == "cmg"))
    return str(result.scalar_one().id)


async def _create_client_tenant(db, cmg_id: str):
    from app.models.tenant import Tenant
    t = Tenant(
        parent_id=uuid.UUID(cmg_id),
        tier="client",
        name="Wasterent Users",
        slug=f"wasterent-u-{uuid.uuid4().hex[:8]}",
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


async def _create_client_admin(db, tenant_id: uuid.UUID, client):
    from app.models.user import User
    from app.core.security import hash_password
    email = f"admin-{uuid.uuid4().hex[:8]}@wasterent.com"
    u = User(
        tenant_id=tenant_id,
        email=email,
        hashed_password=hash_password("Test1234!"),
        full_name="Admin Wasterent",
        role="admin",
    )
    db.add(u)
    await db.commit()
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": "Test1234!"})
    assert resp.status_code == 200
    return str(u.id), resp.json()["access_token"]


async def test_create_user_cmg_admin(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    resp = await client.post(
        f"/api/v1/tenants/{tenant.id}/users",
        json={
            "email": f"new-{uuid.uuid4().hex[:8]}@wasterent.com",
            "full_name": "Nuevo Usuario",
            "role": "operator",
            "password": "Pass1234!",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["role"] == "operator"
    assert data["active"] is True
    assert "password" not in data
    assert "hashed_password" not in data


async def test_create_user_own_admin(client, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    _, token = await _create_client_admin(db, tenant.id, client)
    resp = await client.post(
        f"/api/v1/tenants/{tenant.id}/users",
        json={
            "email": f"op-{uuid.uuid4().hex[:8]}@wasterent.com",
            "full_name": "Operador",
            "role": "operator",
            "password": "Pass1234!",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201


async def test_create_user_foreign_admin_forbidden(client, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant_a = await _create_client_tenant(db, cmg_id)
    tenant_b = await _create_client_tenant(db, cmg_id)
    _, token_b = await _create_client_admin(db, tenant_b.id, client)
    resp = await client.post(
        f"/api/v1/tenants/{tenant_a.id}/users",
        json={
            "email": f"x-{uuid.uuid4().hex[:8]}@test.com",
            "full_name": "Intruso",
            "role": "viewer",
            "password": "Pass1234!",
        },
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert resp.status_code == 403


async def test_list_users_in_tenant(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    await _create_client_admin(db, tenant.id, client)
    resp = await client.get(
        f"/api/v1/tenants/{tenant.id}/users",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


async def test_update_user_role(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    user_id, _ = await _create_client_admin(db, tenant.id, client)
    resp = await client.put(
        f"/api/v1/users/{user_id}",
        json={"role": "viewer"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "viewer"


async def test_deactivate_user_soft_delete(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    user_id, _ = await _create_client_admin(db, tenant.id, client)
    resp = await client.delete(
        f"/api/v1/users/{user_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 204
    from app.models.user import User
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    u = result.scalar_one()
    assert u.active is False
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /opt/cmg-telematic1 && python -m pytest tests/api/test_users_api.py -v 2>&1 | tail -20
```
Expected: 6 FAILED

- [ ] **Step 3: Create backend/app/schemas/user.py**

```python
import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    tenant_id: uuid.UUID
    email: str
    full_name: str
    role: Literal['admin', 'operator', 'viewer', 'driver']
    active: bool
    created_at: datetime


class UserCreate(BaseModel):
    email: str
    full_name: str
    role: Literal['admin', 'operator', 'viewer', 'driver'] = 'operator'
    password: str


class UserUpdate(BaseModel):
    full_name: str | None = None
    role: Literal['admin', 'operator', 'viewer', 'driver'] | None = None
    active: bool | None = None
```

- [ ] **Step 4: Create backend/app/api/v1/users.py**

```python
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.schemas.user import UserOut, UserUpdate
from app.models.user import User

router = APIRouter(tags=["users"])


def _check_user_access(target: User, current: CurrentUser) -> None:
    if current.tenant_tier == "cmg":
        return
    if current.role != "admin" or str(target.tenant_id) != str(current.tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sin permiso")


@router.put("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID,
    body: UserUpdate,
    current: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    _check_user_access(user, current)
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.role is not None:
        user.role = body.role
    if body.active is not None:
        user.active = body.active
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=204)
async def deactivate_user(
    user_id: uuid.UUID,
    current: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    _check_user_access(user, current)
    user.active = False
    await db.commit()
```

- [ ] **Step 5: Add GET/POST /tenants/{id}/users to tenants.py**

In `backend/app/api/v1/tenants.py`, add imports after the existing import block:

```python
from sqlalchemy import select, or_  # already imported
# Add to imports:
from app.schemas.user import UserOut, UserCreate
from app.models.user import User
from app.core.security import hash_password
```

Then add these two endpoints at the end of the file:

```python
@router.get("/tenants/{tenant_id}/users", response_model=list[UserOut])
async def list_tenant_users(
    tenant_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" and (
        user.role != "admin" or str(user.tenant_id) != str(tenant_id)
    ):
        raise HTTPException(status_code=403, detail="Sin permiso")
    result = await db.execute(
        select(User).where(User.tenant_id == tenant_id).order_by(User.email)
    )
    return result.scalars().all()


@router.post("/tenants/{tenant_id}/users", response_model=UserOut, status_code=201)
async def create_tenant_user(
    tenant_id: uuid.UUID,
    body: UserCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" and (
        user.role != "admin" or str(user.tenant_id) != str(tenant_id)
    ):
        raise HTTPException(status_code=403, detail="Sin permiso")
    tenant = await db.get(Tenant, tenant_id)
    if not tenant or not tenant.active:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    new_user = User(
        tenant_id=tenant_id,
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        role=body.role,
    )
    db.add(new_user)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Email ya registrado")
    await db.refresh(new_user)
    return new_user
```

- [ ] **Step 6: Wire users_router in router.py**

In `backend/app/api/v1/router.py`:

```python
from app.api.v1.users import router as users_router
# ...
api_router.include_router(users_router)
```

- [ ] **Step 7: Run tests**

```bash
cd /opt/cmg-telematic1 && python -m pytest tests/api/test_users_api.py -v
```
Expected: 6/6 PASSED

- [ ] **Step 8: Run full suite**

```bash
cd /opt/cmg-telematic1 && python -m pytest tests/ -q 2>&1 | tail -5
```
Expected: all passing

- [ ] **Step 9: Commit**

```bash
git add backend/app/schemas/user.py backend/app/api/v1/users.py backend/app/api/v1/tenants.py backend/app/api/v1/router.py tests/api/test_users_api.py
git commit -m "feat: user schemas + GET/POST /tenants/:id/users + PUT/DELETE /users/:id"
```

---

### Task 3: Backend — VehicleCreate + POST /vehicles + tenant_id filter

**Files:**
- Modify: `backend/app/schemas/vehicle.py`
- Modify: `backend/app/api/v1/vehicles.py`
- Create: `tests/api/test_vehicle_tenant_api.py`

- [ ] **Step 1: Write failing tests**

Create `tests/api/test_vehicle_tenant_api.py`:

```python
import uuid
import pytest
from sqlalchemy import select


async def _cmg_tenant_id(db) -> str:
    from app.models.tenant import Tenant
    result = await db.execute(select(Tenant).where(Tenant.tier == "cmg"))
    return str(result.scalar_one().id)


async def _first_vtype_id(client, token: str) -> str:
    resp = await client.get("/api/v1/vehicle-types", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    return resp.json()[0]["id"]


async def _create_client_tenant(db, cmg_id: str):
    from app.models.tenant import Tenant
    t = Tenant(
        parent_id=uuid.UUID(cmg_id),
        tier="client",
        name="Wasterent Vehicles",
        slug=f"wasterent-v-{uuid.uuid4().hex[:8]}",
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


async def _create_client_admin_token(db, tenant_id: uuid.UUID, client) -> str:
    from app.models.user import User
    from app.core.security import hash_password
    email = f"admin-v-{uuid.uuid4().hex[:8]}@wasterent.com"
    u = User(
        tenant_id=tenant_id,
        email=email,
        hashed_password=hash_password("Test1234!"),
        full_name="Admin",
        role="admin",
    )
    db.add(u)
    await db.commit()
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": "Test1234!"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


async def test_create_vehicle_cmg_for_client(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    vtype_id = await _first_vtype_id(client, admin_token)
    resp = await client.post(
        "/api/v1/vehicles",
        json={"vehicle_type_id": vtype_id, "name": "Cisterna 01", "tenant_id": str(tenant.id)},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201
    assert resp.json()["tenant_id"] == str(tenant.id)


async def test_create_vehicle_client_admin_own_tenant(client, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    token = await _create_client_admin_token(db, tenant.id, client)
    vtype_id = await _first_vtype_id(client, token)
    resp = await client.post(
        "/api/v1/vehicles",
        json={"vehicle_type_id": vtype_id, "name": "Barredora 01"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    assert resp.json()["tenant_id"] == str(tenant.id)


async def test_create_vehicle_client_cannot_override_tenant(client, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant_a = await _create_client_tenant(db, cmg_id)
    tenant_b = await _create_client_tenant(db, cmg_id)
    token_a = await _create_client_admin_token(db, tenant_a.id, client)
    vtype_id = await _first_vtype_id(client, token_a)
    resp = await client.post(
        "/api/v1/vehicles",
        json={"vehicle_type_id": vtype_id, "name": "Intento", "tenant_id": str(tenant_b.id)},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert resp.status_code == 201
    assert resp.json()["tenant_id"] == str(tenant_a.id)


async def test_list_vehicles_tenant_filter(client, admin_token, db):
    cmg_id = await _cmg_tenant_id(db)
    tenant = await _create_client_tenant(db, cmg_id)
    vtype_id = await _first_vtype_id(client, admin_token)
    await client.post(
        "/api/v1/vehicles",
        json={"vehicle_type_id": vtype_id, "name": "Filtro Test", "tenant_id": str(tenant.id)},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    resp = await client.get(
        f"/api/v1/vehicles?tenant_id={tenant.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    vehicles = resp.json()
    assert len(vehicles) >= 1
    assert all(v["tenant_id"] == str(tenant.id) for v in vehicles)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /opt/cmg-telematic1 && python -m pytest tests/api/test_vehicle_tenant_api.py -v 2>&1 | tail -20
```
Expected: 4 FAILED

- [ ] **Step 3: Add VehicleCreate schema**

In `backend/app/schemas/vehicle.py`, add after the existing `VehicleOut` class:

```python
class VehicleCreate(BaseModel):
    vehicle_type_id: uuid.UUID
    name: str
    license_plate: str | None = None
    vin: str | None = None
    year: int | None = None
    tenant_id: uuid.UUID | None = None
```

- [ ] **Step 4: Add POST /vehicles and tenant_id filter to GET /vehicles**

In `backend/app/api/v1/vehicles.py`:

**4a.** Add `Query` to the fastapi import:
```python
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
```

**4b.** Add `VehicleCreate` to schema import:
```python
from app.schemas.vehicle import (
    VehicleTypeOut, VehicleOut, VehicleCreate, VehicleStatus,
    TelemetryPoint, TrackPoint, KpiHour,
)
```

**4c.** Replace the existing `list_vehicles` function (lines 42–51) with:

```python
@router.get("/vehicles", response_model=list[VehicleOut])
async def list_vehicles(
    tenant_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Vehicle).where(Vehicle.active == True)
    if user.tenant_tier != "cmg":
        query = query.where(Vehicle.tenant_id == user.tenant_id)
    elif tenant_id is not None:
        query = query.where(Vehicle.tenant_id == tenant_id)
    result = await db.execute(query.order_by(Vehicle.name))
    return result.scalars().all()
```

**4d.** Add `POST /vehicles` after the `list_vehicles` function:

```python
@router.post("/vehicles", response_model=VehicleOut, status_code=201)
async def create_vehicle(
    body: VehicleCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Se requiere rol admin")
    effective_tenant_id = (
        body.tenant_id
        if (body.tenant_id is not None and user.tenant_tier == "cmg")
        else uuid.UUID(str(user.tenant_id))
    )
    vtype = await db.get(VehicleType, body.vehicle_type_id)
    if not vtype:
        raise HTTPException(status_code=404, detail="Tipo de vehículo no encontrado")
    vehicle = Vehicle(
        tenant_id=effective_tenant_id,
        vehicle_type_id=body.vehicle_type_id,
        name=body.name,
        license_plate=body.license_plate,
        vin=body.vin,
        year=body.year,
    )
    db.add(vehicle)
    await db.commit()
    await db.refresh(vehicle)
    return vehicle
```

- [ ] **Step 5: Run tests**

```bash
cd /opt/cmg-telematic1 && python -m pytest tests/api/test_vehicle_tenant_api.py -v
```
Expected: 4/4 PASSED

- [ ] **Step 6: Run full suite**

```bash
cd /opt/cmg-telematic1 && python -m pytest tests/ -q 2>&1 | tail -5
```
Expected: all passing

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/vehicle.py backend/app/api/v1/vehicles.py tests/api/test_vehicle_tenant_api.py
git commit -m "feat: VehicleCreate + POST /vehicles + tenant_id filter for GET /vehicles"
```

---

### Task 4: Frontend — Types + query keys

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/queryKeys.ts`

- [ ] **Step 1: Append new types to frontend/src/lib/types.ts**

Add at the end of the file:

```typescript
export interface TenantCreate {
  parent_id: string
  tier: 'client'
  name: string
  slug: string
}

export interface TenantUpdate {
  name?: string
  slug?: string
  active?: boolean
}

export interface UserOut {
  id: string
  tenant_id: string
  email: string
  full_name: string
  role: 'admin' | 'operator' | 'viewer' | 'driver'
  active: boolean
  created_at: string
}

export interface UserCreate {
  email: string
  full_name: string
  role: 'admin' | 'operator' | 'viewer' | 'driver'
  password: string
}

export interface UserUpdate {
  full_name?: string
  role?: 'admin' | 'operator' | 'viewer' | 'driver'
  active?: boolean
}

export interface GrantOut {
  id: string
  grantor_id: string
  grantee_id: string
  resource_type: string
  resource_id: string | null
  allowed_actions: string[]
  constraints: Record<string, unknown> | null
  granted_at: string
  expires_at: string | null
  active: boolean
}

export interface GrantCreate {
  grantee_id: string
  resource_type: string
  resource_id?: string | null
  allowed_actions: string[]
  constraints?: Record<string, unknown> | null
  expires_at?: string | null
}

export interface VehicleCreate {
  vehicle_type_id: string
  name: string
  license_plate?: string | null
  vin?: string | null
  year?: number | null
  tenant_id?: string | null
}
```

- [ ] **Step 2: Add query keys to frontend/src/lib/queryKeys.ts**

Add inside the `keys` object (after the last `maintenanceLogs` line, before the closing `}`):

```typescript
cliente: (id: string) => ['tenants', id] as const,
clienteUsers: (id: string) => ['tenants', id, 'users'] as const,
clienteVehicles: (id: string) => ['tenants', id, 'vehicles'] as const,
clienteGrants: (id: string) => ['tenants', id, 'grants'] as const,
```

- [ ] **Step 3: Type-check**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/queryKeys.ts
git commit -m "feat: frontend types + query keys for sprint 11 clientes"
```

---

### Task 5: Frontend — Sidebar + App routing + TenantsPage

**Files:**
- Modify: `frontend/src/shared/ui/icons.tsx`
- Modify: `frontend/src/shared/ui/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/features/clientes/TenantsPage.tsx`

- [ ] **Step 1: Add IconClientes to icons.tsx**

At the end of `frontend/src/shared/ui/icons.tsx`, add:

```tsx
export function IconClientes(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </Icon>
  )
}
```

- [ ] **Step 2: Update Sidebar.tsx**

In `frontend/src/shared/ui/Sidebar.tsx`:

**2a.** Add `IconClientes` to the import:
```tsx
import { IconFlota, IconAlertas, IconReglas, IconMantenimiento, IconAjustes, IconClientes } from './icons'
```

**2b.** After `const isAdmin = user?.role === 'admin'`, add:
```tsx
const isCmg = user?.tenant_tier === 'cmg'
```

**2c.** After the `{NAV_ITEMS.map(...)}` block (before `<div style={{ marginTop: 'auto' }}`), add:
```tsx
{isCmg && (
  <NavLink
    to="/clientes"
    title="Clientes"
    style={({ isActive }) => ({
      width: 36, height: 36,
      borderRadius: 8,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: isActive ? 'var(--accent-energy)' : 'var(--text-muted)',
      background: isActive ? 'rgba(249,115,22,0.15)' : 'transparent',
      transition: 'background 0.15s, color 0.15s',
    })}
  >
    <IconClientes width={20} height={20}/>
  </NavLink>
)}
```

- [ ] **Step 3: Add routes to App.tsx**

**3a.** Add lazy imports after the `MaintenancePlanDetailPage` import:
```tsx
const TenantsPage      = lazy(() => import('./features/clientes/TenantsPage'))
const TenantFormPage   = lazy(() => import('./features/clientes/TenantFormPage'))
const TenantDetailPage = lazy(() => import('./features/clientes/TenantDetailPage'))
```

**3b.** Add routes inside the inner `<Routes>` block, before the `path="*"` catch-all:
```tsx
<Route path="clientes"          element={<TenantsPage />} />
<Route path="clientes/new"      element={<TenantFormPage />} />
<Route path="clientes/:id"      element={<TenantDetailPage />} />
<Route path="clientes/:id/edit" element={<TenantFormPage />} />
```

- [ ] **Step 4: Create TenantsPage.tsx**

Create `frontend/src/features/clientes/TenantsPage.tsx`:

```tsx
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { TenantOut } from '../../lib/types'

export default function TenantsPage() {
  const { data: tenants = [], isLoading } = useQuery({
    queryKey: keys.tenants(),
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants'),
  })

  const clients = tenants.filter(t => t.tier !== 'cmg')

  return (
    <Shell title="Clientes">
      <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 20, fontWeight: 600 }}>
            Clientes
          </h2>
          <Link
            to="/clientes/new"
            style={{
              background: 'var(--accent-energy)', color: '#fff',
              borderRadius: 6, padding: '8px 16px', fontSize: 14,
              fontWeight: 500, textDecoration: 'none',
            }}
          >
            + Nuevo cliente
          </Link>
        </div>

        {isLoading ? (
          <p style={{ color: 'var(--text-muted)' }}>Cargando...</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
                {['Nombre', 'Slug', 'Estado', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontSize: 12, fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map(tenant => (
                <tr key={tenant.id} style={{ borderBottom: '1px solid var(--bg-border)' }}>
                  <td style={{ padding: '10px 12px', color: 'var(--text-primary)', fontSize: 14 }}>{tenant.name}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontFamily: 'var(--font-data)', fontSize: 13 }}>{tenant.slug}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12,
                      background: tenant.active ? 'rgba(34,197,94,0.15)' : 'rgba(120,113,108,0.15)',
                      color: tenant.active ? 'var(--accent-ok)' : 'var(--accent-off)',
                    }}>
                      {tenant.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <Link to={`/clientes/${tenant.id}`} style={{ color: 'var(--accent-energy)', fontSize: 13, textDecoration: 'none' }}>
                      Ver detalle →
                    </Link>
                  </td>
                </tr>
              ))}
              {clients.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: '16px 12px', color: 'var(--text-muted)', fontSize: 13 }}>
                    Sin clientes. Crea el primero con "+ Nuevo cliente".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  )
}
```

- [ ] **Step 5: Type-check and commit**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -20
```

```bash
git add frontend/src/shared/ui/icons.tsx frontend/src/shared/ui/Sidebar.tsx frontend/src/App.tsx frontend/src/features/clientes/TenantsPage.tsx
git commit -m "feat: Clientes sidebar entry + routing + TenantsPage"
```

---

### Task 6: Frontend — TenantFormPage

**Files:**
- Create: `frontend/src/features/clientes/TenantFormPage.tsx`

- [ ] **Step 1: Create TenantFormPage.tsx**

Create `frontend/src/features/clientes/TenantFormPage.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import type { TenantOut, TenantCreate, TenantUpdate } from '../../lib/types'

export default function TenantFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [active, setActive] = useState(true)

  const { data: tenant } = useQuery({
    queryKey: keys.cliente(id!),
    queryFn: () => apiClient.get<TenantOut>(`/api/v1/tenants/${id}`),
    enabled: isEdit,
  })

  useEffect(() => {
    if (tenant) {
      setName(tenant.name)
      setSlug(tenant.slug)
      setActive(tenant.active)
    }
  }, [tenant])

  const mutation = useMutation({
    mutationFn: (payload: TenantCreate | TenantUpdate) =>
      isEdit
        ? apiClient.put<TenantOut>(`/api/v1/tenants/${id}`, payload)
        : apiClient.post<TenantOut>('/api/v1/tenants', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.tenants() })
      if (isEdit) qc.invalidateQueries({ queryKey: keys.cliente(id!) })
      navigate('/clientes')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isEdit) {
      mutation.mutate({ name: name.trim(), slug: slug.trim(), active } satisfies TenantUpdate)
    } else {
      mutation.mutate({
        parent_id: user!.tenant_id,
        tier: 'client',
        name: name.trim(),
        slug: slug.trim(),
      } satisfies TenantCreate)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', background: 'var(--bg-elevated)',
    border: '1px solid var(--bg-border)', borderRadius: 6,
    color: 'var(--text-primary)', fontSize: 14, boxSizing: 'border-box',
  }

  return (
    <Shell title={isEdit ? 'Editar cliente' : 'Nuevo cliente'}>
      <div style={{ padding: 24, maxWidth: 480 }}>
        <h2 style={{ margin: '0 0 24px', color: 'var(--text-primary)', fontSize: 20, fontWeight: 600 }}>
          {isEdit ? 'Editar cliente' : 'Nuevo cliente'}
        </h2>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Nombre</span>
            <input value={name} onChange={e => setName(e.target.value)} required style={inputStyle} />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Slug (identificador único)</span>
            <input
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              required
              style={{ ...inputStyle, fontFamily: 'var(--font-data)' }}
            />
          </label>

          {isEdit && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
              <span style={{ color: 'var(--text-primary)', fontSize: 14 }}>Activo</span>
            </label>
          )}

          {mutation.isError && (
            <p style={{ color: 'var(--accent-crit)', fontSize: 13, margin: 0 }}>
              Error al guardar. Verifica que el slug sea único.
            </p>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <button
              type="submit"
              disabled={mutation.isPending}
              style={{
                background: 'var(--accent-energy)', color: '#fff', border: 'none',
                borderRadius: 6, padding: '9px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer',
              }}
            >
              {mutation.isPending ? 'Guardando...' : 'Guardar'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/clientes')}
              style={{
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--bg-border)', borderRadius: 6,
                padding: '9px 20px', fontSize: 14, cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </Shell>
  )
}
```

- [ ] **Step 2: Type-check and commit**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -20
```

```bash
git add frontend/src/features/clientes/TenantFormPage.tsx
git commit -m "feat: TenantFormPage — crear/editar cliente con nombre, slug, activo"
```

---

### Task 7: Frontend — UserFormModal + GrantsSection + BrandTokensEditor

**Files:**
- Create: `frontend/src/features/clientes/UserFormModal.tsx`
- Create: `frontend/src/features/clientes/GrantsSection.tsx`
- Create: `frontend/src/features/clientes/BrandTokensEditor.tsx`

- [ ] **Step 1: Create UserFormModal.tsx**

Create `frontend/src/features/clientes/UserFormModal.tsx`:

```tsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { UserOut, UserCreate, UserUpdate } from '../../lib/types'

interface Props {
  tenantId: string
  user?: UserOut
  onClose: () => void
}

export default function UserFormModal({ tenantId, user, onClose }: Props) {
  const isEdit = !!user
  const qc = useQueryClient()

  const [email, setEmail] = useState(user?.email ?? '')
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [role, setRole] = useState<UserOut['role']>(user?.role ?? 'operator')
  const [password, setPassword] = useState('')

  const mutation = useMutation({
    mutationFn: (payload: UserCreate | UserUpdate) =>
      isEdit
        ? apiClient.put<UserOut>(`/api/v1/users/${user!.id}`, payload)
        : apiClient.post<UserOut>(`/api/v1/tenants/${tenantId}/users`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.clienteUsers(tenantId) })
      onClose()
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isEdit) {
      mutation.mutate({ full_name: fullName, role } satisfies UserUpdate)
    } else {
      mutation.mutate({ email, full_name: fullName, role, password } satisfies UserCreate)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', background: 'var(--bg-base)',
    border: '1px solid var(--bg-border)', borderRadius: 6,
    color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: 'var(--bg-surface)', borderRadius: 10, padding: 24,
        width: 400, border: '1px solid var(--bg-border)',
      }}>
        <h3 style={{ margin: '0 0 20px', color: 'var(--text-primary)', fontSize: 16, fontWeight: 600 }}>
          {isEdit ? 'Editar usuario' : 'Nuevo usuario'}
        </h3>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!isEdit && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Email</span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required style={inputStyle} />
            </label>
          )}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Nombre completo</span>
            <input value={fullName} onChange={e => setFullName(e.target.value)} required style={inputStyle} />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Rol</span>
            <select value={role} onChange={e => setRole(e.target.value as UserOut['role'])} style={inputStyle}>
              <option value="admin">Admin</option>
              <option value="operator">Operador</option>
              <option value="viewer">Viewer</option>
              <option value="driver">Conductor</option>
            </select>
          </label>

          {!isEdit && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Contraseña</span>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                style={inputStyle}
              />
            </label>
          )}

          {mutation.isError && (
            <p style={{ color: 'var(--accent-crit)', fontSize: 12, margin: 0 }}>Error al guardar.</p>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button
              type="submit"
              disabled={mutation.isPending}
              style={{
                flex: 1, background: 'var(--accent-energy)', color: '#fff',
                border: 'none', borderRadius: 6, padding: '8px 0', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              }}
            >
              {mutation.isPending ? 'Guardando...' : 'Guardar'}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1, background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--bg-border)', borderRadius: 6, padding: '8px 0', fontSize: 13, cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create GrantsSection.tsx**

Create `frontend/src/features/clientes/GrantsSection.tsx`:

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { GrantOut, GrantCreate } from '../../lib/types'

const GRANT_TYPES = [
  { resource_type: 'maintenance', label: 'Registrar intervenciones de mantenimiento', allowed_actions: ['log'] },
  { resource_type: 'vehicles', label: 'Ver datos CAN (campos visibles)', allowed_actions: ['view'] },
]

interface Props { tenantId: string }

export default function GrantsSection({ tenantId }: Props) {
  const qc = useQueryClient()
  const [selectedIdx, setSelectedIdx] = useState(0)

  const { data: grants = [] } = useQuery({
    queryKey: keys.clienteGrants(tenantId),
    queryFn: () => apiClient.get<GrantOut[]>(`/api/v1/grants?grantee_id=${tenantId}`),
  })

  const createMutation = useMutation({
    mutationFn: (payload: GrantCreate) => apiClient.post<GrantOut>('/api/v1/grants', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.clienteGrants(tenantId) }),
  })

  const revokeMutation = useMutation({
    mutationFn: (grantId: string) => apiClient.delete(`/api/v1/grants/${grantId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.clienteGrants(tenantId) }),
  })

  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
            {['Tipo', 'Acciones', ''].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--text-muted)', fontSize: 12 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grants.length === 0 ? (
            <tr>
              <td colSpan={3} style={{ padding: '10px', color: 'var(--text-muted)', fontSize: 13 }}>Sin grants activos</td>
            </tr>
          ) : grants.map(g => (
            <tr key={g.id} style={{ borderBottom: '1px solid var(--bg-border)' }}>
              <td style={{ padding: '8px 10px', color: 'var(--text-primary)', fontSize: 13 }}>{g.resource_type}</td>
              <td style={{ padding: '8px 10px', color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-data)' }}>
                {g.allowed_actions.join(', ')}
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                <button
                  onClick={() => revokeMutation.mutate(g.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-crit)', fontSize: 12, cursor: 'pointer' }}
                >
                  Revocar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          value={selectedIdx}
          onChange={e => setSelectedIdx(Number(e.target.value))}
          style={{
            flex: 1, padding: '7px 10px', background: 'var(--bg-elevated)',
            border: '1px solid var(--bg-border)', borderRadius: 6,
            color: 'var(--text-primary)', fontSize: 13,
          }}
        >
          {GRANT_TYPES.map((g, i) => <option key={i} value={i}>{g.label}</option>)}
        </select>
        <button
          onClick={() => createMutation.mutate({
            grantee_id: tenantId,
            resource_type: GRANT_TYPES[selectedIdx].resource_type,
            allowed_actions: GRANT_TYPES[selectedIdx].allowed_actions,
          })}
          disabled={createMutation.isPending}
          style={{
            background: 'var(--accent-energy)', color: '#fff', border: 'none',
            borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}
        >
          Añadir
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create BrandTokensEditor.tsx**

Create `frontend/src/features/clientes/BrandTokensEditor.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { BrandTokens } from '../../lib/types'

interface Props { tenantId: string }

export default function BrandTokensEditor({ tenantId }: Props) {
  const qc = useQueryClient()

  const { data: tokens } = useQuery({
    queryKey: keys.tenantBrandTokens(tenantId),
    queryFn: () => apiClient.get<BrandTokens>(`/api/v1/tenants/${tenantId}/brand-tokens`),
  })

  const [brandColor, setBrandColor] = useState('#F97316')
  const [logoUrl, setLogoUrl] = useState('')
  const [brandName, setBrandName] = useState('')
  const [previewColor, setPreviewColor] = useState('#F97316')

  useEffect(() => {
    if (tokens) {
      setBrandColor(tokens.brand_color ?? '#F97316')
      setPreviewColor(tokens.brand_color ?? '#F97316')
      setLogoUrl(tokens.logo_url ?? '')
      setBrandName(tokens.brand_name ?? '')
    }
  }, [tokens])

  const mutation = useMutation({
    mutationFn: (payload: BrandTokens) =>
      apiClient.put(`/api/v1/tenants/${tenantId}/brand-tokens`, { brand_tokens: payload }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tenantBrandTokens(tenantId) }),
  })

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', background: 'var(--bg-elevated)',
    border: '1px solid var(--bg-border)', borderRadius: 6,
    color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box',
  }

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Nombre de marca</span>
          <input value={brandName} onChange={e => setBrandName(e.target.value)} style={inputStyle} />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Color de acento</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="color"
              value={brandColor}
              onChange={e => { setBrandColor(e.target.value); setPreviewColor(e.target.value) }}
              style={{ width: 36, height: 36, padding: 2, background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', borderRadius: 6, cursor: 'pointer' }}
            />
            <input
              value={brandColor}
              onChange={e => {
                setBrandColor(e.target.value)
                if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setPreviewColor(e.target.value)
              }}
              style={{ ...inputStyle, fontFamily: 'var(--font-data)', flex: 1 }}
            />
          </div>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>URL del logo</span>
          <input value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://..." style={inputStyle} />
        </label>

        <button
          onClick={() => mutation.mutate({ brand_color: brandColor, logo_url: logoUrl, brand_name: brandName })}
          disabled={mutation.isPending}
          style={{
            background: 'var(--accent-energy)', color: '#fff', border: 'none',
            borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 500,
            cursor: 'pointer', alignSelf: 'flex-start',
          }}
        >
          {mutation.isPending ? 'Guardando...' : 'Guardar'}
        </button>
        {mutation.isSuccess && <p style={{ color: 'var(--accent-ok)', fontSize: 12, margin: 0 }}>Guardado</p>}
      </div>

      {/* Live preview */}
      <div style={{ width: 180 }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '0 0 8px' }}>Preview</p>
        <div style={{ background: 'var(--bg-surface)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bg-border)' }}>
          <div style={{ background: 'var(--bg-elevated)', padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--bg-border)' }}>
            {logoUrl
              ? <img src={logoUrl} alt="logo" style={{ width: 18, height: 18, objectFit: 'contain' }} />
              : <div style={{ width: 18, height: 18, borderRadius: 4, background: previewColor }} />
            }
            <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 600 }}>
              {brandName || 'Marca'}
            </span>
          </div>
          {['Flota', 'Alertas', 'Ajustes'].map(label => (
            <div key={label} style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
          ))}
          <div style={{ padding: '6px 10px', fontSize: 11, color: previewColor, background: `${previewColor}22` }}>
            Página activa
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Type-check and commit**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -20
```

```bash
git add frontend/src/features/clientes/UserFormModal.tsx frontend/src/features/clientes/GrantsSection.tsx frontend/src/features/clientes/BrandTokensEditor.tsx
git commit -m "feat: UserFormModal + GrantsSection + BrandTokensEditor"
```

---

### Task 8: Frontend — TenantDetailPage

**Files:**
- Create: `frontend/src/features/clientes/TenantDetailPage.tsx`

- [ ] **Step 1: Create TenantDetailPage.tsx**

Create `frontend/src/features/clientes/TenantDetailPage.tsx`:

```tsx
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import UserFormModal from './UserFormModal'
import GrantsSection from './GrantsSection'
import BrandTokensEditor from './BrandTokensEditor'
import type { TenantOut, UserOut, VehicleOut } from '../../lib/types'

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-surface)', borderRadius: 8, padding: 20, border: '1px solid var(--bg-border)', marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 16px', color: 'var(--text-primary)', fontSize: 15, fontWeight: 600 }}>{title}</h3>
      {children}
    </div>
  )
}

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [showUserModal, setShowUserModal] = useState(false)
  const [editingUser, setEditingUser] = useState<UserOut | undefined>()

  const { data: tenant, isLoading } = useQuery({
    queryKey: keys.cliente(id!),
    queryFn: () => apiClient.get<TenantOut>(`/api/v1/tenants/${id}`),
  })

  const { data: users = [] } = useQuery({
    queryKey: keys.clienteUsers(id!),
    queryFn: () => apiClient.get<UserOut[]>(`/api/v1/tenants/${id}/users`),
    enabled: !!id,
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: keys.clienteVehicles(id!),
    queryFn: () => apiClient.get<VehicleOut[]>(`/api/v1/vehicles?tenant_id=${id}`),
    enabled: !!id,
  })

  const deactivateUser = useMutation({
    mutationFn: (userId: string) => apiClient.delete(`/api/v1/users/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.clienteUsers(id!) }),
  })

  if (isLoading) {
    return <Shell title="Cliente"><p style={{ padding: 24, color: 'var(--text-muted)' }}>Cargando...</p></Shell>
  }
  if (!tenant) {
    return <Shell title="Cliente"><p style={{ padding: 24, color: 'var(--text-muted)' }}>Cliente no encontrado</p></Shell>
  }

  return (
    <Shell title={tenant.name}>
      <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>

        {/* 1. Cabecera */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h2 style={{ margin: '0 0 4px', color: 'var(--text-primary)', fontSize: 22, fontWeight: 700 }}>{tenant.name}</h2>
            <span style={{ color: 'var(--text-muted)', fontSize: 13, fontFamily: 'var(--font-data)' }}>{tenant.slug}</span>
            <span style={{
              marginLeft: 10, display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12,
              background: tenant.active ? 'rgba(34,197,94,0.15)' : 'rgba(120,113,108,0.15)',
              color: tenant.active ? 'var(--accent-ok)' : 'var(--accent-off)',
            }}>
              {tenant.active ? 'Activo' : 'Inactivo'}
            </span>
          </div>
          <Link
            to={`/clientes/${id}/edit`}
            style={{
              background: 'var(--bg-elevated)', color: 'var(--text-primary)',
              border: '1px solid var(--bg-border)', borderRadius: 6,
              padding: '7px 14px', fontSize: 13, textDecoration: 'none',
            }}
          >
            Editar
          </Link>
        </div>

        {/* 2. Usuarios */}
        <SectionCard title="Usuarios">
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
                {['Email', 'Nombre', 'Rol', 'Estado', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--text-muted)', fontSize: 12 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--bg-border)' }}>
                  <td style={{ padding: '8px 10px', fontSize: 13, color: 'var(--text-primary)' }}>{u.email}</td>
                  <td style={{ padding: '8px 10px', fontSize: 13, color: 'var(--text-muted)' }}>{u.full_name}</td>
                  <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>{u.role}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 6px', borderRadius: 4, fontSize: 11,
                      background: u.active ? 'rgba(34,197,94,0.15)' : 'rgba(120,113,108,0.15)',
                      color: u.active ? 'var(--accent-ok)' : 'var(--accent-off)',
                    }}>
                      {u.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    <button
                      onClick={() => { setEditingUser(u); setShowUserModal(true) }}
                      style={{ background: 'none', border: 'none', color: 'var(--accent-energy)', fontSize: 12, cursor: 'pointer', marginRight: 8 }}
                    >
                      Editar
                    </button>
                    {u.active && (
                      <button
                        onClick={() => deactivateUser.mutate(u.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--accent-crit)', fontSize: 12, cursor: 'pointer' }}
                      >
                        Desactivar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={5} style={{ padding: '10px', color: 'var(--text-muted)', fontSize: 13 }}>Sin usuarios</td></tr>
              )}
            </tbody>
          </table>
          <button
            onClick={() => { setEditingUser(undefined); setShowUserModal(true) }}
            style={{
              background: 'var(--accent-energy)', color: '#fff', border: 'none',
              borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}
          >
            + Añadir usuario
          </button>
        </SectionCard>

        {/* 3. Vehículos */}
        <SectionCard title="Vehículos">
          {vehicles.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 10px' }}>Sin vehículos asignados</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
                  {['Nombre', 'Matrícula'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--text-muted)', fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vehicles.map(v => (
                  <tr key={v.id} style={{ borderBottom: '1px solid var(--bg-border)' }}>
                    <td style={{ padding: '8px 10px', fontSize: 13, color: 'var(--text-primary)' }}>{v.name}</td>
                    <td style={{ padding: '8px 10px', fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>
                      {v.license_plate ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Link to={`/fleet?tenant=${id}`} style={{ color: 'var(--accent-energy)', fontSize: 13, textDecoration: 'none' }}>
            Ver en Flota →
          </Link>
        </SectionCard>

        {/* 4. Permission Grants */}
        <SectionCard title="Permission Grants">
          <GrantsSection tenantId={id!} />
        </SectionCard>

        {/* 5. White-label */}
        <SectionCard title="White-label">
          <BrandTokensEditor tenantId={id!} />
        </SectionCard>

      </div>

      {showUserModal && (
        <UserFormModal
          tenantId={id!}
          user={editingUser}
          onClose={() => { setShowUserModal(false); setEditingUser(undefined) }}
        />
      )}
    </Shell>
  )
}
```

- [ ] **Step 2: Type-check and commit**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -20
```

```bash
git add frontend/src/features/clientes/TenantDetailPage.tsx
git commit -m "feat: TenantDetailPage — 5 secciones (cabecera, usuarios, vehículos, grants, white-label)"
```

---

### Task 9: Frontend — SettingsPage users section

**Files:**
- Create: `frontend/src/features/settings/UsersSection.tsx`
- Modify: `frontend/src/features/settings/SettingsPage.tsx`

- [ ] **Step 1: Create UsersSection.tsx**

Create `frontend/src/features/settings/UsersSection.tsx`:

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import { useAuthStore } from '../auth/useAuthStore'
import UserFormModal from '../clientes/UserFormModal'
import type { UserOut } from '../../lib/types'

export default function UsersSection() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editingUser, setEditingUser] = useState<UserOut | undefined>()
  const tenantId = user!.tenant_id

  const { data: users = [] } = useQuery({
    queryKey: keys.clienteUsers(tenantId),
    queryFn: () => apiClient.get<UserOut[]>(`/api/v1/tenants/${tenantId}/users`),
  })

  const deactivate = useMutation({
    mutationFn: (userId: string) => apiClient.delete(`/api/v1/users/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.clienteUsers(tenantId) }),
  })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 15, fontWeight: 600 }}>Usuarios</h3>
        <button
          onClick={() => { setEditingUser(undefined); setShowModal(true) }}
          style={{
            background: 'var(--accent-energy)', color: '#fff', border: 'none',
            borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}
        >
          + Añadir usuario
        </button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
            {['Email', 'Nombre', 'Rol', 'Estado', ''].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--text-muted)', fontSize: 12 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id} style={{ borderBottom: '1px solid var(--bg-border)' }}>
              <td style={{ padding: '8px 10px', fontSize: 13, color: 'var(--text-primary)' }}>{u.email}</td>
              <td style={{ padding: '8px 10px', fontSize: 13, color: 'var(--text-muted)' }}>{u.full_name}</td>
              <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>{u.role}</td>
              <td style={{ padding: '8px 10px' }}>
                <span style={{
                  display: 'inline-block', padding: '2px 6px', borderRadius: 4, fontSize: 11,
                  background: u.active ? 'rgba(34,197,94,0.15)' : 'rgba(120,113,108,0.15)',
                  color: u.active ? 'var(--accent-ok)' : 'var(--accent-off)',
                }}>
                  {u.active ? 'Activo' : 'Inactivo'}
                </span>
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                <button
                  onClick={() => { setEditingUser(u); setShowModal(true) }}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-energy)', fontSize: 12, cursor: 'pointer', marginRight: 8 }}
                >
                  Editar
                </button>
                {u.active && (
                  <button
                    onClick={() => deactivate.mutate(u.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--accent-crit)', fontSize: 12, cursor: 'pointer' }}
                  >
                    Desactivar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showModal && (
        <UserFormModal
          tenantId={tenantId}
          user={editingUser}
          onClose={() => { setShowModal(false); setEditingUser(undefined) }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Modify SettingsPage.tsx**

Replace `frontend/src/features/settings/SettingsPage.tsx` with:

```tsx
import Shell from '../../shared/ui/Shell'
import NotificationSettings from './NotificationSettings'
import UsersSection from './UsersSection'
import { useAuthStore } from '../auth/useAuthStore'

export default function SettingsPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  return (
    <Shell title="Ajustes">
      <div style={{ padding: 24, overflowY: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: 32 }}>
        <NotificationSettings />
        {isAdmin && <UsersSection />}
      </div>
    </Shell>
  )
}
```

- [ ] **Step 3: Type-check and commit**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -20
```

```bash
git add frontend/src/features/settings/UsersSection.tsx frontend/src/features/settings/SettingsPage.tsx
git commit -m "feat: SettingsPage — sección Usuarios visible para role=admin"
```

---

### Task 10: Tests — Frontend test suite

**Files:**
- Create: `frontend/src/features/clientes/__tests__/TenantsPage.test.tsx`
- Create: `frontend/src/features/clientes/__tests__/TenantFormPage.test.tsx`
- Create: `frontend/src/features/clientes/__tests__/TenantDetailPage.test.tsx`
- Create: `frontend/src/features/clientes/__tests__/UserFormModal.test.tsx`
- Create: `frontend/src/features/clientes/__tests__/BrandTokensEditor.test.tsx`
- Create: `frontend/src/features/clientes/__tests__/GrantsSection.test.tsx`

- [ ] **Step 1: Create TenantsPage.test.tsx**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TenantsPage from '../TenantsPage'
import type { TenantOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({ apiClient: { get: vi.fn() } }))
vi.mock('../../../features/auth/useAuthStore', () => ({ useAuthStore: vi.fn() }))

import { apiClient } from '../../../lib/apiClient'
import { useAuthStore } from '../../../features/auth/useAuthStore'

const cmgUser = { user_id: 'u1', tenant_id: 't0', tenant_tier: 'cmg' as const, role: 'admin' as const, email: 'admin@cmg.es' }
const mockTenants: TenantOut[] = [
  { id: 't1', parent_id: 't0', tier: 'client', name: 'Wasterent', slug: 'wasterent', active: true, brand_name: null, brand_color: null, logo_url: null, custom_domain: null, brand_tokens: null, created_at: '2026-01-01T00:00:00Z' },
]

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter><TenantsPage /></MemoryRouter></QueryClientProvider>)
}

describe('TenantsPage', () => {
  it('muestra lista de clientes', async () => {
    vi.mocked(useAuthStore).mockReturnValue(cmgUser)
    vi.mocked(apiClient.get).mockResolvedValue(mockTenants)
    renderPage()
    expect(await screen.findByText('Wasterent')).toBeInTheDocument()
  })

  it('muestra enlace Nuevo cliente', () => {
    vi.mocked(useAuthStore).mockReturnValue(cmgUser)
    vi.mocked(apiClient.get).mockResolvedValue([])
    renderPage()
    expect(screen.getByText('+ Nuevo cliente')).toBeInTheDocument()
  })

  it('filtra CMG tenant de la lista', async () => {
    const withCmg: TenantOut[] = [
      ...mockTenants,
      { id: 't0', parent_id: null, tier: 'cmg', name: 'CMG', slug: 'cmg', active: true, brand_name: null, brand_color: null, logo_url: null, custom_domain: null, brand_tokens: null, created_at: '2026-01-01T00:00:00Z' },
    ]
    vi.mocked(useAuthStore).mockReturnValue(cmgUser)
    vi.mocked(apiClient.get).mockResolvedValue(withCmg)
    renderPage()
    expect(await screen.findByText('Wasterent')).toBeInTheDocument()
    expect(screen.queryByText('CMG')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Create TenantFormPage.test.tsx**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TenantFormPage from '../TenantFormPage'

vi.mock('../../../lib/apiClient', () => ({ apiClient: { post: vi.fn(), put: vi.fn(), get: vi.fn() } }))
vi.mock('../../../features/auth/useAuthStore', () => ({ useAuthStore: vi.fn() }))

import { apiClient } from '../../../lib/apiClient'
import { useAuthStore } from '../../../features/auth/useAuthStore'

const cmgUser = { user_id: 'u1', tenant_id: 't0', tenant_tier: 'cmg' as const, role: 'admin' as const, email: 'admin@cmg.es' }
const newTenant = { id: 't1', parent_id: 't0', tier: 'client', name: 'Wasterent', slug: 'wasterent', active: true, brand_name: null, brand_color: null, logo_url: null, custom_domain: null, brand_tokens: null, created_at: '2026-01-01T00:00:00Z' }

function renderCreate() {
  vi.mocked(useAuthStore).mockReturnValue(cmgUser)
  vi.mocked(apiClient.post).mockResolvedValue(newTenant)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/clientes/new']}>
        <Routes><Route path="/clientes/new" element={<TenantFormPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('TenantFormPage', () => {
  it('muestra campos de formulario', () => {
    renderCreate()
    expect(screen.getByText('Nombre')).toBeInTheDocument()
    expect(screen.getByText(/Slug/)).toBeInTheDocument()
  })

  it('llama a POST con tier=client al crear', async () => {
    renderCreate()
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[0], { target: { value: 'Wasterent' } })
    fireEvent.change(inputs[1], { target: { value: 'wasterent' } })
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/tenants',
      expect.objectContaining({ name: 'Wasterent', slug: 'wasterent', tier: 'client' })
    ))
  })
})
```

- [ ] **Step 3: Create TenantDetailPage.test.tsx**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TenantDetailPage from '../TenantDetailPage'
import type { TenantOut, UserOut, VehicleOut, GrantOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))
vi.mock('../../../features/auth/useAuthStore', () => ({ useAuthStore: vi.fn() }))

import { apiClient } from '../../../lib/apiClient'
import { useAuthStore } from '../../../features/auth/useAuthStore'

const cmgUser = { user_id: 'u1', tenant_id: 't0', tenant_tier: 'cmg' as const, role: 'admin' as const, email: 'admin@cmg.es' }
const tenant: TenantOut = { id: 't1', parent_id: 't0', tier: 'client', name: 'Wasterent', slug: 'wasterent', active: true, brand_name: null, brand_color: null, logo_url: null, custom_domain: null, brand_tokens: null, created_at: '2026-01-01T00:00:00Z' }
const users: UserOut[] = [{ id: 'u2', tenant_id: 't1', email: 'op@wasterent.com', full_name: 'Operador', role: 'operator', active: true, created_at: '2026-01-01T00:00:00Z' }]

function renderDetail() {
  vi.mocked(useAuthStore).mockReturnValue(cmgUser)
  vi.mocked(apiClient.get).mockImplementation((url: string) => {
    if (url.includes('/users')) return Promise.resolve(users)
    if (url.includes('/vehicles')) return Promise.resolve([] as VehicleOut[])
    if (url.includes('/grants')) return Promise.resolve([] as GrantOut[])
    if (url.includes('/brand-tokens')) return Promise.resolve({})
    return Promise.resolve(tenant)
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/clientes/t1']}>
        <Routes><Route path="/clientes/:id" element={<TenantDetailPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('TenantDetailPage', () => {
  it('muestra nombre del cliente', async () => {
    renderDetail()
    expect(await screen.findByText('Wasterent')).toBeInTheDocument()
  })

  it('muestra usuario en sección Usuarios', async () => {
    renderDetail()
    expect(await screen.findByText('op@wasterent.com')).toBeInTheDocument()
  })

  it('muestra las 5 secciones', async () => {
    renderDetail()
    expect(await screen.findByText('Usuarios')).toBeInTheDocument()
    expect(await screen.findByText('Vehículos')).toBeInTheDocument()
    expect(await screen.findByText('Permission Grants')).toBeInTheDocument()
    expect(await screen.findByText('White-label')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Create UserFormModal.test.tsx**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import UserFormModal from '../UserFormModal'
import type { UserOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({ apiClient: { post: vi.fn(), put: vi.fn() } }))

import { apiClient } from '../../../lib/apiClient'

const existingUser: UserOut = { id: 'u1', tenant_id: 't1', email: 'op@w.com', full_name: 'Operador', role: 'operator', active: true, created_at: '2026-01-01T00:00:00Z' }

function wrap(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>)
}

describe('UserFormModal', () => {
  it('llama a POST al crear con contraseña', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ ...existingUser, id: 'u-new' })
    wrap(<UserFormModal tenantId="t1" onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'new@w.com' } })
    fireEvent.change(screen.getByLabelText(/nombre completo/i), { target: { value: 'Nuevo' } })
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'Pass1234!' } })
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/tenants/t1/users',
      expect.objectContaining({ email: 'new@w.com', password: 'Pass1234!' })
    ))
  })

  it('llama a PUT al editar sin campo contraseña', async () => {
    vi.mocked(apiClient.put).mockResolvedValue(existingUser)
    wrap(<UserFormModal tenantId="t1" user={existingUser} onClose={vi.fn()} />)
    expect(screen.queryByLabelText(/contraseña/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      `/api/v1/users/${existingUser.id}`,
      expect.not.objectContaining({ password: expect.anything() })
    ))
  })
})
```

- [ ] **Step 5: Create BrandTokensEditor.test.tsx**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BrandTokensEditor from '../BrandTokensEditor'

vi.mock('../../../lib/apiClient', () => ({ apiClient: { get: vi.fn(), put: vi.fn() } }))

import { apiClient } from '../../../lib/apiClient'

function wrap() {
  vi.mocked(apiClient.get).mockResolvedValue({ brand_color: '#F97316', brand_name: 'Wasterent', logo_url: '' })
  vi.mocked(apiClient.put).mockResolvedValue({})
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter><BrandTokensEditor tenantId="t1" /></MemoryRouter></QueryClientProvider>)
}

describe('BrandTokensEditor', () => {
  it('muestra nombre de marca en preview', async () => {
    wrap()
    expect(await screen.findByText('Wasterent')).toBeInTheDocument()
  })

  it('llama a PUT al guardar', async () => {
    wrap()
    fireEvent.click(await screen.findByText('Guardar'))
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      '/api/v1/tenants/t1/brand-tokens',
      expect.objectContaining({ brand_tokens: expect.objectContaining({ brand_color: expect.any(String) }) })
    ))
  })
})
```

- [ ] **Step 6: Create GrantsSection.test.tsx**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import GrantsSection from '../GrantsSection'
import type { GrantOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))

import { apiClient } from '../../../lib/apiClient'

const grant: GrantOut = { id: 'g1', grantor_id: 't0', grantee_id: 't1', resource_type: 'maintenance', resource_id: null, allowed_actions: ['log'], constraints: null, granted_at: '2026-01-01T00:00:00Z', expires_at: null, active: true }

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter><GrantsSection tenantId="t1" /></MemoryRouter></QueryClientProvider>)
}

describe('GrantsSection', () => {
  it('muestra grants existentes', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([grant])
    wrap()
    expect(await screen.findByText('maintenance')).toBeInTheDocument()
  })

  it('llama a POST al añadir grant', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([])
    vi.mocked(apiClient.post).mockResolvedValue(grant)
    wrap()
    fireEvent.click(await screen.findByText('Añadir'))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/grants',
      expect.objectContaining({ grantee_id: 't1', resource_type: 'maintenance' })
    ))
  })

  it('llama a DELETE al revocar', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([grant])
    vi.mocked(apiClient.delete).mockResolvedValue(undefined)
    wrap()
    fireEvent.click(await screen.findByText('Revocar'))
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/grants/g1'))
  })
})
```

- [ ] **Step 7: Run frontend tests**

```bash
cd /opt/cmg-telematic1/frontend && npm test -- --run 2>&1 | tail -20
```
Expected: all existing tests + ~17 new = ~124 passing

- [ ] **Step 8: Run backend tests**

```bash
cd /opt/cmg-telematic1 && python -m pytest tests/ -q 2>&1 | tail -5
```
Expected: all passing (~80 total)

- [ ] **Step 9: Commit**

```bash
git add frontend/src/features/clientes/__tests__/
git commit -m "test: frontend tests para sprint 11 — 6 archivos, ~17 tests"
```
