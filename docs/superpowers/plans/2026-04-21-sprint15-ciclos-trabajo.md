# Sprint 15 — Ciclos de Trabajo y Exportación CSV

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir un sistema genérico de ciclos de trabajo configurable por tipo de vehículo (detección retroactiva desde telemetría) y exportación CSV de alertas y logs de mantenimiento.

**Architecture:** Dos nuevas tablas (`work_cycle_definition`, `work_cycle`) + servicio `cycle_detector.py` que consulta `telemetry_record` retroactivamente según 4 tipos de trigger (pto_change, threshold_exceeded, sensor_pulse, ignition_period). Los ciclos se almacenan con `cycle_data JSONB` extensible. CSV export reutiliza `apiClient.getBlob()` ya existente.

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic, Pydantic v2, React + TanStack Query, TypeScript.

---

## Ficheros

| Fichero | Acción |
|---------|--------|
| `backend/alembic/versions/006_work_cycles.py` | Crear |
| `backend/app/models/work_cycle.py` | Crear |
| `backend/app/schemas/work_cycle.py` | Crear |
| `backend/app/services/cycle_detector.py` | Crear |
| `backend/app/api/v1/work_cycles.py` | Crear |
| `backend/app/api/v1/router.py` | Modificar |
| `backend/app/api/v1/alerts.py` | Modificar |
| `backend/app/api/v1/maintenance.py` | Modificar |
| `backend/tests/api/test_work_cycles_api.py` | Crear |
| `frontend/src/lib/types.ts` | Modificar |
| `frontend/src/lib/queryKeys.ts` | Modificar |
| `frontend/src/features/vehicle/WorkCyclesTab.tsx` | Crear |
| `frontend/src/features/vehicle/VehicleDetailPage.tsx` | Modificar |
| `frontend/src/features/settings/WorkCycleDefinitionsSection.tsx` | Crear |
| `frontend/src/features/settings/SettingsPage.tsx` | Modificar |
| `frontend/src/features/alerts/AlertsPage.tsx` | Modificar |
| `frontend/src/features/maintenance/MaintenancePage.tsx` | Modificar |

---

## Task 1 — Migración Alembic 006: tablas work_cycle_definition y work_cycle

**Files:**
- Create: `backend/alembic/versions/006_work_cycles.py`

- [ ] **Step 1: Verificar que 005 es la revisión actual**

```bash
ls backend/alembic/versions/
```
Esperado: ver `005_add_device_tenant_id.py` como el más reciente.

- [ ] **Step 2: Crear el fichero de migración**

Crear `backend/alembic/versions/006_work_cycles.py` con este contenido exacto:

```python
"""create work_cycle_definition and work_cycle

Revision ID: 006
Revises: 005
Create Date: 2026-04-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "work_cycle_definition",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "vehicle_type_id", UUID(as_uuid=True),
            sa.ForeignKey("vehicle_type.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "tenant_id", UUID(as_uuid=True),
            sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=True,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("trigger_type", sa.String(30), nullable=False),
        sa.Column("trigger_config", JSONB, nullable=False, server_default="'{}'"),
        sa.Column("snapshot_fields", JSONB, nullable=False, server_default="'[]'"),
        sa.Column("aggregate_fields", JSONB, nullable=False, server_default="'[]'"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_wcd_vehicle_type_id", "work_cycle_definition", ["vehicle_type_id"])
    op.create_index("ix_wcd_tenant_id", "work_cycle_definition", ["tenant_id"])

    op.create_table(
        "work_cycle",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "vehicle_id", UUID(as_uuid=True),
            sa.ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "definition_id", UUID(as_uuid=True),
            sa.ForeignKey("work_cycle_definition.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "tenant_id", UUID(as_uuid=True),
            sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("cycle_data", JSONB, nullable=False, server_default="'{}'"),
        sa.Column("lat", sa.Numeric(9, 6), nullable=True),
        sa.Column("lon", sa.Numeric(9, 6), nullable=True),
    )
    op.create_index("ix_wc_vehicle_id", "work_cycle", ["vehicle_id"])
    op.create_index("ix_wc_definition_id", "work_cycle", ["definition_id"])
    op.create_index("ix_wc_tenant_id", "work_cycle", ["tenant_id"])
    op.create_index("ix_wc_started_at", "work_cycle", ["started_at"])


def downgrade() -> None:
    op.drop_table("work_cycle")
    op.drop_table("work_cycle_definition")
```

- [ ] **Step 3: Verificar sintaxis**

```bash
cd /opt/cmg-telematic1 && python3 -c "import ast; ast.parse(open('backend/alembic/versions/006_work_cycles.py').read()); print('OK')"
```
Esperado: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/alembic/versions/006_work_cycles.py
git commit -m "feat: add work_cycle_definition and work_cycle tables (migration 006)"
```

---

## Task 2 — Modelos SQLAlchemy: WorkCycleDefinition y WorkCycle

**Files:**
- Create: `backend/app/models/work_cycle.py`

- [ ] **Step 1: Leer modelos existentes para confirmar el patrón**

```bash
head -10 backend/app/models/device.py
```

- [ ] **Step 2: Crear `backend/app/models/work_cycle.py`**

```python
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import String, ForeignKey, DateTime, Boolean, Integer, Numeric
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class WorkCycleDefinition(Base):
    __tablename__ = "work_cycle_definition"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_type_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicle_type.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id", ondelete="CASCADE"), nullable=True, index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    trigger_type: Mapped[str] = mapped_column(String(30), nullable=False)
    trigger_config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    snapshot_fields: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    aggregate_fields: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
    )

    cycles = relationship("WorkCycle", back_populates="definition", cascade="all, delete-orphan")


class WorkCycle(Base):
    __tablename__ = "work_cycle"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicle.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    definition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("work_cycle_definition.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cycle_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)
    lon: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)

    definition = relationship("WorkCycleDefinition", back_populates="cycles")
```

- [ ] **Step 3: Verificar sintaxis**

```bash
cd /opt/cmg-telematic1 && python3 -c "import ast; ast.parse(open('backend/app/models/work_cycle.py').read()); print('OK')"
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/models/work_cycle.py
git commit -m "feat: add WorkCycleDefinition and WorkCycle SQLAlchemy models"
```

---

## Task 3 — Schemas Pydantic

**Files:**
- Create: `backend/app/schemas/work_cycle.py`

- [ ] **Step 1: Crear `backend/app/schemas/work_cycle.py`**

```python
from __future__ import annotations
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any
from pydantic import BaseModel, ConfigDict, field_validator

_VALID_TRIGGER_TYPES = {"pto_change", "threshold_exceeded", "sensor_pulse", "ignition_period"}


class WorkCycleDefinitionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vehicle_type_id: uuid.UUID
    tenant_id: uuid.UUID | None
    name: str
    trigger_type: str
    trigger_config: dict[str, Any]
    snapshot_fields: list[str]
    aggregate_fields: list[str]
    active: bool
    created_at: datetime


class WorkCycleDefinitionCreate(BaseModel):
    vehicle_type_id: uuid.UUID
    name: str
    trigger_type: str
    trigger_config: dict[str, Any] = {}
    snapshot_fields: list[str] = []
    aggregate_fields: list[str] = []

    @field_validator("trigger_type")
    @classmethod
    def validate_trigger_type(cls, v: str) -> str:
        if v not in _VALID_TRIGGER_TYPES:
            raise ValueError(f"trigger_type debe ser uno de: {', '.join(sorted(_VALID_TRIGGER_TYPES))}")
        return v


class WorkCycleDefinitionUpdate(BaseModel):
    name: str | None = None
    trigger_config: dict[str, Any] | None = None
    snapshot_fields: list[str] | None = None
    aggregate_fields: list[str] | None = None
    active: bool | None = None


class WorkCycleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vehicle_id: uuid.UUID
    definition_id: uuid.UUID
    tenant_id: uuid.UUID
    started_at: datetime
    ended_at: datetime | None
    duration_seconds: int | None
    cycle_data: dict[str, Any]
    lat: Decimal | None
    lon: Decimal | None


class ComputeCyclesRequest(BaseModel):
    vehicle_id: uuid.UUID
    definition_id: uuid.UUID
    from_dt: datetime
    to_dt: datetime
```

- [ ] **Step 2: Verificar sintaxis e imports**

```bash
cd /opt/cmg-telematic1 && python3 -c "
import ast
ast.parse(open('backend/app/schemas/work_cycle.py').read())
import sys; sys.path.insert(0, 'backend')
from app.schemas.work_cycle import WorkCycleDefinitionOut, WorkCycleDefinitionCreate, WorkCycleOut, ComputeCyclesRequest
print('OK')
"
```
Esperado: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/work_cycle.py
git commit -m "feat: add work cycle Pydantic schemas"
```

---

## Task 4 — Servicio cycle_detector

**Files:**
- Create: `backend/app/services/cycle_detector.py`

- [ ] **Step 1: Crear `backend/app/services/cycle_detector.py`**

```python
"""Retroactive work cycle detection from telemetry_record.

detect_and_store_cycles() is the public entry point. It queries telemetry_record
for the given vehicle+period, groups records into cycles per trigger_type, builds
cycle_data from snapshot/aggregate fields, and writes work_cycle rows to the DB.
"""
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.models.work_cycle import WorkCycleDefinition, WorkCycle


async def detect_and_store_cycles(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    tenant_id: uuid.UUID,
    definition: WorkCycleDefinition,
    from_dt: datetime,
    to_dt: datetime,
) -> int:
    """Detect cycles and persist them. Returns number of cycles written."""
    await db.execute(
        text("""
            DELETE FROM work_cycle
            WHERE vehicle_id = :vid AND definition_id = :did
              AND started_at >= :from_dt AND started_at < :to_dt
        """),
        {"vid": str(vehicle_id), "did": str(definition.id), "from_dt": from_dt, "to_dt": to_dt},
    )

    trigger_type = definition.trigger_type
    config = definition.trigger_config or {}

    if trigger_type == "pto_change":
        rows = await _query_telemetry(db, vehicle_id, from_dt, to_dt, extra_cols=["pto_active"])
        groups = _group_boolean_periods(rows, "pto_active", True)
    elif trigger_type == "ignition_period":
        rows = await _query_telemetry(db, vehicle_id, from_dt, to_dt, extra_cols=["ignition"])
        groups = _group_boolean_periods(rows, "ignition", True)
    elif trigger_type == "threshold_exceeded":
        sensor = config.get("sensor", "")
        threshold = float(config.get("threshold", 0))
        operator = config.get("op", ">")
        rows = await _query_telemetry(db, vehicle_id, from_dt, to_dt, extra_cols=[])
        groups = _group_threshold_periods(rows, sensor, threshold, operator)
    elif trigger_type == "sensor_pulse":
        sensor = config.get("sensor", "")
        min_gap = int(config.get("min_gap_seconds", 30))
        rows = await _query_telemetry(db, vehicle_id, from_dt, to_dt, extra_cols=[])
        groups = _detect_pulses(rows, sensor, min_gap)
    else:
        return 0

    snapshot_fields: list[str] = definition.snapshot_fields or []
    aggregate_fields: list[str] = definition.aggregate_fields or []
    is_pulse = trigger_type == "sensor_pulse"

    for g in groups:
        group_rows = g["rows"]
        if not group_rows:
            continue
        cycle_data = _build_cycle_data(group_rows, snapshot_fields, aggregate_fields)
        start_row = group_rows[0]
        end_row = group_rows[-1]
        started_at: datetime = start_row["recorded_at"]
        ended_at: datetime | None = None if is_pulse else end_row["recorded_at"]
        duration: int | None = (
            None if is_pulse
            else int((end_row["recorded_at"] - started_at).total_seconds())
        )
        db.add(WorkCycle(
            vehicle_id=vehicle_id,
            definition_id=definition.id,
            tenant_id=tenant_id,
            started_at=started_at,
            ended_at=ended_at,
            duration_seconds=duration,
            cycle_data=cycle_data,
            lat=start_row.get("lat"),
            lon=start_row.get("lon"),
        ))

    await db.commit()
    return len(groups)


async def _query_telemetry(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    from_dt: datetime,
    to_dt: datetime,
    extra_cols: list[str],
) -> list[dict]:
    col_list = ", ".join(["recorded_at", "lat", "lon", "can_data"] + extra_cols)
    result = await db.execute(
        text(f"""
            SELECT {col_list}
            FROM telemetry_record
            WHERE vehicle_id = :vid
              AND recorded_at >= :from_dt AND recorded_at < :to_dt
            ORDER BY recorded_at
        """),
        {"vid": str(vehicle_id), "from_dt": from_dt, "to_dt": to_dt},
    )
    return [dict(row._mapping) for row in result]


def _group_boolean_periods(rows: list[dict], col: str, active_value: bool) -> list[dict]:
    cycles: list[dict] = []
    current: list[dict] = []
    for row in rows:
        if row.get(col) == active_value:
            current.append(row)
        else:
            if current:
                cycles.append({"rows": current})
                current = []
    if current:
        cycles.append({"rows": current})
    return cycles


def _group_threshold_periods(
    rows: list[dict], sensor: str, threshold: float, op: str
) -> list[dict]:
    def matches(row: dict) -> bool:
        raw = (row.get("can_data") or {}).get(sensor)
        if raw is None:
            return False
        try:
            v = float(raw)
        except (TypeError, ValueError):
            return False
        if op == ">":   return v > threshold
        if op == ">=":  return v >= threshold
        if op == "<":   return v < threshold
        if op == "<=":  return v <= threshold
        return v == threshold

    cycles: list[dict] = []
    current: list[dict] = []
    for row in rows:
        if matches(row):
            current.append(row)
        else:
            if current:
                cycles.append({"rows": current})
                current = []
    if current:
        cycles.append({"rows": current})
    return cycles


def _detect_pulses(
    rows: list[dict], sensor: str, min_gap_seconds: int
) -> list[dict]:
    pulses: list[dict] = []
    last_t: datetime | None = None
    for row in rows:
        val = (row.get("can_data") or {}).get(sensor)
        if val in (True, "true", "1", 1):
            t: datetime = row["recorded_at"]
            if last_t is None or (t - last_t).total_seconds() >= min_gap_seconds:
                pulses.append({"rows": [row]})
                last_t = t
    return pulses


def _build_cycle_data(
    rows: list[dict],
    snapshot_fields: list[str],
    aggregate_fields: list[str],
) -> dict[str, Any]:
    data: dict[str, Any] = {}
    if not rows:
        return data

    can_start = rows[0].get("can_data") or {}
    can_end = rows[-1].get("can_data") or {}

    for field in snapshot_fields:
        if (v := can_start.get(field)) is not None:
            data[f"{field}_start"] = v
        if (v := can_end.get(field)) is not None:
            data[f"{field}_end"] = v

    for field in aggregate_fields:
        values = []
        for row in rows:
            raw = (row.get("can_data") or {}).get(field)
            if raw is not None:
                try:
                    values.append(float(raw))
                except (TypeError, ValueError):
                    pass
        if values:
            data[f"{field}_sum"] = round(sum(values), 3)
            data[f"{field}_avg"] = round(sum(values) / len(values), 3)
            data[f"{field}_max"] = round(max(values), 3)

    return data
```

- [ ] **Step 2: Verificar sintaxis**

```bash
cd /opt/cmg-telematic1 && python3 -c "import ast; ast.parse(open('backend/app/services/cycle_detector.py').read()); print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/cycle_detector.py
git commit -m "feat: add cycle_detector service — retroactive work cycle detection from telemetry"
```

---

## Task 5 — Endpoints work_cycles.py

**Files:**
- Create: `backend/app/api/v1/work_cycles.py`

- [ ] **Step 1: Crear `backend/app/api/v1/work_cycles.py`**

```python
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.schemas.auth import CurrentUser
from app.schemas.work_cycle import (
    WorkCycleDefinitionOut, WorkCycleDefinitionCreate, WorkCycleDefinitionUpdate,
    WorkCycleOut, ComputeCyclesRequest,
)
from app.models.work_cycle import WorkCycleDefinition, WorkCycle
from app.models.vehicle import Vehicle
from app.services.cycle_detector import detect_and_store_cycles

router = APIRouter(tags=["work_cycles"])


# ── Definitions ──────────────────────────────────────────────────────────────

@router.get("/definitions", response_model=list[WorkCycleDefinitionOut])
async def list_definitions(
    vehicle_type_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(WorkCycleDefinition)
    if user.tenant_tier != "cmg":
        q = q.where(
            or_(WorkCycleDefinition.tenant_id == user.tenant_id,
                WorkCycleDefinition.tenant_id.is_(None))
        )
    if vehicle_type_id:
        q = q.where(WorkCycleDefinition.vehicle_type_id == vehicle_type_id)
    result = await db.execute(q.order_by(WorkCycleDefinition.created_at.desc()))
    return result.scalars().all()


@router.post("/definitions", response_model=WorkCycleDefinitionOut, status_code=status.HTTP_201_CREATED)
async def create_definition(
    body: WorkCycleDefinitionCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    tenant_id = None if user.tenant_tier == "cmg" else user.tenant_id
    defn = WorkCycleDefinition(
        vehicle_type_id=body.vehicle_type_id,
        tenant_id=tenant_id,
        name=body.name,
        trigger_type=body.trigger_type,
        trigger_config=body.trigger_config,
        snapshot_fields=body.snapshot_fields,
        aggregate_fields=body.aggregate_fields,
    )
    db.add(defn)
    await db.commit()
    await db.refresh(defn)
    return defn


@router.patch("/definitions/{definition_id}", response_model=WorkCycleDefinitionOut)
async def update_definition(
    definition_id: uuid.UUID,
    body: WorkCycleDefinitionUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    defn = await db.get(WorkCycleDefinition, definition_id)
    if not defn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Definición no encontrada")
    if user.tenant_tier != "cmg" and str(defn.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Definición no encontrada")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(defn, field, value)
    await db.commit()
    await db.refresh(defn)
    return defn


@router.delete("/definitions/{definition_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_definition(
    definition_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    defn = await db.get(WorkCycleDefinition, definition_id)
    if not defn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Definición no encontrada")
    if user.tenant_tier != "cmg" and str(defn.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Definición no encontrada")
    await db.delete(defn)
    await db.commit()


# ── Cycles ───────────────────────────────────────────────────────────────────

@router.get("", response_model=list[WorkCycleOut])
async def list_cycles(
    vehicle_id: uuid.UUID = Query(...),
    from_dt: datetime = Query(...),
    to_dt: datetime = Query(...),
    definition_id: uuid.UUID | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(WorkCycle).where(
        WorkCycle.vehicle_id == vehicle_id,
        WorkCycle.started_at >= from_dt,
        WorkCycle.started_at < to_dt,
    )
    if user.tenant_tier != "cmg":
        q = q.where(WorkCycle.tenant_id == user.tenant_id)
    if definition_id:
        q = q.where(WorkCycle.definition_id == definition_id)
    result = await db.execute(q.order_by(WorkCycle.started_at))
    return result.scalars().all()


@router.post("/compute")
async def compute_cycles(
    body: ComputeCyclesRequest,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol admin")
    defn = await db.get(WorkCycleDefinition, body.definition_id)
    if not defn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Definición no encontrada")
    vehicle = await db.get(Vehicle, body.vehicle_id)
    if not vehicle or not vehicle.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    if user.tenant_tier != "cmg" and str(vehicle.tenant_id) != str(user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    count = await detect_and_store_cycles(
        db, body.vehicle_id, vehicle.tenant_id, defn, body.from_dt, body.to_dt
    )
    return {"computed": count}
```

- [ ] **Step 2: Verificar sintaxis**

```bash
cd /opt/cmg-telematic1 && python3 -c "import ast; ast.parse(open('backend/app/api/v1/work_cycles.py').read()); print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/v1/work_cycles.py
git commit -m "feat: add work_cycles endpoints (definitions CRUD + list cycles + compute)"
```

---

## Task 6 — Registrar router en router.py

**Files:**
- Modify: `backend/app/api/v1/router.py`

- [ ] **Step 1: Leer router.py para ver el patrón de registro existente**

```bash
cat backend/app/api/v1/router.py
```

- [ ] **Step 2: Añadir import y registro siguiendo el patrón existente**

Añadir al final de los imports:
```python
from app.api.v1.work_cycles import router as work_cycles_router
```

Añadir al final de los `include_router`:
```python
api_router.include_router(work_cycles_router, prefix="/work-cycles")
```

- [ ] **Step 3: Verificar sintaxis**

```bash
cd /opt/cmg-telematic1 && python3 -c "import ast; ast.parse(open('backend/app/api/v1/router.py').read()); print('OK')"
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/v1/router.py
git commit -m "feat: register work_cycles router at /api/v1/work-cycles"
```

---

## Task 7 — Tests backend (7 tests)

**Files:**
- Create: `backend/tests/api/test_work_cycles_api.py`

- [ ] **Step 1: Leer test_devices_api.py para copiar exactamente el patrón de mocks**

```bash
cat backend/tests/api/test_devices_api.py
```

- [ ] **Step 2: Crear `backend/tests/api/test_work_cycles_api.py`**

```python
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.deps import get_current_user
from app.core.database import get_db


def _make_user(tier="cmg", role="admin", tenant_id=None):
    u = MagicMock()
    u.tenant_tier = tier
    u.role = role
    u.tenant_id = tenant_id or uuid.uuid4()
    return u


def _make_db():
    db = AsyncMock()
    db.execute = AsyncMock()
    db.get = AsyncMock(return_value=None)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    return db


def _override(user, db):
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db


def test_wc_unauthenticated():
    app.dependency_overrides = {}
    client = TestClient(app, raise_server_exceptions=False)
    res = client.get("/api/v1/work-cycles/definitions")
    assert res.status_code in (401, 403)


def test_wc_cmg_admin_creates_definition():
    user = _make_user(tier="cmg", role="admin")
    db = _make_db()
    defn = MagicMock()
    defn.id = uuid.uuid4()
    defn.vehicle_type_id = uuid.uuid4()
    defn.tenant_id = None
    defn.name = "Ciclo PTO"
    defn.trigger_type = "pto_change"
    defn.trigger_config = {}
    defn.snapshot_fields = []
    defn.aggregate_fields = []
    defn.active = True
    from datetime import datetime, timezone
    defn.created_at = datetime.now(timezone.utc)
    db.refresh.side_effect = lambda obj: None

    async def fake_refresh(obj):
        obj.id = defn.id
        obj.vehicle_type_id = defn.vehicle_type_id
        obj.tenant_id = defn.tenant_id
        obj.name = defn.name
        obj.trigger_type = defn.trigger_type
        obj.trigger_config = defn.trigger_config
        obj.snapshot_fields = defn.snapshot_fields
        obj.aggregate_fields = defn.aggregate_fields
        obj.active = defn.active
        obj.created_at = defn.created_at

    db.refresh = fake_refresh
    _override(user, db)
    client = TestClient(app, raise_server_exceptions=False)
    res = client.post("/api/v1/work-cycles/definitions", json={
        "vehicle_type_id": str(uuid.uuid4()),
        "name": "Ciclo PTO",
        "trigger_type": "pto_change",
    })
    assert res.status_code == 201
    assert res.json()["trigger_type"] == "pto_change"
    assert res.json()["tenant_id"] is None


def test_wc_client_admin_creates_definition():
    tenant_id = uuid.uuid4()
    user = _make_user(tier="client", role="admin", tenant_id=tenant_id)
    db = _make_db()
    from datetime import datetime, timezone

    async def fake_refresh(obj):
        obj.id = uuid.uuid4()
        obj.vehicle_type_id = uuid.uuid4()
        obj.tenant_id = tenant_id
        obj.name = "Sensor inductivo"
        obj.trigger_type = "sensor_pulse"
        obj.trigger_config = {"sensor": "inductive", "min_gap_seconds": 30}
        obj.snapshot_fields = []
        obj.aggregate_fields = []
        obj.active = True
        obj.created_at = datetime.now(timezone.utc)

    db.refresh = fake_refresh
    _override(user, db)
    client = TestClient(app, raise_server_exceptions=False)
    res = client.post("/api/v1/work-cycles/definitions", json={
        "vehicle_type_id": str(uuid.uuid4()),
        "name": "Sensor inductivo",
        "trigger_type": "sensor_pulse",
        "trigger_config": {"sensor": "inductive", "min_gap_seconds": 30},
    })
    assert res.status_code == 201
    assert res.json()["tenant_id"] == str(tenant_id)


def test_wc_non_admin_cannot_create():
    user = _make_user(tier="client", role="operator")
    db = _make_db()
    _override(user, db)
    client = TestClient(app, raise_server_exceptions=False)
    res = client.post("/api/v1/work-cycles/definitions", json={
        "vehicle_type_id": str(uuid.uuid4()),
        "name": "X",
        "trigger_type": "pto_change",
    })
    assert res.status_code == 403


def test_wc_client_cannot_modify_global_definition():
    tenant_id = uuid.uuid4()
    user = _make_user(tier="client", role="admin", tenant_id=tenant_id)
    db = _make_db()
    defn = MagicMock()
    defn.tenant_id = None  # global CMG definition
    db.get.return_value = defn
    _override(user, db)
    client = TestClient(app, raise_server_exceptions=False)
    res = client.patch(f"/api/v1/work-cycles/definitions/{uuid.uuid4()}", json={"active": False})
    assert res.status_code == 404


def test_wc_list_cycles_scoped_to_tenant():
    tenant_id = uuid.uuid4()
    user = _make_user(tier="client", role="operator", tenant_id=tenant_id)
    db = _make_db()
    scalars_mock = MagicMock()
    scalars_mock.all.return_value = []
    execute_result = MagicMock()
    execute_result.scalars.return_value = scalars_mock
    db.execute.return_value = execute_result
    _override(user, db)
    client = TestClient(app, raise_server_exceptions=False)
    from datetime import datetime, timezone
    res = client.get(
        "/api/v1/work-cycles",
        params={
            "vehicle_id": str(uuid.uuid4()),
            "from_dt": "2026-04-01T00:00:00Z",
            "to_dt": "2026-04-30T23:59:59Z",
        },
    )
    assert res.status_code == 200
    assert res.json() == []


def test_wc_compute_returns_count():
    user = _make_user(tier="cmg", role="admin")
    db = _make_db()
    defn = MagicMock()
    defn.trigger_type = "pto_change"
    defn.trigger_config = {}
    defn.snapshot_fields = []
    defn.aggregate_fields = []
    vehicle = MagicMock()
    vehicle.active = True
    vehicle.tenant_id = uuid.uuid4()

    async def fake_get(model, pk):
        from app.models.work_cycle import WorkCycleDefinition
        from app.models.vehicle import Vehicle
        if model is WorkCycleDefinition:
            return defn
        if model is Vehicle:
            return vehicle
        return None

    db.get = fake_get
    db.execute = AsyncMock(return_value=MagicMock(fetchall=MagicMock(return_value=[])))

    with patch("app.api.v1.work_cycles.detect_and_store_cycles", new=AsyncMock(return_value=5)):
        _override(user, db)
        client = TestClient(app, raise_server_exceptions=False)
        res = client.post("/api/v1/work-cycles/compute", json={
            "vehicle_id": str(uuid.uuid4()),
            "definition_id": str(uuid.uuid4()),
            "from_dt": "2026-04-01T00:00:00Z",
            "to_dt": "2026-04-30T23:59:59Z",
        })
    assert res.status_code == 200
    assert res.json()["computed"] == 5
```

- [ ] **Step 3: Ejecutar tests**

```bash
cd /opt/cmg-telematic1 && DB_URL="postgresql+asyncpg://fake/fake" DB_URL_SYNC="postgresql+psycopg2://fake/fake" REDIS_URL="redis://localhost:6379" SECRET_KEY="test-secret-key-minimum-32-chars-long" python3 -m pytest backend/tests/api/test_work_cycles_api.py -v 2>&1 | tail -20
```
Esperado: `7 passed`

- [ ] **Step 4: Commit**

```bash
git add backend/tests/api/test_work_cycles_api.py
git commit -m "test: backend tests for work_cycles API (7 tests)"
```

---

## Task 8 — CSV export: alertas y mantenimiento

**Files:**
- Modify: `backend/app/api/v1/alerts.py`
- Modify: `backend/app/api/v1/maintenance.py`

- [ ] **Step 1: Leer el inicio de ambos ficheros para confirmar imports**

```bash
head -15 backend/app/api/v1/alerts.py
head -15 backend/app/api/v1/maintenance.py
```

- [ ] **Step 2: Añadir export CSV a `alerts.py`**

Añadir al bloque de imports al inicio del fichero:
```python
import csv
import io
from fastapi.responses import StreamingResponse
from app.models.alert_rule import AlertRule
```

Añadir este endpoint al final del fichero:
```python
@router.get("/alerts/export.csv")
async def export_alerts_csv(
    alert_status: str | None = Query(None, alias="status"),
    vehicle_id: uuid.UUID | None = Query(None),
    triggered_at_from: datetime | None = Query(None),
    triggered_at_to: datetime | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(AlertInstance, AlertRule.name.label("rule_name"), AlertRule.severity)
        .join(AlertRule, AlertRule.id == AlertInstance.rule_id)
    )
    if user.tenant_tier != "cmg":
        query = query.where(AlertInstance.tenant_id == user.tenant_id)
    if alert_status:
        query = query.where(AlertInstance.status == alert_status)
    if vehicle_id:
        query = query.where(AlertInstance.vehicle_id == vehicle_id)
    if triggered_at_from:
        query = query.where(AlertInstance.triggered_at >= triggered_at_from)
    if triggered_at_to:
        query = query.where(AlertInstance.triggered_at <= triggered_at_to)
    query = query.order_by(AlertInstance.triggered_at.desc())
    result = await db.execute(query)
    rows = result.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "vehicle_id", "rule_name", "severity", "triggered_at", "resolved_at", "status", "trigger_value", "ack_note"])
    for alert, rule_name, severity in rows:
        writer.writerow([
            str(alert.id),
            str(alert.vehicle_id),
            rule_name,
            severity,
            alert.triggered_at.isoformat() if alert.triggered_at else "",
            alert.resolved_at.isoformat() if alert.resolved_at else "",
            alert.status,
            str(alert.trigger_value) if alert.trigger_value else "",
            alert.ack_note or "",
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="alertas.csv"'},
    )
```

- [ ] **Step 3: Añadir export CSV a `maintenance.py`**

Añadir al bloque de imports (si no existen ya):
```python
import csv
import io
from fastapi.responses import StreamingResponse
```

Añadir este endpoint al final del fichero:
```python
@router.get("/logs/export.csv")
async def export_maintenance_logs_csv(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.vehicle import Vehicle as VehicleModel
    query = (
        select(
            MaintenanceLog,
            MaintenancePlan.name.label("plan_name"),
            VehicleModel.name.label("vehicle_name"),
        )
        .join(MaintenancePlan, MaintenancePlan.id == MaintenanceLog.plan_id)
        .join(VehicleModel, VehicleModel.id == MaintenanceLog.vehicle_id)
    )
    if user.tenant_tier != "cmg":
        query = query.where(MaintenancePlan.tenant_id == user.tenant_id)
    query = query.order_by(MaintenanceLog.performed_at.desc())
    result = await db.execute(query)
    rows = result.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "vehicle_name", "plan_name", "performed_at", "performed_by_email", "description", "cost_eur"])
    for log, plan_name, vehicle_name in rows:
        writer.writerow([
            str(log.id),
            vehicle_name,
            plan_name,
            log.performed_at.isoformat() if log.performed_at else "",
            log.performed_by_email or "",
            log.description or "",
            str(log.cost_eur) if log.cost_eur is not None else "",
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="mantenimiento.csv"'},
    )
```

- [ ] **Step 4: Verificar sintaxis de ambos ficheros**

```bash
cd /opt/cmg-telematic1 && python3 -c "
import ast
ast.parse(open('backend/app/api/v1/alerts.py').read())
ast.parse(open('backend/app/api/v1/maintenance.py').read())
print('OK')
"
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/alerts.py backend/app/api/v1/maintenance.py
git commit -m "feat: add CSV export endpoints for alerts and maintenance logs"
```

---

## Task 9 — Frontend: types.ts y queryKeys.ts

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/queryKeys.ts`

- [ ] **Step 1: Añadir interfaces a `frontend/src/lib/types.ts`** (al final del fichero)

```typescript
export interface WorkCycleDefinition {
  id: string
  vehicle_type_id: string
  tenant_id: string | null
  name: string
  trigger_type: 'pto_change' | 'threshold_exceeded' | 'sensor_pulse' | 'ignition_period'
  trigger_config: Record<string, unknown>
  snapshot_fields: string[]
  aggregate_fields: string[]
  active: boolean
  created_at: string
}

export interface WorkCycleDefinitionCreate {
  vehicle_type_id: string
  name: string
  trigger_type: string
  trigger_config?: Record<string, unknown>
  snapshot_fields?: string[]
  aggregate_fields?: string[]
}

export interface WorkCycle {
  id: string
  vehicle_id: string
  definition_id: string
  tenant_id: string
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  cycle_data: Record<string, unknown>
  lat: number | null
  lon: number | null
}
```

- [ ] **Step 2: Añadir claves a `frontend/src/lib/queryKeys.ts`** (dentro del objeto `keys`)

```typescript
workCycleDefinitions: (vehicleTypeId?: string) => vehicleTypeId
  ? ['work-cycle-definitions', vehicleTypeId] as const
  : ['work-cycle-definitions'] as const,
workCycles: (vehicleId: string, from: string, to: string) =>
  ['work-cycles', vehicleId, from, to] as const,
```

- [ ] **Step 3: TypeScript check**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -10
```
Esperado: sin errores.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/queryKeys.ts
git commit -m "feat: add WorkCycleDefinition and WorkCycle TypeScript types and query keys"
```

---

## Task 10 — WorkCyclesTab.tsx

**Files:**
- Create: `frontend/src/features/vehicle/WorkCyclesTab.tsx`

- [ ] **Step 1: Crear `frontend/src/features/vehicle/WorkCyclesTab.tsx`**

```typescript
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { WorkCycleDefinition, WorkCycle } from '../../lib/types'

interface Props {
  vehicleId: string
  vehicleTypeId: string
  tenantId: string
}

const TRIGGER_LABELS: Record<string, string> = {
  pto_change: 'PTO activo',
  threshold_exceeded: 'Umbral superado',
  sensor_pulse: 'Pulso sensor',
  ignition_period: 'Período ignición',
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
}

function getDefaultRange(): { from: string; to: string } {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--bg-border)',
  borderRadius: 8,
  padding: 16,
}

export default function WorkCyclesTab({ vehicleId, vehicleTypeId, tenantId }: Props) {
  const defaultRange = getDefaultRange()
  const [fromDate, setFromDate] = useState(defaultRange.from)
  const [toDate, setToDate] = useState(defaultRange.to)
  const [selectedDefinitionId, setSelectedDefinitionId] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: definitions = [] } = useQuery({
    queryKey: keys.workCycleDefinitions(vehicleTypeId),
    queryFn: () => apiClient.get<WorkCycleDefinition[]>(
      `/api/v1/work-cycles/definitions?vehicle_type_id=${vehicleTypeId}`
    ),
  })

  const activeDefinitions = definitions.filter(d => d.active)

  const fromDt = fromDate + 'T00:00:00Z'
  const toDt = toDate + 'T23:59:59Z'

  const { data: cycles = [], isLoading } = useQuery({
    queryKey: keys.workCycles(vehicleId, fromDt, toDt),
    queryFn: () => {
      const params = new URLSearchParams({ vehicle_id: vehicleId, from_dt: fromDt, to_dt: toDt })
      if (selectedDefinitionId) params.set('definition_id', selectedDefinitionId)
      return apiClient.get<WorkCycle[]>(`/api/v1/work-cycles?${params}`)
    },
    enabled: !!vehicleId,
  })

  const computeMutation = useMutation({
    mutationFn: (definitionId: string) =>
      apiClient.post<{ computed: number }>('/api/v1/work-cycles/compute', {
        vehicle_id: vehicleId,
        definition_id: definitionId,
        from_dt: fromDt,
        to_dt: toDt,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-cycles'] })
    },
  })

  const defnMap = Object.fromEntries(definitions.map(d => [d.id, d]))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Controls */}
      <div style={{ ...cardStyle, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--accent-off)', marginBottom: 4 }}>DEFINICIÓN</div>
          <select
            value={selectedDefinitionId}
            onChange={e => setSelectedDefinitionId(e.target.value)}
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-base, #E7E5E4)', border: '1px solid var(--bg-border)', borderRadius: 5, padding: '5px 8px', fontSize: 13 }}
          >
            <option value="">Todas</option>
            {activeDefinitions.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--accent-off)', marginBottom: 4 }}>DESDE</div>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-base, #E7E5E4)', border: '1px solid var(--bg-border)', borderRadius: 5, padding: '5px 8px', fontSize: 13 }} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--accent-off)', marginBottom: 4 }}>HASTA</div>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-base, #E7E5E4)', border: '1px solid var(--bg-border)', borderRadius: 5, padding: '5px 8px', fontSize: 13 }} />
        </div>
        {selectedDefinitionId && (
          <button
            onClick={() => computeMutation.mutate(selectedDefinitionId)}
            disabled={computeMutation.isPending}
            style={{ padding: '6px 14px', background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 5, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
          >
            {computeMutation.isPending ? 'Calculando…' : 'Calcular ciclos'}
          </button>
        )}
        {computeMutation.isSuccess && (
          <span style={{ fontSize: 12, color: 'var(--accent-ok)' }}>
            {computeMutation.data.computed} ciclos detectados
          </span>
        )}
      </div>

      {/* Table */}
      <div style={cardStyle}>
        {isLoading ? (
          <div style={{ color: 'var(--accent-off)', fontSize: 13 }}>Cargando ciclos…</div>
        ) : cycles.length === 0 ? (
          <div style={{ color: 'var(--accent-off)', fontSize: 13 }}>
            No hay ciclos para este período.
            {selectedDefinitionId ? ' Pulsa "Calcular ciclos" para detectarlos.' : ' Selecciona una definición y pulsa "Calcular ciclos".'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--accent-off)', fontWeight: 600 }}>Definición</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--accent-off)', fontWeight: 600 }}>Inicio</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--accent-off)', fontWeight: 600 }}>Fin</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--accent-off)', fontWeight: 600 }}>Duración</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--accent-off)', fontWeight: 600 }}>GPS</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--accent-off)', fontWeight: 600 }}>Datos</th>
              </tr>
            </thead>
            <tbody>
              {cycles.map(cycle => (
                <>
                  <tr
                    key={cycle.id}
                    style={{ borderBottom: '1px solid var(--bg-elevated)', cursor: 'pointer' }}
                    onClick={() => setExpandedId(expandedId === cycle.id ? null : cycle.id)}
                  >
                    <td style={{ padding: '6px 8px', color: 'var(--text-base, #E7E5E4)' }}>
                      {defnMap[cycle.definition_id]?.name ?? '—'}
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-base, #E7E5E4)', fontFamily: 'var(--font-data)' }}>
                      {formatDate(cycle.started_at)}
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-base, #E7E5E4)', fontFamily: 'var(--font-data)' }}>
                      {formatDate(cycle.ended_at)}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--accent-energy)', fontFamily: 'var(--font-data)' }}>
                      {formatDuration(cycle.duration_seconds)}
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--accent-off)', fontFamily: 'var(--font-data)', fontSize: 11 }}>
                      {cycle.lat != null ? `${Number(cycle.lat).toFixed(4)}, ${Number(cycle.lon).toFixed(4)}` : '—'}
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--accent-info)', fontSize: 11 }}>
                      {Object.keys(cycle.cycle_data).length > 0 ? '▶ ver datos' : '—'}
                    </td>
                  </tr>
                  {expandedId === cycle.id && Object.keys(cycle.cycle_data).length > 0 && (
                    <tr key={`${cycle.id}-expanded`}>
                      <td colSpan={6} style={{ padding: '4px 8px 8px 24px', background: 'var(--bg-elevated)' }}>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                          {Object.entries(cycle.cycle_data).map(([k, v]) => (
                            <div key={k}>
                              <span style={{ color: 'var(--accent-off)', fontSize: 10 }}>{k}: </span>
                              <span style={{ color: 'var(--text-base, #E7E5E4)', fontFamily: 'var(--font-data)', fontSize: 11 }}>{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -15
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/vehicle/WorkCyclesTab.tsx
git commit -m "feat: add WorkCyclesTab — cycle list with date filter and compute trigger"
```

---

## Task 11 — VehicleDetailPage.tsx: añadir pestaña Ciclos

**Files:**
- Modify: `frontend/src/features/vehicle/VehicleDetailPage.tsx`

- [ ] **Step 1: Leer VehicleDetailPage.tsx para ver el patrón exacto de tabs**

```bash
grep -n "PAGE_TABS\|setTab\|tab ==\|import Work" frontend/src/features/vehicle/VehicleDetailPage.tsx
```

- [ ] **Step 2: Aplicar los cambios**

En `VehicleDetailPage.tsx`:

1. Añadir import al inicio (con los otros imports de features):
```typescript
import WorkCyclesTab from './WorkCyclesTab'
```

2. Cambiar `PAGE_TABS` de:
```typescript
const PAGE_TABS = [
  { id: 'live', label: 'EN VIVO' },
  { id: 'historic', label: 'HISTÓRICO' },
]
```
a:
```typescript
const PAGE_TABS = [
  { id: 'live', label: 'EN VIVO' },
  { id: 'historic', label: 'HISTÓRICO' },
  { id: 'cycles', label: 'CICLOS' },
]
```

3. Cambiar el tipo del estado de tab de:
```typescript
const [tab, setTab] = useState<'live' | 'historic'>('live')
```
a:
```typescript
const [tab, setTab] = useState<'live' | 'historic' | 'cycles'>('live')
```

4. Cambiar el `onTabChange` cast de:
```typescript
onTabChange={(newTab) => setTab(newTab as 'live' | 'historic')}
```
a:
```typescript
onTabChange={(newTab) => setTab(newTab as 'live' | 'historic' | 'cycles')}
```

5. Añadir el bloque de la pestaña Ciclos después del bloque `{tab === 'historic' && ...}`:
```typescript
{tab === 'cycles' && vehicle.vehicle_type_id && (
  <div style={{ padding: 24, maxWidth: 1400 }}>
    <WorkCyclesTab
      vehicleId={vehicle.id}
      vehicleTypeId={vehicle.vehicle_type_id}
      tenantId={vehicle.tenant_id}
    />
  </div>
)}
```

- [ ] **Step 3: TypeScript check**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -15
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/vehicle/VehicleDetailPage.tsx
git commit -m "feat: add Ciclos tab to VehicleDetailPage"
```

---

## Task 12 — WorkCycleDefinitionsSection.tsx + SettingsPage.tsx

**Files:**
- Create: `frontend/src/features/settings/WorkCycleDefinitionsSection.tsx`
- Modify: `frontend/src/features/settings/SettingsPage.tsx`

- [ ] **Step 1: Leer SettingsPage.tsx para confirmar el patrón de secciones**

```bash
cat frontend/src/features/settings/SettingsPage.tsx
```

- [ ] **Step 2: Crear `frontend/src/features/settings/WorkCycleDefinitionsSection.tsx`**

```typescript
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { WorkCycleDefinition, WorkCycleDefinitionCreate, VehicleTypeOut } from '../../lib/types'

const TRIGGER_OPTIONS = [
  { value: 'pto_change', label: 'PTO activo (cisterna, hidráulica)' },
  { value: 'threshold_exceeded', label: 'Umbral superado (excavadora, presión)' },
  { value: 'sensor_pulse', label: 'Pulso de sensor (basura, contadores)' },
  { value: 'ignition_period', label: 'Período ignición (jornada completa)' },
]

const sectionStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--bg-border)',
  borderRadius: 8,
  padding: 20,
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  color: 'var(--text-base, #E7E5E4)',
  border: '1px solid var(--bg-border)',
  borderRadius: 5,
  padding: '6px 10px',
  fontSize: 13,
  width: '100%',
}

export default function WorkCycleDefinitionsSection() {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<Partial<WorkCycleDefinitionCreate>>({ trigger_type: 'pto_change', trigger_config: {}, snapshot_fields: [], aggregate_fields: [] })
  const [modalError, setModalError] = useState<string | null>(null)

  const { data: definitions = [], isLoading } = useQuery({
    queryKey: keys.workCycleDefinitions(),
    queryFn: () => apiClient.get<WorkCycleDefinition[]>('/api/v1/work-cycles/definitions'),
  })

  const { data: vehicleTypes = [] } = useQuery({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: Infinity,
  })

  const createMutation = useMutation({
    mutationFn: (payload: WorkCycleDefinitionCreate) =>
      apiClient.post<WorkCycleDefinition>('/api/v1/work-cycles/definitions', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-cycle-definitions'] })
      setShowModal(false)
      setForm({ trigger_type: 'pto_change', trigger_config: {}, snapshot_fields: [], aggregate_fields: [] })
      setModalError(null)
    },
    onError: (err: Error) => setModalError(err.message),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiClient.patch<WorkCycleDefinition>(`/api/v1/work-cycles/definitions/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['work-cycle-definitions'] }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.vehicle_type_id || !form.name || !form.trigger_type) {
      setModalError('Completa todos los campos obligatorios')
      return
    }
    createMutation.mutate(form as WorkCycleDefinitionCreate)
  }

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 14, color: 'var(--text-base, #E7E5E4)' }}>Ciclos de trabajo</h3>
        <button
          onClick={() => setShowModal(true)}
          style={{ padding: '5px 12px', background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 5, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
        >
          + Nueva definición
        </button>
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--accent-off)', fontSize: 13 }}>Cargando…</div>
      ) : definitions.length === 0 ? (
        <div style={{ color: 'var(--accent-off)', fontSize: 13 }}>No hay definiciones configuradas.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
              <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--accent-off)' }}>Nombre</th>
              <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--accent-off)' }}>Tipo vehículo</th>
              <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--accent-off)' }}>Trigger</th>
              <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--accent-off)' }}>Origen</th>
              <th style={{ textAlign: 'center', padding: '5px 8px', color: 'var(--accent-off)' }}>Activo</th>
            </tr>
          </thead>
          <tbody>
            {definitions.map(d => {
              const vt = vehicleTypes.find(v => v.id === d.vehicle_type_id)
              const isGlobal = d.tenant_id === null
              return (
                <tr key={d.id} style={{ borderBottom: '1px solid var(--bg-elevated)' }}>
                  <td style={{ padding: '5px 8px', color: 'var(--text-base, #E7E5E4)' }}>{d.name}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--accent-off)' }}>{vt?.name ?? d.vehicle_type_id.slice(0, 8)}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--accent-energy)', fontFamily: 'var(--font-data)', fontSize: 11 }}>{d.trigger_type}</td>
                  <td style={{ padding: '5px 8px' }}>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: isGlobal ? 'rgba(56,189,248,0.15)' : 'rgba(249,115,22,0.15)', color: isGlobal ? 'var(--accent-info)' : 'var(--accent-energy)' }}>
                      {isGlobal ? 'CMG global' : 'Cliente'}
                    </span>
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                    {!isGlobal ? (
                      <button
                        onClick={() => toggleMutation.mutate({ id: d.id, active: !d.active })}
                        style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', background: d.active ? 'rgba(34,197,94,0.15)' : 'rgba(120,113,108,0.2)', color: d.active ? 'var(--accent-ok)' : 'var(--accent-off)' }}
                      >
                        {d.active ? 'Activo' : 'Inactivo'}
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: d.active ? 'var(--accent-ok)' : 'var(--accent-off)' }}>
                        {d.active ? '✓' : '✗'}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {showModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) { setShowModal(false); setModalError(null) } }}
        >
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-border)', borderRadius: 10, padding: 24, width: 440, maxWidth: '90vw' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 14 }}>Nueva definición de ciclo</h3>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>Nombre *</label>
                <input style={inputStyle} value={form.name ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ej. Ciclo bomba agua" required />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>Tipo de vehículo *</label>
                <select style={inputStyle} value={form.vehicle_type_id ?? ''} onChange={e => setForm(f => ({ ...f, vehicle_type_id: e.target.value }))} required>
                  <option value="">Seleccionar...</option>
                  {vehicleTypes.map(vt => <option key={vt.id} value={vt.id}>{vt.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>Tipo de trigger *</label>
                <select style={inputStyle} value={form.trigger_type ?? 'pto_change'} onChange={e => setForm(f => ({ ...f, trigger_type: e.target.value }))}>
                  {TRIGGER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {(form.trigger_type === 'threshold_exceeded' || form.trigger_type === 'sensor_pulse') && (
                <div>
                  <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>
                    {form.trigger_type === 'threshold_exceeded' ? 'Sensor (clave en can_data)' : 'Sensor / pin (clave en can_data)'}
                  </label>
                  <input style={inputStyle} placeholder="ej. hydraulic_pressure"
                    onChange={e => setForm(f => ({ ...f, trigger_config: { ...f.trigger_config, sensor: e.target.value } }))} />
                </div>
              )}
              {form.trigger_type === 'threshold_exceeded' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>Operador</label>
                    <select style={inputStyle} onChange={e => setForm(f => ({ ...f, trigger_config: { ...f.trigger_config, op: e.target.value } }))}>
                      <option value=">">{'>'}</option>
                      <option value=">=">{'>='}</option>
                      <option value="<">{'<'}</option>
                      <option value="<=">{'<='}</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--accent-off)', display: 'block', marginBottom: 4 }}>Umbral</label>
                    <input type="number" style={inputStyle} placeholder="ej. 280"
                      onChange={e => setForm(f => ({ ...f, trigger_config: { ...f.trigger_config, threshold: Number(e.target.value) } }))} />
                  </div>
                </div>
              )}
              {modalError && <div style={{ color: 'var(--accent-crit)', fontSize: 12 }}>{modalError}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" onClick={() => { setShowModal(false); setModalError(null) }}
                  style={{ padding: '6px 14px', background: 'var(--bg-elevated)', color: 'var(--text-base, #E7E5E4)', border: '1px solid var(--bg-border)', borderRadius: 5, fontSize: 13, cursor: 'pointer' }}>
                  Cancelar
                </button>
                <button type="submit" disabled={createMutation.isPending}
                  style={{ padding: '6px 14px', background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 5, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                  {createMutation.isPending ? 'Guardando…' : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Añadir sección a `frontend/src/features/settings/SettingsPage.tsx`**

Añadir import al inicio:
```typescript
import WorkCycleDefinitionsSection from './WorkCycleDefinitionsSection'
```

Añadir en el cuerpo del componente, dentro del `<div>` con gap:32, después de `{isAdmin && <UsersSection />}`:
```typescript
{isAdmin && <WorkCycleDefinitionsSection />}
```

- [ ] **Step 4: TypeScript check**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -15
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/settings/WorkCycleDefinitionsSection.tsx frontend/src/features/settings/SettingsPage.tsx
git commit -m "feat: add WorkCycleDefinitionsSection to settings — CRUD for work cycle definitions"
```

---

## Task 13 — Botones CSV en AlertsPage y MaintenancePage

**Files:**
- Modify: `frontend/src/features/alerts/AlertsPage.tsx`
- Modify: `frontend/src/features/maintenance/MaintenancePage.tsx`

- [ ] **Step 1: Leer AlertsPage.tsx para ver qué filtros usa y dónde está el header**

```bash
head -80 frontend/src/features/alerts/AlertsPage.tsx
```

- [ ] **Step 2: Añadir botón CSV a `AlertsPage.tsx`**

En `AlertsPage.tsx`, añadir una función `handleExportCsv` y un botón que la llame. La función debe:
1. Construir los mismos parámetros que el listado actual (status, vehicle_id, fechas)
2. Llamar `apiClient.getBlob('/api/v1/alerts/export.csv?' + params)`
3. Crear un link temporal y hacer click para la descarga (igual que en ReportsPage.tsx)

Añadir a los imports:
```typescript
import { apiClient } from '../../lib/apiClient'
```

Añadir la función (dentro del componente, antes del return):
```typescript
async function handleExportCsv() {
  const params = new URLSearchParams()
  if (statusFilter) params.set('status', statusFilter)
  if (vehicleFilter) params.set('vehicle_id', vehicleFilter)
  const blob = await apiClient.getBlob(`/api/v1/alerts/export.csv?${params}`)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'alertas.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
```

Añadir el botón cerca del header (ajustar al layout exacto que encuentres al leer el fichero):
```typescript
<button
  onClick={handleExportCsv}
  style={{ padding: '5px 12px', background: 'var(--bg-elevated)', color: 'var(--text-base, #E7E5E4)', border: '1px solid var(--bg-border)', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}
>
  Exportar CSV
</button>
```

- [ ] **Step 3: Leer MaintenancePage.tsx para ver el header**

```bash
head -60 frontend/src/features/maintenance/MaintenancePage.tsx
```

- [ ] **Step 4: Añadir botón CSV a `MaintenancePage.tsx`**

Misma lógica que AlertsPage pero sin filtros, y descargando desde `/api/v1/maintenance/logs/export.csv`:

```typescript
async function handleExportCsv() {
  const blob = await apiClient.getBlob('/api/v1/maintenance/logs/export.csv')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'mantenimiento.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
```

- [ ] **Step 5: TypeScript check**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 6: Ejecutar suite completa de tests frontend**

```bash
cd /opt/cmg-telematic1/frontend && npx vitest run 2>&1 | tail -15
```
Esperado: sin fallos nuevos.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/alerts/AlertsPage.tsx frontend/src/features/maintenance/MaintenancePage.tsx
git commit -m "feat: add CSV export buttons to AlertsPage and MaintenancePage"
```
