# FlotaPage Redesign + Vehicle Type Icons — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar FleetPage con grid de tarjetas de vehículo + sistema de iconos PNG por tipo, siguiendo el diseño Figma.

**Architecture:** Backend añade columna `icon_url` a `vehicle_type`, endpoint multipart para subir PNG y StaticFiles mount. Frontend redesigns FleetPage con layout de 3 zonas (grid tarjetas + mapa + paneles inferiores), nuevo componente VehicleCard con icono, y upload de icono en VehicleTypesPage.

**Tech Stack:** FastAPI + Alembic + SQLAlchemy (backend), React 18 + TanStack Query + Zustand (frontend), Caddy reverse proxy, Docker volumes para persistencia de archivos.

---

## File Map

| File | Action |
|---|---|
| `backend/alembic/versions/007_vehicle_type_icon_url.py` | Create |
| `backend/app/models/vehicle_type.py` | Modify — add `icon_url` column |
| `backend/app/schemas/vehicle.py` | Modify — add `icon_url` to `VehicleTypeOut` |
| `backend/app/api/v1/vehicles.py` | Modify — add `POST /vehicle-types/{type_id}/icon` |
| `backend/app/main.py` | Modify — add `StaticFiles` mount, create uploads dir |
| `docker-compose.yml` | Modify — add `uploads_data` volume to core-api |
| `Caddyfile` | Modify — add `/uploads/*` handle block |
| `frontend/src/lib/types.ts` | Modify — add `icon_url` to `VehicleTypeOut` |
| `frontend/src/features/vehicles/VehicleTypesPage.tsx` | Modify — add icon thumbnail + upload button |
| `frontend/src/features/fleet/VehicleCard.tsx` | Create |
| `frontend/src/features/fleet/FleetPage.tsx` | Modify — complete redesign |

---

### Task 1: Alembic migration 007_vehicle_type_icon_url

**Files:**
- Create: `backend/alembic/versions/007_vehicle_type_icon_url.py`

- [ ] **Step 1: Create the migration file**

```python
"""add icon_url to vehicle_type

Revision ID: 007
Revises: 006
Create Date: 2026-04-22
"""
from alembic import op
import sqlalchemy as sa

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vehicle_type",
        sa.Column("icon_url", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("vehicle_type", "icon_url")
```

- [ ] **Step 2: Verify file exists**

```bash
ls backend/alembic/versions/007_vehicle_type_icon_url.py
```
Expected: file listed.

- [ ] **Step 3: Commit**

```bash
git add backend/alembic/versions/007_vehicle_type_icon_url.py
git commit -m "feat: alembic migration 007 — add icon_url to vehicle_type"
```

---

### Task 2: Backend model, schema, icon upload endpoint, StaticFiles

**Files:**
- Modify: `backend/app/models/vehicle_type.py`
- Modify: `backend/app/schemas/vehicle.py`
- Modify: `backend/app/api/v1/vehicles.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Add `icon_url` to the SQLAlchemy model**

Replace the full content of `backend/app/models/vehicle_type.py`:

```python
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

    vehicles = relationship("Vehicle", back_populates="vehicle_type")
```

- [ ] **Step 2: Add `icon_url` to `VehicleTypeOut` schema**

In `backend/app/schemas/vehicle.py`, replace `VehicleTypeOut`:

```python
class VehicleTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    slug: str
    name: str
    sensor_schema: list[dict[str, Any]]
    icon_url: str | None = None
```

- [ ] **Step 3: Add icon upload endpoint to vehicles.py**

Read `backend/app/api/v1/vehicles.py` first, then add the following imports at the top (after existing imports):

```python
from pathlib import Path
from fastapi import UploadFile, File
```

Then add the endpoint after the existing `PATCH /vehicle-types/{type_id}` endpoint:

```python
@router.post("/vehicle-types/{type_id}/icon", response_model=VehicleTypeOut)
async def upload_vehicle_type_icon(
    type_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    if current_user.tenant_tier != "cmg" or current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Solo CMG admin")
    if file.content_type != "image/png":
        raise HTTPException(status_code=400, detail="Solo se aceptan archivos PNG")
    content = await file.read()
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Archivo demasiado grande (máx 2 MB)")

    result = await db.execute(select(VehicleType).where(VehicleType.id == type_id))
    vehicle_type = result.scalar_one_or_none()
    if not vehicle_type:
        raise HTTPException(status_code=404, detail="Tipo de vehículo no encontrado")

    uploads_dir = Path("/app/uploads/icons")
    uploads_dir.mkdir(parents=True, exist_ok=True)
    (uploads_dir / f"{type_id}.png").write_bytes(content)

    vehicle_type.icon_url = f"/uploads/icons/{type_id}.png"
    await db.commit()
    await db.refresh(vehicle_type)
    return vehicle_type
```

- [ ] **Step 4: Mount StaticFiles in main.py**

Replace the full content of `backend/app/main.py`:

```python
# backend/app/main.py
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import redis.asyncio as aioredis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router
from app.api.v1.ws import router as ws_router, ConnectionManager, broadcast_telemetry_task
from app.core.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path("/app/uploads/icons").mkdir(parents=True, exist_ok=True)
    app.state.redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    app.state.ws_manager = ConnectionManager()
    task = asyncio.create_task(
        broadcast_telemetry_task(app.state.redis, app.state.ws_manager)
    )
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    await app.state.redis.aclose()


app = FastAPI(
    title="CMG Telematics API",
    version="2.0.0",
    docs_url="/docs" if not settings.is_production else None,
    redoc_url="/redoc" if not settings.is_production else None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
app.include_router(ws_router)
app.mount("/uploads", StaticFiles(directory="/app/uploads"), name="uploads")


@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/vehicle_type.py \
        backend/app/schemas/vehicle.py \
        backend/app/api/v1/vehicles.py \
        backend/app/main.py
git commit -m "feat: icon_url on vehicle_type — model, schema, upload endpoint, StaticFiles"
```

---

### Task 3: Infrastructure — Caddyfile + docker-compose.yml

**Files:**
- Modify: `Caddyfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add `/uploads/*` handle block to Caddyfile**

In `Caddyfile`, add the `handle /uploads/*` block **before** the catch-all `handle { reverse_proxy frontend:3000 }` block:

```
cmgtrack.com {
    handle /api/* {
        reverse_proxy core-api:8010
    }
    handle /ws/* {
        reverse_proxy core-api:8010
    }
    handle /docs* {
        reverse_proxy core-api:8010
    }
    handle /redoc* {
        reverse_proxy core-api:8010
    }
    handle /openapi.json {
        reverse_proxy core-api:8010
    }
    handle /uploads/* {
        reverse_proxy core-api:8010
    }
    handle {
        reverse_proxy frontend:3000
    }

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        -Server
    }
}

www.cmgtrack.com {
    redir https://cmgtrack.com{uri} permanent
}

www.cmgnexus.es {
    redir https://cmgnexus.es{uri} permanent
}

cmgnexus.es {
    handle {
        reverse_proxy 10.0.0.2:8000 {
            header_up X-Real-IP {remote_host}
            header_up X-Forwarded-Proto https
        }
    }

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        -Server
    }

    @workshop_sw path /static/workshop/sw.js
    header @workshop_sw Service-Worker-Allowed /taller/

    @portal_sw path /static/sw.js
    header @portal_sw Service-Worker-Allowed /
}
```

- [ ] **Step 2: Add uploads_data volume to docker-compose.yml**

In `docker-compose.yml`, add `volumes` mount to the `core-api` service and declare the volume:

The `core-api` service should become:
```yaml
  core-api:
    build:
      context: ./backend
    restart: unless-stopped
    ports:
      - "127.0.0.1:8010:8010"
    environment:
      DB_URL: ${DB_URL}
      DB_URL_SYNC: ${DB_URL_SYNC}
      REDIS_URL: ${REDIS_URL}
      SECRET_KEY: ${SECRET_KEY}
      ENVIRONMENT: ${ENVIRONMENT}
    volumes:
      - uploads_data:/app/uploads
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://localhost:8010/health')\""]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
```

The `volumes:` section at the bottom should become:
```yaml
volumes:
  pgdata:
  redisdata:
  caddydata:
  caddyconfig:
  uploads_data:
```

- [ ] **Step 3: Commit**

```bash
git add Caddyfile docker-compose.yml
git commit -m "feat: Caddyfile /uploads/* block + uploads_data Docker volume for core-api"
```

---

### Task 4: Backend deploy + run migration + smoke test

**Files:** (no code changes — deploy only)

- [ ] **Step 1: Build new core-api image**

```bash
cd /opt/cmg-telematic1
docker build -t cmg-core-api ./backend
```
Expected: `Successfully built ...`

- [ ] **Step 2: Stop and remove old core-api container**

```bash
docker stop core-api && docker rm core-api
```

- [ ] **Step 3: Start new core-api with uploads volume**

```bash
docker run -d \
  --name core-api \
  --network cmg-telematic1_default \
  -p 127.0.0.1:8010:8010 \
  --env-file /opt/cmg-telematic1/.env \
  -v uploads_data:/app/uploads \
  --restart unless-stopped \
  cmg-core-api
```

- [ ] **Step 4: Verify container is healthy**

```bash
docker ps | grep core-api
curl -s http://localhost:8010/health
```
Expected: `{"status":"ok","version":"2.0.0"}`

- [ ] **Step 5: Run alembic migration**

```bash
docker exec core-api alembic upgrade head
```
Expected output ends with: `Running upgrade 006 -> 007, add icon_url to vehicle_type`

- [ ] **Step 6: Verify column exists**

```bash
docker exec -it postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "\d vehicle_type"
```
Expected: `icon_url` column of type `text` appears in the output.

- [ ] **Step 7: Reload Caddy to apply /uploads/* block**

```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```
Expected: no error output.

- [ ] **Step 8: Smoke test the icon endpoint returns 422 without file**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST https://cmgtrack.com/api/v1/vehicle-types/00000000-0000-0000-0000-000000000000/icon
```
Expected: `422` (validation error — no file provided, not 404 which would mean route missing).

- [ ] **Step 9: Commit (no code changes needed — just verify)**

Nothing to commit here — this task is purely operational.

---

### Task 5: Frontend types.ts — add icon_url to VehicleTypeOut

**Files:**
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Add `icon_url` to `VehicleTypeOut` interface**

In `frontend/src/lib/types.ts`, replace the `VehicleTypeOut` interface:

```typescript
export interface VehicleTypeOut {
  id: string
  slug: string
  name: string
  sensor_schema: SensorDef[]
  icon_url: string | null
}
```

- [ ] **Step 2: Verify TypeScript compilation has no errors**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```
Expected: no output (no errors).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/types.ts
git commit -m "feat: add icon_url to VehicleTypeOut frontend type"
```

---

### Task 6: VehicleTypesPage — icon upload UI

**Files:**
- Modify: `frontend/src/features/vehicles/VehicleTypesPage.tsx`

- [ ] **Step 1: Read the current state of VehicleTypesPage.tsx**

Read `frontend/src/features/vehicles/VehicleTypesPage.tsx` (full file) to understand the current structure of the selected type's header panel.

- [ ] **Step 2: Add icon upload function and state**

After the existing imports in VehicleTypesPage.tsx, add the import for useAuthStore:

```typescript
import { useAuthStore } from '../../features/auth/useAuthStore'
```

Then add the `uploadIcon` helper function (outside the component, after the form helper functions):

```typescript
async function uploadIcon(typeId: string, file: File): Promise<VehicleTypeOut> {
  const token = useAuthStore.getState().accessToken
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`/api/v1/vehicle-types/${typeId}/icon`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status}: ${text}`)
  }
  return res.json()
}
```

- [ ] **Step 3: Add icon upload mutation in the component**

Inside the `VehicleTypesPage` component function, after the existing mutations (e.g. after `schemaMutation`), add:

```typescript
const iconMutation = useMutation({
  mutationFn: ({ typeId, file }: { typeId: string; file: File }) =>
    uploadIcon(typeId, file),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.vehicleTypes() }),
})
```

- [ ] **Step 4: Add icon thumbnail and upload button in the right panel header**

In the JSX section that renders the selected type header (the section showing the type's name, slug, and edit buttons), add the icon thumbnail and upload button. It should appear after the type name row:

```tsx
{/* Icon row */}
<div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
  <div style={{
    width: 40, height: 40,
    background: 'var(--bg-elevated)',
    borderRadius: 6,
    border: '1px solid var(--bg-border)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  }}>
    {selectedType.icon_url
      ? <img
          src={selectedType.icon_url}
          alt="icon"
          style={{ width: 40, height: 40, objectFit: 'contain' }}
        />
      : <span style={{ fontSize: 18, color: 'var(--text-muted)' }}>🚛</span>
    }
  </div>
  <div>
    <label style={{
      padding: '4px 10px',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--bg-border)',
      borderRadius: 6,
      fontSize: 12,
      color: 'var(--text-default)',
      cursor: iconMutation.isPending ? 'not-allowed' : 'pointer',
      opacity: iconMutation.isPending ? 0.6 : 1,
    }}>
      {iconMutation.isPending ? 'Subiendo…' : 'Subir icono PNG'}
      <input
        type="file"
        accept="image/png"
        style={{ display: 'none' }}
        disabled={iconMutation.isPending}
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) iconMutation.mutate({ typeId: selectedType.id, file })
          e.target.value = ''
        }}
      />
    </label>
    {iconMutation.isError && (
      <div style={{ fontSize: 11, color: 'var(--accent-crit)', marginTop: 4 }}>
        {(iconMutation.error as Error).message}
      </div>
    )}
  </div>
</div>
```

- [ ] **Step 5: Verify TypeScript has no errors**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/vehicles/VehicleTypesPage.tsx
git commit -m "feat: icon upload UI in VehicleTypesPage — thumbnail + file input"
```

---

### Task 7: VehicleCard.tsx — new component

**Files:**
- Create: `frontend/src/features/fleet/VehicleCard.tsx`

- [ ] **Step 1: Create VehicleCard.tsx**

```tsx
import { useFleetStore } from './useFleetStore'
import type { VehicleOut, VehicleTypeOut, VehicleStatus } from '../../lib/types'

interface Props {
  vehicle: VehicleOut
  vehicleType: VehicleTypeOut | undefined
  status: VehicleStatus | undefined
  isSelected: boolean
}

function TruckSvg() {
  return (
    <svg width="64" height="52" viewBox="0 0 64 52" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="10" width="38" height="24" rx="3" fill="var(--bg-elevated)" stroke="var(--bg-border)" strokeWidth="1.5"/>
      <rect x="40" y="16" width="20" height="18" rx="3" fill="var(--bg-elevated)" stroke="var(--bg-border)" strokeWidth="1.5"/>
      <rect x="43" y="17" width="10" height="9" rx="1.5" fill="var(--accent-info)" opacity="0.3"/>
      <rect x="2" y="34" width="58" height="4" rx="1" fill="var(--bg-border)"/>
      <circle cx="13" cy="42" r="5" fill="var(--bg-elevated)" stroke="var(--bg-border)" strokeWidth="2"/>
      <circle cx="49" cy="42" r="5" fill="var(--bg-elevated)" stroke="var(--bg-border)" strokeWidth="2"/>
    </svg>
  )
}

export default function VehicleCard({ vehicle, vehicleType, status, isSelected }: Props) {
  const setSelected = useFleetStore(s => s.setSelected)
  const online = status?.online ?? false

  const borderColor = isSelected
    ? 'var(--accent-energy)'
    : online ? 'var(--accent-ok)' : 'var(--bg-border)'

  return (
    <div
      onClick={() => setSelected(isSelected ? null : vehicle.id)}
      title={vehicle.license_plate ?? vehicle.name}
      style={{
        minWidth: 160,
        minHeight: 140,
        padding: '10px 8px 8px',
        background: 'var(--bg-surface)',
        border: `2px solid ${borderColor}`,
        borderRadius: 8,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
        transition: 'border-color 0.15s',
        userSelect: 'none',
      }}
    >
      <div style={{
        height: 80,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {vehicleType?.icon_url
          ? <img
              src={vehicleType.icon_url}
              alt={vehicleType.name}
              style={{ maxHeight: 80, maxWidth: '100%', objectFit: 'contain' }}
            />
          : <TruckSvg />
        }
      </div>

      <div style={{
        marginTop: 6,
        fontSize: 12,
        fontFamily: 'var(--font-data)',
        color: 'var(--text-default)',
        textAlign: 'center',
        lineHeight: 1.3,
        wordBreak: 'break-all',
        width: '100%',
      }}>
        {vehicle.license_plate ?? vehicle.name}
      </div>

      <div style={{
        position: 'absolute',
        bottom: 7,
        right: 7,
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: online ? 'var(--accent-ok)' : 'var(--bg-border)',
      }} />
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript has no errors**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/fleet/VehicleCard.tsx
git commit -m "feat: VehicleCard component — icon, plate, online dot, selection border"
```

---

### Task 8: FleetPage.tsx — complete redesign

**Files:**
- Modify: `frontend/src/features/fleet/FleetPage.tsx`

This is the most complex task. The new FleetPage layout:
- **Top** (~55vh): flex row — grid of VehicleCards (left ~55%) + FleetMap (right ~45%)
- **Bottom** (~45vh): flex row
  - No selection: Servicios (50%) + Incidencias (50%)
  - With selection: Servicios (25%) + Incidencias (35%) + Panel vehículo (40%, slide in)

Critical constraint: `FleetMap.tsx` must **not** be modified. It receives `vehicles` and `statuses` props and internally reads `selectedId` from `useFleetStore`.

- [ ] **Step 1: Write the relative time helper (top of file)**

The file will start with this utility:

```typescript
function relativeTime(iso: string | null): string {
  if (!iso) return 'Sin señal'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'Hace un momento'
  if (mins < 60) return `Hace ${mins} min`
  const h = Math.floor(mins / 60)
  if (h < 24) return `Hace ${h}h`
  return `Hace ${Math.floor(h / 24)}d`
}
```

- [ ] **Step 2: Write the full redesigned FleetPage.tsx**

Replace the entire content of `frontend/src/features/fleet/FleetPage.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import Shell from '../../shared/ui/Shell'
import FleetMap from './FleetMap'
import VehicleCard from './VehicleCard'
import { useFleetStore } from './useFleetStore'
import { useVehicleStatuses } from './useVehicleStatuses'
import { apiClient } from '../../lib/apiClient'
import { keys } from '../../lib/queryKeys'
import type { VehicleOut, VehicleTypeOut, AlertInstanceOut, TenantOut } from '../../lib/types'

interface AlertRuleBrief { id: string; name: string }

function relativeTime(iso: string | null): string {
  if (!iso) return 'Sin señal'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'Hace un momento'
  if (mins < 60) return `Hace ${mins} min`
  const h = Math.floor(mins / 60)
  if (h < 24) return `Hace ${h}h`
  return `Hace ${Math.floor(h / 24)}d`
}

export default function FleetPage() {
  const selectedId = useFleetStore(s => s.selectedId)
  const setSelected = useFleetStore(s => s.setSelected)

  const { data: vehicles = [] } = useQuery({
    queryKey: keys.vehicles(),
    queryFn: () => apiClient.get<VehicleOut[]>('/api/v1/vehicles'),
    staleTime: 5 * 60_000,
  })

  const { data: vehicleTypes = [] } = useQuery({
    queryKey: keys.vehicleTypes(),
    queryFn: () => apiClient.get<VehicleTypeOut[]>('/api/v1/vehicle-types'),
    staleTime: 10 * 60_000,
  })

  const { data: tenants = [] } = useQuery({
    queryKey: keys.tenants(),
    queryFn: () => apiClient.get<TenantOut[]>('/api/v1/tenants'),
    staleTime: 10 * 60_000,
  })

  const { data: firingAlerts = [] } = useQuery({
    queryKey: [...keys.alerts(), 'firing'],
    queryFn: () => apiClient.get<AlertInstanceOut[]>('/api/v1/alerts?status=firing'),
    refetchInterval: 30_000,
  })

  const { data: rules = [] } = useQuery({
    queryKey: keys.rules(),
    queryFn: () => apiClient.get<AlertRuleBrief[]>('/api/v1/alert-rules'),
    staleTime: 5 * 60_000,
  })

  const statuses = useVehicleStatuses(vehicles)

  const typeById = new Map(vehicleTypes.map(t => [t.id, t]))
  const vehicleById = new Map(vehicles.map(v => [v.id, v]))
  const tenantById = new Map(tenants.map(t => [t.id, t]))
  const ruleById = new Map(rules.map(r => [r.id, r]))

  const onlineCount = vehicles.filter(v => statuses.get(v.id)?.online).length
  const offlineCount = vehicles.length - onlineCount

  const selectedVehicle = selectedId ? vehicleById.get(selectedId) : undefined
  const selectedStatus = selectedId ? statuses.get(selectedId) : undefined
  const selectedType = selectedVehicle ? typeById.get(selectedVehicle.vehicle_type_id) : undefined
  const selectedTenant = selectedVehicle ? tenantById.get(selectedVehicle.tenant_id) : undefined

  const topAlerts = [...firingAlerts]
    .sort((a, b) => new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime())
    .slice(0, 5)

  // CAN LED states for selected vehicle panel
  const canLedStates = (() => {
    if (!selectedType || !selectedStatus) return []
    return selectedType.sensor_schema
      .filter(def => def.gauge_type === 'led' && def.avl_id != null)
      .map(def => {
        const raw = selectedStatus.can_data?.[`avl_${def.avl_id}`]
        let active = false
        if (raw != null) {
          const num = Number(raw)
          if (def.bit_index != null) {
            active = ((num >> def.bit_index) & 1) === 1
          } else {
            active = num === 1
          }
        }
        return { label: def.label, active }
      })
  })()

  return (
    <Shell title="Flota">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

        {/* ── Top section ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', height: '55vh', minHeight: 0 }}>

          {/* Left: vehicle grid */}
          <div style={{
            width: '55%',
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid var(--bg-border)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--bg-border)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexShrink: 0,
            }}>
              <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 14, color: 'var(--text-default)' }}>
                FLOTA
              </span>
              <span style={{ fontSize: 12, color: 'var(--accent-ok)' }}>
                ● Activos: {onlineCount}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                ○ No activos: {offlineCount}
              </span>
            </div>

            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: 12,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 10,
              alignContent: 'start',
            }}>
              {vehicles.map(vehicle => (
                <VehicleCard
                  key={vehicle.id}
                  vehicle={vehicle}
                  vehicleType={typeById.get(vehicle.vehicle_type_id)}
                  status={statuses.get(vehicle.id)}
                  isSelected={vehicle.id === selectedId}
                />
              ))}
              {vehicles.length === 0 && (
                <div style={{ gridColumn: '1 / -1', color: 'var(--text-muted)', fontSize: 13, paddingTop: 20 }}>
                  Sin vehículos registrados
                </div>
              )}
            </div>
          </div>

          {/* Right: map */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <FleetMap vehicles={vehicles} statuses={statuses} />
          </div>
        </div>

        {/* ── Bottom section ───────────────────────────────────────── */}
        <div style={{
          flex: 1,
          display: 'flex',
          minHeight: 0,
          borderTop: '1px solid var(--bg-border)',
          overflow: 'hidden',
        }}>

          {/* Servicios del día */}
          <div style={{
            width: selectedId ? '25%' : '50%',
            transition: 'width 0.2s ease',
            borderRight: '1px solid var(--bg-border)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '8px 14px',
              borderBottom: '1px solid var(--bg-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-default)' }}>Servicios del día</span>
              <input
                type="date"
                disabled
                style={{
                  fontSize: 11,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--bg-border)',
                  borderRadius: 4,
                  color: 'var(--text-muted)',
                  padding: '2px 6px',
                  cursor: 'not-allowed',
                }}
              />
            </div>
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              textAlign: 'center',
            }}>
              <div>
                <div style={{ fontSize: 22, marginBottom: 8 }}>📋</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Próximamente — configuración<br />por cliente y tipo de vehículo
                </div>
              </div>
            </div>
          </div>

          {/* Incidencias */}
          <div style={{
            width: selectedId ? '35%' : '50%',
            transition: 'width 0.2s ease',
            borderRight: selectedId ? '1px solid var(--bg-border)' : 'none',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '8px 14px',
              borderBottom: '1px solid var(--bg-border)',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-default)' }}>Incidencias activas</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {topAlerts.length === 0 ? (
                <div style={{ padding: '16px 14px', fontSize: 12, color: 'var(--accent-ok)' }}>
                  ✓ Sin incidencias activas
                </div>
              ) : (
                topAlerts.map(alert => {
                  const v = vehicleById.get(alert.vehicle_id)
                  const rule = ruleById.get(alert.rule_id)
                  return (
                    <div key={alert.id} style={{
                      padding: '8px 14px',
                      borderBottom: '1px solid var(--bg-border)',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
                          {relativeTime(alert.triggered_at)}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--accent-warn)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {rule?.name ?? alert.rule_id.slice(0, 8)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v?.license_plate ?? v?.name ?? '—'}
                        </div>
                      </div>
                      <Link
                        to="/alerts"
                        style={{ fontSize: 11, color: 'var(--accent-info)', flexShrink: 0 }}
                      >
                        Detalles →
                      </Link>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Panel vehículo seleccionado */}
          <div style={{
            width: selectedId ? '40%' : 0,
            overflow: 'hidden',
            transition: 'width 0.2s ease',
            flexShrink: 0,
          }}>
            {selectedVehicle && (
              <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}>
                {/* Panel header */}
                <div style={{
                  padding: '8px 14px',
                  borderBottom: '1px solid var(--bg-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexShrink: 0,
                }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-default)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedTenant?.name ?? '—'}
                  </span>
                  <button
                    onClick={() => setSelected(null)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      fontSize: 16,
                      lineHeight: 1,
                      padding: '0 2px',
                    }}
                    title="Cerrar panel"
                  >
                    ×
                  </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
                  {/* Conductor + enlace */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Conductor</div>
                      <div style={{ fontSize: 12, color: 'var(--text-default)' }}>—</div>
                    </div>
                    <Link
                      to={`/vehicles/${selectedVehicle.id}`}
                      style={{ fontSize: 12, color: 'var(--accent-info)', alignSelf: 'flex-end' }}
                    >
                      Detalle →
                    </Link>
                  </div>

                  {/* Ficha */}
                  <div style={{
                    background: 'var(--bg-elevated)',
                    borderRadius: 6,
                    padding: '10px 12px',
                    marginBottom: 12,
                  }}>
                    <Row label="Tipo" value={selectedType?.name ?? '—'} />
                    <Row label="Matrícula" value={selectedVehicle.license_plate ?? '—'} />
                    <Row label="VIN" value={selectedVehicle.vin ?? '—'} />
                  </div>

                  {/* Estados CAN */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Estados CAN
                    </div>
                    <CanBadge label="Ignición" active={selectedStatus?.ignition ?? false} />
                    <CanBadge label="PTO" active={selectedStatus?.pto_active ?? false} />
                    {canLedStates.map(s => (
                      <CanBadge key={s.label} label={s.label} active={s.active} />
                    ))}
                  </div>

                  {/* Última señal */}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Última señal: {relativeTime(selectedStatus?.last_seen ?? null)}
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </Shell>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--text-default)', fontFamily: 'var(--font-data)', textAlign: 'right', maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </span>
    </div>
  )
}

function CanBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    }}>
      <span style={{ fontSize: 12, color: 'var(--text-default)' }}>{label}</span>
      <span style={{
        fontSize: 10,
        padding: '2px 8px',
        borderRadius: 10,
        background: active ? 'color-mix(in srgb, var(--accent-ok) 20%, transparent)' : 'var(--bg-elevated)',
        color: active ? 'var(--accent-ok)' : 'var(--text-muted)',
        border: `1px solid ${active ? 'var(--accent-ok)' : 'var(--bg-border)'}`,
        fontWeight: 500,
      }}>
        {active ? 'Activo' : 'Desactivado'}
      </span>
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript has no errors**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/fleet/FleetPage.tsx
git commit -m "feat: FleetPage complete redesign — grid cards, map, incidencias, vehicle panel"
```

---

### Task 9: Frontend deploy

**Files:** (no code changes — deploy only)

- [ ] **Step 1: Build new frontend image**

```bash
cd /opt/cmg-telematic1
docker build -t cmg-frontend ./frontend
```
Expected: `Successfully built ...`

- [ ] **Step 2: Stop and remove old frontend container**

```bash
docker stop frontend && docker rm frontend
```

- [ ] **Step 3: Start new frontend container**

```bash
docker run -d \
  --name frontend \
  --network cmg-telematic1_default \
  -p 127.0.0.1:3000:3000 \
  --restart unless-stopped \
  cmg-frontend
```

- [ ] **Step 4: Verify frontend responds**

```bash
curl -s -o /dev/null -w "%{http_code}" https://cmgtrack.com/fleet
```
Expected: `200`

- [ ] **Step 5: Smoke test in browser**

Navigate to `https://cmgtrack.com/fleet` and verify:
1. Grid of vehicle cards appears in the left ~55% of the top section
2. Map appears in the right ~45% of the top section
3. Bottom section shows "Servicios del día" (placeholder) and "Incidencias activas"
4. Clicking a card selects it: border turns orange, vehicle panel slides in on the right of the bottom section
5. Vehicle panel shows tenant name, tipo, matrícula, VIN, ignición/PTO badges
6. Clicking the card again (or ×) deselects and panel closes
7. Navigate to `/tipos-vehiculo` → select a type → icon thumbnail appears (gray if no icon) + "Subir icono PNG" button → upload a PNG → thumbnail updates

- [ ] **Step 6: Commit final deploy notes (optional)**

If there are no code changes, nothing to commit. The sprint is complete.

---

## Self-Review Checklist

### Spec coverage
- [x] Grid tarjetas con icono PNG / SVG fallback
- [x] Borde verde (online) / gris (offline) / naranja (seleccionado)
- [x] Matrícula + punto de estado
- [x] Mapa top-right, FleetMap sin modificar
- [x] Panel inferior: Servicios del día (placeholder) + Incidencias (max 5, firing)
- [x] Panel vehículo: empresa, conductor "—", enlace Detalle, tipo/matrícula/VIN, estados CAN (ignición + PTO + LED sensores), última señal
- [x] Upload icono PNG desde VehicleTypesPage (solo CMG admin)
- [x] Endpoint multipart con validación PNG + 2MB
- [x] Alembic migration 007
- [x] StaticFiles mount en FastAPI
- [x] uploads_data Docker volume
- [x] Caddyfile /uploads/* block
- [x] `useFleetStore.setSelected()` usado (no useState local) — FleetMap.tsx no se toca
- [x] Transición CSS suave al aparecer/desaparecer panel
