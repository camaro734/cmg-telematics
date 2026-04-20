# Sprint 10 — Mantenimiento Predictivo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo completo de mantenimiento predictivo por ciclos hidráulicos — planes por vehículo, progreso calculado desde TimescaleDB, historial de intervenciones, UI global tipo panel de taller.

**Architecture:** Los acumuladores (pto_hours, engine_hours, calendar_days) se calculan en tiempo real sobre `telemetry_1h`. El "reset" es implícito: se busca el `performed_at` del último `MaintenanceLog` con ese contador en `reset_counters` y se suma desde ahí. Sin estado Redis.

**Tech Stack:** FastAPI + SQLAlchemy async + TimescaleDB `telemetry_1h`, React 18 + TanStack Query, Vitest + RTL, Alembic migrations.

---

## File Map

**Backend — crear:**
- `backend/app/schemas/maintenance.py` — Pydantic schemas
- `backend/app/api/v1/maintenance.py` — endpoints CRUD
- `backend/alembic/versions/003_add_maintenance_created_at.py` — migration

**Backend — modificar:**
- `backend/app/models/maintenance.py` — añadir `created_at`
- `backend/app/api/v1/router.py` — registrar router
- `backend/app/api/v1/vehicles.py` — añadir `/vehicles/:id/maintenance`

**Tests backend — crear:**
- `tests/api/test_maintenance_api.py`

**Frontend — crear:**
- `frontend/src/features/maintenance/ProgressBar.tsx`
- `frontend/src/features/maintenance/MaintenancePage.tsx`
- `frontend/src/features/maintenance/MaintenancePlanFormPage.tsx`
- `frontend/src/features/maintenance/ThresholdBuilder.tsx`
- `frontend/src/features/maintenance/MaintenancePlanDetailPage.tsx`
- `frontend/src/features/maintenance/LogInterventionModal.tsx`
- `frontend/src/features/maintenance/__tests__/ProgressBar.test.tsx`
- `frontend/src/features/maintenance/__tests__/MaintenancePage.test.tsx`
- `frontend/src/features/maintenance/__tests__/MaintenancePlanFormPage.test.tsx`
- `frontend/src/features/maintenance/__tests__/LogInterventionModal.test.tsx`

**Frontend — modificar:**
- `frontend/src/lib/types.ts` — tipos nuevos
- `frontend/src/lib/queryKeys.ts` — claves nuevas
- `frontend/src/shared/ui/icons.tsx` — IconMantenimiento
- `frontend/src/shared/ui/Sidebar.tsx` — entrada Mantenimiento
- `frontend/src/App.tsx` — rutas /maintenance
- `frontend/src/features/vehicle/VehicleDetailPage.tsx` — badge

---

## Task 1: Model + Migration + Schemas

**Files:**
- Modify: `backend/app/models/maintenance.py`
- Create: `backend/alembic/versions/003_add_maintenance_created_at.py`
- Create: `backend/app/schemas/maintenance.py`

- [ ] **Step 1: Añadir `created_at` al modelo `MaintenancePlan`**

Reemplazar el contenido de `backend/app/models/maintenance.py`:

```python
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import String, ForeignKey, DateTime, Boolean, Integer, Numeric, ARRAY
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base

class MaintenancePlan(Base):
    __tablename__ = "maintenance_plan"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    trigger_condition: Mapped[dict] = mapped_column(JSONB, nullable=False)
    next_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    warn_before_pct: Mapped[int] = mapped_column(Integer, default=10)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

class MaintenanceLog(Base):
    __tablename__ = "maintenance_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False)
    plan_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("maintenance_plan.id"), nullable=True)
    performed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    performed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("user.id"), nullable=True)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    reset_counters: Mapped[list | None] = mapped_column(ARRAY(String), nullable=True)
    cost_eur: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    photo_urls: Mapped[list | None] = mapped_column(ARRAY(String), nullable=True)
```

- [ ] **Step 2: Crear migración Alembic**

Crear `backend/alembic/versions/003_add_maintenance_created_at.py`:

```python
"""add created_at to maintenance_plan

Revision ID: 003
Revises: 002
"""
from alembic import op
import sqlalchemy as sa

revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'maintenance_plan',
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('NOW()'),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column('maintenance_plan', 'created_at')
```

- [ ] **Step 3: Ejecutar migración**

```bash
cd /opt/cmg-telematic1/backend
alembic upgrade head
```

Salida esperada: `Running upgrade 002 -> 003, add created_at to maintenance_plan`

- [ ] **Step 4: Crear schemas Pydantic**

Crear `backend/app/schemas/maintenance.py`:

```python
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict


class MaintenanceThreshold(BaseModel):
    type: Literal['pto_hours', 'engine_hours', 'calendar_days']
    value: float


class TriggerCondition(BaseModel):
    thresholds: list[MaintenanceThreshold]
    op: Literal['OR'] = 'OR'


class ThresholdProgress(BaseModel):
    type: str
    current: float
    limit: float
    pct: float


class MaintenanceProgress(BaseModel):
    status: Literal['ok', 'próximo', 'vencido']
    thresholds: list[ThresholdProgress]


class MaintenancePlanCreate(BaseModel):
    vehicle_id: uuid.UUID
    name: str
    trigger_condition: TriggerCondition
    warn_before_pct: int = 10
    active: bool = True


class MaintenancePlanUpdate(BaseModel):
    name: str | None = None
    trigger_condition: TriggerCondition | None = None
    warn_before_pct: int | None = None
    active: bool | None = None


class MaintenancePlanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    vehicle_id: uuid.UUID
    vehicle_name: str
    tenant_id: uuid.UUID
    name: str
    trigger_condition: dict
    warn_before_pct: int
    active: bool
    created_at: datetime
    progress: MaintenanceProgress


class MaintenanceLogCreate(BaseModel):
    performed_at: datetime
    description: str | None = None
    reset_counters: list[str]
    cost_eur: float | None = None


class MaintenanceLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    plan_id: uuid.UUID | None
    vehicle_id: uuid.UUID
    performed_at: datetime
    performed_by_email: str | None = None
    description: str | None
    reset_counters: list[str]
    cost_eur: float | None
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/maintenance.py \
        backend/alembic/versions/003_add_maintenance_created_at.py \
        backend/app/schemas/maintenance.py
git commit -m "feat: maintenance model created_at + Pydantic schemas"
```

---

## Task 2: Backend Tests (TDD — escribir antes de implementar)

**Files:**
- Create: `tests/api/test_maintenance_api.py`

- [ ] **Step 1: Crear fichero de tests**

Crear `tests/api/test_maintenance_api.py`:

```python
import pytest
from datetime import datetime, timezone

PLAN_PAYLOAD = lambda vid: {
    "vehicle_id": vid,
    "name": "Cambio aceite hidráulico",
    "trigger_condition": {
        "thresholds": [
            {"type": "pto_hours", "value": 500},
            {"type": "calendar_days", "value": 365},
        ],
        "op": "OR",
    },
    "warn_before_pct": 10,
    "active": True,
}


async def _first_vehicle_id(client, token: str) -> str:
    resp = await client.get("/api/v1/vehicles", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    vehicles = resp.json()
    assert len(vehicles) > 0, "Seed data must have at least one vehicle"
    return vehicles[0]["id"]


async def test_create_plan_admin(client, admin_token):
    vid = await _first_vehicle_id(client, admin_token)
    resp = await client.post(
        "/api/v1/maintenance/plans",
        json=PLAN_PAYLOAD(vid),
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Cambio aceite hidráulico"
    assert data["vehicle_id"] == vid
    assert data["progress"]["status"] in ("ok", "próximo", "vencido")
    assert isinstance(data["progress"]["thresholds"], list)


async def test_list_plans(client, admin_token):
    vid = await _first_vehicle_id(client, admin_token)
    await client.post(
        "/api/v1/maintenance/plans",
        json=PLAN_PAYLOAD(vid),
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    resp = await client.get(
        "/api/v1/maintenance/plans",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


async def test_plan_pto_hours_zero_without_telemetry(client, admin_token):
    vid = await _first_vehicle_id(client, admin_token)
    resp = await client.post(
        "/api/v1/maintenance/plans",
        json=PLAN_PAYLOAD(vid),
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    data = resp.json()
    pto = next(t for t in data["progress"]["thresholds"] if t["type"] == "pto_hours")
    assert pto["current"] == 0.0
    assert pto["pct"] == 0.0


async def test_update_plan(client, admin_token):
    vid = await _first_vehicle_id(client, admin_token)
    create_resp = await client.post(
        "/api/v1/maintenance/plans",
        json=PLAN_PAYLOAD(vid),
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    plan_id = create_resp.json()["id"]
    resp = await client.put(
        f"/api/v1/maintenance/plans/{plan_id}",
        json={"name": "Aceite — actualizado"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Aceite — actualizado"


async def test_delete_plan(client, admin_token):
    vid = await _first_vehicle_id(client, admin_token)
    create_resp = await client.post(
        "/api/v1/maintenance/plans",
        json=PLAN_PAYLOAD(vid),
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    plan_id = create_resp.json()["id"]
    resp = await client.delete(
        f"/api/v1/maintenance/plans/{plan_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 204
    get_resp = await client.get(
        f"/api/v1/maintenance/plans/{plan_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert get_resp.status_code == 404


async def test_log_intervention(client, admin_token):
    vid = await _first_vehicle_id(client, admin_token)
    create_resp = await client.post(
        "/api/v1/maintenance/plans",
        json=PLAN_PAYLOAD(vid),
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    plan_id = create_resp.json()["id"]
    log_payload = {
        "performed_at": datetime.now(timezone.utc).isoformat(),
        "description": "Cambio aceite SAE 46",
        "reset_counters": ["pto_hours"],
        "cost_eur": 85.50,
    }
    resp = await client.post(
        f"/api/v1/maintenance/plans/{plan_id}/logs",
        json=log_payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["description"] == "Cambio aceite SAE 46"
    assert data["cost_eur"] == 85.50
    assert "pto_hours" in data["reset_counters"]


async def test_get_plan_logs(client, admin_token):
    vid = await _first_vehicle_id(client, admin_token)
    create_resp = await client.post(
        "/api/v1/maintenance/plans",
        json=PLAN_PAYLOAD(vid),
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    plan_id = create_resp.json()["id"]
    await client.post(
        f"/api/v1/maintenance/plans/{plan_id}/logs",
        json={"performed_at": datetime.now(timezone.utc).isoformat(), "reset_counters": ["pto_hours"]},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    resp = await client.get(
        f"/api/v1/maintenance/plans/{plan_id}/logs",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


async def test_vehicle_maintenance_endpoint(client, admin_token):
    vid = await _first_vehicle_id(client, admin_token)
    await client.post(
        "/api/v1/maintenance/plans",
        json=PLAN_PAYLOAD(vid),
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    resp = await client.get(
        f"/api/v1/vehicles/{vid}/maintenance",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
    assert len(resp.json()) >= 1
```

- [ ] **Step 2: Confirmar que los tests fallan (endpoints no existen)**

```bash
cd /opt/cmg-telematic1
python3 -m pytest tests/api/test_maintenance_api.py -v 2>&1 | head -30
```

Salida esperada: `404 Not Found` o `AttributeError` — los endpoints no existen todavía.

- [ ] **Step 3: Commit de los tests**

```bash
git add tests/api/test_maintenance_api.py
git commit -m "test: maintenance API tests (failing — TDD)"
```

---

## Task 3: Backend Endpoint

**Files:**
- Create: `backend/app/api/v1/maintenance.py`
- Modify: `backend/app/api/v1/router.py`
- Modify: `backend/app/api/v1/vehicles.py`

- [ ] **Step 1: Crear `backend/app/api/v1/maintenance.py`**

```python
# backend/app/api/v1/maintenance.py
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.schemas.maintenance import (
    MaintenancePlanCreate, MaintenancePlanUpdate, MaintenancePlanOut,
    MaintenanceLogCreate, MaintenanceLogOut,
    MaintenanceProgress, ThresholdProgress,
)
from app.models.maintenance import MaintenancePlan, MaintenanceLog
from app.models.vehicle import Vehicle
from app.models.permission_grant import PermissionGrant

router = APIRouter(tags=["maintenance"])


async def _require_admin(user: CurrentUser) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")


async def _require_admin_or_grant(user: CurrentUser, db: AsyncSession) -> None:
    if user.role == "admin":
        return
    result = await db.execute(
        select(PermissionGrant).where(
            PermissionGrant.grantee_id == user.tenant_id,
            PermissionGrant.resource_type == "maintenance",
            PermissionGrant.active == True,
        )
    )
    grant = result.scalar_one_or_none()
    if not grant or "log" not in (grant.allowed_actions or []):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sin permiso para registrar intervenciones",
        )


async def _compute_progress(plan: MaintenancePlan, db: AsyncSession) -> MaintenanceProgress:
    thresholds = plan.trigger_condition.get("thresholds", [])
    results: list[ThresholdProgress] = []

    for thresh in thresholds:
        t_type = thresh["type"]
        limit = float(thresh["value"])

        log_res = await db.execute(
            select(MaintenanceLog.performed_at)
            .where(
                MaintenanceLog.plan_id == plan.id,
                MaintenanceLog.reset_counters.contains([t_type]),
            )
            .order_by(MaintenanceLog.performed_at.desc())
            .limit(1)
        )
        baseline: datetime = log_res.scalar_one_or_none() or plan.created_at

        if t_type == "calendar_days":
            current = float(max(0, (datetime.now(timezone.utc) - baseline).days))
        elif t_type in ("pto_hours", "engine_hours"):
            col = "pto_active_minutes" if t_type == "pto_hours" else "engine_on_minutes"
            row = await db.execute(
                text(
                    f"SELECT COALESCE(SUM({col}), 0) / 60.0 "
                    "FROM telemetry_1h "
                    "WHERE vehicle_id = :vid AND bucket >= :baseline"
                ),
                {"vid": plan.vehicle_id, "baseline": baseline},
            )
            current = float(row.scalar_one() or 0.0)
        else:
            current = 0.0

        pct = round(current / limit * 100.0, 1) if limit > 0 else 0.0
        results.append(ThresholdProgress(
            type=t_type,
            current=round(current, 2),
            limit=limit,
            pct=pct,
        ))

    warn_threshold = 100.0 - plan.warn_before_pct
    if any(t.pct >= 100.0 for t in results):
        overall = "vencido"
    elif any(t.pct >= warn_threshold for t in results):
        overall = "próximo"
    else:
        overall = "ok"

    return MaintenanceProgress(status=overall, thresholds=results)


async def _to_out(plan: MaintenancePlan, vehicle_name: str, db: AsyncSession) -> MaintenancePlanOut:
    progress = await _compute_progress(plan, db)
    return MaintenancePlanOut(
        id=plan.id,
        vehicle_id=plan.vehicle_id,
        vehicle_name=vehicle_name,
        tenant_id=plan.tenant_id,
        name=plan.name,
        trigger_condition=plan.trigger_condition,
        warn_before_pct=plan.warn_before_pct,
        active=plan.active,
        created_at=plan.created_at,
        progress=progress,
    )


@router.get("/maintenance/plans", response_model=list[MaintenancePlanOut])
async def list_plans(
    vehicle_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(MaintenancePlan)
    if user.tenant_tier != "cmg":
        query = query.where(MaintenancePlan.tenant_id == user.tenant_id)
    if vehicle_id:
        query = query.where(MaintenancePlan.vehicle_id == vehicle_id)
    result = await db.execute(query.order_by(MaintenancePlan.name))
    plans = result.scalars().all()

    vehicle_ids = list({p.vehicle_id for p in plans})
    vehicles: dict[uuid.UUID, str] = {}
    if vehicle_ids:
        v_res = await db.execute(
            select(Vehicle.id, Vehicle.name).where(Vehicle.id.in_(vehicle_ids))
        )
        vehicles = {row.id: row.name for row in v_res}

    return [await _to_out(p, vehicles.get(p.vehicle_id, "—"), db) for p in plans]


@router.post("/maintenance/plans", response_model=MaintenancePlanOut, status_code=201)
async def create_plan(
    body: MaintenancePlanCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(user)
    vehicle = await db.get(Vehicle, body.vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")
    if user.tenant_tier != "cmg" and str(vehicle.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    plan = MaintenancePlan(
        vehicle_id=body.vehicle_id,
        tenant_id=vehicle.tenant_id,
        name=body.name,
        trigger_condition=body.trigger_condition.model_dump(),
        warn_before_pct=body.warn_before_pct,
        active=body.active,
    )
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return await _to_out(plan, vehicle.name, db)


@router.get("/maintenance/plans/{plan_id}", response_model=MaintenancePlanOut)
async def get_plan(
    plan_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plan = await db.get(MaintenancePlan, plan_id)
    if not plan or (user.tenant_tier != "cmg" and str(plan.tenant_id) != str(user.tenant_id)):
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    vehicle = await db.get(Vehicle, plan.vehicle_id)
    return await _to_out(plan, vehicle.name if vehicle else "—", db)


@router.put("/maintenance/plans/{plan_id}", response_model=MaintenancePlanOut)
async def update_plan(
    plan_id: uuid.UUID,
    body: MaintenancePlanUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(user)
    plan = await db.get(MaintenancePlan, plan_id)
    if not plan or (user.tenant_tier != "cmg" and str(plan.tenant_id) != str(user.tenant_id)):
        raise HTTPException(status_code=404, detail="Plan no encontrado")

    if body.name is not None:
        plan.name = body.name
    if body.trigger_condition is not None:
        plan.trigger_condition = body.trigger_condition.model_dump()
    if body.warn_before_pct is not None:
        plan.warn_before_pct = body.warn_before_pct
    if body.active is not None:
        plan.active = body.active

    await db.commit()
    await db.refresh(plan)
    vehicle = await db.get(Vehicle, plan.vehicle_id)
    return await _to_out(plan, vehicle.name if vehicle else "—", db)


@router.delete("/maintenance/plans/{plan_id}", status_code=204)
async def delete_plan(
    plan_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(user)
    plan = await db.get(MaintenancePlan, plan_id)
    if not plan or (user.tenant_tier != "cmg" and str(plan.tenant_id) != str(user.tenant_id)):
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    await db.delete(plan)
    await db.commit()


@router.post("/maintenance/plans/{plan_id}/logs", response_model=MaintenanceLogOut, status_code=201)
async def create_log(
    plan_id: uuid.UUID,
    body: MaintenanceLogCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plan = await db.get(MaintenancePlan, plan_id)
    if not plan or (user.tenant_tier != "cmg" and str(plan.tenant_id) != str(user.tenant_id)):
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    await _require_admin_or_grant(user, db)

    log = MaintenanceLog(
        vehicle_id=plan.vehicle_id,
        plan_id=plan_id,
        performed_at=body.performed_at,
        performed_by=uuid.UUID(str(user.user_id)),
        description=body.description,
        reset_counters=body.reset_counters,
        cost_eur=body.cost_eur,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return MaintenanceLogOut(
        id=log.id,
        plan_id=log.plan_id,
        vehicle_id=log.vehicle_id,
        performed_at=log.performed_at,
        performed_by_email=user.email,
        description=log.description,
        reset_counters=log.reset_counters or [],
        cost_eur=float(log.cost_eur) if log.cost_eur is not None else None,
    )


@router.get("/maintenance/plans/{plan_id}/logs", response_model=list[MaintenanceLogOut])
async def list_logs(
    plan_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plan = await db.get(MaintenancePlan, plan_id)
    if not plan or (user.tenant_tier != "cmg" and str(plan.tenant_id) != str(user.tenant_id)):
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    result = await db.execute(
        select(MaintenanceLog)
        .where(MaintenanceLog.plan_id == plan_id)
        .order_by(MaintenanceLog.performed_at.desc())
    )
    return [
        MaintenanceLogOut(
            id=lg.id, plan_id=lg.plan_id, vehicle_id=lg.vehicle_id,
            performed_at=lg.performed_at, performed_by_email=None,
            description=lg.description,
            reset_counters=lg.reset_counters or [],
            cost_eur=float(lg.cost_eur) if lg.cost_eur is not None else None,
        )
        for lg in result.scalars().all()
    ]
```

- [ ] **Step 2: Registrar router en `backend/app/api/v1/router.py`**

Añadir estas dos líneas al fichero existente:

```python
from app.api.v1.maintenance import router as maintenance_router
# ...después de las demás inclusiones:
api_router.include_router(maintenance_router)
```

El fichero completo queda:

```python
# backend/app/api/v1/router.py
from fastapi import APIRouter
from app.api.v1.auth import router as auth_router
from app.api.v1.vehicles import router as vehicles_router
from app.api.v1.alerts import router as alerts_router
from app.api.v1.rules import router as rules_router
from app.api.v1.tenants import router as tenants_router
from app.api.v1.settings import router as settings_router
from app.api.v1.maintenance import router as maintenance_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(vehicles_router)
api_router.include_router(alerts_router)
api_router.include_router(rules_router)
api_router.include_router(tenants_router)
api_router.include_router(settings_router)
api_router.include_router(maintenance_router)
```

- [ ] **Step 3: Añadir endpoint `/vehicles/:id/maintenance` en `backend/app/api/v1/vehicles.py`**

Añadir al final del fichero (después del último endpoint existente):

```python
from app.models.maintenance import MaintenancePlan
from app.schemas.maintenance import MaintenancePlanOut, MaintenanceProgress, ThresholdProgress

async def _compute_vehicle_maintenance_progress(plan: MaintenancePlan, db: AsyncSession):
    """Thin wrapper — reutiliza la lógica del router de maintenance."""
    from app.api.v1.maintenance import _compute_progress
    return await _compute_progress(plan, db)


@router.get("/vehicles/{vehicle_id}/maintenance", response_model=list[MaintenancePlanOut])
async def list_vehicle_maintenance(
    vehicle_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")
    _check_vehicle_access(vehicle, user)

    result = await db.execute(
        select(MaintenancePlan)
        .where(MaintenancePlan.vehicle_id == vehicle_id)
        .order_by(MaintenancePlan.name)
    )
    plans = result.scalars().all()
    from app.api.v1.maintenance import _to_out
    return [await _to_out(p, vehicle.name, db) for p in plans]
```

- [ ] **Step 4: Ejecutar tests y confirmar que pasan**

```bash
cd /opt/cmg-telematic1
python3 -m pytest tests/api/test_maintenance_api.py -v
```

Salida esperada: `8 passed`

- [ ] **Step 5: Ejecutar suite completa para confirmar no hay regresiones**

```bash
python3 -m pytest tests/api/ -v 2>&1 | tail -10
```

Salida esperada: todos los tests anteriores siguen pasando.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/maintenance.py \
        backend/app/api/v1/router.py \
        backend/app/api/v1/vehicles.py
git commit -m "feat: maintenance API endpoints — CRUD planes + logs + progreso TimescaleDB"
```

---

## Task 4: Frontend Types + QueryKeys

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/queryKeys.ts`

- [ ] **Step 1: Añadir tipos al final de `frontend/src/lib/types.ts`**

```typescript
export interface MaintenanceThreshold {
  type: 'pto_hours' | 'engine_hours' | 'calendar_days'
  value: number
}

export interface TriggerCondition {
  thresholds: MaintenanceThreshold[]
  op: 'OR'
}

export interface ThresholdProgress {
  type: string
  current: number
  limit: number
  pct: number
}

export interface MaintenanceProgress {
  status: 'ok' | 'próximo' | 'vencido'
  thresholds: ThresholdProgress[]
}

export interface MaintenancePlanOut {
  id: string
  vehicle_id: string
  vehicle_name: string
  tenant_id: string
  name: string
  trigger_condition: TriggerCondition
  warn_before_pct: number
  active: boolean
  created_at: string
  progress: MaintenanceProgress
}

export interface MaintenancePlanCreate {
  vehicle_id: string
  name: string
  trigger_condition: TriggerCondition
  warn_before_pct: number
  active: boolean
}

export interface MaintenanceLogOut {
  id: string
  plan_id: string | null
  vehicle_id: string
  performed_at: string
  performed_by_email: string | null
  description: string | null
  reset_counters: string[]
  cost_eur: number | null
}

export interface MaintenanceLogCreate {
  performed_at: string
  description?: string
  reset_counters: string[]
  cost_eur?: number
}
```

- [ ] **Step 2: Añadir claves al final de `frontend/src/lib/queryKeys.ts`**

```typescript
export const keys = {
  vehicles: () => ['vehicles'] as const,
  vehicle: (id: string) => ['vehicles', id] as const,
  vehicleStatus: (id: string) => ['vehicles', id, 'status'] as const,
  vehicleTrack: (id: string) => ['vehicles', id, 'track'] as const,
  vehicleKpis: (id: string) => ['vehicles', id, 'kpis'] as const,
  vehicleMaintenance: (id: string) => ['vehicles', id, 'maintenance'] as const,
  vehicleTypes: () => ['vehicle-types'] as const,
  alerts: () => ['alerts'] as const,
  rules: () => ['rules'] as const,
  rule: (id: string) => ['rules', id] as const,
  tenants: () => ['tenants'] as const,
  tenantBrandTokens: (tenantId: string) => ['tenants', tenantId, 'brand-tokens'] as const,
  settings: (tenantId?: string) => tenantId ? ['settings', tenantId] as const : ['settings'] as const,
  maintenancePlans: () => ['maintenance', 'plans'] as const,
  maintenancePlan: (id: string) => ['maintenance', 'plans', id] as const,
  maintenanceLogs: (planId: string) => ['maintenance', 'plans', planId, 'logs'] as const,
}
```

- [ ] **Step 3: Verificar que el proyecto TypeScript compila**

```bash
cd /opt/cmg-telematic1/frontend
npm run build 2>&1 | tail -5
```

Salida esperada: sin errores de tipos.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/queryKeys.ts
git commit -m "feat: maintenance types + query keys"
```

---

## Task 5: ProgressBar Component

**Files:**
- Create: `frontend/src/features/maintenance/ProgressBar.tsx`
- Create: `frontend/src/features/maintenance/__tests__/ProgressBar.test.tsx`

- [ ] **Step 1: Escribir test (fallará — componente no existe)**

Crear `frontend/src/features/maintenance/__tests__/ProgressBar.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProgressBar from '../ProgressBar'

describe('ProgressBar', () => {
  it('muestra el porcentaje', () => {
    render(<ProgressBar pct={75} status="ok" />)
    expect(screen.getByText('75%')).toBeInTheDocument()
  })

  it('color verde para ok', () => {
    const { container } = render(<ProgressBar pct={30} status="ok" />)
    const fills = container.querySelectorAll('div')
    const fill = Array.from(fills).find(el => el.style.background === 'var(--accent-ok)')
    expect(fill).toBeTruthy()
  })

  it('color naranja para próximo', () => {
    const { container } = render(<ProgressBar pct={92} status="próximo" />)
    const fills = container.querySelectorAll('div')
    const fill = Array.from(fills).find(el => el.style.background === 'var(--accent-warn)')
    expect(fill).toBeTruthy()
  })

  it('color rojo para vencido', () => {
    const { container } = render(<ProgressBar pct={105} status="vencido" />)
    const fills = container.querySelectorAll('div')
    const fill = Array.from(fills).find(el => el.style.background === 'var(--accent-crit)')
    expect(fill).toBeTruthy()
  })

  it('limita el fill a 100% aunque pct sea mayor', () => {
    const { container } = render(<ProgressBar pct={150} status="vencido" />)
    const fills = container.querySelectorAll('div')
    const fill = Array.from(fills).find(el => el.style.width === '100%') as HTMLElement
    expect(fill).toBeTruthy()
  })
})
```

- [ ] **Step 2: Confirmar que el test falla**

```bash
cd /opt/cmg-telematic1/frontend
npm test -- --run src/features/maintenance/__tests__/ProgressBar.test.tsx 2>&1 | tail -10
```

Salida esperada: `Cannot find module '../ProgressBar'`

- [ ] **Step 3: Crear `frontend/src/features/maintenance/ProgressBar.tsx`**

```typescript
const STATUS_COLOR = {
  ok: 'var(--accent-ok)',
  'próximo': 'var(--accent-warn)',
  vencido: 'var(--accent-crit)',
} as const

interface ProgressBarProps {
  pct: number
  status: keyof typeof STATUS_COLOR
  showLabel?: boolean
}

export default function ProgressBar({ pct, status, showLabel = true }: ProgressBarProps) {
  const fill = Math.min(pct, 100)
  const color = STATUS_COLOR[status]

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        flex: 1,
        height: 6,
        background: 'var(--gauge-track)',
        borderRadius: 3,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${fill}%`,
          height: '100%',
          background: color,
          borderRadius: 3,
          transition: 'width 0.3s ease',
        }} />
      </div>
      {showLabel && (
        <span style={{
          fontSize: 11,
          fontFamily: 'var(--font-data)',
          color,
          minWidth: 36,
          textAlign: 'right',
        }}>
          {Math.round(pct)}%
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Confirmar que el test pasa**

```bash
npm test -- --run src/features/maintenance/__tests__/ProgressBar.test.tsx
```

Salida esperada: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/maintenance/ProgressBar.tsx \
        frontend/src/features/maintenance/__tests__/ProgressBar.test.tsx
git commit -m "feat: ProgressBar component — ok/próximo/vencido colors"
```

---

## Task 6: MaintenancePage

**Files:**
- Create: `frontend/src/features/maintenance/MaintenancePage.tsx`
- Create: `frontend/src/features/maintenance/__tests__/MaintenancePage.test.tsx`

- [ ] **Step 1: Escribir test**

Crear `frontend/src/features/maintenance/__tests__/MaintenancePage.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import MaintenancePage from '../MaintenancePage'
import type { MaintenancePlanOut } from '../../../lib/types'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: { get: vi.fn() },
}))
vi.mock('../../../features/auth/useAuthStore', () => ({
  useAuthStore: vi.fn(() => ({ user: { role: 'admin', tenant_tier: 'client' } })),
}))

import { apiClient } from '../../../lib/apiClient'

const mockPlan: MaintenancePlanOut = {
  id: 'p1', vehicle_id: 'v1', vehicle_name: 'WR-04', tenant_id: 't1',
  name: 'Cambio aceite', trigger_condition: { thresholds: [{ type: 'pto_hours', value: 500 }], op: 'OR' },
  warn_before_pct: 10, active: true, created_at: '2026-04-20T00:00:00Z',
  progress: {
    status: 'próximo',
    thresholds: [{ type: 'pto_hours', current: 460, limit: 500, pct: 92 }],
  },
}

function wrap(plans: MaintenancePlanOut[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(['maintenance', 'plans'], plans)
  qc.setQueryData(['vehicles'], [])
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MaintenancePage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('MaintenancePage', () => {
  it('muestra mensaje vacío cuando no hay planes', () => {
    vi.mocked(apiClient.get).mockResolvedValue([])
    wrap([])
    expect(screen.getByText(/Sin planes de mantenimiento/)).toBeInTheDocument()
  })

  it('muestra nombre del vehículo y del plan', () => {
    vi.mocked(apiClient.get).mockResolvedValue([mockPlan])
    wrap([mockPlan])
    expect(screen.getByText('WR-04')).toBeInTheDocument()
    expect(screen.getByText('Cambio aceite')).toBeInTheDocument()
  })

  it('muestra badge de estado PRÓXIMO', () => {
    vi.mocked(apiClient.get).mockResolvedValue([mockPlan])
    wrap([mockPlan])
    expect(screen.getByText('PRÓXIMO')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Confirmar que el test falla**

```bash
npm test -- --run src/features/maintenance/__tests__/MaintenancePage.test.tsx 2>&1 | tail -5
```

- [ ] **Step 3: Crear `frontend/src/features/maintenance/MaintenancePage.tsx`**

```typescript
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import ProgressBar from './ProgressBar'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { MaintenancePlanOut, VehicleOut } from '../../lib/types'

const STATUS_LABEL: Record<string, string> = { ok: 'OK', 'próximo': 'PRÓXIMO', vencido: 'VENCIDO' }
const STATUS_COLOR: Record<string, string> = {
  ok: 'var(--accent-ok)',
  'próximo': 'var(--accent-warn)',
  vencido: 'var(--accent-crit)',
}
const THRESHOLD_LABEL: Record<string, string> = {
  pto_hours: 'h PTO',
  engine_hours: 'h motor',
  calendar_days: 'días',
}
const STATUS_ORDER: Record<string, number> = { vencido: 0, 'próximo': 1, ok: 2 }

export default function MaintenancePage() {
  const [vehicleFilter, setVehicleFilter] = useState('')

  const { data: plans = [], isLoading } = useQuery({
    queryKey: keys.maintenancePlans(),
    queryFn: () => apiClient.get<MaintenancePlanOut[]>('/api/v1/maintenance/plans'),
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: keys.vehicles(),
    queryFn: () => apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    staleTime: Infinity,
  })

  const sorted = [...plans]
    .filter(p => !vehicleFilter || p.vehicle_id === vehicleFilter)
    .sort((a, b) => (STATUS_ORDER[a.progress.status] ?? 3) - (STATUS_ORDER[b.progress.status] ?? 3))

  return (
    <Shell title="Mantenimiento">
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <select
            value={vehicleFilter}
            onChange={e => setVehicleFilter(e.target.value)}
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--bg-border)',
              color: 'var(--text-primary)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
            }}
          >
            <option value="">Todos los vehículos</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <Link
            to="/maintenance/new"
            style={{
              background: 'var(--accent-energy)',
              color: '#fff',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 12,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            + Nuevo plan
          </Link>
        </div>

        {isLoading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Cargando…</div>
        ) : sorted.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Sin planes de mantenimiento configurados</div>
        ) : (
          <div style={{ background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--bg-border)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
                  {['VEHÍCULO', 'PLAN', 'PROGRESO', 'ESTADO', ''].map(h => (
                    <th key={h} style={{ padding: '8px 16px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', textAlign: 'left' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((plan, i) => {
                  const worst = plan.progress.thresholds.length > 0
                    ? plan.progress.thresholds.reduce((a, b) => a.pct > b.pct ? a : b)
                    : null
                  return (
                    <tr key={plan.id} style={{ borderBottom: i < sorted.length - 1 ? '1px solid var(--bg-border)' : 'none' }}>
                      <td style={{ padding: '10px 16px', fontSize: 13 }}>{plan.vehicle_name}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <Link to={`/maintenance/${plan.id}`} style={{ color: 'var(--text-primary)', fontSize: 13 }}>
                          {plan.name}
                        </Link>
                      </td>
                      <td style={{ padding: '10px 16px', minWidth: 200 }}>
                        {worst && (
                          <div>
                            <ProgressBar pct={worst.pct} status={plan.progress.status} />
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                              {THRESHOLD_LABEL[worst.type] ?? worst.type}: {Math.round(worst.current)}/{worst.limit}
                            </div>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: STATUS_COLOR[plan.progress.status] ?? 'var(--text-muted)' }}>
                          {STATUS_LABEL[plan.progress.status] ?? plan.progress.status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <Link to={`/maintenance/${plan.id}/edit`} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          Editar
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  )
}
```

- [ ] **Step 4: Confirmar que el test pasa**

```bash
npm test -- --run src/features/maintenance/__tests__/MaintenancePage.test.tsx
```

Salida esperada: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/maintenance/MaintenancePage.tsx \
        frontend/src/features/maintenance/__tests__/MaintenancePage.test.tsx
git commit -m "feat: MaintenancePage — tabla global con semáforo de estado"
```

---

## Task 7: MaintenancePlanFormPage + ThresholdBuilder

**Files:**
- Create: `frontend/src/features/maintenance/ThresholdBuilder.tsx`
- Create: `frontend/src/features/maintenance/MaintenancePlanFormPage.tsx`
- Create: `frontend/src/features/maintenance/__tests__/MaintenancePlanFormPage.test.tsx`

- [ ] **Step 1: Escribir test**

Crear `frontend/src/features/maintenance/__tests__/MaintenancePlanFormPage.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import MaintenancePlanFormPage from '../MaintenancePlanFormPage'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}))
vi.mock('../../../features/auth/useAuthStore', () => ({
  useAuthStore: vi.fn(() => ({ user: { role: 'admin', tenant_tier: 'client' } })),
}))

import { apiClient } from '../../../lib/apiClient'

function wrap(path = '/maintenance/new') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(['vehicles'], [{ id: 'v1', name: 'WR-04' }])
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/maintenance/new" element={<MaintenancePlanFormPage />} />
          <Route path="/maintenance/:id/edit" element={<MaintenancePlanFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('MaintenancePlanFormPage', () => {
  it('renderiza el formulario con campo nombre', () => {
    vi.mocked(apiClient.get).mockResolvedValue([{ id: 'v1', name: 'WR-04' }])
    wrap()
    expect(screen.getByPlaceholderText(/Nombre del plan/i)).toBeInTheDocument()
  })

  it('no permite submit sin nombre', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([])
    wrap()
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(apiClient.post).not.toHaveBeenCalled())
  })

  it('submit llama a POST con el payload correcto', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([{ id: 'v1', name: 'WR-04' }])
    vi.mocked(apiClient.post).mockResolvedValue({ id: 'p1', name: 'Aceite' })
    wrap()

    fireEvent.change(screen.getByPlaceholderText(/Nombre del plan/i), { target: { value: 'Aceite hidráulico' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/maintenance/plans',
      expect.objectContaining({ name: 'Aceite hidráulico' })
    ))
  })
})
```

- [ ] **Step 2: Confirmar que el test falla**

```bash
npm test -- --run src/features/maintenance/__tests__/MaintenancePlanFormPage.test.tsx 2>&1 | tail -5
```

- [ ] **Step 3: Crear `frontend/src/features/maintenance/ThresholdBuilder.tsx`**

```typescript
import type { MaintenanceThreshold } from '../../lib/types'

const TYPE_OPTIONS = [
  { value: 'pto_hours', label: 'Horas PTO' },
  { value: 'engine_hours', label: 'Horas motor' },
  { value: 'calendar_days', label: 'Días calendario' },
] as const

const TYPE_UNIT: Record<string, string> = {
  pto_hours: 'horas',
  engine_hours: 'horas',
  calendar_days: 'días',
}

interface Props {
  thresholds: MaintenanceThreshold[]
  onChange: (thresholds: MaintenanceThreshold[]) => void
}

export default function ThresholdBuilder({ thresholds, onChange }: Props) {
  function add() {
    onChange([...thresholds, { type: 'pto_hours', value: 500 }])
  }

  function remove(i: number) {
    onChange(thresholds.filter((_, idx) => idx !== i))
  }

  function update(i: number, field: keyof MaintenanceThreshold, val: string) {
    const next = thresholds.map((t, idx) =>
      idx === i ? { ...t, [field]: field === 'value' ? Number(val) : val } : t
    )
    onChange(next)
  }

  const inputStyle = {
    background: 'var(--bg-base)',
    border: '1px solid var(--bg-border)',
    color: 'var(--text-primary)',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 13,
  }

  return (
    <div>
      {thresholds.map((t, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <select
            value={t.type}
            onChange={e => update(i, 'type', e.target.value)}
            style={inputStyle}
          >
            {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            type="number"
            value={t.value}
            min={1}
            onChange={e => update(i, 'value', e.target.value)}
            style={{ ...inputStyle, width: 90 }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{TYPE_UNIT[t.type]}</span>
          {thresholds.length > 1 && (
            <button
              type="button"
              onClick={() => remove(i)}
              style={{ background: 'none', border: 'none', color: 'var(--accent-crit)', cursor: 'pointer', fontSize: 16 }}
              title="Eliminar umbral"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        style={{
          background: 'none',
          border: '1px dashed var(--bg-border)',
          color: 'var(--text-muted)',
          borderRadius: 6,
          padding: '5px 12px',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        + Añadir umbral
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Crear `frontend/src/features/maintenance/MaintenancePlanFormPage.tsx`**

```typescript
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import ThresholdBuilder from './ThresholdBuilder'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleOut, MaintenancePlanOut, MaintenancePlanCreate, MaintenanceThreshold } from '../../lib/types'

const DEFAULT_THRESHOLDS: MaintenanceThreshold[] = [{ type: 'pto_hours', value: 500 }]

export default function MaintenancePlanFormPage() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEdit = !!id

  const [name, setName] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [thresholds, setThresholds] = useState<MaintenanceThreshold[]>(DEFAULT_THRESHOLDS)
  const [warnPct, setWarnPct] = useState(10)
  const [active, setActive] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { data: vehicles = [] } = useQuery({
    queryKey: keys.vehicles(),
    queryFn: () => apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    staleTime: Infinity,
  })

  const { data: existing } = useQuery({
    queryKey: keys.maintenancePlan(id ?? ''),
    queryFn: () => apiClient.get<MaintenancePlanOut>(`/api/v1/maintenance/plans/${id}`),
    enabled: isEdit,
  })

  useEffect(() => {
    if (existing) {
      setName(existing.name)
      setVehicleId(existing.vehicle_id)
      setThresholds(existing.trigger_condition.thresholds)
      setWarnPct(existing.warn_before_pct)
      setActive(existing.active)
    } else if (vehicles.length > 0 && !vehicleId) {
      setVehicleId(vehicles[0].id)
    }
  }, [existing, vehicles])

  const mutation = useMutation({
    mutationFn: (payload: MaintenancePlanCreate) =>
      isEdit
        ? apiClient.put<MaintenancePlanOut>(`/api/v1/maintenance/plans/${id}`, payload)
        : apiClient.post<MaintenancePlanOut>('/api/v1/maintenance/plans', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.maintenancePlans() })
      navigate('/maintenance')
    },
    onError: () => setError('Error al guardar el plan'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    mutation.mutate({
      vehicle_id: vehicleId,
      name: name.trim(),
      trigger_condition: { thresholds, op: 'OR' },
      warn_before_pct: warnPct,
      active,
    })
  }

  const labelStyle = { fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }
  const inputStyle = { background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', color: 'var(--text-primary)', borderRadius: 6, padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box' as const }

  return (
    <Shell title={isEdit ? 'Editar plan' : 'Nuevo plan de mantenimiento'}>
      <div style={{ padding: 24, maxWidth: 600 }}>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            <div>
              <div style={labelStyle}>NOMBRE DEL PLAN</div>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Nombre del plan"
                required
                style={inputStyle}
              />
            </div>

            {!isEdit && (
              <div>
                <div style={labelStyle}>VEHÍCULO</div>
                <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} style={inputStyle}>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            )}

            <div>
              <div style={{ ...labelStyle, marginBottom: 10 }}>UMBRALES (se dispara al llegar al primero)</div>
              <ThresholdBuilder thresholds={thresholds} onChange={setThresholds} />
            </div>

            <div>
              <div style={labelStyle}>AVISAR CUANDO QUEDE (%)</div>
              <input
                type="number"
                value={warnPct}
                min={1}
                max={50}
                onChange={e => setWarnPct(Number(e.target.value))}
                style={{ ...inputStyle, width: 100 }}
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
              <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>Plan activo</span>
            </label>

            {error && <div style={{ color: 'var(--accent-crit)', fontSize: 13 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                type="submit"
                disabled={mutation.isPending}
                style={{
                  background: 'var(--accent-energy)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '10px 24px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: mutation.isPending ? 'not-allowed' : 'pointer',
                }}
              >
                {mutation.isPending ? 'Guardando…' : 'Guardar'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/maintenance')}
                style={{ background: 'none', border: '1px solid var(--bg-border)', color: 'var(--text-muted)', borderRadius: 6, padding: '10px 24px', fontSize: 13, cursor: 'pointer' }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </form>
      </div>
    </Shell>
  )
}
```

- [ ] **Step 5: Confirmar que el test pasa**

```bash
npm test -- --run src/features/maintenance/__tests__/MaintenancePlanFormPage.test.tsx
```

Salida esperada: `3 passed`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/maintenance/ThresholdBuilder.tsx \
        frontend/src/features/maintenance/MaintenancePlanFormPage.tsx \
        frontend/src/features/maintenance/__tests__/MaintenancePlanFormPage.test.tsx
git commit -m "feat: MaintenancePlanFormPage + ThresholdBuilder — crear/editar planes"
```

---

## Task 8: MaintenancePlanDetailPage + LogInterventionModal

**Files:**
- Create: `frontend/src/features/maintenance/LogInterventionModal.tsx`
- Create: `frontend/src/features/maintenance/MaintenancePlanDetailPage.tsx`
- Create: `frontend/src/features/maintenance/__tests__/LogInterventionModal.test.tsx`

- [ ] **Step 1: Escribir test**

Crear `frontend/src/features/maintenance/__tests__/LogInterventionModal.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import LogInterventionModal from '../LogInterventionModal'

vi.mock('../../../lib/apiClient', () => ({
  apiClient: { post: vi.fn() },
}))

import { apiClient } from '../../../lib/apiClient'

const THRESHOLDS = [
  { type: 'pto_hours', value: 500 },
  { type: 'calendar_days', value: 365 },
]

function wrap(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LogInterventionModal planId="p1" thresholds={THRESHOLDS} onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('LogInterventionModal', () => {
  it('muestra checkboxes para cada contador', () => {
    wrap()
    expect(screen.getByText('Horas PTO')).toBeInTheDocument()
    expect(screen.getByText('Días calendario')).toBeInTheDocument()
  })

  it('submit llama a POST con contadores seleccionados', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ id: 'log1', reset_counters: ['pto_hours'] })
    wrap()

    fireEvent.click(screen.getByLabelText('Horas PTO'))
    fireEvent.click(screen.getByText('Registrar'))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/maintenance/plans/p1/logs',
      expect.objectContaining({ reset_counters: ['pto_hours'] })
    ))
  })

  it('llama onClose al cancelar', () => {
    const onClose = vi.fn()
    wrap(onClose)
    fireEvent.click(screen.getByText('Cancelar'))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Confirmar que el test falla**

```bash
npm test -- --run src/features/maintenance/__tests__/LogInterventionModal.test.tsx 2>&1 | tail -5
```

- [ ] **Step 3: Crear `frontend/src/features/maintenance/LogInterventionModal.tsx`**

```typescript
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { MaintenanceThreshold, MaintenanceLogCreate } from '../../lib/types'

const THRESHOLD_LABEL: Record<string, string> = {
  pto_hours: 'Horas PTO',
  engine_hours: 'Horas motor',
  calendar_days: 'Días calendario',
}

interface Props {
  planId: string
  thresholds: MaintenanceThreshold[]
  onClose: () => void
}

export default function LogInterventionModal({ planId, thresholds, onClose }: Props) {
  const qc = useQueryClient()
  const [description, setDescription] = useState('')
  const [costEur, setCostEur] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (payload: MaintenanceLogCreate) =>
      apiClient.post(`/api/v1/maintenance/plans/${planId}/logs`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.maintenancePlans() })
      qc.invalidateQueries({ queryKey: keys.maintenanceLogs(planId) })
      onClose()
    },
    onError: () => setError('Error al registrar la intervención'),
  })

  function toggle(type: string) {
    setSelected(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    mutation.mutate({
      performed_at: new Date().toISOString(),
      description: description.trim() || undefined,
      reset_counters: selected,
      cost_eur: costEur ? Number(costEur) : undefined,
    })
  }

  const inputStyle = { background: 'var(--bg-base)', border: '1px solid var(--bg-border)', color: 'var(--text-primary)', borderRadius: 6, padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box' as const }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 10, padding: 24, width: 420, border: '1px solid var(--bg-border)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 20 }}>
          Registrar intervención
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 8 }}>
                CONTADORES A RESETEAR
              </div>
              {thresholds.map(t => (
                <label key={t.type} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    aria-label={THRESHOLD_LABEL[t.type] ?? t.type}
                    checked={selected.includes(t.type)}
                    onChange={() => toggle(t.type)}
                  />
                  <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                    {THRESHOLD_LABEL[t.type] ?? t.type}
                  </span>
                </label>
              ))}
            </div>

            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }}>DESCRIPCIÓN</div>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Ej: Cambio aceite SAE 46, filtro hidráulico…"
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>

            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }}>COSTE (€)</div>
              <input
                type="number"
                value={costEur}
                onChange={e => setCostEur(e.target.value)}
                placeholder="0.00"
                min={0}
                step={0.01}
                style={{ ...inputStyle, width: 120 }}
              />
            </div>

            {error && <div style={{ color: 'var(--accent-crit)', fontSize: 13 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={onClose}
                style={{ background: 'none', border: '1px solid var(--bg-border)', color: 'var(--text-muted)', borderRadius: 6, padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={mutation.isPending}
                style={{ background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: mutation.isPending ? 'not-allowed' : 'pointer' }}
              >
                {mutation.isPending ? 'Guardando…' : 'Registrar'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Crear `frontend/src/features/maintenance/MaintenancePlanDetailPage.tsx`**

```typescript
import { useState } from 'react'
import { useParams, Navigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Shell from '../../shared/ui/Shell'
import ProgressBar from './ProgressBar'
import LogInterventionModal from './LogInterventionModal'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { MaintenancePlanOut, MaintenanceLogOut } from '../../lib/types'

const THRESHOLD_LABEL: Record<string, string> = {
  pto_hours: 'Horas PTO',
  engine_hours: 'Horas motor',
  calendar_days: 'Días calendario',
}

export default function MaintenancePlanDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [showLog, setShowLog] = useState(false)

  const { data: plan, isLoading } = useQuery({
    queryKey: keys.maintenancePlan(id ?? ''),
    queryFn: () => apiClient.get<MaintenancePlanOut>(`/api/v1/maintenance/plans/${id}`),
    enabled: !!id,
    refetchInterval: 60_000,
  })

  const { data: logs = [] } = useQuery({
    queryKey: keys.maintenanceLogs(id ?? ''),
    queryFn: () => apiClient.get<MaintenanceLogOut[]>(`/api/v1/maintenance/plans/${id}/logs`),
    enabled: !!id,
  })

  if (!id) return <Navigate to="/maintenance" replace />
  if (isLoading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
      Cargando…
    </div>
  )
  if (!plan) return <Navigate to="/maintenance" replace />

  return (
    <Shell title={plan.name}>
      <div style={{ padding: 24, maxWidth: 800 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{plan.vehicle_name}</div>
            <div style={{ fontSize: 18, color: 'var(--text-primary)', fontWeight: 600, marginTop: 2 }}>{plan.name}</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link to={`/maintenance/${id}/edit`} style={{ background: 'none', border: '1px solid var(--bg-border)', color: 'var(--text-muted)', borderRadius: 6, padding: '8px 16px', fontSize: 12, textDecoration: 'none' }}>
              Editar
            </Link>
            <button
              onClick={() => setShowLog(true)}
              style={{ background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              Registrar intervención
            </button>
          </div>
        </div>

        {/* Progress cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
          {plan.progress.thresholds.map(t => (
            <div key={t.type} style={{ background: 'var(--bg-surface)', borderRadius: 8, padding: '16px', border: '1px solid var(--bg-border)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 10 }}>
                {THRESHOLD_LABEL[t.type] ?? t.type.toUpperCase()}
              </div>
              <div style={{ fontSize: 22, fontFamily: 'var(--font-data)', fontWeight: 500, color: 'var(--text-primary)', marginBottom: 10 }}>
                {Math.round(t.current)} <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/ {t.limit}</span>
              </div>
              <ProgressBar pct={t.pct} status={plan.progress.status} />
            </div>
          ))}
        </div>

        {/* History */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 12 }}>
            HISTORIAL DE INTERVENCIONES
          </div>
          {logs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Sin intervenciones registradas</div>
          ) : (
            <div style={{ background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--bg-border)', overflow: 'hidden' }}>
              {logs.map((log, i) => (
                <div key={log.id} style={{ padding: '12px 16px', borderBottom: i < logs.length - 1 ? '1px solid var(--bg-border)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                        {log.description ?? 'Intervención registrada'}
                      </div>
                      {log.reset_counters.length > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                          Resetea: {log.reset_counters.map(c => THRESHOLD_LABEL[c] ?? c).join(', ')}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>
                        {new Date(log.performed_at).toLocaleDateString('es-ES')}
                      </div>
                      {log.cost_eur != null && (
                        <div style={{ fontSize: 12, color: 'var(--accent-ok)', fontFamily: 'var(--font-data)', marginTop: 2 }}>
                          {log.cost_eur.toFixed(2)} €
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showLog && (
        <LogInterventionModal
          planId={id}
          thresholds={plan.trigger_condition.thresholds}
          onClose={() => setShowLog(false)}
        />
      )}
    </Shell>
  )
}
```

- [ ] **Step 5: Confirmar que el test pasa**

```bash
npm test -- --run src/features/maintenance/__tests__/LogInterventionModal.test.tsx
```

Salida esperada: `3 passed`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/maintenance/LogInterventionModal.tsx \
        frontend/src/features/maintenance/MaintenancePlanDetailPage.tsx \
        frontend/src/features/maintenance/__tests__/LogInterventionModal.test.tsx
git commit -m "feat: MaintenancePlanDetailPage + LogInterventionModal"
```

---

## Task 9: Wiring — Icon, Sidebar, App Routes, VehicleDetailPage Badge

**Files:**
- Modify: `frontend/src/shared/ui/icons.tsx`
- Modify: `frontend/src/shared/ui/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/features/vehicle/VehicleDetailPage.tsx`

- [ ] **Step 1: Añadir `IconMantenimiento` a `frontend/src/shared/ui/icons.tsx`**

Añadir al final del fichero (antes del último `}`):

```typescript
// Maintenance: wrench tool shape
export function IconMantenimiento(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </Icon>
  )
}
```

- [ ] **Step 2: Añadir entrada en `frontend/src/shared/ui/Sidebar.tsx`**

Sustituir la línea de imports y el array `NAV_ITEMS`:

```typescript
import { IconFlota, IconAlertas, IconReglas, IconMantenimiento, IconAjustes } from './icons'

const NAV_ITEMS = [
  { to: '/fleet',       Icon: IconFlota,          label: 'Flota',          active: true },
  { to: '/alerts',      Icon: IconAlertas,         label: 'Alertas',        active: true },
  { to: '/maintenance', Icon: IconMantenimiento,   label: 'Mantenimiento',  active: true },
  { to: '/rules',       Icon: IconReglas,          label: 'Reglas',         active: true },
]
```

- [ ] **Step 3: Añadir rutas en `frontend/src/App.tsx`**

Sustituir el contenido de `App.tsx`:

```typescript
import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './features/auth/LoginPage'
import RequireAuth from './features/auth/RequireAuth'

const FleetPage                  = lazy(() => import('./features/fleet/FleetPage'))
const VehicleDetailPage          = lazy(() => import('./features/vehicle/VehicleDetailPage'))
const AlertsPage                 = lazy(() => import('./features/alerts/AlertsPage'))
const SettingsPage               = lazy(() => import('./features/settings/SettingsPage'))
const RulesPage                  = lazy(() => import('./features/rules/RulesPage'))
const RuleFormPage               = lazy(() => import('./features/rules/RuleFormPage'))
const MaintenancePage            = lazy(() => import('./features/maintenance/MaintenancePage'))
const MaintenancePlanFormPage    = lazy(() => import('./features/maintenance/MaintenancePlanFormPage'))
const MaintenancePlanDetailPage  = lazy(() => import('./features/maintenance/MaintenancePlanDetailPage'))

function Loading() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-base)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-muted)',
    }}>
      Cargando…
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="fleet"                element={<FleetPage />} />
                <Route path="vehicles/:id"         element={<VehicleDetailPage />} />
                <Route path="alerts"               element={<AlertsPage />} />
                <Route path="settings"             element={<SettingsPage />} />
                <Route path="rules"                element={<RulesPage />} />
                <Route path="rules/new"            element={<RuleFormPage />} />
                <Route path="rules/:id"            element={<RuleFormPage />} />
                <Route path="maintenance"          element={<MaintenancePage />} />
                <Route path="maintenance/new"      element={<MaintenancePlanFormPage />} />
                <Route path="maintenance/:id"      element={<MaintenancePlanDetailPage />} />
                <Route path="maintenance/:id/edit" element={<MaintenancePlanFormPage />} />
                <Route path="*"                    element={<Navigate to="/fleet" replace />} />
              </Routes>
            </Suspense>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
```

- [ ] **Step 4: Añadir badge de mantenimiento en `frontend/src/features/vehicle/VehicleDetailPage.tsx`**

Añadir query y badge. Primero, añadir la query después de la de `kpis`:

```typescript
  const { data: maintenancePlans = [] } = useQuery({
    queryKey: keys.vehicleMaintenance(id ?? ''),
    queryFn: () => apiClient.get<MaintenancePlanOut[]>(`/api/v1/vehicles/${id}/maintenance`),
    enabled: !!vehicle,
  })
  const urgentCount = maintenancePlans.filter(
    p => p.progress.status === 'vencido' || p.progress.status === 'próximo'
  ).length
```

Añadir el import de `MaintenancePlanOut` a los tipos existentes en la línea de importación:

```typescript
import type { VehicleOut, VehicleStatus, TrackPoint, VehicleTypeOut, KpiHour, MaintenancePlanOut } from '../../lib/types'
```

Añadir badge junto al título en el componente `Shell` (justo después de `<Shell title={vehicle.name}>`):

```typescript
    <Shell title={vehicle.name}>
      {urgentCount > 0 && (
        <div style={{ padding: '6px 24px 0' }}>
          <a
            href={`/maintenance?vehicle=${id}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: urgentCount > 0 ? 'rgba(239,68,68,0.15)' : 'transparent',
              border: `1px solid var(--accent-crit)`,
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 11,
              color: 'var(--accent-crit)',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            ⚠ {urgentCount} plan{urgentCount > 1 ? 'es' : ''} de mantenimiento pendiente{urgentCount > 1 ? 's' : ''}
          </a>
        </div>
      )}
```

Cerrar el `div` del badge antes de `<div style={{ height: '100%', overflowY: 'auto' }}>`. El JSX queda:

```tsx
  return (
    <Shell title={vehicle.name}>
      {urgentCount > 0 && (
        <div style={{ padding: '6px 24px 0' }}>
          <a
            href={`/maintenance?vehicle=${id}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid var(--accent-crit)',
              borderRadius: 6, padding: '4px 10px',
              fontSize: 11, color: 'var(--accent-crit)',
              textDecoration: 'none', fontWeight: 600,
            }}
          >
            ⚠ {urgentCount} plan{urgentCount > 1 ? 'es' : ''} de mantenimiento pendiente{urgentCount > 1 ? 's' : ''}
          </a>
        </div>
      )}
      <div style={{ height: '100%', overflowY: 'auto' }}>
        {/* ... resto sin cambios ... */}
```

- [ ] **Step 5: Verificar compilación TypeScript**

```bash
cd /opt/cmg-telematic1/frontend
npm run build 2>&1 | tail -10
```

Salida esperada: sin errores.

- [ ] **Step 6: Ejecutar suite completa de tests frontend**

```bash
npm test -- --run 2>&1 | tail -15
```

Salida esperada: todos los tests pasando (incluyendo los nuevos de mantenimiento).

- [ ] **Step 7: Ejecutar suite backend completa**

```bash
cd /opt/cmg-telematic1
python3 -m pytest tests/api/ -v 2>&1 | tail -15
```

Salida esperada: todos los tests pasando.

- [ ] **Step 8: Commit final**

```bash
git add frontend/src/shared/ui/icons.tsx \
        frontend/src/shared/ui/Sidebar.tsx \
        frontend/src/App.tsx \
        frontend/src/features/vehicle/VehicleDetailPage.tsx
git commit -m "feat: Sprint 10 wiring — sidebar Mantenimiento, rutas, badge vehículo"
```

---

## Self-Review

**Cobertura del spec:**
- ✅ Backend schemas + Pydantic → Task 1
- ✅ Alembic migration → Task 1
- ✅ Endpoints CRUD planes → Task 3
- ✅ Endpoint logs → Task 3
- ✅ `/vehicles/:id/maintenance` → Task 3
- ✅ Progreso desde TimescaleDB con baseline por log → Task 3
- ✅ Permisos admin / permission_grant → Task 3
- ✅ ProgressBar con colores ok/próximo/vencido → Task 5
- ✅ MaintenancePage tabla global con filtro y ordenación → Task 6
- ✅ MaintenancePlanFormPage + ThresholdBuilder → Task 7
- ✅ MaintenancePlanDetailPage + LogInterventionModal → Task 8
- ✅ Sidebar entrada + App routes → Task 9
- ✅ Badge en VehicleDetailPage → Task 9
- ✅ Tests backend 8 escenarios → Task 2
- ✅ Tests frontend 4 suites → Tasks 5-8

**Tipos consistentes en todo el plan:**
- `MaintenancePlanOut.progress.status` → `'ok' | 'próximo' | 'vencido'` (Task 1, 4, 5, 6)
- `keys.maintenancePlans()` → `['maintenance', 'plans']` (Task 4, usada en Tasks 6-8)
- `apiClient.post('/api/v1/maintenance/plans/:id/logs', payload)` (Task 3, Task 8 test)
- `_compute_progress` importada en vehicles.py vía `from app.api.v1.maintenance import _compute_progress` (Task 3)
