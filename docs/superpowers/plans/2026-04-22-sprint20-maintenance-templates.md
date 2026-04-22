# Sprint 20 — Maintenance Templates + Compliance Workflow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow CMG to define maintenance plan templates per vehicle type; auto-create plans on vehicle creation; client uploads a proof document before resetting counters; background task emails tenants when plans are due.

**Architecture:** Single migration adds `vehicle_type.maintenance_templates JSONB` and `maintenance_log.document_url TEXT`. A new `POST /maintenance/plans/{id}/complete` endpoint handles multipart document upload + counter reset. A new `PATCH /vehicle-types/{id}/maintenance-templates` endpoint manages templates. A background `asyncio` task checks plans every 4 hours and publishes email events to the existing `alerts.fire` Redis stream. Frontend adds template management to `VehicleTypesPage` and a "Realizar mantenimiento" modal to `MaintenancePage`.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, PostgreSQL JSONB, Redis Streams, React 18, TanStack Query, Zustand.

---

## File Map

| File | Action |
|---|---|
| `backend/alembic/versions/009_maintenance_templates_and_doc.py` | Create |
| `backend/app/models/vehicle_type.py` | Add `maintenance_templates` JSONB column |
| `backend/app/models/maintenance.py` | Add `document_url` TEXT column to MaintenanceLog |
| `backend/app/schemas/maintenance.py` | Add `MaintenanceTemplateItem`; add `document_url` to `MaintenanceLogOut` |
| `backend/app/schemas/vehicle.py` | Add `maintenance_templates` to `VehicleTypeOut` |
| `backend/app/api/v1/vehicles.py` | Add `PATCH /vehicle-types/{id}/maintenance-templates`; extend `POST /vehicles` to auto-create plans |
| `backend/app/api/v1/maintenance.py` | Add `POST /maintenance/plans/{id}/complete` |
| `backend/app/core/maintenance_notifier.py` | Create background notification task |
| `backend/app/main.py` | mkdir maintenance_docs; launch notifier task |
| `frontend/src/lib/types.ts` | Add `MaintenanceTemplateItem`; add `maintenance_templates` to `VehicleTypeOut`; add `document_url` to `MaintenanceLogOut` |
| `frontend/src/features/vehicles/VehicleTypesPage.tsx` | Add maintenance templates section + alert rules section |
| `frontend/src/features/maintenance/MaintenancePage.tsx` | Add "Realizar mantenimiento" modal |
| `frontend/src/features/rules/RuleFormPage.tsx` | Pre-fill vehicle_filter from `?type_id` query param |
| `frontend/src/features/vehicle/VehicleDetailPage.tsx` | Add Mantenimiento tab with CMG edit capability |

---

### Task 1: Migration 009 + model changes

**Files:**
- Create: `backend/alembic/versions/009_maintenance_templates_and_doc.py`
- Modify: `backend/app/models/vehicle_type.py`
- Modify: `backend/app/models/maintenance.py`

- [ ] **Step 1: Create migration file**

```python
# backend/alembic/versions/009_maintenance_templates_and_doc.py
"""add maintenance_templates to vehicle_type and document_url to maintenance_log

Revision ID: 009
Revises: 008
Create Date: 2026-04-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vehicle_type",
        sa.Column(
            "maintenance_templates",
            JSONB,
            nullable=False,
            server_default="[]",
        ),
    )
    op.add_column(
        "maintenance_log",
        sa.Column("document_url", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("maintenance_log", "document_url")
    op.drop_column("vehicle_type", "maintenance_templates")
```

- [ ] **Step 2: Add column to VehicleType model**

Read `backend/app/models/vehicle_type.py`. The file currently ends with `icon_url`. Add after `icon_url`:

```python
# backend/app/models/vehicle_type.py
import uuid
from sqlalchemy import String, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base

class VehicleType(Base):
    __tablename__ = "vehicle_type"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    sensor_schema: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    icon_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    maintenance_templates: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]", default=list)

    vehicles = relationship("Vehicle", back_populates="vehicle_type")
```

- [ ] **Step 3: Add document_url to MaintenanceLog model**

Read `backend/app/models/maintenance.py`. Add `document_url` column after `photo_urls`:

```python
    photo_urls: Mapped[list | None] = mapped_column(ARRAY(String), nullable=True)
    document_url: Mapped[str | None] = mapped_column(Text, nullable=True)
```

- [ ] **Step 4: Commit**

```bash
git add backend/alembic/versions/009_maintenance_templates_and_doc.py \
        backend/app/models/vehicle_type.py \
        backend/app/models/maintenance.py
git commit -m "feat: migration 009 — maintenance_templates on vehicle_type + document_url on maintenance_log"
```

---

### Task 2: Schemas

**Files:**
- Modify: `backend/app/schemas/maintenance.py`
- Modify: `backend/app/schemas/vehicle.py`

- [ ] **Step 1: Add MaintenanceTemplateItem and document_url to maintenance schemas**

Read `backend/app/schemas/maintenance.py`. Add `MaintenanceTemplateItem` class after `TriggerCondition`, and add `document_url` to `MaintenanceLogOut`:

```python
# At the top, after TriggerCondition class:

class MaintenanceTemplateItem(BaseModel):
    name: str
    thresholds: list[MaintenanceThreshold]
    warn_before_pct: int = 10
```

Then modify `MaintenanceLogOut` to add the field:
```python
class MaintenanceLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    plan_id: uuid.UUID | None = None
    vehicle_id: uuid.UUID
    performed_at: datetime
    performed_by_email: str | None = None
    description: str | None = None
    reset_counters: list[str]
    cost_eur: float | None = None
    document_url: str | None = None   # ← add this line
```

- [ ] **Step 2: Add maintenance_templates to VehicleTypeOut**

Read `backend/app/schemas/vehicle.py`. Add import and field:

```python
# backend/app/schemas/vehicle.py
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict
from app.schemas.maintenance import MaintenanceTemplateItem   # ← add import


class VehicleTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    slug: str
    name: str
    sensor_schema: list[dict[str, Any]]
    icon_url: str | None = None
    maintenance_templates: list[MaintenanceTemplateItem] = []   # ← add this line
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/maintenance.py backend/app/schemas/vehicle.py
git commit -m "feat: MaintenanceTemplateItem schema + document_url in MaintenanceLogOut + maintenance_templates in VehicleTypeOut"
```

---

### Task 3: Backend — template endpoint + auto-copy on vehicle creation

**Files:**
- Modify: `backend/app/api/v1/vehicles.py`

- [ ] **Step 1: Add PATCH /vehicle-types/{type_id}/maintenance-templates endpoint**

Read `backend/app/api/v1/vehicles.py`. Add this import at the top (after existing imports):

```python
from app.schemas.maintenance import MaintenanceTemplateItem, MaintenancePlanCreate
from app.models.maintenance import MaintenancePlan
```

Note: `MaintenancePlan` and `MaintenancePlanCreate` are already imported in this file. Only add `MaintenanceTemplateItem` if not already there.

Add a new Pydantic model for the request body right before the route definitions (or after existing form models in the file):

```python
class MaintenanceTemplatesUpdate(BaseModel):
    templates: list[MaintenanceTemplateItem]
```

Import `BaseModel` from pydantic if not already (check existing imports first).

Add the endpoint after the existing `PATCH /vehicle-types/{type_id}/sensor-schema` endpoint:

```python
@router.patch("/vehicle-types/{type_id}/maintenance-templates", response_model=VehicleTypeOut)
async def update_vehicle_type_maintenance_templates(
    type_id: uuid.UUID,
    body: MaintenanceTemplatesUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.tenant_tier != "cmg" or user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo CMG admin puede modificar tipos de vehículo",
        )
    vtype = await db.get(VehicleType, type_id)
    if not vtype:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tipo de vehículo no encontrado")
    from sqlalchemy.orm.attributes import flag_modified
    vtype.maintenance_templates = [t.model_dump() for t in body.templates]
    flag_modified(vtype, "maintenance_templates")
    await db.commit()
    await db.refresh(vtype)
    return vtype
```

- [ ] **Step 2: Auto-create plans in POST /vehicles**

In the existing `create_vehicle` endpoint, after `await db.refresh(vehicle)` and before `return vehicle`, add the auto-copy logic:

```python
    # Auto-create maintenance plans from vehicle type templates
    templates = vtype.maintenance_templates or []
    for tmpl in templates:
        plan = MaintenancePlan(
            vehicle_id=vehicle.id,
            tenant_id=effective_tenant_id,
            name=tmpl["name"],
            trigger_condition={
                "thresholds": tmpl["thresholds"],
                "op": "OR",
            },
            warn_before_pct=tmpl.get("warn_before_pct", 10),
            active=True,
        )
        db.add(plan)
    if templates:
        await db.commit()

    return vehicle
```

Make sure `MaintenancePlan` is imported (it already is: `from app.models.maintenance import MaintenancePlan`).

- [ ] **Step 3: Verify**

```bash
cd /opt/cmg-telematic1 && python -c "
import ast, sys
with open('backend/app/api/v1/vehicles.py') as f:
    src = f.read()
ast.parse(src)
print('Syntax OK')
"
```

Expected: `Syntax OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/v1/vehicles.py
git commit -m "feat: PATCH /vehicle-types/{id}/maintenance-templates + auto-copy plans on POST /vehicles"
```

---

### Task 4: Backend — POST /maintenance/plans/{id}/complete

**Files:**
- Modify: `backend/app/api/v1/maintenance.py`

- [ ] **Step 1: Add imports for file upload**

Read `backend/app/api/v1/maintenance.py`. Add to the existing `from fastapi import ...` import line:

```python
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, status
```

Also add at the top:
```python
from pathlib import Path
```

- [ ] **Step 2: Add the complete endpoint**

Add this endpoint after the `create_log` endpoint (after line ~319):

```python
@router.post("/maintenance/plans/{plan_id}/complete", response_model=MaintenanceLogOut, status_code=201)
async def complete_plan(
    plan_id: uuid.UUID,
    file: UploadFile | None = File(None),
    description: str | None = Form(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plan = await db.get(MaintenancePlan, plan_id)
    if not plan or (user.tenant_tier != "cmg" and str(plan.tenant_id) != str(user.tenant_id)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan no encontrado")

    # Non-CMG users must upload a document
    has_file = file is not None and file.filename
    if user.tenant_tier != "cmg" and not has_file:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Debe adjuntar un documento (factura o albarán) para registrar el mantenimiento",
        )

    log_id = uuid.uuid4()
    document_url: str | None = None

    if has_file:
        allowed_types = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
        content_type = (file.content_type or "").split(";")[0].strip()
        if content_type not in allowed_types:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Formato no válido. Use imagen (JPEG, PNG, WEBP) o PDF.",
            )
        contents = await file.read()
        if len(contents) > 5 * 1024 * 1024:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El archivo supera el límite de 5 MB",
            )
        ext = Path(file.filename).suffix.lower() or ".pdf"
        dest = Path("/app/uploads/maintenance_docs") / f"{log_id}{ext}"
        dest.write_bytes(contents)
        document_url = f"/uploads/maintenance_docs/{log_id}{ext}"

    thresholds = plan.trigger_condition.get("thresholds", [])
    reset_counters = [t["type"] for t in thresholds]
    now = datetime.now(timezone.utc)

    log = MaintenanceLog(
        id=log_id,
        vehicle_id=plan.vehicle_id,
        plan_id=plan_id,
        performed_at=now,
        performed_by=uuid.UUID(str(user.user_id)),
        description=description,
        reset_counters=reset_counters,
        document_url=document_url,
    )
    db.add(log)

    # For calendar_days thresholds, advance next_due_at
    for t in thresholds:
        if t["type"] == "calendar_days":
            from datetime import timedelta
            plan.next_due_at = now + timedelta(days=float(t["value"]))
            break

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
        cost_eur=None,
        document_url=log.document_url,
    )
```

- [ ] **Step 3: Verify syntax**

```bash
python -c "
import ast
with open('backend/app/api/v1/maintenance.py') as f:
    ast.parse(f.read())
print('Syntax OK')
"
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/v1/maintenance.py
git commit -m "feat: POST /maintenance/plans/{id}/complete — document upload + counter reset"
```

---

### Task 5: Background notifier + main.py

**Files:**
- Create: `backend/app/core/maintenance_notifier.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create backend/app/core/maintenance_notifier.py**

```python
# backend/app/core/maintenance_notifier.py
"""
Tarea background: revisa planes de mantenimiento cada 4 horas.
Publica notificaciones email al Redis stream 'alerts.fire' cuando
un plan está 'próximo' o 'vencido', con anti-spam de 23h por plan.
"""
import asyncio
import json
import logging
import uuid

from redis.asyncio import Redis
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.maintenance import MaintenancePlan
from app.models.vehicle import Vehicle
from app.models.tenant import Tenant

logger = logging.getLogger(__name__)

STREAM_KEY = "alerts.fire"
CHECK_INTERVAL = 4 * 3600  # seconds


async def maintenance_notification_task(redis: Redis) -> None:
    """Loop: sleep 4h, then check all active plans and notify if due."""
    while True:
        await asyncio.sleep(CHECK_INTERVAL)
        try:
            await _check_and_notify(redis)
        except Exception as e:
            logger.error("Error en tarea notificaciones mantenimiento: %s", e)


async def _check_and_notify(redis: Redis) -> None:
    from app.api.v1.maintenance import _compute_progress  # avoid circular at module load

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(MaintenancePlan).where(MaintenancePlan.active == True)
        )
        plans = result.scalars().all()

        for plan in plans:
            try:
                progress = await _compute_progress(plan, db)
                if progress.status not in ("próximo", "vencido"):
                    continue

                cache_key = f"maint:notified:{plan.id}:{progress.status}"
                if await redis.exists(cache_key):
                    continue

                tenant = await db.get(Tenant, plan.tenant_id)
                if not tenant or not getattr(tenant, "notification_email", None):
                    continue

                vehicle = await db.get(Vehicle, plan.vehicle_id)
                vehicle_name = vehicle.name if vehicle else str(plan.vehicle_id)

                await redis.xadd(
                    STREAM_KEY,
                    {
                        "alert_id": str(uuid.uuid4()),
                        "rule_id": str(uuid.uuid4()),
                        "vehicle_id": str(plan.vehicle_id),
                        "tenant_id": str(plan.tenant_id),
                        "severity": "critical" if progress.status == "vencido" else "warning",
                        "trigger_value": json.dumps(
                            {"plan": plan.name, "status": progress.status, "vehicle": vehicle_name}
                        ),
                        "actions": json.dumps(
                            [{"type": "email", "recipients": [tenant.notification_email]}]
                        ),
                        "escalation": json.dumps([]),
                    },
                    maxlen=10_000,
                    approximate=True,
                )

                await redis.setex(cache_key, 23 * 3600, "1")
                logger.info(
                    "Notificación mantenimiento: plan=%s vehicle=%s status=%s",
                    plan.name, vehicle_name, progress.status,
                )
            except Exception as e:
                logger.error("Error procesando plan %s: %s", plan.id, e)
```

- [ ] **Step 2: Update backend/app/main.py**

Read `backend/app/main.py`. Replace the lifespan function with:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    Path("/app/uploads/icons").mkdir(parents=True, exist_ok=True)
    Path("/app/uploads/maintenance_docs").mkdir(parents=True, exist_ok=True)
    app.state.redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    app.state.ws_manager = ConnectionManager()
    from app.core.maintenance_notifier import maintenance_notification_task
    ws_task = asyncio.create_task(
        broadcast_telemetry_task(app.state.redis, app.state.ws_manager)
    )
    notifier_task = asyncio.create_task(
        maintenance_notification_task(app.state.redis)
    )
    yield
    ws_task.cancel()
    notifier_task.cancel()
    for t in (ws_task, notifier_task):
        try:
            await t
        except asyncio.CancelledError:
            pass
    await app.state.redis.aclose()
```

- [ ] **Step 3: Verify syntax**

```bash
python -c "
import ast
for f in ['backend/app/core/maintenance_notifier.py', 'backend/app/main.py']:
    with open(f) as fh:
        ast.parse(fh.read())
    print(f, 'OK')
"
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/core/maintenance_notifier.py backend/app/main.py
git commit -m "feat: maintenance_notifier background task + mkdir maintenance_docs in lifespan"
```

---

### Task 6: Backend deploy + migration 009

- [ ] **Step 1: Build core-api image**

```bash
cd /opt/cmg-telematic1 && docker build -t cmg-core-api ./backend 2>&1 | tail -5
```

Expected: `Successfully tagged cmg-core-api:latest`

- [ ] **Step 2: Replace container**

```bash
docker stop core-api && docker rm core-api
docker run -d \
  --name core-api \
  --network cmg-telematic1_default \
  -p 127.0.0.1:8010:8010 \
  --env-file /opt/cmg-telematic1/.env \
  -v uploads_data:/app/uploads \
  --restart unless-stopped \
  cmg-core-api
```

- [ ] **Step 3: Run migration**

```bash
sleep 15 && docker exec core-api alembic upgrade head
```

Expected output contains: `Running upgrade 008 -> 009, add maintenance_templates to vehicle_type and document_url to maintenance_log`

- [ ] **Step 4: Verify columns**

```bash
PGUSER=$(grep ^POSTGRES_USER /opt/cmg-telematic1/.env | cut -d= -f2)
PGDB=$(grep ^POSTGRES_DB /opt/cmg-telematic1/.env | cut -d= -f2)
PGCONT=$(docker ps --format "{{.Names}}" | grep postgres)
docker exec "$PGCONT" psql -U "$PGUSER" -d "$PGDB" \
  -c "\d vehicle_type" 2>/dev/null | grep maintenance_templates
docker exec "$PGCONT" psql -U "$PGUSER" -d "$PGDB" \
  -c "\d maintenance_log" 2>/dev/null | grep document_url
```

Expected: lines showing `maintenance_templates | jsonb` and `document_url | text`

- [ ] **Step 5: Smoke test complete endpoint**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  https://cmgtrack.com/api/v1/maintenance/plans/00000000-0000-0000-0000-000000000000/complete \
  -X POST
```

Expected: `403` or `401` (route exists, auth required — NOT 404)

---

### Task 7: Frontend types.ts

**Files:**
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Add MaintenanceTemplateItem interface**

Read `frontend/src/lib/types.ts`. After the `TriggerCondition` interface (around line 208-211), add:

```typescript
export interface MaintenanceTemplateItem {
  name: string
  thresholds: MaintenanceThreshold[]
  warn_before_pct: number
}
```

- [ ] **Step 2: Add maintenance_templates to VehicleTypeOut**

Find the `VehicleTypeOut` interface. Add `maintenance_templates`:

```typescript
export interface VehicleTypeOut {
  id: string
  slug: string
  name: string
  sensor_schema: SensorDef[]
  icon_url: string | null
  maintenance_templates: MaintenanceTemplateItem[]   // ← add this line
}
```

- [ ] **Step 3: Add document_url to MaintenanceLogOut**

Find `MaintenanceLogOut`. Add `document_url`:

```typescript
export interface MaintenanceLogOut {
  id: string
  plan_id: string | null
  vehicle_id: string
  performed_at: string
  performed_by_email: string | null
  description: string | null
  reset_counters: string[]
  cost_eur: number | null
  document_url: string | null   // ← add this line
}
```

- [ ] **Step 4: TypeScript check**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (clean)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/types.ts
git commit -m "feat: MaintenanceTemplateItem type + maintenance_templates in VehicleTypeOut + document_url in MaintenanceLogOut"
```

---

### Task 8: VehicleTypesPage — maintenance templates + alert rules sections

**Files:**
- Modify: `frontend/src/features/vehicles/VehicleTypesPage.tsx`

- [ ] **Step 1: Read the full VehicleTypesPage.tsx**

Read the file to understand the current state and where the right panel content ends.

- [ ] **Step 2: Add imports and form types**

At the top of the file, after existing imports, add:

```typescript
import { useNavigate } from 'react-router-dom'
import type { MaintenanceTemplateItem } from '../../lib/types'
```

Add these type definitions near the top form types section:

```typescript
type TemplateFormState = {
  name: string
  thresholdType: 'pto_hours' | 'engine_hours' | 'calendar_days'
  value: string
  warn_before_pct: string
}
const emptyTemplateForm: TemplateFormState = {
  name: '', thresholdType: 'pto_hours', value: '', warn_before_pct: '10',
}
```

- [ ] **Step 3: Add template modal state inside the component**

Inside the `VehicleTypesPage` component function, after the existing sensor modal state, add:

```typescript
const navigate = useNavigate()

// ── Template modal state ──────────────────────────────────────────────────
const [showTemplateModal, setShowTemplateModal] = useState(false)
const [editingTemplateIdx, setEditingTemplateIdx] = useState<number | null>(null)
const [templateForm, setTemplateForm] = useState<TemplateFormState>(emptyTemplateForm)

function openNewTemplate() {
  setEditingTemplateIdx(null)
  setTemplateForm(emptyTemplateForm)
  setShowTemplateModal(true)
}

function openEditTemplate(tmpl: MaintenanceTemplateItem, idx: number) {
  setEditingTemplateIdx(idx)
  setTemplateForm({
    name: tmpl.name,
    thresholdType: tmpl.thresholds[0]?.type ?? 'pto_hours',
    value: tmpl.thresholds[0]?.value?.toString() ?? '',
    warn_before_pct: tmpl.warn_before_pct.toString(),
  })
  setShowTemplateModal(true)
}

const updateTemplatesMutation = useMutation({
  mutationFn: ({ typeId, templates }: { typeId: string; templates: MaintenanceTemplateItem[] }) =>
    apiClient.patch<VehicleTypeOut>(`/api/v1/vehicle-types/${typeId}/maintenance-templates`, { templates }),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: keys.vehicleTypes() })
    setShowTemplateModal(false)
  },
})

function saveTemplate() {
  if (!selectedType || !templateForm.name.trim() || !templateForm.value) return
  const newTemplate: MaintenanceTemplateItem = {
    name: templateForm.name.trim(),
    thresholds: [{ type: templateForm.thresholdType, value: parseFloat(templateForm.value) }],
    warn_before_pct: parseInt(templateForm.warn_before_pct) || 10,
  }
  const current: MaintenanceTemplateItem[] = selectedType.maintenance_templates ?? []
  let next: MaintenanceTemplateItem[]
  if (editingTemplateIdx === null) {
    next = [...current, newTemplate]
  } else {
    next = current.map((t, i) => i === editingTemplateIdx ? newTemplate : t)
  }
  updateTemplatesMutation.mutate({ typeId: selectedType.id, templates: next })
}

function deleteTemplate(idx: number) {
  if (!selectedType) return
  const next = (selectedType.maintenance_templates ?? []).filter((_, i) => i !== idx)
  updateTemplatesMutation.mutate({ typeId: selectedType.id, templates: next })
}
```

- [ ] **Step 4: Add the rules query**

Inside the component, after the vehicle types query, add a query to load rules:

```typescript
const { data: allRules = [] } = useQuery({
  queryKey: keys.rules(),
  queryFn: () => apiClient.get<{ id: string; name: string; severity: string; active: boolean; vehicle_filter: { scope: string; vehicle_type_id?: string } }[]>('/api/v1/rules'),
  staleTime: 60_000,
})

const typeRules = allRules.filter(
  r => r.vehicle_filter?.scope === 'type' && r.vehicle_filter?.vehicle_type_id === selectedType?.id
)
```

- [ ] **Step 5: Add maintenance templates section in the right panel JSX**

Find where the icon upload section ends in the JSX (look for the icon upload `<div>` block). After it, add a "Planes de mantenimiento" section:

```tsx
{/* ── Maintenance templates section ──────────────────────────────────────── */}
{user?.tenant_tier === 'cmg' && user?.role === 'admin' && selectedType && (
  <div style={{ marginTop: 24 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        Planes de mantenimiento
      </span>
      <button style={btnPrimary} onClick={openNewTemplate}>+ Añadir</button>
    </div>
    {(selectedType.maintenance_templates ?? []).length === 0 ? (
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sin plantillas configuradas</p>
    ) : (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
            {['NOMBRE', 'UMBRAL', 'VALOR', '% AVISO', ''].map(h => (
              <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-muted)', fontSize: 10, fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(selectedType.maintenance_templates ?? []).map((tmpl, idx) => (
            <tr key={idx} style={{ borderBottom: '1px solid var(--bg-border)' }}>
              <td style={{ padding: '6px 8px' }}>{tmpl.name}</td>
              <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>
                {{ pto_hours: 'h PTO', engine_hours: 'h motor', calendar_days: 'días' }[tmpl.thresholds[0]?.type] ?? tmpl.thresholds[0]?.type}
              </td>
              <td style={{ padding: '6px 8px', fontFamily: 'var(--font-data)' }}>{tmpl.thresholds[0]?.value}</td>
              <td style={{ padding: '6px 8px', fontFamily: 'var(--font-data)' }}>{tmpl.warn_before_pct}%</td>
              <td style={{ padding: '6px 8px', display: 'flex', gap: 6 }}>
                <button style={btnSecondary} onClick={() => openEditTemplate(tmpl, idx)}>Editar</button>
                <button style={{ ...btnSecondary, color: 'var(--accent-crit)', borderColor: 'var(--accent-crit)' }} onClick={() => deleteTemplate(idx)}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
)}
```

- [ ] **Step 6: Add alert rules section in the right panel JSX**

After the maintenance templates section, add the alert rules section:

```tsx
{/* ── Alert rules for this type ──────────────────────────────────────────── */}
{user?.tenant_tier === 'cmg' && user?.role === 'admin' && selectedType && (
  <div style={{ marginTop: 24 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        Reglas de alerta
      </span>
      <button style={btnPrimary} onClick={() => navigate(`/rules/new?type_id=${selectedType.id}`)}>+ Nueva regla</button>
    </div>
    {typeRules.length === 0 ? (
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sin reglas configuradas para este tipo</p>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {typeRules.map(r => (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-base)', borderRadius: 6, padding: '6px 10px' }}>
            <span style={{ fontSize: 12 }}>{r.name}</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: r.severity === 'critical' ? 'var(--accent-crit)' : r.severity === 'warning' ? 'var(--accent-warn)' : 'var(--accent-info)', color: '#fff', fontWeight: 600, textTransform: 'uppercase' }}>
                {r.severity}
              </span>
              <span style={{ fontSize: 10, color: r.active ? 'var(--accent-ok)' : 'var(--text-muted)' }}>
                {r.active ? 'Activa' : 'Inactiva'}
              </span>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 7: Add template modal JSX**

Find the existing sensor modal in the JSX (look for `showSensorModal &&`). After it, add the template modal:

```tsx
{/* ── Template modal ─────────────────────────────────────────────────────── */}
{showTemplateModal && (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
    <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 24, width: 360, border: '1px solid var(--bg-border)' }}>
      <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600 }}>
        {editingTemplateIdx === null ? 'Nueva plantilla' : 'Editar plantilla'}
      </h3>
      <label style={labelStyle}>Nombre</label>
      <input style={{ ...inputStyle, marginBottom: 12 }} value={templateForm.name}
        onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))} />
      <label style={labelStyle}>Tipo de umbral</label>
      <select style={{ ...inputStyle, marginBottom: 12 }}
        value={templateForm.thresholdType}
        onChange={e => setTemplateForm(f => ({ ...f, thresholdType: e.target.value as TemplateFormState['thresholdType'] }))}>
        <option value="pto_hours">Horas PTO</option>
        <option value="engine_hours">Horas motor</option>
        <option value="calendar_days">Días naturales</option>
      </select>
      <label style={labelStyle}>Valor</label>
      <input style={{ ...inputStyle, marginBottom: 12 }} type="number" min="1" value={templateForm.value}
        onChange={e => setTemplateForm(f => ({ ...f, value: e.target.value }))} />
      <label style={labelStyle}>% aviso previo</label>
      <input style={{ ...inputStyle, marginBottom: 20 }} type="number" min="1" max="50" value={templateForm.warn_before_pct}
        onChange={e => setTemplateForm(f => ({ ...f, warn_before_pct: e.target.value }))} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button style={btnSecondary} onClick={() => setShowTemplateModal(false)}>Cancelar</button>
        <button style={btnPrimary} onClick={saveTemplate}
          disabled={updateTemplatesMutation.isPending}>
          {updateTemplatesMutation.isPending ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 8: TypeScript check**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 9: Commit**

```bash
git add frontend/src/features/vehicles/VehicleTypesPage.tsx
git commit -m "feat: VehicleTypesPage — maintenance templates section + alert rules section per type"
```

---

### Task 9: MaintenancePage — "Realizar mantenimiento" modal

**Files:**
- Modify: `frontend/src/features/maintenance/MaintenancePage.tsx`

- [ ] **Step 1: Add imports**

Read `frontend/src/features/maintenance/MaintenancePage.tsx`. Add to existing imports:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../../features/auth/useAuthStore'
```

Note: `useQuery` is already imported. Only add `useMutation` and `useQueryClient` to the existing `@tanstack/react-query` import line.

- [ ] **Step 2: Add modal state and mutation inside component**

Inside the `MaintenancePage` component, after the existing state declarations, add:

```typescript
const qc = useQueryClient()
const { user } = useAuthStore()
const isCmg = user?.tenant_tier === 'cmg'

const [completingPlan, setCompletingPlan] = useState<MaintenancePlanOut | null>(null)
const [completeFile, setCompleteFile] = useState<File | null>(null)
const [completeDesc, setCompleteDesc] = useState('')
const [completeError, setCompleteError] = useState('')

const completeMutation = useMutation({
  mutationFn: async ({ planId, file, description }: { planId: string; file: File | null; description: string }) => {
    const token = useAuthStore.getState().accessToken
    const formData = new FormData()
    if (file) formData.append('file', file)
    if (description) formData.append('description', description)
    const res = await fetch(`/api/v1/maintenance/plans/${planId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Error al registrar mantenimiento' }))
      throw new Error(err.detail ?? 'Error')
    }
    return res.json()
  },
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: keys.maintenancePlans() })
    setCompletingPlan(null)
    setCompleteFile(null)
    setCompleteDesc('')
    setCompleteError('')
  },
  onError: (err: Error) => {
    setCompleteError(err.message)
  },
})

function openComplete(plan: MaintenancePlanOut) {
  setCompletingPlan(plan)
  setCompleteFile(null)
  setCompleteDesc('')
  setCompleteError('')
}

function handleComplete() {
  if (!completingPlan) return
  if (!isCmg && !completeFile) {
    setCompleteError('Debe adjuntar un documento (factura o albarán)')
    return
  }
  completeMutation.mutate({ planId: completingPlan.id, file: completeFile, description: completeDesc })
}
```

- [ ] **Step 3: Add "Realizar mantenimiento" button to the table rows**

Find the existing table row JSX in `MaintenancePage`. The last column (empty `''` header) currently has edit/detail links. Add the "Realizar mantenimiento" button alongside the existing actions:

In the `<td>` for the last column of each row, add:

```tsx
{(plan.progress.status === 'próximo' || plan.progress.status === 'vencido') && (
  <button
    onClick={() => openComplete(plan)}
    style={{
      background: 'var(--accent-energy)',
      color: '#fff',
      border: 'none',
      borderRadius: 5,
      padding: '4px 10px',
      fontSize: 11,
      cursor: 'pointer',
      fontWeight: 600,
      marginLeft: 8,
    }}
  >
    Realizar
  </button>
)}
```

- [ ] **Step 4: Add complete modal JSX**

After the closing `</Shell>` tag or before it (inside Shell, after the main table `div`), add the modal:

```tsx
{/* ── Complete maintenance modal ─────────────────────────────────────────── */}
{completingPlan && (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
    <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 24, width: 400, border: '1px solid var(--bg-border)' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600 }}>Registrar mantenimiento</h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        {completingPlan.name} — {completingPlan.vehicle_name}
      </p>

      <label style={{ fontSize: 11, color: 'var(--accent-off)', fontWeight: 600, letterSpacing: '0.04em', marginBottom: 4, display: 'block' }}>
        Documento (factura / albarán){!isCmg && ' *'}
      </label>
      <input
        type="file"
        accept="image/*,.pdf"
        onChange={e => setCompleteFile(e.target.files?.[0] ?? null)}
        style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-primary, #E7E5E4)', width: '100%' }}
      />

      <label style={{ fontSize: 11, color: 'var(--accent-off)', fontWeight: 600, letterSpacing: '0.04em', marginBottom: 4, display: 'block' }}>
        Descripción (opcional)
      </label>
      <textarea
        value={completeDesc}
        onChange={e => setCompleteDesc(e.target.value)}
        rows={3}
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', color: 'var(--text-primary, #E7E5E4)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box', resize: 'vertical', marginBottom: 12 }}
      />

      {completeError && (
        <p style={{ fontSize: 12, color: 'var(--accent-crit)', marginBottom: 12 }}>{completeError}</p>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={() => setCompletingPlan(null)}
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary, #E7E5E4)', border: '1px solid var(--bg-border)', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}
        >
          Cancelar
        </button>
        <button
          onClick={handleComplete}
          disabled={completeMutation.isPending}
          style={{ background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600, opacity: completeMutation.isPending ? 0.7 : 1 }}
        >
          {completeMutation.isPending ? 'Guardando…' : 'Confirmar y resetear contador'}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 5: TypeScript check**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/maintenance/MaintenancePage.tsx
git commit -m "feat: MaintenancePage — Realizar mantenimiento modal with document upload and counter reset"
```

---

### Task 10: RuleFormPage type_id param + VehicleDetailPage maintenance tab

**Files:**
- Modify: `frontend/src/features/rules/RuleFormPage.tsx`
- Modify: `frontend/src/features/vehicle/VehicleDetailPage.tsx`

- [ ] **Step 1: Read RuleFormPage.tsx**

Read `frontend/src/features/rules/RuleFormPage.tsx` to understand the vehicle_filter form state and how it initializes.

- [ ] **Step 2: Pre-fill type_id in RuleFormPage**

Find where `useSearchParams` is used or add it. In the existing form initialization (likely in a `useState` or a `useEffect`), add:

```typescript
import { useSearchParams } from 'react-router-dom'

// Inside the component:
const [searchParams] = useSearchParams()
const prefilledTypeId = searchParams.get('type_id')
```

Find where `vehicle_filter` state is initialized. Change its initial value to use the prefilled type_id when present:

```typescript
// If vehicle_filter is a state variable initialized with something like:
const [vehicleFilter, setVehicleFilter] = useState({ scope: 'all', vehicle_id: '', vehicle_type_id: '' })

// Change to:
const [vehicleFilter, setVehicleFilter] = useState({
  scope: prefilledTypeId ? 'type' : 'all',
  vehicle_id: '',
  vehicle_type_id: prefilledTypeId ?? '',
})
```

The exact state field names depend on what you see in the file — match them exactly.

- [ ] **Step 3: Read VehicleDetailPage.tsx**

Read `frontend/src/features/vehicle/VehicleDetailPage.tsx` to understand tab structure and existing data fetching.

- [ ] **Step 4: Add Mantenimiento tab to VehicleDetailPage**

Find the tabs array (likely `['EN VIVO', 'HISTÓRICO', 'CICLOS']`). Add `'MANTENIMIENTO'`:

```typescript
const TABS = ['EN VIVO', 'HISTÓRICO', 'CICLOS', 'MANTENIMIENTO'] as const
type Tab = typeof TABS[number]
```

The maintenance data is already fetched: `GET /api/v1/vehicles/{id}/maintenance`. Find where it is fetched and add `queryKey: keys.vehicleMaintenance(id!)` to enable cache invalidation.

Add the maintenance tab content panel (shown when `tab === 'MANTENIMIENTO'`):

```tsx
{tab === 'MANTENIMIENTO' && (
  <div style={{ padding: 24 }}>
    {vehiclePlans.length === 0 ? (
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Sin planes de mantenimiento para este vehículo</p>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {vehiclePlans.map(plan => (
          <div key={plan.id} style={{ background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--bg-border)', padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{plan.name}</div>
                {plan.progress.thresholds.map(t => (
                  <div key={t.type} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {t.current.toFixed(1)} / {t.limit} {{ pto_hours: 'h PTO', engine_hours: 'h motor', calendar_days: 'días' }[t.type] ?? t.type}
                    {' '}({t.pct.toFixed(0)}%)
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                  background: plan.progress.status === 'vencido' ? 'var(--accent-crit)' : plan.progress.status === 'próximo' ? 'var(--accent-warn)' : 'var(--accent-ok)',
                  color: '#fff'
                }}>
                  {plan.progress.status.toUpperCase()}
                </span>
                {isCmg && (
                  <button
                    onClick={() => openEditPlan(plan)}
                    style={{ fontSize: 11, padding: '3px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', borderRadius: 5, cursor: 'pointer', color: 'var(--text-primary, #E7E5E4)' }}
                  >
                    Editar umbrales
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    )}

    {/* Edit thresholds modal — CMG only */}
    {editingPlan && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
        <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 24, width: 360, border: '1px solid var(--bg-border)' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600 }}>Editar umbrales</h3>
          <label style={{ fontSize: 11, color: 'var(--accent-off)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Nombre</label>
          <input style={{ background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', color: 'var(--text-primary, #E7E5E4)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box', marginBottom: 12 }}
            value={editPlanForm.name}
            onChange={e => setEditPlanForm(f => ({ ...f, name: e.target.value }))} />
          <label style={{ fontSize: 11, color: 'var(--accent-off)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Valor umbral</label>
          <input style={{ background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', color: 'var(--text-primary, #E7E5E4)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box', marginBottom: 12 }}
            type="number" min="1" value={editPlanForm.value}
            onChange={e => setEditPlanForm(f => ({ ...f, value: e.target.value }))} />
          <label style={{ fontSize: 11, color: 'var(--accent-off)', fontWeight: 600, display: 'block', marginBottom: 4 }}>% aviso previo</label>
          <input style={{ background: 'var(--bg-elevated)', border: '1px solid var(--bg-border)', color: 'var(--text-primary, #E7E5E4)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box', marginBottom: 20 }}
            type="number" min="1" max="50" value={editPlanForm.warnPct}
            onChange={e => setEditPlanForm(f => ({ ...f, warnPct: e.target.value }))} />
          {editPlanError && <p style={{ color: 'var(--accent-crit)', fontSize: 12, marginBottom: 12 }}>{editPlanError}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setEditingPlan(null)} style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary, #E7E5E4)', border: '1px solid var(--bg-border)', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
            <button onClick={handleEditPlan} disabled={editPlanMutation.isPending} style={{ background: 'var(--accent-energy)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
              {editPlanMutation.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
)}
```

Add the required state and mutation inside the component:

```typescript
const { user } = useAuthStore()
const isCmg = user?.tenant_tier === 'cmg'

const [editingPlan, setEditingPlan] = useState<MaintenancePlanOut | null>(null)
const [editPlanForm, setEditPlanForm] = useState({ name: '', value: '', warnPct: '10' })
const [editPlanError, setEditPlanError] = useState('')

function openEditPlan(plan: MaintenancePlanOut) {
  const firstThreshold = plan.trigger_condition.thresholds[0]
  setEditingPlan(plan)
  setEditPlanForm({
    name: plan.name,
    value: firstThreshold?.value?.toString() ?? '',
    warnPct: plan.warn_before_pct.toString(),
  })
  setEditPlanError('')
}

const editPlanMutation = useMutation({
  mutationFn: ({ planId, body }: { planId: string; body: MaintenancePlanUpdate }) =>
    apiClient.put<MaintenancePlanOut>(`/api/v1/maintenance/plans/${planId}`, body),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: keys.vehicleMaintenance(id!) })
    setEditingPlan(null)
    setEditPlanError('')
  },
  onError: () => setEditPlanError('Error al guardar los cambios'),
})

function handleEditPlan() {
  if (!editingPlan || !editPlanForm.value) return
  const firstThreshold = editingPlan.trigger_condition.thresholds[0]
  if (!firstThreshold) return
  editPlanMutation.mutate({
    planId: editingPlan.id,
    body: {
      name: editPlanForm.name,
      trigger_condition: {
        thresholds: [{ type: firstThreshold.type, value: parseFloat(editPlanForm.value) }],
        op: 'OR',
      },
      warn_before_pct: parseInt(editPlanForm.warnPct) || 10,
    },
  })
}
```

Also add these imports if not already present:
```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../../features/auth/useAuthStore'
import type { MaintenancePlanOut, MaintenancePlanUpdate } from '../../lib/types'
```

- [ ] **Step 5: TypeScript check**

```bash
cd /opt/cmg-telematic1/frontend && npx tsc --noEmit 2>&1 | head -30
```

Fix any errors before continuing.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/rules/RuleFormPage.tsx \
        frontend/src/features/vehicle/VehicleDetailPage.tsx
git commit -m "feat: RuleFormPage pre-fills type from ?type_id param; VehicleDetailPage adds Mantenimiento tab with CMG edit"
```

---

### Task 11: Frontend deploy

- [ ] **Step 1: Build frontend image**

```bash
cd /opt/cmg-telematic1 && docker build -t cmg-frontend ./frontend 2>&1 | tail -5
```

Expected: `Successfully tagged cmg-frontend:latest`

- [ ] **Step 2: Replace container**

```bash
docker stop frontend && docker rm frontend
docker run -d \
  --name frontend \
  --network cmg-telematic1_default \
  -p 127.0.0.1:3000:3000 \
  --restart unless-stopped \
  cmg-frontend
```

- [ ] **Step 3: Verify**

```bash
sleep 5 && curl -s -o /dev/null -w "%{http_code}" https://cmgtrack.com/
```

Expected: `200`

- [ ] **Step 4: Smoke test full flow**

1. Log in as CMG admin → go to Tipos de Vehículo → select a type → verify "Planes de mantenimiento" section appears
2. Add a template (e.g. "Aceite transfer · 1000 h PTO · 10% aviso") → verify it appears in the table
3. Create a new vehicle of that type → go to Mantenimiento → verify the plan was auto-created for the vehicle
4. In MaintenancePage, if a plan shows PRÓXIMO or VENCIDO → click "Realizar" → modal opens → as non-CMG user, submitting without file shows error
5. Go to Tipos de Vehículo → "Reglas de alerta" section → "Nueva regla" → URL has `?type_id=...` → form pre-fills the type
6. Go to vehicle detail → Mantenimiento tab → plans listed → CMG admin sees "Editar umbrales" button
