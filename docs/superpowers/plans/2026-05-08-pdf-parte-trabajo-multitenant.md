# PDF Parte de Trabajo Multi-tenant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar el PDF del parte de trabajo para que sea un albarán de servicio profesional con branding por tenant emisor, telemetría configurable por tipo de vehículo, firma + DNI del cliente final (o motivo de no firma), descarga desde web autenticado y compartir desde mobile con la Share API nativa.

**Architecture:** Backend FastAPI extiende endpoints existentes (no portal nuevo); frontend React añade componentes de configuración y descarga; mobile React Native rediseña pantalla de cierre y añade nueva pantalla de éxito con compartir PDF. Sin nuevas dependencias backend, una nueva tabla (`tenant_doc_counter`) y siete columnas nuevas distribuidas en cuatro tablas existentes.

**Tech Stack:** Python 3.11 / FastAPI / SQLAlchemy 2.x async / Alembic / WeasyPrint / pytest · React 18 / Vite / TanStack Query / vitest · React Native / Expo (`expo-file-system`, `expo-sharing`)

**Spec source:** `docs/superpowers/specs/2026-05-08-pdf-parte-trabajo-multitenant-design.md` (commit `dd4f7e4`)

---

## Convenciones del plan

- Todos los comandos backend asumen `cwd=/opt/cmg-telematic1/backend` salvo que se indique.
- Todos los comandos frontend asumen `cwd=/opt/cmg-telematic1/frontend`.
- Todos los comandos mobile asumen `cwd=/opt/cmg-telematic1/mobile`.
- Tras cada cambio de schema en backend, ejecutar `alembic upgrade head` dentro del contenedor de core-api en producción no forma parte del plan (lo hace despliegue). Los tests usan migraciones fixture o esquema en memoria — no se aplica Alembic en local salvo que el desarrollador lo decida.
- En este proyecto el status "completado" de una orden se llama `'done'` (no `'completed'`). El plan usa `'done'` consistentemente.
- En cada commit referenciamos qué tarea/sub-paso lo origina para trazabilidad.

---

## Mapa de archivos

### Backend
| Archivo | Acción | Responsabilidad |
|---|---|---|
| `backend/alembic/versions/021_pdf_parte_multitenant.py` | Crear | Migración: 7 columnas + 1 tabla |
| `backend/app/models/tenant.py` | Modificar | Añadir `business_cif`, `business_address` |
| `backend/app/models/vehicle_type.py` | Modificar | Añadir `pdf_metrics` |
| `backend/app/models/work_order.py` | Modificar | Añadir `final_client_name`, `final_client_address`, `doc_number` |
| `backend/app/models/work_report.py` | Modificar | Añadir `client_signee_name`, `client_signee_dni`, `unsigned_reason` |
| `backend/app/models/tenant_doc_counter.py` | Crear | Modelo nuevo de contador atómico |
| `backend/app/models/__init__.py` | Modificar | Registrar nuevo modelo |
| `backend/app/schemas/tenant.py` | Modificar | Añadir `business_cif`, `business_address` a schemas |
| `backend/app/schemas/vehicle.py` | Modificar | Añadir `PdfMetric` y `pdf_metrics` a `VehicleTypeUpdate`/`VehicleTypeOut` |
| `backend/app/schemas/work_order.py` | Modificar | Añadir `final_client_*`, `doc_number` a schemas |
| `backend/app/schemas/work_report.py` | Modificar | Añadir `client_signee_*`, `unsigned_reason` |
| `backend/app/services/__init__.py` | Crear (si no existe) | Paquete de servicios |
| `backend/app/services/doc_numbers.py` | Crear | Helper `assign_doc_number` atómico |
| `backend/app/api/v1/work_orders.py` | Modificar | Wire `final_client_*`, llamar `assign_doc_number` al pasar a `done` |
| `backend/app/api/v1/vehicles.py` | Modificar | Aceptar `pdf_metrics` en `PATCH /vehicle-types/{id}` |
| `backend/app/api/v1/tenants.py` | Modificar | Aceptar `business_cif`/`business_address` en update tenant |
| `backend/app/api/v1/work_reports.py` | Modificar | Validación XOR firma/no-firma · template PDF · helper format_metric · endpoint telemetry-detail |
| `backend/tests/api/test_doc_numbers.py` | Crear | Tests de `assign_doc_number` |
| `backend/tests/api/test_work_reports_signature.py` | Crear | Tests de validación XOR firma/no-firma |
| `backend/tests/api/test_work_reports_pdf.py` | Crear | Tests del template PDF (smoke + branding + telemetría) |
| `backend/tests/api/test_vehicle_types_pdf_metrics.py` | Crear | Tests de configuración pdf_metrics |

### Frontend (web)
| Archivo | Acción | Responsabilidad |
|---|---|---|
| `frontend/src/features/clientes/TenantFormPage.tsx` | Modificar | Inputs `business_cif`, `business_address`, `primary_color` |
| `frontend/src/features/vehicles/PdfMetricsSection.tsx` | Crear | Componente de configuración de métricas PDF |
| `frontend/src/features/vehicles/VehicleTypesPage.tsx` | Modificar | Integrar `PdfMetricsSection` |
| `frontend/src/features/work-orders/WorkOrdersPage.tsx` | Modificar | Columna `doc_number`, botones "Descargar PDF", inputs cliente final, tab Telemetría capturada en modal |
| `frontend/src/features/work-orders/WorkReportModal.tsx` | Modificar | Mostrar Telemetría capturada · botón Descargar PDF visible |
| `frontend/src/api/workOrders.ts` (o equivalente) | Modificar | Tipos extendidos + endpoint telemetry-detail |

### Mobile
| Archivo | Acción | Responsabilidad |
|---|---|---|
| `mobile/package.json` | Modificar | Añadir `expo-file-system` y `expo-sharing` |
| `mobile/src/utils/dni.ts` | Crear | Helper `isValidDni` |
| `mobile/src/screens/WorkReportScreen.tsx` | Modificar | Bloque firma cliente con DNI o motivo de no firma |
| `mobile/src/screens/WorkReportSuccessScreen.tsx` | Crear | Pantalla post-cierre con compartir PDF |
| `mobile/src/api/workOrders.ts` | Modificar | Payload extendido + helper `downloadAndShareReportPdf` |
| `mobile/src/types/index.ts` | Modificar | Tipos `WorkReport` extendidos |
| `mobile/src/navigation/MainNavigator.tsx` | Modificar | Registrar `WorkReportSuccess` |

---

# FASE 1 — BACKEND: Migración + Modelos + Schemas

## Task 1: Migración 021 — Schema multi-tenant del PDF

**Files:**
- Create: `backend/alembic/versions/021_pdf_parte_multitenant.py`

- [ ] **Step 1: Crear el archivo de migración con `upgrade()` y `downgrade()`**

```python
"""pdf parte trabajo multitenant - cliente final + branding + doc_number

Revision ID: 021
Revises: 020
Create Date: 2026-05-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = '021'
down_revision = '020'
branch_labels = None
depends_on = None


def upgrade():
    # tenant: datos legales del emisor
    op.add_column('tenant', sa.Column('business_cif', sa.String(20), nullable=True))
    op.add_column('tenant', sa.Column('business_address', sa.String(300), nullable=True))

    # vehicle_type: métricas configurables del PDF
    op.add_column(
        'vehicle_type',
        sa.Column('pdf_metrics', JSONB, nullable=False, server_default="'[]'::jsonb"),
    )

    # work_order: datos del cliente final + número de documento
    op.add_column('work_order', sa.Column('final_client_name', sa.String(200), nullable=True))
    op.add_column('work_order', sa.Column('final_client_address', sa.String(300), nullable=True))
    op.add_column('work_order', sa.Column('doc_number', sa.String(40), nullable=True))
    op.create_index(
        'work_order_doc_number_idx',
        'work_order',
        ['tenant_id', 'doc_number'],
        unique=True,
        postgresql_where=sa.text('doc_number IS NOT NULL'),
    )

    # work_report: firmante o motivo de no firma
    op.add_column('work_report', sa.Column('client_signee_name', sa.String(200), nullable=True))
    op.add_column('work_report', sa.Column('client_signee_dni', sa.String(20), nullable=True))
    op.add_column('work_report', sa.Column('unsigned_reason', sa.String(200), nullable=True))

    # tabla counter para asignación atómica de doc_number
    op.create_table(
        'tenant_doc_counter',
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id', ondelete='CASCADE'), nullable=False),
        sa.Column('year', sa.Integer, nullable=False),
        sa.Column('last_seq', sa.Integer, nullable=False, server_default='0'),
        sa.PrimaryKeyConstraint('tenant_id', 'year'),
    )


def downgrade():
    op.drop_table('tenant_doc_counter')
    op.drop_column('work_report', 'unsigned_reason')
    op.drop_column('work_report', 'client_signee_dni')
    op.drop_column('work_report', 'client_signee_name')
    op.drop_index('work_order_doc_number_idx', table_name='work_order')
    op.drop_column('work_order', 'doc_number')
    op.drop_column('work_order', 'final_client_address')
    op.drop_column('work_order', 'final_client_name')
    op.drop_column('vehicle_type', 'pdf_metrics')
    op.drop_column('tenant', 'business_address')
    op.drop_column('tenant', 'business_cif')
```

- [ ] **Step 2: Verificar la migración compila y se enlaza con la 020**

Run: `python -m alembic --config alembic.ini history --verbose 2>&1 | head -10`
Expected: aparece `021 (head) -> 020` o similar; sin errores de import.

- [ ] **Step 3: Commit**

```bash
git add backend/alembic/versions/021_pdf_parte_multitenant.py
git commit -m "feat(db): migración 021 PDF parte multitenant — schema"
```

---

## Task 2: Modelos SQLAlchemy

**Files:**
- Create: `backend/app/models/tenant_doc_counter.py`
- Modify: `backend/app/models/tenant.py`, `backend/app/models/vehicle_type.py`, `backend/app/models/work_order.py`, `backend/app/models/work_report.py`, `backend/app/models/__init__.py`

- [ ] **Step 1: Crear modelo `TenantDocCounter`**

Crear `backend/app/models/tenant_doc_counter.py`:

```python
import uuid
from sqlalchemy import Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class TenantDocCounter(Base):
    __tablename__ = "tenant_doc_counter"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id", ondelete="CASCADE"), primary_key=True,
    )
    year: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
```

- [ ] **Step 2: Añadir columnas a `Tenant`**

Editar `backend/app/models/tenant.py`. Después de la línea `notification_email: Mapped[str | None] = mapped_column(Text(), nullable=True)`, añadir:

```python
    business_cif: Mapped[str | None] = mapped_column(String(20), nullable=True)
    business_address: Mapped[str | None] = mapped_column(String(300), nullable=True)
```

- [ ] **Step 3: Añadir columna a `VehicleType`**

Editar `backend/app/models/vehicle_type.py`. Después de `dout_config: ...`, añadir:

```python
    pdf_metrics: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="'[]'", default=list)
```

- [ ] **Step 4: Añadir columnas a `WorkOrder`**

Editar `backend/app/models/work_order.py`. Después de `notes: ...` y antes de `created_by: ...`, añadir:

```python
    final_client_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    final_client_address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    doc_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
```

- [ ] **Step 5: Añadir columnas a `WorkReport`**

Editar `backend/app/models/work_report.py`. Después de `signature_url: ...`, añadir:

```python
    client_signee_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    client_signee_dni: Mapped[str | None] = mapped_column(String(20), nullable=True)
    unsigned_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
```

Importar `String` arriba si no estaba: `from sqlalchemy import Text, ForeignKey, DateTime, Integer, String`.

- [ ] **Step 6: Registrar modelo nuevo en `__init__.py`**

Verificar `backend/app/models/__init__.py` y añadir línea:

```python
from app.models.tenant_doc_counter import TenantDocCounter  # noqa: F401
```

(Si el archivo ya importa otros modelos siguiendo un patrón, sigue ese patrón.)

- [ ] **Step 7: Verificar que los modelos cargan sin errores**

Run: `python -c "from app.models import tenant, vehicle_type, work_order, work_report, tenant_doc_counter; print('ok')"`
Expected: `ok`

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/
git commit -m "feat(models): pdf parte multitenant — campos en tenant/vehicle_type/work_order/work_report + TenantDocCounter"
```

---

## Task 3: Pydantic schemas extendidos

**Files:**
- Modify: `backend/app/schemas/tenant.py`, `backend/app/schemas/vehicle.py`, `backend/app/schemas/work_order.py`, `backend/app/schemas/work_report.py`

- [ ] **Step 1: Schema `tenant.py` — extender `TenantOut` y `TenantUpdate`**

Editar `backend/app/schemas/tenant.py`. Añadir campos a `TenantOut`:

```python
class TenantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    parent_id: uuid.UUID | None = None
    tier: str
    name: str
    slug: str
    active: bool
    brand_name: str | None = None
    brand_color: str | None = None
    logo_url: str | None = None
    custom_domain: str | None = None
    brand_tokens: dict[str, Any] | None = None
    enabled_modules: list[str] = []
    business_cif: str | None = None
    business_address: str | None = None
    created_at: datetime
```

Y a `TenantUpdate`:

```python
class TenantUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
    active: bool | None = None
    enabled_modules: list[str] | None = None
    business_cif: str | None = None
    business_address: str | None = None
```

- [ ] **Step 2: Schema `vehicle.py` — definir `PdfMetric` y extender `VehicleTypeOut`/`VehicleTypeUpdate`**

Editar `backend/app/schemas/vehicle.py`. Añadir tras la importación inicial:

```python
from pydantic import Field
```

(Si ya está importado, no duplicar.) Añadir clase `PdfMetric` después de `HistoricMetricItem`:

```python
PdfMetricKey = Literal['pto_minutes','pressure_min','pressure_max','rpm_avg','pump_minutes','fuel_l']
PdfMetricFormat = Literal['integer','decimal1','decimal2']


class PdfMetric(BaseModel):
    key: PdfMetricKey
    label: str = Field(min_length=1, max_length=60)
    unit: str = Field(min_length=1, max_length=10)
    format: PdfMetricFormat
```

Modificar `VehicleTypeOut` añadiendo línea:

```python
    pdf_metrics: list[PdfMetric] = []
```

Modificar `VehicleTypeUpdate` para aceptar el campo:

```python
class VehicleTypeUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
    pdf_metrics: list[PdfMetric] | None = None
```

- [ ] **Step 3: Schema `work_order.py` — extender create/update/out**

Editar `backend/app/schemas/work_order.py`. Añadir a `WorkOrderOut`, `WorkOrderCreate`, `WorkOrderUpdate`:

En `WorkOrderOut` (después de `notes`):
```python
    final_client_name: str | None = None
    final_client_address: str | None = None
    doc_number: str | None = None
```

En `WorkOrderCreate` (después de `notes`):
```python
    final_client_name: str | None = None
    final_client_address: str | None = None
```

En `WorkOrderUpdate` (después de `notes`):
```python
    final_client_name: str | None = None
    final_client_address: str | None = None
```

- [ ] **Step 4: Schema `work_report.py` — extender create/out**

Reemplazar el contenido de `backend/app/schemas/work_report.py` por:

```python
import uuid
from datetime import datetime
from pydantic import BaseModel, Field, model_validator


class MaterialItem(BaseModel):
    name: str
    quantity: float
    unit: str = ''


class WorkReportCreate(BaseModel):
    description: str | None = None
    work_duration_minutes: int | None = None
    materials_used: list[MaterialItem] = []
    signature_data: str | None = None  # base64 data URL del canvas (firma del cliente)
    client_signee_name: str | None = Field(default=None, max_length=200)
    client_signee_dni: str | None = Field(default=None, max_length=20)
    unsigned_reason: str | None = Field(default=None, max_length=200)

    @model_validator(mode='after')
    def _check_xor_signed_or_unsigned(self):
        signed = bool(
            (self.signature_data and self.signature_data.strip()) or
            (self.client_signee_name and self.client_signee_name.strip()) or
            (self.client_signee_dni and self.client_signee_dni.strip())
        )
        unsigned = bool(self.unsigned_reason and self.unsigned_reason.strip())
        if signed and unsigned:
            raise ValueError(
                "No se puede indicar firma y motivo de no firma a la vez. Elige uno."
            )
        # No exigimos uno u otro aquí — la regla "uno obligatorio" se valida solo
        # al transicionar la orden a 'done', no cuando se actualiza el report en
        # borrador. La validación final está en el endpoint de cambio de estado.
        return self


class WorkReportOut(BaseModel):
    id: uuid.UUID
    work_order_id: uuid.UUID
    tenant_id: uuid.UUID
    vehicle_id: uuid.UUID | None = None
    driver_id: uuid.UUID | None = None
    description: str | None = None
    work_duration_minutes: int | None = None
    photo_urls: list[str] = []
    signature_url: str | None = None
    client_signee_name: str | None = None
    client_signee_dni: str | None = None
    unsigned_reason: str | None = None
    materials_used: list[MaterialItem] = []
    created_at: datetime

    model_config = {'from_attributes': True}
```

- [ ] **Step 5: Verificar carga limpia de schemas**

Run: `python -c "from app.schemas import tenant, vehicle, work_order, work_report; print('ok')"`
Expected: `ok`

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/
git commit -m "feat(schemas): pdf parte multitenant — PdfMetric, datos cliente final, firma cliente"
```

---

# FASE 2 — BACKEND: Asignación atómica de `doc_number`

## Task 4: Helper `assign_doc_number` con tests

**Files:**
- Create: `backend/app/services/__init__.py` (si no existe)
- Create: `backend/app/services/doc_numbers.py`
- Create: `backend/tests/api/test_doc_numbers.py`

- [ ] **Step 1: Verificar / crear paquete services**

Run: `ls backend/app/services 2>&1`
Si no existe el directorio, crear archivo vacío:

```bash
mkdir -p backend/app/services && touch backend/app/services/__init__.py
```

- [ ] **Step 2: Escribir test de `assign_doc_number` (TDD)**

Crear `backend/tests/api/test_doc_numbers.py`:

```python
import uuid
import pytest
from sqlalchemy import text
from datetime import datetime, timezone


@pytest.mark.asyncio
async def test_assign_doc_number_first_for_tenant_year(db_session):
    """First call returns PT-YYYY-00001 and creates counter row."""
    from app.services.doc_numbers import assign_doc_number
    tenant_id = uuid.uuid4()
    # Crear tenant mínimo para FK
    await db_session.execute(text(
        "INSERT INTO tenant (id, tier, name, slug, active, enabled_modules, created_at) "
        "VALUES (:id, 'cmg', 'T', :slug, true, '{}', now())"
    ), {"id": tenant_id, "slug": f"t-{tenant_id.hex[:8]}"})
    await db_session.commit()

    doc = await assign_doc_number(db_session, tenant_id, datetime(2026, 5, 8, tzinfo=timezone.utc))
    assert doc == "PT-2026-00001"

    counter = (await db_session.execute(text(
        "SELECT last_seq FROM tenant_doc_counter WHERE tenant_id=:t AND year=2026"
    ), {"t": tenant_id})).scalar_one()
    assert counter == 1


@pytest.mark.asyncio
async def test_assign_doc_number_increments_per_tenant(db_session):
    """Second call increments to 00002 for same tenant+year."""
    from app.services.doc_numbers import assign_doc_number
    tenant_id = uuid.uuid4()
    await db_session.execute(text(
        "INSERT INTO tenant (id, tier, name, slug, active, enabled_modules, created_at) "
        "VALUES (:id, 'cmg', 'T', :slug, true, '{}', now())"
    ), {"id": tenant_id, "slug": f"t-{tenant_id.hex[:8]}"})
    await db_session.commit()

    d1 = await assign_doc_number(db_session, tenant_id, datetime(2026, 5, 8, tzinfo=timezone.utc))
    d2 = await assign_doc_number(db_session, tenant_id, datetime(2026, 5, 9, tzinfo=timezone.utc))
    assert d1 == "PT-2026-00001"
    assert d2 == "PT-2026-00002"


@pytest.mark.asyncio
async def test_assign_doc_number_separate_series_per_tenant(db_session):
    """Two tenants in same year have independent counters starting at 1."""
    from app.services.doc_numbers import assign_doc_number
    t1, t2 = uuid.uuid4(), uuid.uuid4()
    for tid in (t1, t2):
        await db_session.execute(text(
            "INSERT INTO tenant (id, tier, name, slug, active, enabled_modules, created_at) "
            "VALUES (:id, 'cmg', 'T', :slug, true, '{}', now())"
        ), {"id": tid, "slug": f"t-{tid.hex[:8]}"})
    await db_session.commit()
    d1 = await assign_doc_number(db_session, t1, datetime(2026, 5, 8, tzinfo=timezone.utc))
    d2 = await assign_doc_number(db_session, t2, datetime(2026, 5, 8, tzinfo=timezone.utc))
    assert d1 == "PT-2026-00001"
    assert d2 == "PT-2026-00001"


@pytest.mark.asyncio
async def test_assign_doc_number_resets_per_year(db_session):
    """Different year for same tenant starts at 1 again."""
    from app.services.doc_numbers import assign_doc_number
    tenant_id = uuid.uuid4()
    await db_session.execute(text(
        "INSERT INTO tenant (id, tier, name, slug, active, enabled_modules, created_at) "
        "VALUES (:id, 'cmg', 'T', :slug, true, '{}', now())"
    ), {"id": tenant_id, "slug": f"t-{tenant_id.hex[:8]}"})
    await db_session.commit()
    d1 = await assign_doc_number(db_session, tenant_id, datetime(2026, 5, 8, tzinfo=timezone.utc))
    d2 = await assign_doc_number(db_session, tenant_id, datetime(2027, 1, 1, tzinfo=timezone.utc))
    assert d1 == "PT-2026-00001"
    assert d2 == "PT-2027-00001"
```

> **Nota:** este test requiere fixture `db_session` que el conftest puede no exponer. Si el conftest actual no lo tiene, pasa al Step 3 igualmente; el test lo verá fallar primero por `ImportError` y después por fixture, y el implementador puede añadir el fixture si fuese necesario para el test integration. Si la suite no se puede ejecutar contra una BD real en el entorno, marca estos tests con `@pytest.mark.integration` y documenta cómo correrlos.

- [ ] **Step 3: Ejecutar el test esperando que falle por `ImportError`**

Run: `pytest backend/tests/api/test_doc_numbers.py -v 2>&1 | tail -20`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.doc_numbers'`

- [ ] **Step 4: Implementar `assign_doc_number`**

Crear `backend/app/services/doc_numbers.py`:

```python
import uuid
from datetime import datetime
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def assign_doc_number(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    completed_at: datetime,
) -> str:
    """
    Asigna de forma atómica el siguiente número de documento
    `PT-{año}-{NNNNN}` para el tenant + año dados.

    Usa UPSERT con RETURNING sobre `tenant_doc_counter` para evitar
    race conditions con cierres simultáneos.
    """
    year = completed_at.year
    result = await db.execute(
        text(
            """
            INSERT INTO tenant_doc_counter (tenant_id, year, last_seq)
            VALUES (:tenant_id, :year, 1)
            ON CONFLICT (tenant_id, year)
              DO UPDATE SET last_seq = tenant_doc_counter.last_seq + 1
            RETURNING last_seq
            """
        ),
        {"tenant_id": tenant_id, "year": year},
    )
    seq = result.scalar_one()
    return f"PT-{year}-{seq:05d}"
```

- [ ] **Step 5: Ejecutar tests y verificar que pasan**

Run: `pytest backend/tests/api/test_doc_numbers.py -v 2>&1 | tail -20`
Expected: 4 PASSED (o `SKIPPED` si los marcaste como integration y no hay BD).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/ backend/tests/api/test_doc_numbers.py
git commit -m "feat(services): assign_doc_number atómico por tenant+año (UPSERT RETURNING)"
```

---

## Task 5: Asignar `doc_number` al pasar orden a `done`

**Files:**
- Modify: `backend/app/api/v1/work_orders.py`

- [ ] **Step 1: Localizar el endpoint que cambia el estado**

Run: `grep -n "status" backend/app/api/v1/work_orders.py | head -20`
Identificar el endpoint `PATCH` que actualiza estado o un endpoint dedicado de transición. Si existe un endpoint dedicado (por ejemplo `/{order_id}/status`), aplicar el cambio allí; si no, el `PATCH /{order_id}` es donde toca.

- [ ] **Step 2: Añadir lógica de asignación cuando status cambia a `'done'`**

Editar `backend/app/api/v1/work_orders.py` — en el endpoint que aplica el cambio de estado, añadir la asignación. Patrón a aplicar (adaptar a la estructura concreta del archivo):

```python
from datetime import datetime, timezone
from app.services.doc_numbers import assign_doc_number

# ... dentro del endpoint que muta `order.status`:
if body.status == 'done' and order.status != 'done':
    if not order.doc_number:
        order.completed_at = order.completed_at or datetime.now(timezone.utc)
        order.doc_number = await assign_doc_number(
            db, order.tenant_id, order.completed_at,
        )
```

- [ ] **Step 3: Aceptar `final_client_name`/`final_client_address` en endpoints de creación y actualización**

Asegúrate de que los endpoints `POST /work-orders` y `PATCH /work-orders/{id}` propaguen los nuevos campos del body (`final_client_name`, `final_client_address`) al modelo. Patrón:

```python
# en create:
order = WorkOrder(
    ...
    final_client_name=body.final_client_name,
    final_client_address=body.final_client_address,
)

# en patch:
if body.final_client_name is not None:
    order.final_client_name = body.final_client_name
if body.final_client_address is not None:
    order.final_client_address = body.final_client_address
```

- [ ] **Step 4: Smoke test manual del endpoint**

Run (con servidor levantado o tras commit, opcional):
`pytest backend/tests/api/test_work_orders*.py -v 2>&1 | tail -20`
Expected: tests existentes siguen verdes.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/work_orders.py
git commit -m "feat(api): asigna doc_number al cerrar orden + datos cliente final en CRUD"
```

---

# FASE 3 — BACKEND: Validación de firma y endpoint /report

## Task 6: Endpoint `/report` con XOR firma/no-firma

**Files:**
- Modify: `backend/app/api/v1/work_reports.py`
- Create: `backend/tests/api/test_work_reports_signature.py`

- [ ] **Step 1: Test de XOR (TDD)**

Crear `backend/tests/api/test_work_reports_signature.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_report_accepts_signed_payload(client, auth_admin, sample_order):
    """Signed payload (signature_data + name + dni) is accepted."""
    r = await client.post(
        f"/api/v1/work-orders/{sample_order.id}/report",
        json={
            "description": "trabajo ok",
            "signature_data": "data:image/png;base64,iVBORw0KGgoAAAANS",
            "client_signee_name": "Juan Garcia",
            "client_signee_dni": "12345678A",
        },
        headers=auth_admin,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["client_signee_name"] == "Juan Garcia"
    assert body["client_signee_dni"] == "12345678A"
    assert body["signature_url"] is not None
    assert body["unsigned_reason"] is None


@pytest.mark.asyncio
async def test_report_accepts_unsigned_with_reason(client, auth_admin, sample_order):
    """Unsigned payload with reason is accepted."""
    r = await client.post(
        f"/api/v1/work-orders/{sample_order.id}/report",
        json={"description": "ok", "unsigned_reason": "Cliente ausente"},
        headers=auth_admin,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["unsigned_reason"] == "Cliente ausente"
    assert body["signature_url"] is None
    assert body["client_signee_name"] is None


@pytest.mark.asyncio
async def test_report_rejects_signed_and_unsigned_mixed(client, auth_admin, sample_order):
    """Mixing signature and unsigned_reason returns 422."""
    r = await client.post(
        f"/api/v1/work-orders/{sample_order.id}/report",
        json={
            "signature_data": "data:image/png;base64,abc",
            "client_signee_name": "X",
            "client_signee_dni": "Y",
            "unsigned_reason": "Otro",
        },
        headers=auth_admin,
    )
    assert r.status_code == 422
    assert "firma" in r.text.lower() or "motivo" in r.text.lower()


@pytest.mark.asyncio
async def test_close_order_requires_signed_or_unsigned(client, auth_admin, sample_order):
    """PATCH status='done' fails 422 if report has neither signature nor unsigned_reason."""
    # Crea report sin firma y sin motivo
    await client.post(
        f"/api/v1/work-orders/{sample_order.id}/report",
        json={"description": "draft"}, headers=auth_admin,
    )
    r = await client.patch(
        f"/api/v1/work-orders/{sample_order.id}",
        json={"status": "done"},
        headers=auth_admin,
    )
    assert r.status_code == 422
```

> Si el conftest no tiene fixtures `client`, `auth_admin`, `sample_order`, mira los tests existentes (`test_devices_api.py`, `test_vehicle_types_api.py`) y reutiliza/copia el patrón. Si esos fixtures no existen tampoco, marca estos tests `@pytest.mark.integration` y deja que se documenten para el dev.

- [ ] **Step 2: Verificar que los tests fallan**

Run: `pytest backend/tests/api/test_work_reports_signature.py -v 2>&1 | tail -20`
Expected: FAIL (mezcla XOR no rechazada / falta lógica de cierre).

- [ ] **Step 3: Actualizar `upsert_report` para guardar los nuevos campos**

Editar `backend/app/api/v1/work_reports.py`. En la función `upsert_report` (línea ~190), después de `report.materials_used = ...` y antes del `if body.signature_data`, añadir:

```python
    report.client_signee_name = (body.client_signee_name or '').strip() or None
    report.client_signee_dni = (body.client_signee_dni or '').strip() or None
    report.unsigned_reason = (body.unsigned_reason or '').strip() or None

    # Si la nueva versión declara unsigned, limpiar firma previa
    if report.unsigned_reason:
        report.signature_url = None
        report.client_signee_name = None
        report.client_signee_dni = None
```

- [ ] **Step 4: Validar al cerrar la orden a `done`**

Editar `backend/app/api/v1/work_orders.py`. Justo antes (o en lugar de) de la asignación de `doc_number` añadida en Task 5, validar que el report cumple la regla:

```python
from app.models.work_report import WorkReport
from sqlalchemy import select

if body.status == 'done' and order.status != 'done':
    rep = (await db.execute(
        select(WorkReport).where(WorkReport.work_order_id == order.id)
    )).scalar_one_or_none()
    is_signed = bool(rep and rep.signature_url and rep.client_signee_name and rep.client_signee_dni)
    is_unsigned = bool(rep and rep.unsigned_reason)
    if not (is_signed or is_unsigned):
        raise HTTPException(
            status_code=422,
            detail="No se puede cerrar la orden: el parte debe estar firmado por el cliente o tener motivo de no firma.",
        )
    # ... a continuación, el bloque de doc_number de Task 5
```

- [ ] **Step 5: Ejecutar tests y verificar PASS**

Run: `pytest backend/tests/api/test_work_reports_signature.py -v 2>&1 | tail -20`
Expected: 4 PASSED (o SKIPPED si están marcados integration).

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/ backend/tests/api/test_work_reports_signature.py
git commit -m "feat(api): work_report XOR firma/no-firma + bloqueo cierre sin firma ni motivo"
```

---

# FASE 4 — BACKEND: Configuración de pdf_metrics

## Task 7: Aceptar `pdf_metrics` en PATCH vehicle_types

**Files:**
- Modify: `backend/app/api/v1/vehicles.py`
- Create: `backend/tests/api/test_vehicle_types_pdf_metrics.py`

- [ ] **Step 1: Test de pdf_metrics (TDD)**

Crear `backend/tests/api/test_vehicle_types_pdf_metrics.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_patch_vehicle_type_sets_pdf_metrics(client, auth_cmg_admin, sample_vehicle_type):
    payload = {"pdf_metrics": [
        {"key": "pto_minutes", "label": "Tiempo PTO", "unit": "min", "format": "integer"},
        {"key": "pressure_max", "label": "Presión máx.", "unit": "bar", "format": "decimal1"},
    ]}
    r = await client.patch(
        f"/api/v1/vehicle-types/{sample_vehicle_type.id}",
        json=payload, headers=auth_cmg_admin,
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body["pdf_metrics"]) == 2
    assert body["pdf_metrics"][0]["key"] == "pto_minutes"


@pytest.mark.asyncio
async def test_patch_vehicle_type_rejects_unknown_key(client, auth_cmg_admin, sample_vehicle_type):
    payload = {"pdf_metrics": [
        {"key": "made_up_metric", "label": "X", "unit": "u", "format": "integer"},
    ]}
    r = await client.patch(
        f"/api/v1/vehicle-types/{sample_vehicle_type.id}",
        json=payload, headers=auth_cmg_admin,
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_patch_vehicle_type_rejects_duplicate_keys(client, auth_cmg_admin, sample_vehicle_type):
    payload = {"pdf_metrics": [
        {"key": "pto_minutes", "label": "A", "unit": "min", "format": "integer"},
        {"key": "pto_minutes", "label": "B", "unit": "min", "format": "integer"},
    ]}
    r = await client.patch(
        f"/api/v1/vehicle-types/{sample_vehicle_type.id}",
        json=payload, headers=auth_cmg_admin,
    )
    assert r.status_code == 422
    assert "duplica" in r.text.lower() or "unique" in r.text.lower() or "duplicate" in r.text.lower()
```

- [ ] **Step 2: Verificar fallo**

Run: `pytest backend/tests/api/test_vehicle_types_pdf_metrics.py -v 2>&1 | tail -20`
Expected: FAIL (campo no aceptado o no validado).

- [ ] **Step 3: Implementar persistencia + validación de duplicados**

Editar `backend/app/api/v1/vehicles.py` — en `update_vehicle_type` (línea ~218), después del manejo de `body.slug`:

```python
    if body.pdf_metrics is not None:
        keys = [m.key for m in body.pdf_metrics]
        if len(keys) != len(set(keys)):
            raise HTTPException(status_code=422, detail="No se puede duplicar una métrica en pdf_metrics")
        vtype.pdf_metrics = [m.model_dump() for m in body.pdf_metrics]
```

- [ ] **Step 4: Verificar PASS**

Run: `pytest backend/tests/api/test_vehicle_types_pdf_metrics.py -v 2>&1 | tail -20`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/vehicles.py backend/tests/api/test_vehicle_types_pdf_metrics.py
git commit -m "feat(api): vehicle_type acepta pdf_metrics con validación de keys+duplicados"
```

---

## Task 8: Aceptar `business_cif`/`business_address` en tenants

**Files:**
- Modify: `backend/app/api/v1/tenants.py`

- [ ] **Step 1: Localizar el endpoint update**

Run: `grep -n "TenantUpdate\|business" backend/app/api/v1/tenants.py | head -10`

- [ ] **Step 2: Aplicar los nuevos campos**

En el handler que recibe `TenantUpdate`, añadir tras la actualización de los campos existentes:

```python
    if body.business_cif is not None:
        tenant.business_cif = body.business_cif.strip() or None
    if body.business_address is not None:
        tenant.business_address = body.business_address.strip() or None
```

- [ ] **Step 3: Verificar que el endpoint no rompe el flujo existente**

Run: `pytest backend/tests/api/ -k "tenant" -v 2>&1 | tail -10` (si hay tests; si no, smoke import)
Expected: sin regresiones.

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/v1/tenants.py
git commit -m "feat(api): tenant update acepta business_cif y business_address"
```

---

# FASE 5 — BACKEND: Template PDF y endpoint de generación

## Task 9: Helper `format_metric` y nuevo template

**Files:**
- Modify: `backend/app/api/v1/work_reports.py`

- [ ] **Step 1: Reemplazar `_PDF_TEMPLATE` por la nueva versión completa**

Editar `backend/app/api/v1/work_reports.py`. Reemplazar las líneas 31–123 (de `_PDF_TEMPLATE = """` hasta `"""`) por:

```python
_PDF_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 18mm 16mm;
    @bottom-left  { content: "{{ brand_name }} · {{ doc_number or '' }}"; font-size: 8px; color: #aaa; }
    @bottom-right { content: "Página " counter(page) " de " counter(pages); font-size: 8px; color: #aaa; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #222; }
  .header { display: flex; justify-content: space-between; align-items: flex-start;
            border-bottom: 2px solid {{ primary_color }}; padding-bottom: 12px; margin-bottom: 18px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-logo { max-height: 44px; max-width: 160px; }
  .brand-name { font-size: 16px; font-weight: 700; color: {{ primary_color }}; }
  .brand-sub { font-size: 10px; color: #888; margin-top: 2px; }
  .doc-info { text-align: right; font-size: 10px; color: #555; }
  .doc-info .num { font-size: 14px; color: #222; font-weight: 700; display: block; }
  h2 { font-size: 11px; font-weight: 700; color: #1a1a1a; text-transform: uppercase;
       letter-spacing: 0.04em; border-left: 3px solid {{ primary_color }}; padding-left: 8px;
       margin: 14px 0 8px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; background: #fafafa;
             border: 1px solid #ececec; border-radius: 4px; padding: 10px 12px; }
  .party-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em;
                 color: {{ primary_color }}; font-weight: 700; margin-bottom: 4px; }
  .party-line { font-size: 11px; line-height: 1.4; }
  .service-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px 16px;
                  font-size: 10px; margin-bottom: 6px; }
  .field-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; }
  .field-value { font-size: 11px; color: #222; font-weight: 500; margin-top: 1px; }
  .description-box { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 4px;
                     padding: 8px 10px; font-size: 10.5px; line-height: 1.5; white-space: pre-wrap; }
  table.stops { width: 100%; border-collapse: collapse; font-size: 10px; }
  table.stops thead { display: table-header-group; }
  table.stops th { background: #f3f3f3; color: #555; padding: 6px 8px; text-align: left;
                   font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em;
                   border-bottom: 1px solid #ddd; }
  table.stops td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  table.stops td.num { font-weight: 700; color: {{ primary_color }}; width: 28px; }
  table.stops td.metric { font-family: 'JetBrains Mono', monospace; text-align: right; white-space: nowrap; }
  table.stops .stop-client { font-size: 9px; color: #888; margin-top: 2px; }
  .photos-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 6px; }
  .photo-img { width: 100%; height: 110px; object-fit: cover; border-radius: 3px; border: 1px solid #ddd; }
  .signature-section { margin-top: 22px; page-break-inside: avoid; }
  .signature-box { border: 1px solid #ccc; border-radius: 4px; padding: 10px 14px;
                   display: inline-block; min-width: 280px; }
  .signature-img { max-height: 90px; max-width: 280px; display: block; margin-bottom: 4px; }
  .signature-meta { font-size: 10px; color: #444; line-height: 1.4; padding-top: 4px; border-top: 1px solid #eee; }
  .signature-meta b { font-size: 11px; color: #222; }
  .unsigned-note { font-size: 11px; color: #777; font-style: italic; padding: 8px 0; }
  .unsigned-note b { color: #555; font-style: normal; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">
      {% if logo_url %}<img class="brand-logo" src="{{ logo_url }}"/>{% endif %}
      <div>
        <div class="brand-name">{{ brand_name }}</div>
        <div class="brand-sub">Parte de servicio</div>
      </div>
    </div>
    <div class="doc-info">
      {% if doc_number %}<span class="num">{{ doc_number }}</span>{% endif %}
      {{ completed_date or '—' }}
      {% if completed_time %}<br>{{ completed_time }}{% endif %}
    </div>
  </div>

  <div class="parties">
    <div>
      <div class="party-label">Emite</div>
      <div class="party-line"><b>{{ brand_name }}</b></div>
      {% if business_cif %}<div class="party-line">CIF: {{ business_cif }}</div>{% endif %}
      {% if business_address %}<div class="party-line">{{ business_address }}</div>{% endif %}
    </div>
    <div>
      <div class="party-label">Cliente</div>
      <div class="party-line"><b>{{ final_client_name or '—' }}</b></div>
      {% if final_client_address %}<div class="party-line">{{ final_client_address }}</div>{% endif %}
    </div>
  </div>

  <h2>Servicio realizado</h2>
  <div class="service-grid">
    <div><div class="field-label">Vehículo</div><div class="field-value">{{ vehicle_label or '—' }}</div></div>
    <div><div class="field-label">Conductor</div><div class="field-value">{{ driver_name or '—' }}</div></div>
    <div><div class="field-label">Duración</div><div class="field-value">{{ duration_label or '—' }}</div></div>
  </div>
  {% if order_title %}<div class="field-value" style="margin: 6px 0 4px;"><b>{{ order_title }}</b></div>{% endif %}
  {% if description %}<div class="description-box">{{ description }}</div>{% endif %}

  {% if stops %}
  <h2>Paradas y mediciones</h2>
  <table class="stops">
    <thead>
      <tr>
        <th>#</th><th>Ubicación</th>
        {% for m in pdf_metrics %}<th style="text-align:right">{{ m.label }}</th>{% endfor %}
      </tr>
    </thead>
    <tbody>
      {% for s in stops %}
      <tr>
        <td class="num">{{ loop.index }}</td>
        <td>
          <div>{{ s.address or '—' }}</div>
          {% if s.client_name %}<div class="stop-client">{{ s.client_name }}</div>{% endif %}
        </td>
        {% for m in pdf_metrics %}<td class="metric">{{ format_metric(s.get(m.key), m.format, m.unit) }}</td>{% endfor %}
      </tr>
      {% endfor %}
    </tbody>
  </table>
  {% endif %}

  {% if materials_used %}
  <h2>Materiales utilizados</h2>
  <table class="stops">
    <thead><tr><th>Material</th><th style="text-align:right">Cantidad</th><th>Unidad</th></tr></thead>
    <tbody>
      {% for m in materials_used %}
      <tr><td>{{ m.name }}</td><td class="metric">{{ m.quantity }}</td><td>{{ m.unit or '—' }}</td></tr>
      {% endfor %}
    </tbody>
  </table>
  {% endif %}

  {% if photo_urls %}
  <h2>Fotografías</h2>
  <div class="photos-grid">
    {% for url in photo_urls %}<img class="photo-img" src="{{ url }}"/>{% endfor %}
  </div>
  {% endif %}

  <div class="signature-section">
    <h2>Conformidad del cliente</h2>
    {% if signature_url %}
      <div class="signature-box">
        <img class="signature-img" src="{{ signature_url }}"/>
        <div class="signature-meta">
          <b>{{ signee_name }}</b><br>
          DNI: {{ signee_dni }}
        </div>
      </div>
    {% else %}
      <div class="unsigned-note">
        Parte cerrado sin firma del cliente. <b>Motivo:</b> {{ unsigned_reason or '—' }}
      </div>
    {% endif %}
  </div>
</body>
</html>
"""
```

- [ ] **Step 2: Añadir helper `format_metric`**

En el mismo archivo, justo después del bloque `_template = Template(_PDF_TEMPLATE)`, añadir:

```python
def format_metric(value, fmt: str, unit: str) -> str:
    """Formatea un valor numérico para la tabla de paradas del PDF."""
    if value is None:
        return "—"
    if fmt == "integer":
        return f"{int(value)} {unit}"
    if fmt == "decimal1":
        return f"{value:.1f} {unit}"
    if fmt == "decimal2":
        return f"{value:.2f} {unit}"
    return f"{value} {unit}"
```

Y registrarlo en el entorno Jinja del template. Reemplazar:

```python
_template = Template(_PDF_TEMPLATE)
```

por:

```python
from jinja2 import Environment, BaseLoader

_jinja_env = Environment(loader=BaseLoader())
_jinja_env.globals['format_metric'] = format_metric
_template = _jinja_env.from_string(_PDF_TEMPLATE)
```

(Mantener `format_metric` definido **antes** de `_jinja_env`).

- [ ] **Step 3: Verificar que el módulo importa**

Run: `python -c "from app.api.v1 import work_reports; print('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/v1/work_reports.py
git commit -m "feat(pdf): nuevo template multi-tenant + helper format_metric registrado en Jinja"
```

---

## Task 10: Endpoint `download_pdf` carga datos completos

**Files:**
- Modify: `backend/app/api/v1/work_reports.py`

- [ ] **Step 1: Reescribir `download_pdf` para cargar tenant, vehicle_type, stops**

Sustituir la función `download_pdf` (línea ~258 hasta el `return Response(...)` final) por:

```python
@router.get("/{order_id}/report/pdf")
async def download_pdf(
    order_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.work_order_stop import WorkOrderStop
    from app.models.vehicle_type import VehicleType

    order = await _get_order_authorized(order_id, user, db)
    rep_q = await db.execute(select(WorkReport).where(WorkReport.work_order_id == order_id))
    report = rep_q.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Sin informe para generar PDF")

    # Tenant emisor
    tr = await db.execute(select(Tenant).where(Tenant.id == order.tenant_id))
    tenant = tr.scalar_one_or_none()
    brand_name = (tenant.brand_name or tenant.name) if tenant else "CMG Track"
    business_cif = tenant.business_cif if tenant else None
    business_address = tenant.business_address if tenant else None
    primary_color = (
        (tenant.brand_tokens or {}).get("primary_color") if tenant else None
    ) or "#F97316"
    logo_url = tenant.logo_url if tenant else None

    # Vehicle + tipo y métricas
    vehicle = None
    vtype = None
    if order.vehicle_id:
        v = await db.execute(select(Vehicle).where(Vehicle.id == order.vehicle_id))
        vehicle = v.scalar_one_or_none()
        if vehicle and vehicle.vehicle_type_id:
            tq = await db.execute(select(VehicleType).where(VehicleType.id == vehicle.vehicle_type_id))
            vtype = tq.scalar_one_or_none()
    pdf_metrics = (vtype.pdf_metrics if vtype else None) or []
    vehicle_label = (
        f"{vehicle.name} · {vehicle.license_plate}" if vehicle and vehicle.license_plate
        else (vehicle.name if vehicle else None)
    )

    # Conductor
    driver_name = None
    if order.driver_id:
        dq = await db.execute(select(Driver).where(Driver.id == order.driver_id))
        d = dq.scalar_one_or_none()
        driver_name = d.full_name if d else None

    # Paradas
    stops_q = await db.execute(
        select(WorkOrderStop).where(WorkOrderStop.work_order_id == order_id)
        .order_by(WorkOrderStop.order_index)
    )
    stops = [
        {
            "address": s.address,
            "client_name": s.client_name,
            "pto_minutes": s.pto_minutes,
            "pressure_min": s.pressure_min,
            "pressure_max": s.pressure_max,
            "rpm_avg": s.rpm_avg,
            "pump_minutes": s.pump_minutes,
            "fuel_l": s.fuel_l,
            # helper get() del template — aseguramos compatibilidad
            "get": (lambda _self: _self.get if hasattr(_self, 'get') else None)(None),
        }
        for s in stops_q.scalars().all()
    ]

    # Duración
    duration_label = (
        f"{report.work_duration_minutes // 60}h {report.work_duration_minutes % 60}min"
        if report.work_duration_minutes else None
    )

    # Fechas
    completed_date = order.completed_at.strftime("%d/%m/%Y") if order.completed_at else None
    completed_time = order.completed_at.strftime("%H:%M") if order.completed_at else None

    # Materiales
    from app.schemas.work_report import MaterialItem
    materials = [MaterialItem(**m) for m in (report.materials_used or [])]

    # Convertir URLs locales a file:// para WeasyPrint
    def _to_file_url(url_path: str | None) -> str | None:
        if not url_path:
            return None
        if url_path.startswith(("http://", "https://", "file://")):
            return url_path
        return f"file:///app{url_path}"

    photo_file_urls = [_to_file_url(u) for u in (report.photo_urls or []) if u]
    sig_file_url = _to_file_url(report.signature_url)
    logo_file_url = _to_file_url(logo_url)

    html_str = _template.render(
        brand_name=brand_name,
        business_cif=business_cif,
        business_address=business_address,
        primary_color=primary_color,
        logo_url=logo_file_url,
        doc_number=order.doc_number,
        order_title=order.title,
        completed_date=completed_date,
        completed_time=completed_time,
        vehicle_label=vehicle_label,
        driver_name=driver_name,
        duration_label=duration_label,
        description=report.description,
        materials_used=materials,
        photo_urls=photo_file_urls,
        signature_url=sig_file_url,
        signee_name=report.client_signee_name,
        signee_dni=report.client_signee_dni,
        unsigned_reason=report.unsigned_reason,
        final_client_name=order.final_client_name,
        final_client_address=order.final_client_address,
        pdf_metrics=pdf_metrics,
        stops=stops,
    )

    pdf_bytes = HTML(string=html_str).write_pdf()
    fname = order.doc_number or f"informe_{order.title[:40].replace(' ', '_')}"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}.pdf"'},
    )
```

> Nota sobre el dict de stops: para que `s.get(m.key)` funcione en Jinja necesitamos exponer los stops como dicts (no objetos SQLAlchemy). Lo hacemos arriba creando el dict explícitamente. Quita la línea inútil `"get": ...` — se puede prescindir, ya que un dict tiene `.get()` nativo. Reemplaza esa lambda por simplemente borrar la línea (estaba para tranquilizar al lector).

Limpieza: borra del bloque la línea con `"get": (lambda...)`. Queda:

```python
    stops = [
        {
            "address": s.address,
            "client_name": s.client_name,
            "pto_minutes": s.pto_minutes,
            "pressure_min": s.pressure_min,
            "pressure_max": s.pressure_max,
            "rpm_avg": s.rpm_avg,
            "pump_minutes": s.pump_minutes,
            "fuel_l": s.fuel_l,
        }
        for s in stops_q.scalars().all()
    ]
```

- [ ] **Step 2: Verificar import limpio del módulo**

Run: `python -c "from app.api.v1.work_reports import download_pdf, _template, format_metric; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/v1/work_reports.py
git commit -m "feat(pdf): endpoint download_pdf carga branding tenant + paradas + pdf_metrics dinámicas"
```

---

## Task 11: Tests del PDF (smoke + branding)

**Files:**
- Create: `backend/tests/api/test_work_reports_pdf.py`

- [ ] **Step 1: Test de generación**

Crear `backend/tests/api/test_work_reports_pdf.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_pdf_download_returns_pdf_bytes(client, auth_admin, sample_done_order_with_signed_report):
    r = await client.get(
        f"/api/v1/work-orders/{sample_done_order_with_signed_report.id}/report/pdf",
        headers=auth_admin,
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:4] == b"%PDF"
    # debe incluir el doc_number en el filename
    assert "PT-" in r.headers.get("content-disposition", "")


@pytest.mark.asyncio
async def test_pdf_uses_tenant_brand_name_and_color(client, auth_admin, sample_done_order_with_branded_tenant):
    """Smoke: el HTML pre-render contiene el brand_name y el color primary del tenant."""
    from app.api.v1.work_reports import _template
    # Renderizamos el template directamente con datos mínimos
    html = _template.render(
        brand_name="Aguas de Valencia",
        primary_color="#0EA5E9",
        doc_number="PT-2026-00001",
        completed_date="08/05/2026",
        order_title="Limpieza fosa",
        pdf_metrics=[],
        stops=[],
        materials_used=[],
        photo_urls=[],
        signature_url=None,
        unsigned_reason="Cliente ausente",
        final_client_name="Comunidad El Pinar",
    )
    assert "Aguas de Valencia" in html
    assert "#0EA5E9" in html
    assert "PT-2026-00001" in html
    assert "Cliente ausente" in html


def test_format_metric_handles_all_formats():
    from app.api.v1.work_reports import format_metric
    assert format_metric(None, "integer", "min") == "—"
    assert format_metric(22.7, "integer", "min") == "22 min"
    assert format_metric(8.456, "decimal1", "bar") == "8.5 bar"
    assert format_metric(8.456, "decimal2", "bar") == "8.46 bar"
    assert format_metric(1850, "integer", "rpm") == "1850 rpm"
```

- [ ] **Step 2: Ejecutar tests**

Run: `pytest backend/tests/api/test_work_reports_pdf.py -v 2>&1 | tail -20`
Expected: 3 PASSED (los con fixtures pueden quedar SKIPPED).

- [ ] **Step 3: Commit**

```bash
git add backend/tests/api/test_work_reports_pdf.py
git commit -m "test(pdf): smoke + format_metric + branding tenant en template"
```

---

# FASE 6 — BACKEND: Endpoint telemetry-detail

## Task 12: GET `/work-orders/{id}/telemetry-detail`

**Files:**
- Modify: `backend/app/api/v1/work_orders.py` (o `work_reports.py` — pon donde encaje con el resto)

- [ ] **Step 1: Añadir endpoint**

Localiza el router de work_orders. Añadir:

```python
from app.models.work_order_stop import WorkOrderStop
from app.models.vehicle_type import VehicleType
from app.models.vehicle import Vehicle

@router.get("/{order_id}/telemetry-detail")
async def get_telemetry_detail(
    order_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    order = (await db.execute(select(WorkOrder).where(WorkOrder.id == order_id))).scalar_one_or_none()
    if not order:
        raise HTTPException(404)
    if user.tenant_tier != "cmg" and str(order.tenant_id) != str(user.tenant_id):
        raise HTTPException(403)

    pdf_keys: list[str] = []
    if order.vehicle_id:
        v = (await db.execute(select(Vehicle).where(Vehicle.id == order.vehicle_id))).scalar_one_or_none()
        if v and v.vehicle_type_id:
            vt = (await db.execute(select(VehicleType).where(VehicleType.id == v.vehicle_type_id))).scalar_one_or_none()
            if vt:
                pdf_keys = [m.get("key") for m in (vt.pdf_metrics or [])]

    stops = (await db.execute(
        select(WorkOrderStop).where(WorkOrderStop.work_order_id == order_id)
        .order_by(WorkOrderStop.order_index)
    )).scalars().all()

    return {
        "stops": [
            {
                "id": str(s.id),
                "order_index": s.order_index,
                "address": s.address,
                "client_name": s.client_name,
                "arrived_at": s.arrived_at.isoformat() if s.arrived_at else None,
                "completed_at": s.completed_at.isoformat() if s.completed_at else None,
                "telemetry": {
                    "pto_minutes": s.pto_minutes,
                    "pressure_min": s.pressure_min,
                    "pressure_max": s.pressure_max,
                    "rpm_avg": s.rpm_avg,
                    "pump_minutes": s.pump_minutes,
                    "fuel_l": s.fuel_l,
                },
            }
            for s in stops
        ],
        "pdf_metric_keys": pdf_keys,
    }
```

- [ ] **Step 2: Verificar import**

Run: `python -c "from app.api.v1 import work_orders; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/v1/work_orders.py
git commit -m "feat(api): GET /work-orders/{id}/telemetry-detail con marca de keys en pdf_metrics"
```

---

# FASE 7 — FRONTEND WEB: Datos legales + branding tenant

## Task 13: Inputs business_cif/address + primary_color en TenantFormPage

**Files:**
- Modify: `frontend/src/features/clientes/TenantFormPage.tsx`

- [ ] **Step 1: Leer el archivo y localizar la sección de campos editables**

Run: `grep -n "brand_name\|business\|brand_tokens\|onSubmit" frontend/src/features/clientes/TenantFormPage.tsx | head -20`

- [ ] **Step 2: Añadir state y campos `business_cif` / `business_address`**

En el `useState` o equivalente del formulario, añadir:

```tsx
const [businessCif, setBusinessCif] = useState(initial?.business_cif ?? '')
const [businessAddress, setBusinessAddress] = useState(initial?.business_address ?? '')
```

En el JSX, añadir una sección "Datos legales" antes del bloque de submit:

```tsx
<section className="form-section">
  <h3>Datos legales (aparecerán en el PDF de partes)</h3>
  <label className="field">
    <span>CIF / NIF</span>
    <input value={businessCif} onChange={e => setBusinessCif(e.target.value)} maxLength={20}
           placeholder="A-46123456" />
  </label>
  <label className="field">
    <span>Dirección fiscal</span>
    <input value={businessAddress} onChange={e => setBusinessAddress(e.target.value)} maxLength={300}
           placeholder="Av. del Puerto 102, 46023 Valencia" />
  </label>
</section>
```

(Adapta las clases al estilo del archivo: si usa Tailwind, sustituye `className`.)

- [ ] **Step 3: Añadir selector de `primary_color` que persiste en `brand_tokens`**

Si ya hay un editor de `brand_tokens` (BrandTokensEditor.tsx existe en la misma carpeta — comprobar y usar), inyectar `primary_color` allí. Si no, añadir aquí:

```tsx
const [primaryColor, setPrimaryColor] = useState<string>(
  (initial?.brand_tokens as any)?.primary_color ?? '#F97316'
)
```

JSX:

```tsx
<section className="form-section">
  <h3>Branding</h3>
  <label className="field">
    <span>Color primario (PDFs y portal)</span>
    <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} />
    <input type="text" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
           pattern="^#([0-9A-Fa-f]{6})$" style={{ marginLeft: 8, width: 90 }} />
  </label>
</section>
```

- [ ] **Step 4: Incluir los nuevos campos en el payload del submit**

Localizar el handler que llama `PATCH /tenants/{id}`. Añadir al body:

```tsx
business_cif: businessCif.trim() || null,
business_address: businessAddress.trim() || null,
brand_tokens: {
  ...(initial?.brand_tokens ?? {}),
  primary_color: primaryColor,
},
```

(Si la API expone `brand_tokens` por endpoint separado en este proyecto — verificar — usa el endpoint correcto en lugar de incluirlo en el patch principal.)

- [ ] **Step 5: Verificar build**

Run: `npm run build 2>&1 | tail -5`
Expected: build OK, sin errores TS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/clientes/TenantFormPage.tsx
git commit -m "feat(web): TenantFormPage — datos legales + primary_color para PDF"
```

---

# FASE 8 — FRONTEND WEB: Configuración pdf_metrics

## Task 14: Componente PdfMetricsSection

**Files:**
- Create: `frontend/src/features/vehicles/PdfMetricsSection.tsx`
- Modify: `frontend/src/features/vehicles/VehicleTypesPage.tsx`

- [ ] **Step 1: Crear PdfMetricsSection con catálogo, edición y reorden por flechas**

Crear `frontend/src/features/vehicles/PdfMetricsSection.tsx`:

```tsx
import { useState } from 'react'

export type PdfMetric = {
  key: 'pto_minutes'|'pressure_min'|'pressure_max'|'rpm_avg'|'pump_minutes'|'fuel_l'
  label: string
  unit: string
  format: 'integer'|'decimal1'|'decimal2'
}

const CATALOG: PdfMetric[] = [
  { key: 'pto_minutes',   label: 'Tiempo PTO',   unit: 'min', format: 'integer'  },
  { key: 'pressure_min',  label: 'Presión mín.', unit: 'bar', format: 'decimal1' },
  { key: 'pressure_max',  label: 'Presión máx.', unit: 'bar', format: 'decimal1' },
  { key: 'rpm_avg',       label: 'RPM medio',    unit: 'rpm', format: 'integer'  },
  { key: 'pump_minutes',  label: 'Tiempo bomba', unit: 'min', format: 'integer'  },
  { key: 'fuel_l',        label: 'Combustible',  unit: 'L',   format: 'decimal1' },
]

const FORMAT_LABELS: Record<PdfMetric['format'], string> = {
  integer:  'Entero',
  decimal1: '1 decimal',
  decimal2: '2 decimales',
}

type Props = {
  value: PdfMetric[]
  onChange: (next: PdfMetric[]) => void
  saving?: boolean
}

export default function PdfMetricsSection({ value, onChange, saving }: Props) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  const usedKeys = new Set(value.map(m => m.key))
  const available = CATALOG.filter(c => !usedKeys.has(c.key))

  const move = (idx: number, delta: number) => {
    const j = idx + delta
    if (j < 0 || j >= value.length) return
    const next = [...value]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    onChange(next)
  }
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx))
  const update = (idx: number, patch: Partial<PdfMetric>) => {
    const next = [...value]
    next[idx] = { ...next[idx], ...patch }
    onChange(next)
  }
  const add = (m: PdfMetric) => {
    onChange([...value, m])
    setAdding(false)
  }

  return (
    <section className="pdf-metrics-section">
      <h3>Métricas en el PDF de partes</h3>
      <p className="hint">
        Selecciona y ordena las métricas que aparecerán en cada parada del PDF de informe.
      </p>

      <ul className="metric-list">
        {value.length === 0 && (
          <li className="empty">Sin métricas configuradas — el PDF mostrará solo la lista de paradas.</li>
        )}
        {value.map((m, idx) => (
          <li key={m.key} className="metric-row">
            <span className="metric-label">{m.label}</span>
            <span className="metric-key">{m.key}</span>
            <span className="metric-unit">{m.unit}</span>
            <span className="metric-format">{FORMAT_LABELS[m.format]}</span>
            <button onClick={() => move(idx, -1)} disabled={idx === 0 || saving} title="Subir">↑</button>
            <button onClick={() => move(idx, +1)} disabled={idx === value.length - 1 || saving} title="Bajar">↓</button>
            <button onClick={() => setEditingIdx(idx)} disabled={saving} title="Editar etiqueta/unidad">✎</button>
            <button onClick={() => remove(idx)} disabled={saving} title="Quitar">✕</button>
          </li>
        ))}
      </ul>

      {available.length > 0 && (
        <button onClick={() => setAdding(true)} disabled={saving}>+ Añadir métrica</button>
      )}

      {adding && (
        <div className="add-picker">
          <p>Elige una métrica del catálogo:</p>
          {available.map(m => (
            <button key={m.key} onClick={() => add(m)}>
              {m.label} <small>({m.key})</small>
            </button>
          ))}
          <button onClick={() => setAdding(false)} className="cancel">Cancelar</button>
        </div>
      )}

      {editingIdx !== null && (
        <EditMetricModal
          metric={value[editingIdx]}
          onSave={patch => { update(editingIdx, patch); setEditingIdx(null) }}
          onCancel={() => setEditingIdx(null)}
        />
      )}

      <PreviewTable metrics={value} />
    </section>
  )
}

function EditMetricModal({ metric, onSave, onCancel }: {
  metric: PdfMetric
  onSave: (patch: Partial<PdfMetric>) => void
  onCancel: () => void
}) {
  const [label, setLabel]   = useState(metric.label)
  const [unit, setUnit]     = useState(metric.unit)
  const [format, setFormat] = useState(metric.format)
  return (
    <div className="modal">
      <div className="modal-content">
        <h4>Editar métrica · {metric.key}</h4>
        <label>Etiqueta a mostrar
          <input value={label} maxLength={60} onChange={e => setLabel(e.target.value)} />
        </label>
        <label>Unidad
          <input value={unit} maxLength={10} onChange={e => setUnit(e.target.value)} />
        </label>
        <label>Formato
          <select value={format} onChange={e => setFormat(e.target.value as PdfMetric['format'])}>
            <option value="integer">Entero</option>
            <option value="decimal1">1 decimal</option>
            <option value="decimal2">2 decimales</option>
          </select>
        </label>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancelar</button>
          <button onClick={() => onSave({ label: label.trim() || metric.label, unit: unit.trim() || metric.unit, format })}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

const SAMPLE_VALUES: Record<PdfMetric['key'], number> = {
  pto_minutes: 22, pressure_min: 7.8, pressure_max: 8.4,
  rpm_avg: 1850, pump_minutes: 18, fuel_l: 4.2,
}
function formatSample(v: number, fmt: PdfMetric['format'], unit: string): string {
  if (fmt === 'integer')  return `${Math.trunc(v)} ${unit}`
  if (fmt === 'decimal1') return `${v.toFixed(1)} ${unit}`
  if (fmt === 'decimal2') return `${v.toFixed(2)} ${unit}`
  return `${v} ${unit}`
}

function PreviewTable({ metrics }: { metrics: PdfMetric[] }) {
  if (metrics.length === 0) return null
  return (
    <div className="preview">
      <h4>Vista previa</h4>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Ubicación</th>
            {metrics.map(m => <th key={m.key}>{m.label}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1</td><td>C/ Mayor 12, Valencia</td>
            {metrics.map(m => (
              <td key={m.key}>{formatSample(SAMPLE_VALUES[m.key], m.format, m.unit)}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Integrar PdfMetricsSection en VehicleTypesPage**

Run: `grep -n "HistoricMetricsSection\|AlertRulesSection" frontend/src/features/vehicles/VehicleTypesPage.tsx | head -10`

Justo donde se muestran las otras secciones similares, importar y montar:

```tsx
import PdfMetricsSection, { PdfMetric } from './PdfMetricsSection'

// dentro del render del tipo seleccionado:
<PdfMetricsSection
  value={(vehicleType.pdf_metrics ?? []) as PdfMetric[]}
  onChange={metrics => savePdfMetrics(vehicleType.id, metrics)}
  saving={pdfSaving}
/>
```

Y añadir el handler `savePdfMetrics` que hace `PATCH /api/v1/vehicle-types/{id}` con `{ pdf_metrics }`. Sigue el patrón de las otras secciones (probable uso de TanStack Query — copia el patrón de `HistoricMetricsSection`).

- [ ] **Step 3: Verificar build**

Run: `npm run build 2>&1 | tail -5`
Expected: build OK.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/vehicles/PdfMetricsSection.tsx frontend/src/features/vehicles/VehicleTypesPage.tsx
git commit -m "feat(web): PdfMetricsSection — configurar métricas del PDF por tipo de vehículo"
```

---

# FASE 9 — FRONTEND WEB: Work Order

## Task 15: Inputs cliente final + columna doc_number + Descargar PDF

**Files:**
- Modify: `frontend/src/features/work-orders/WorkOrdersPage.tsx`
- Modify: `frontend/src/features/work-orders/WorkReportModal.tsx`

- [ ] **Step 1: Añadir inputs `final_client_name` y `final_client_address` al formulario de orden**

En `WorkOrdersPage.tsx`, localizar el formulario de creación/edición de orden. Añadir tras los campos existentes (descripción, ubicación):

```tsx
<fieldset>
  <legend>Datos del cliente final (opcional)</legend>
  <label>
    Nombre / Razón social
    <input value={finalClientName} onChange={e => setFinalClientName(e.target.value)} maxLength={200} />
  </label>
  <label>
    Dirección
    <input value={finalClientAddress} onChange={e => setFinalClientAddress(e.target.value)} maxLength={300} />
  </label>
</fieldset>
```

Y añadir esos campos al payload del POST/PATCH.

- [ ] **Step 2: Mostrar `doc_number` en la lista de órdenes**

Localizar la tabla / lista. Añadir columna "Nº doc" antes de la columna de título o estado:

```tsx
<th>Nº doc</th>
// y en cada fila:
<td>{order.status === 'done' ? (order.doc_number ?? '—') : '—'}</td>
```

- [ ] **Step 3: Botón "⤓ PDF" en cada orden completada**

En la fila de la tabla:

```tsx
{order.status === 'done' && (
  <a
    className="btn-icon"
    href={`/api/v1/work-orders/${order.id}/report/pdf`}
    target="_blank" rel="noreferrer"
    title="Descargar parte (PDF)"
  >⤓ PDF</a>
)}
```

(Si las llamadas a la API requieren un Authorization header explícito desde una librería tipo axios, este enlace fallará: la cookie/JWT debe estar en el navegador automáticamente. Verifica el flujo de auth — si el proyecto usa cookies HttpOnly funciona; si usa header Bearer en localStorage, se necesita un fetch + blob download. En ese caso reemplaza por:)

```tsx
async function downloadPdf(orderId: string, docNumber: string | null) {
  const res = await fetch(`/api/v1/work-orders/${orderId}/report/pdf`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) { alert('Error al descargar PDF'); return }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${docNumber ?? 'parte'}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
```

(Mira cómo se manejan headers Authorization en otros llamados a `/api/v1` del archivo y elige la opción consistente.)

- [ ] **Step 4: Mostrar Telemetría capturada en `WorkReportModal`**

En `WorkReportModal.tsx`, añadir nueva tab "Telemetría capturada" que carga `GET /api/v1/work-orders/{id}/telemetry-detail` con TanStack Query:

```tsx
const { data: telemetry } = useQuery({
  queryKey: ['work-orders', orderId, 'telemetry-detail'],
  queryFn: () => api.get(`/work-orders/${orderId}/telemetry-detail`).then(r => r.data),
  enabled: open,
})
```

Y un render con acordeón por parada (display de tag ✓ en métricas que están en `pdf_metric_keys`):

```tsx
{telemetry?.stops?.map((s: any, i: number) => (
  <details key={s.id}>
    <summary>Parada {i + 1} · {s.address ?? '—'}</summary>
    <ul>
      {Object.entries(s.telemetry).map(([k, v]) => (
        <li key={k}>
          <strong>{k}:</strong> {v ?? '—'}
          {telemetry.pdf_metric_keys.includes(k)
            ? <span className="tag-pdf">✓ en PDF</span>
            : <span className="tag-no-pdf">capturado, no en PDF</span>}
        </li>
      ))}
    </ul>
  </details>
))}
```

- [ ] **Step 5: Botón "Descargar PDF" prominente dentro del modal cuando estado=done**

```tsx
{order.status === 'done' && (
  <button onClick={() => downloadPdf(order.id, order.doc_number)}>
    ⤓ Descargar parte (PDF)
  </button>
)}
```

- [ ] **Step 6: Verificar build**

Run: `npm run build 2>&1 | tail -5`
Expected: build OK.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/work-orders/
git commit -m "feat(web): work-orders — datos cliente final, doc_number visible, descarga PDF y tab telemetría capturada"
```

---

# FASE 10 — MOBILE: Cambios en cliente Expo

## Task 16: Añadir dependencias de Expo

**Files:**
- Modify: `mobile/package.json`

- [ ] **Step 1: Comprobar versiones recomendadas para Expo SDK del proyecto**

Run: `grep -E '"expo"|"expo-' mobile/package.json | head -10`

- [ ] **Step 2: Instalar `expo-file-system` y `expo-sharing`**

```bash
cd /opt/cmg-telematic1/mobile
npx expo install expo-file-system expo-sharing
```

(Si `expo-file-system` ya está, solo se añadirá `expo-sharing`.)

- [ ] **Step 3: Verificar `package.json` lista las nuevas dependencias**

Run: `grep -E "expo-(file|sharing)" mobile/package.json`
Expected: ambas listadas.

- [ ] **Step 4: Commit (incluyendo lockfile)**

```bash
git add mobile/package.json mobile/package-lock.json
git commit -m "chore(mobile): añade expo-file-system y expo-sharing para compartir PDF"
```

---

## Task 17: Helper isValidDni y tipos

**Files:**
- Create: `mobile/src/utils/dni.ts`
- Modify: `mobile/src/types/index.ts`

- [ ] **Step 1: Crear utilidad de validación de DNI/NIE**

Crear `mobile/src/utils/dni.ts`:

```typescript
const LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'

/**
 * Valida DNI español (8 dígitos + letra) o NIE (X/Y/Z + 7 dígitos + letra).
 * Si el formato no se parece a DNI/NIE español, devuelve true (acepta IDs extranjeros).
 */
export function isValidDni(input: string): boolean {
  if (!input) return false
  const v = input.trim().toUpperCase()
  const dniRe = /^(\d{8})([A-Z])$/
  const nieRe = /^([XYZ])(\d{7})([A-Z])$/

  const m = v.match(dniRe) ?? v.match(nieRe)
  if (!m) return v.length >= 5  // formato no español: aceptamos si tiene >=5 chars

  let num: number
  let letter: string
  if (m.length === 3) {
    num = parseInt(m[1], 10)
    letter = m[2]
  } else {
    const prefixVal = { X: 0, Y: 1, Z: 2 }[m[1] as 'X'|'Y'|'Z']
    num = parseInt(`${prefixVal}${m[2]}`, 10)
    letter = m[3]
  }
  return LETTERS[num % 23] === letter
}
```

- [ ] **Step 2: Extender tipo WorkReport en types/index.ts**

Run: `grep -n "WorkReport" mobile/src/types/index.ts`
Localizar el tipo y añadir campos:

```typescript
export type WorkReport = {
  // ... existentes ...
  client_signee_name: string | null
  client_signee_dni: string | null
  unsigned_reason: string | null
  signature_url: string | null
}
```

- [ ] **Step 3: Commit**

```bash
git add mobile/src/utils/dni.ts mobile/src/types/index.ts
git commit -m "feat(mobile): helper isValidDni + tipos WorkReport extendidos"
```

---

## Task 18: WorkReportScreen — captura firma cliente / motivo no firma

**Files:**
- Modify: `mobile/src/screens/WorkReportScreen.tsx`
- Modify: `mobile/src/api/workOrders.ts`

- [ ] **Step 1: Extender API helper para enviar nuevos campos**

Editar `mobile/src/api/workOrders.ts`. Localizar la función que hace POST `/work-orders/{id}/report` y extender su firma + payload:

```typescript
export type SubmitReportArgs = {
  orderId: string
  description?: string
  workDurationMinutes?: number
  materialsUsed?: { name: string; quantity: number; unit?: string }[]
  signatureData?: string | null
  clientSigneeName?: string | null
  clientSigneeDni?: string | null
  unsignedReason?: string | null
}

export async function submitReport(args: SubmitReportArgs) {
  const body: Record<string, unknown> = {
    description: args.description,
    work_duration_minutes: args.workDurationMinutes,
    materials_used: args.materialsUsed ?? [],
    signature_data: args.signatureData ?? null,
    client_signee_name: args.clientSigneeName ?? null,
    client_signee_dni: args.clientSigneeDni ?? null,
    unsigned_reason: args.unsignedReason ?? null,
  }
  return client.post(`/work-orders/${args.orderId}/report`, body).then(r => r.data)
}
```

(Adapta a la convención del archivo — si usa fetch en lugar de axios `client`, mantenlo.)

Añadir helper de descarga + share:

```typescript
import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { getAuthToken, API_BASE } from './client'

export async function downloadAndShareReportPdf(orderId: string, docNumber: string | null) {
  const url = `${API_BASE}/api/v1/work-orders/${orderId}/report/pdf`
  const targetPath = `${FileSystem.cacheDirectory}${docNumber ?? `parte-${orderId}`}.pdf`
  const { uri } = await FileSystem.downloadAsync(url, targetPath, {
    headers: { Authorization: `Bearer ${await getAuthToken()}` },
  })
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: `Parte ${docNumber ?? ''}`,
    })
  }
}
```

(Verifica los nombres reales de `getAuthToken`/`API_BASE` en `client.ts`. Si difieren, ajusta los imports.)

- [ ] **Step 2: Reescribir el bloque firma en WorkReportScreen**

Editar `mobile/src/screens/WorkReportScreen.tsx`:

1. Añadir estados arriba del componente:

```typescript
type Mode = 'sign' | 'unsigned'
type UnsignedReasonKey = 'absent' | 'refused' | 'minor' | 'other'

const REASON_LABELS: Record<UnsignedReasonKey, string> = {
  absent: 'Cliente ausente',
  refused: 'Rechaza firmar',
  minor: 'Menor de edad / sin capacidad',
  other: 'Otro',
}

// dentro del componente:
const [mode, setMode] = useState<Mode>('sign')
const [signeeName, setSigneeName] = useState('')
const [signeeDni, setSigneeDni] = useState('')
const [signatureB64, setSignatureB64] = useState<string | null>(null)
const [unsignedReason, setUnsignedReason] = useState<UnsignedReasonKey | null>(null)
const [unsignedReasonText, setUnsignedReasonText] = useState('')
```

2. Reemplazar / añadir el JSX del bloque "Conformidad del cliente" — sustituir la sección actual de firma del operario:

```tsx
{mode === 'sign' ? (
  <View style={styles.section}>
    <Text style={styles.h2}>Conformidad del cliente</Text>
    <TextInput
      style={styles.input}
      placeholder="Nombre del firmante"
      value={signeeName}
      onChangeText={setSigneeName}
      maxLength={200}
    />
    <TextInput
      style={styles.input}
      placeholder="DNI / NIE"
      value={signeeDni}
      onChangeText={t => setSigneeDni(t.toUpperCase())}
      autoCapitalize="characters"
      maxLength={20}
    />
    {signeeDni.length > 0 && !isValidDni(signeeDni) && (
      <Text style={styles.warn}>Formato de DNI/NIE no estándar</Text>
    )}
    <SignatureCanvas
      onSignatureChange={setSignatureB64}
      style={styles.signatureCanvas}
    />
    <Pressable onPress={() => setSignatureB64(null)}><Text>Borrar firma</Text></Pressable>
    <Pressable
      style={styles.linkBtn}
      onPress={() => { setSignatureB64(null); setSigneeName(''); setSigneeDni(''); setMode('unsigned') }}
    >
      <Text>⊘  No se puede firmar</Text>
    </Pressable>
  </View>
) : (
  <View style={styles.section}>
    <Text style={styles.h2}>Sin firma del cliente</Text>
    <Text style={styles.fieldLabel}>Motivo *</Text>
    {(Object.keys(REASON_LABELS) as UnsignedReasonKey[]).map(k => (
      <Pressable key={k} onPress={() => setUnsignedReason(k)}
                 style={[styles.radio, unsignedReason === k && styles.radioOn]}>
        <Text>{REASON_LABELS[k]}</Text>
      </Pressable>
    ))}
    {unsignedReason === 'other' && (
      <TextInput
        style={styles.input}
        placeholder="Especifica el motivo"
        value={unsignedReasonText}
        onChangeText={setUnsignedReasonText}
        maxLength={200}
      />
    )}
    <Pressable
      style={styles.linkBtn}
      onPress={() => { setUnsignedReason(null); setUnsignedReasonText(''); setMode('sign') }}
    >
      <Text>← Volver a captura de firma</Text>
    </Pressable>
  </View>
)}
```

3. Validación + handler submit:

```typescript
const isValid = mode === 'sign'
  ? signeeName.trim().length >= 3 && !!signeeDni.trim() && !!signatureB64
  : !!unsignedReason && (unsignedReason !== 'other' || unsignedReasonText.trim().length >= 3)

async function onSubmit() {
  const reasonStr = mode === 'unsigned'
    ? (unsignedReason === 'other' ? unsignedReasonText.trim() : REASON_LABELS[unsignedReason!])
    : null

  await submitReport({
    orderId,
    description,
    workDurationMinutes,
    signatureData: mode === 'sign' ? signatureB64 : null,
    clientSigneeName: mode === 'sign' ? signeeName.trim() : null,
    clientSigneeDni: mode === 'sign' ? signeeDni.trim().toUpperCase() : null,
    unsignedReason: reasonStr,
  })
  // Cerrar la orden:
  await patchWorkOrderStatus(orderId, 'done')
  // Navegar a éxito (Task 19):
  navigation.replace('WorkReportSuccess', { orderId, docNumber: /* recuperado del response del PATCH */ null })
}
```

(El status se llama `'done'` no `'completed'` — verifica en `mobile/src/api/workOrders.ts` la función exacta.)

- [ ] **Step 3: Importar el helper isValidDni**

Arriba del archivo:

```typescript
import { isValidDni } from '../utils/dni'
```

- [ ] **Step 4: Verificar typecheck**

Run: `cd /opt/cmg-telematic1/mobile && npx tsc --noEmit 2>&1 | tail -20`
Expected: 0 errores (o únicamente errores no relacionados al cambio).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/screens/WorkReportScreen.tsx mobile/src/api/workOrders.ts
git commit -m "feat(mobile): WorkReportScreen captura firma+DNI cliente o motivo no firma"
```

---

## Task 19: WorkReportSuccessScreen + navegación

**Files:**
- Create: `mobile/src/screens/WorkReportSuccessScreen.tsx`
- Modify: `mobile/src/navigation/MainNavigator.tsx`

- [ ] **Step 1: Crear pantalla de éxito**

Crear `mobile/src/screens/WorkReportSuccessScreen.tsx`:

```tsx
import { View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native'
import { useState } from 'react'
import { useRoute, useNavigation } from '@react-navigation/native'
import { downloadAndShareReportPdf } from '../api/workOrders'

export default function WorkReportSuccessScreen() {
  const route = useRoute<any>()
  const navigation = useNavigation<any>()
  const { orderId, docNumber } = route.params as { orderId: string; docNumber: string | null }
  const [sharing, setSharing] = useState(false)

  async function onShare() {
    try {
      setSharing(true)
      await downloadAndShareReportPdf(orderId, docNumber)
    } catch (e: any) {
      Alert.alert('No se pudo descargar', e?.message ?? 'Error')
    } finally {
      setSharing(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>✓ Parte cerrado</Text>
      {docNumber && <Text style={styles.doc}>{docNumber}</Text>}
      <Pressable style={styles.primary} onPress={onShare} disabled={sharing}>
        {sharing ? <ActivityIndicator /> : <Text style={styles.primaryText}>Compartir parte con el cliente</Text>}
      </Pressable>
      <Pressable style={styles.secondary} onPress={() => navigation.popToTop()}>
        <Text>Volver</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },
  title:    { fontSize: 22, fontWeight: '700' },
  doc:      { fontSize: 14, color: '#666' },
  primary:  { backgroundColor: '#F97316', paddingHorizontal: 22, paddingVertical: 14, borderRadius: 8, minWidth: 280, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '600' },
  secondary:{ paddingHorizontal: 18, paddingVertical: 10 },
})
```

- [ ] **Step 2: Registrar la ruta en `MainNavigator.tsx`**

Run: `grep -n "Stack.Screen" mobile/src/navigation/MainNavigator.tsx | head -10`

Añadir:

```tsx
import WorkReportSuccessScreen from '../screens/WorkReportSuccessScreen'
// ...
<Stack.Screen name="WorkReportSuccess" component={WorkReportSuccessScreen} options={{ title: 'Parte enviado' }} />
```

- [ ] **Step 3: Tipar la ruta si el proyecto usa types de navigation**

Run: `grep -n "RootStack\|ParamList" mobile/src/navigation/*.tsx mobile/src/types/* 2>/dev/null | head -10`

Si hay un `RootStackParamList`, añadir:

```typescript
WorkReportSuccess: { orderId: string; docNumber: string | null }
```

- [ ] **Step 4: Verificar que en WorkReportScreen.tsx la navegación a `WorkReportSuccess` recibe `docNumber`**

Tras `patchWorkOrderStatus(orderId, 'done')` en Task 18, capturar el `doc_number` del response y pasarlo:

```typescript
const updated = await patchWorkOrderStatus(orderId, 'done')
navigation.replace('WorkReportSuccess', { orderId, docNumber: updated?.doc_number ?? null })
```

(Si `patchWorkOrderStatus` no devuelve la orden actualizada, hacer un GET previo o ajustar la función para que la devuelva.)

- [ ] **Step 5: Verificar typecheck**

Run: `cd /opt/cmg-telematic1/mobile && npx tsc --noEmit 2>&1 | tail -10`
Expected: 0 errores.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/screens/WorkReportSuccessScreen.tsx mobile/src/navigation/MainNavigator.tsx mobile/src/screens/WorkReportScreen.tsx
git commit -m "feat(mobile): WorkReportSuccessScreen + Share API para enviar PDF al cliente"
```

---

# FASE 11 — Verificación end-to-end manual

## Task 20: Plan de validación E2E

**Files:** ninguno (es ejecución manual; documentar resultado)

- [ ] **Step 1: Levantar entorno completo**

```bash
docker-compose up -d
docker-compose exec core-api alembic upgrade head
```

Verificar logs limpios.

- [ ] **Step 2: Test manual — crear estructura tenants/datos**

1. Login como CMG admin → crear tenant "Vacuum" (tier=client) si no existe.
2. Login como Vacuum admin → crear tenant "Aguas de Valencia" (tier=subclient).
3. Como Aguas admin: en `/clientes` editar Aguas y rellenar `business_cif`, `business_address`, `primary_color`.
4. En `/tipos-vehiculo` (CMG admin) seleccionar el tipo del vehículo y configurar `pdf_metrics`: PTO min, Presión máx, RPM medio, Combustible.

- [ ] **Step 3: Crear orden y cerrarla desde mobile firmando**

1. En `/work-orders` crear orden para un vehículo de Aguas con 3 paradas (con direcciones reales para tener telemetría plausible). Rellenar `final_client_name`, `final_client_address`.
2. Login mobile como operario asignado.
3. Ir a la orden → "Cerrar parte". Capturar 2 fotos. Rellenar nombre + DNI válido + firmar canvas. Pulsar "Cerrar parte".
4. Verificar que llega a `WorkReportSuccessScreen` con un `doc_number` `PT-2026-XXXXX`.
5. Pulsar "Compartir parte con el cliente". Verificar que el sheet del SO se abre y permite seleccionar WhatsApp/Mail.

- [ ] **Step 4: Verificar PDF en web (admin Aguas)**

1. Volver al web autenticado como Aguas admin.
2. Ir a `/work-orders`, columna "Nº doc" muestra `PT-2026-XXXXX`.
3. Botón "⤓ PDF" descarga el archivo.
4. Abrir el PDF y comprobar:
   - Cabecera con logo de Aguas (si subido) y color primario configurado.
   - Bloque "Emite": Aguas + CIF + dirección.
   - Bloque "Cliente": nombre y dirección del cliente final.
   - Tabla de paradas con las 3 paradas y las 4 métricas configuradas.
   - 2 fotos.
   - Firma + nombre + DNI debajo.
   - Footer con `brand_name · doc_number` izda y "Página 1 de 1" dcha.

- [ ] **Step 5: Test "no se puede firmar"**

1. Crear otra orden similar.
2. En mobile pulsar "No se puede firmar" → seleccionar "Cliente ausente" → cerrar.
3. Descargar PDF y verificar nota gris cursiva: *"Parte cerrado sin firma del cliente. Motivo: Cliente ausente."* — sin sello rojo.

- [ ] **Step 6: Test tab "Telemetría capturada"**

1. En `/work-orders` abrir el modal de la orden completada.
2. Tab "Telemetría capturada" muestra acordeón por parada con todas las métricas, marcadas ✓ las que están en `pdf_metrics`.

- [ ] **Step 7: Documentar resultado**

Si todo pasa, dejar nota en el PR:
> "E2E manual ejecutado el 2026-05-XX. Tenants Vacuum/Aguas creados. Orden con 3 paradas firmada en mobile. PDF descargado desde web y desde share mobile. Sin firma con motivo verificado. Telemetría capturada visible en modal."

Si algo falla, abrir issue con captura del PDF y logs del backend.

- [ ] **Step 8: Commit final del proceso (opcional)**

```bash
git commit --allow-empty -m "test(e2e): pdf parte multitenant verificado manualmente"
```

---

## Riesgos a vigilar durante la implementación

- **Imágenes en WeasyPrint:** las URLs `/uploads/...` deben mapearse a `file:///app/uploads/...` para que el container las resuelva. Si el deploy local difiere, ajustar `_to_file_url`.
- **`completed_at` no se asigna automáticamente** en el modelo: la lógica de cierre debe ponerlo explícitamente al pasar a `done`, ya cubierto en Task 5.
- **`brand_tokens` puede tener un editor separado** (`BrandTokensEditor.tsx` existe). Si la app envía brand_tokens por endpoint dedicado, integrar `primary_color` ahí en lugar de en TenantFormPage.
- **Auth en frontend para descarga PDF:** verificar si la app usa cookies o Bearer token. Si Bearer, el `<a href>` directo no funciona — usar fetch+blob.
- **Mobile WorkReportScreen:** la pantalla actual probablemente capturaba firma del operario; el cambio reinterpreta el canvas como firma del cliente. Si el componente de canvas exporta a base64 con un evento concreto, conserva ese mecanismo.
- **Tests integration:** si el conftest no soporta crear tenants/órdenes en una BD real, varios tests del plan quedarán como `skip`. Está aceptado: el implementador puede añadir un fixture de DB SQLite o documentar que se ejecuten contra Postgres real.
