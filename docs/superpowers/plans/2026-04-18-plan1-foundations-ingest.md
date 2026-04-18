# CMG Telematics 2 — Plan 1: Foundations + Ingest Service

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levantar la infraestructura base (Docker, PostgreSQL/TimescaleDB, Redis) con el schema completo, y construir el `ingest-svc` que recibe datos Teltonika FMC650 vía Codec 8 TCP, los escribe en TimescaleDB y los publica en Redis Stream.

**Architecture:** 5 servicios Docker (postgres, redis, ingest-svc, core-api esqueleto, caddy). El `ingest-svc` es un servidor TCP asyncio que acepta conexiones de dispositivos FMC650, decodifica el protocolo Codec 8, escribe en `telemetry_record` (TimescaleDB hypertable) y publica en Redis Stream `telemetry.raw` para que el rules-engine lo consuma (Plan 2).

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 async, asyncpg, TimescaleDB, Redis 7, Docker Compose, Alembic, pytest, pytest-asyncio.

**Spec de referencia:** `/opt/cmg-telematic1/docs/superpowers/specs/2026-04-18-cmg-telematics2-design.md`
**Referencia protocolo Codec 8:** `/opt/cmg-telematics/backend/app/services/teltonika/` (consultar, no copiar)

---

## Estructura de ficheros que crea este plan

```
/opt/cmg-telematic1/
├── docker-compose.yml
├── .env.example
├── Caddyfile
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/
│   │       └── 001_initial_schema.py
│   └── app/
│       ├── __init__.py
│       ├── main.py
│       ├── core/
│       │   ├── config.py
│       │   ├── database.py
│       │   └── security.py
│       ├── models/
│       │   ├── __init__.py
│       │   ├── base.py
│       │   ├── tenant.py
│       │   ├── user.py
│       │   ├── permission_grant.py
│       │   ├── vehicle_type.py
│       │   ├── vehicle.py
│       │   ├── device.py
│       │   ├── telemetry.py
│       │   ├── alert_rule.py
│       │   ├── alert_instance.py
│       │   └── maintenance.py
│       ├── schemas/
│       │   ├── auth.py
│       │   └── common.py
│       ├── api/
│       │   └── v1/
│       │       ├── router.py
│       │       └── auth.py
│       └── seeds/
│           └── initial.py
├── services/
│   └── ingest/
│       ├── Dockerfile
│       ├── pyproject.toml
│       └── src/
│           ├── __init__.py
│           ├── main.py
│           ├── config.py
│           ├── server.py
│           ├── codec8.py
│           ├── writer.py
│           └── publisher.py
└── tests/
    ├── conftest.py
    ├── test_auth.py
    └── ingest/
        ├── conftest.py
        ├── test_codec8.py
        └── test_ingest_integration.py
```

---

## Task 1: Docker Compose + variables de entorno

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `Caddyfile`

- [ ] **Step 1.1: Crear `.env.example`**

```bash
cat > /opt/cmg-telematic1/.env.example << 'EOF'
# Base de datos
POSTGRES_DB=cmg_telematics
POSTGRES_USER=cmg
POSTGRES_PASSWORD=changeme_db
DB_URL=postgresql+asyncpg://cmg:changeme_db@postgres:5432/cmg_telematics
DB_URL_SYNC=postgresql://cmg:changeme_db@postgres:5432/cmg_telematics

# Redis
REDIS_PASSWORD=changeme_redis
REDIS_URL=redis://:changeme_redis@redis:6379/0

# API
SECRET_KEY=changeme_secret_key_64_chars_minimum_replace_in_production
ENVIRONMENT=development
DOMAIN=localhost

# Notificaciones (dejar vacío en desarrollo)
SENDGRID_KEY=
TWILIO_SID=
TWILIO_TOKEN=
FCM_KEY=
EOF
cp /opt/cmg-telematic1/.env.example /opt/cmg-telematic1/.env
echo "Creado .env"
```

- [ ] **Step 1.2: Crear `docker-compose.yml`**

```yaml
# /opt/cmg-telematic1/docker-compose.yml
services:

  postgres:
    image: timescale/timescaledb:latest-pg16
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD} --save 60 1 --loglevel warning
    volumes:
      - redisdata:/data
    ports:
      - "127.0.0.1:6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  ingest-svc:
    build:
      context: ./services/ingest
    restart: unless-stopped
    ports:
      - "0.0.0.0:5027:5027"
    environment:
      DB_URL: ${DB_URL}
      REDIS_URL: ${REDIS_URL}
      ENVIRONMENT: ${ENVIRONMENT}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

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
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddydata:/data
    depends_on:
      - core-api

volumes:
  pgdata:
  redisdata:
  caddydata:
```

- [ ] **Step 1.3: Crear `Caddyfile`**

```
# /opt/cmg-telematic1/Caddyfile
{$DOMAIN} {
    handle /api/* {
        reverse_proxy core-api:8010
    }
    handle /ws/* {
        reverse_proxy core-api:8010
    }
    handle /docs {
        reverse_proxy core-api:8010
    }
    handle /redoc {
        reverse_proxy core-api:8010
    }
    handle /openapi.json {
        reverse_proxy core-api:8010
    }
    handle {
        root * /srv/frontend
        file_server
        try_files {path} /index.html
    }
}
```

- [ ] **Step 1.4: Verificar que postgres y redis arrancan**

```bash
cd /opt/cmg-telematic1
docker compose up -d postgres redis
docker compose ps
```

Salida esperada: `postgres` y `redis` con estado `healthy`.

```bash
# Verificar conexión
docker compose exec postgres psql -U cmg -d cmg_telematics -c "SELECT version();"
docker compose exec redis redis-cli -a changeme_redis ping
```

Salida esperada: versión de PostgreSQL y `PONG`.

---

## Task 2: backend — dependencias y estructura Python

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/Dockerfile`
- Create: `backend/alembic.ini`

- [ ] **Step 2.1: Crear `backend/pyproject.toml`**

```toml
# /opt/cmg-telematic1/backend/pyproject.toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.backends.legacy:build"

[project]
name = "cmg-telematics-api"
version = "2.0.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi==0.115.0",
    "uvicorn[standard]==0.30.6",
    "sqlalchemy[asyncio]==2.0.35",
    "asyncpg==0.29.0",
    "alembic==1.13.3",
    "pydantic==2.9.2",
    "pydantic-settings==2.5.2",
    "passlib[bcrypt]==1.7.4",
    "python-jose[cryptography]==3.3.0",
    "redis[asyncio]==5.1.1",
    "httpx==0.27.2",
    "python-multipart==0.0.12",
]

[project.optional-dependencies]
dev = [
    "pytest==8.3.3",
    "pytest-asyncio==0.24.0",
    "pytest-cov==5.0.0",
    "httpx==0.27.2",
]
```

- [ ] **Step 2.2: Crear `backend/Dockerfile`**

```dockerfile
# /opt/cmg-telematic1/backend/Dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir -e ".[dev]"

COPY . .

EXPOSE 8010

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010", "--reload"]
```

- [ ] **Step 2.3: Crear `backend/alembic.ini`**

```ini
# /opt/cmg-telematic1/backend/alembic.ini
[alembic]
script_location = alembic
prepend_sys_path = .
file_template = %%(rev)s_%%(slug)s
truncate_slug_length = 40
timezone = UTC

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console
qualname =

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

- [ ] **Step 2.4: Crear estructura de directorios**

```bash
mkdir -p /opt/cmg-telematic1/backend/app/{core,models,schemas,api/v1,seeds}
mkdir -p /opt/cmg-telematic1/backend/alembic/versions
touch /opt/cmg-telematic1/backend/app/__init__.py
touch /opt/cmg-telematic1/backend/app/models/__init__.py
touch /opt/cmg-telematic1/backend/app/schemas/__init__.py
touch /opt/cmg-telematic1/backend/app/api/__init__.py
touch /opt/cmg-telematic1/backend/app/api/v1/__init__.py
touch /opt/cmg-telematic1/backend/alembic/__init__.py
echo "Estructura creada"
```

---

## Task 3: Modelos SQLAlchemy

**Files:**
- Create: `backend/app/models/base.py`
- Create: `backend/app/core/config.py`
- Create: `backend/app/core/database.py`
- Create: `backend/app/models/tenant.py`
- Create: `backend/app/models/user.py`
- Create: `backend/app/models/permission_grant.py`
- Create: `backend/app/models/vehicle_type.py`
- Create: `backend/app/models/vehicle.py`
- Create: `backend/app/models/device.py`
- Create: `backend/app/models/telemetry.py`
- Create: `backend/app/models/alert_rule.py`
- Create: `backend/app/models/alert_instance.py`
- Create: `backend/app/models/maintenance.py`

- [ ] **Step 3.1: `app/core/config.py`**

```python
# backend/app/core/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    db_url: str
    db_url_sync: str
    redis_url: str
    secret_key: str
    environment: str = "development"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 30

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


settings = Settings()
```

- [ ] **Step 3.2: `app/core/database.py`**

```python
# backend/app/core/database.py
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.core.config import settings

engine = create_async_engine(
    settings.db_url,
    echo=not settings.is_production,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
```

- [ ] **Step 3.3: `app/models/base.py`**

```python
# backend/app/models/base.py
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
```

- [ ] **Step 3.4: `app/models/tenant.py`**

```python
# backend/app/models/tenant.py
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, ForeignKey, DateTime, Boolean, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class Tenant(Base):
    __tablename__ = "tenant"
    __table_args__ = (
        CheckConstraint("tier IN ('cmg','client','subclient')", name="ck_tenant_tier"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id", ondelete="SET NULL"), nullable=True)
    tier: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    brand_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    brand_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    custom_domain: Mapped[str | None] = mapped_column(String(200), unique=True, nullable=True)
    brand_tokens: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    parent = relationship("Tenant", remote_side=[id], backref="children")
    users = relationship("User", back_populates="tenant", cascade="all, delete-orphan")
    vehicles = relationship("Vehicle", back_populates="tenant", cascade="all, delete-orphan")
```

- [ ] **Step 3.5: `app/models/user.py`**

```python
# backend/app/models/user.py
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, ForeignKey, DateTime, Boolean, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class User(Base):
    __tablename__ = "user"
    __table_args__ = (
        CheckConstraint("role IN ('admin','operator','viewer','driver')", name="ck_user_role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(256), nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="viewer")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_email: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_push: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    tenant = relationship("Tenant", back_populates="users")
```

- [ ] **Step 3.6: `app/models/permission_grant.py`**

```python
# backend/app/models/permission_grant.py
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, ForeignKey, DateTime, Boolean, ARRAY, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class PermissionGrant(Base):
    __tablename__ = "permission_grant"
    __table_args__ = (
        UniqueConstraint("grantor_id", "grantee_id", "resource_type", "resource_id",
                         name="uq_grant"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    grantor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False)
    grantee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    allowed_actions: Mapped[list] = mapped_column(ARRAY(String), nullable=False)
    constraints: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    granted_by_user: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("user.id"), nullable=True)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
```

- [ ] **Step 3.7: `app/models/vehicle_type.py`**

```python
# backend/app/models/vehicle_type.py
import uuid
from sqlalchemy import String
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class VehicleType(Base):
    __tablename__ = "vehicle_type"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    sensor_schema: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    vehicles = relationship("Vehicle", back_populates="vehicle_type")
```

- [ ] **Step 3.8: `app/models/vehicle.py`**

```python
# backend/app/models/vehicle.py
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, ForeignKey, DateTime, Boolean, SmallInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class Vehicle(Base):
    __tablename__ = "vehicle"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False)
    vehicle_type_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vehicle_type.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    license_plate: Mapped[str | None] = mapped_column(String(20), nullable=True)
    vin: Mapped[str | None] = mapped_column(String(17), unique=True, nullable=True)
    year: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    tenant = relationship("Tenant", back_populates="vehicles")
    vehicle_type = relationship("VehicleType", back_populates="vehicles")
    device = relationship("Device", back_populates="vehicle", uselist=False)
```

- [ ] **Step 3.9: `app/models/device.py`**

```python
# backend/app/models/device.py
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, ForeignKey, DateTime, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class Device(Base):
    __tablename__ = "device"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("vehicle.id", ondelete="SET NULL"), nullable=True)
    imei: Mapped[str] = mapped_column(String(15), unique=True, nullable=False, index=True)
    model: Mapped[str] = mapped_column(String(50), default="FMC650")
    firmware_ver: Mapped[str | None] = mapped_column(String(20), nullable=True)
    online: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    vehicle = relationship("Vehicle", back_populates="device")
```

- [ ] **Step 3.10: `app/models/telemetry.py`**

```python
# backend/app/models/telemetry.py
# NOTA: Esta tabla es gestionada como hypertable TimescaleDB.
# Alembic crea la tabla; el hypertable y compression policy
# se configuran en la migración con op.execute().
import uuid
from datetime import datetime
from sqlalchemy import Float, Boolean, Integer, SmallInteger, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class TelemetryRecord(Base):
    __tablename__ = "telemetry_record"
    __table_args__ = (
        Index("ix_telemetry_vehicle_time", "vehicle_id", "time"),
        Index("ix_telemetry_tenant_time", "tenant_id", "time"),
        {"timescaledb_hypertable": True},  # solo documentativo, no lo usa SQLAlchemy
    )

    time: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), primary_key=True, nullable=False)
    device_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, nullable=False)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vehicle.id"), nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    lat: Mapped[float | None] = mapped_column(Float(precision=10), nullable=True)
    lon: Mapped[float | None] = mapped_column(Float(precision=10), nullable=True)
    speed_kmh: Mapped[float | None] = mapped_column(Float, nullable=True)
    heading: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    altitude_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    ignition: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    pto_active: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    ext_voltage_mv: Mapped[int | None] = mapped_column(Integer, nullable=True)
    can_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
```

- [ ] **Step 3.11: `app/models/alert_rule.py` y `alert_instance.py`**

```python
# backend/app/models/alert_rule.py
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, ForeignKey, DateTime, Boolean, Integer, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class AlertRule(Base):
    __tablename__ = "alert_rule"
    __table_args__ = (
        CheckConstraint("severity IN ('info','warning','critical')", name="ck_rule_severity"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    vehicle_filter: Mapped[dict] = mapped_column(JSONB, nullable=False, default=lambda: {"scope": "all"})
    condition: Mapped[dict] = mapped_column(JSONB, nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, default="warning")
    actions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    escalation: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    schedule: Mapped[dict] = mapped_column(JSONB, nullable=False, default=lambda: {"type": "always"})
    cooldown_minutes: Mapped[int] = mapped_column(Integer, default=30)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("user.id"), nullable=True)
```

```python
# backend/app/models/alert_instance.py
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, ForeignKey, DateTime, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class AlertInstance(Base):
    __tablename__ = "alert_instance"
    __table_args__ = (
        CheckConstraint("status IN ('firing','acknowledged','resolved','escalated')", name="ck_alert_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rule_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("alert_rule.id"), nullable=False)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vehicle.id"), nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    triggered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="firing")
    trigger_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ack_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("user.id"), nullable=True)
    ack_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ack_note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
```

- [ ] **Step 3.12: `app/models/maintenance.py`**

```python
# backend/app/models/maintenance.py
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
    vehicle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vehicle.id"), nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    trigger_condition: Mapped[dict] = mapped_column(JSONB, nullable=False)
    next_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    warn_before_pct: Mapped[int] = mapped_column(Integer, default=10)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class MaintenanceLog(Base):
    __tablename__ = "maintenance_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vehicle.id"), nullable=False)
    plan_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("maintenance_plan.id"), nullable=True)
    performed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    performed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("user.id"), nullable=True)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    reset_counters: Mapped[list | None] = mapped_column(ARRAY(String), nullable=True)
    cost_eur: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    photo_urls: Mapped[list | None] = mapped_column(ARRAY(String), nullable=True)
```

- [ ] **Step 3.13: `app/models/__init__.py` — importar todos los modelos**

```python
# backend/app/models/__init__.py
from app.models.base import Base
from app.models.tenant import Tenant
from app.models.user import User
from app.models.permission_grant import PermissionGrant
from app.models.vehicle_type import VehicleType
from app.models.vehicle import Vehicle
from app.models.device import Device
from app.models.telemetry import TelemetryRecord
from app.models.alert_rule import AlertRule
from app.models.alert_instance import AlertInstance
from app.models.maintenance import MaintenancePlan, MaintenanceLog

__all__ = [
    "Base", "Tenant", "User", "PermissionGrant", "VehicleType",
    "Vehicle", "Device", "TelemetryRecord", "AlertRule", "AlertInstance",
    "MaintenancePlan", "MaintenanceLog",
]
```

---

## Task 4: Alembic — migración inicial con TimescaleDB

**Files:**
- Create: `backend/alembic/env.py`
- Create: `backend/alembic/versions/001_initial_schema.py`

- [ ] **Step 4.1: `alembic/env.py`**

```python
# backend/alembic/env.py
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
import os, sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.models import Base
from app.core.config import settings

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = settings.db_url_sync
    context.configure(url=url, target_metadata=target_metadata,
                      literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = settings.db_url_sync
    connectable = engine_from_config(configuration, prefix="sqlalchemy.",
                                     poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

- [ ] **Step 4.2: `alembic/versions/001_initial_schema.py`**

```python
# backend/alembic/versions/001_initial_schema.py
"""initial schema with TimescaleDB

Revision ID: 001
Create Date: 2026-04-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Habilitar extensión TimescaleDB
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;")

    # tenant
    op.create_table(
        "tenant",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("parent_id", UUID(as_uuid=True), sa.ForeignKey("tenant.id", ondelete="SET NULL"), nullable=True),
        sa.Column("tier", sa.String(20), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(100), unique=True, nullable=False),
        sa.Column("active", sa.Boolean, default=True),
        sa.Column("brand_name", sa.String(200), nullable=True),
        sa.Column("brand_color", sa.String(7), nullable=True),
        sa.Column("logo_url", sa.String(500), nullable=True),
        sa.Column("custom_domain", sa.String(200), unique=True, nullable=True),
        sa.Column("brand_tokens", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("tier IN ('cmg','client','subclient')", name="ck_tenant_tier"),
    )

    # user
    op.create_table(
        "user",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.String(254), unique=True, nullable=False),
        sa.Column("hashed_password", sa.String(256), nullable=False),
        sa.Column("full_name", sa.String(200), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="viewer"),
        sa.Column("active", sa.Boolean, server_default="true"),
        sa.Column("notify_email", sa.Boolean, server_default="true"),
        sa.Column("notify_push", sa.Boolean, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("role IN ('admin','operator','viewer','driver')", name="ck_user_role"),
    )
    op.create_index("ix_user_email", "user", ["email"])

    # permission_grant
    op.create_table(
        "permission_grant",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("grantor_id", UUID(as_uuid=True), sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("grantee_id", UUID(as_uuid=True), sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("resource_type", sa.String(50), nullable=False),
        sa.Column("resource_id", UUID(as_uuid=True), nullable=True),
        sa.Column("allowed_actions", ARRAY(sa.String), nullable=False),
        sa.Column("constraints", JSONB, nullable=True),
        sa.Column("granted_by_user", UUID(as_uuid=True), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("granted_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("active", sa.Boolean, server_default="true"),
        sa.UniqueConstraint("grantor_id", "grantee_id", "resource_type", "resource_id", name="uq_grant"),
    )

    # vehicle_type
    op.create_table(
        "vehicle_type",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(50), unique=True, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("sensor_schema", JSONB, nullable=False, server_default="[]"),
    )

    # vehicle
    op.create_table(
        "vehicle",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vehicle_type_id", UUID(as_uuid=True), sa.ForeignKey("vehicle_type.id"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("license_plate", sa.String(20), nullable=True),
        sa.Column("vin", sa.String(17), unique=True, nullable=True),
        sa.Column("year", sa.SmallInteger, nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("active", sa.Boolean, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # device
    op.create_table(
        "device",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("vehicle_id", UUID(as_uuid=True), sa.ForeignKey("vehicle.id", ondelete="SET NULL"), nullable=True),
        sa.Column("imei", sa.String(15), unique=True, nullable=False),
        sa.Column("model", sa.String(50), server_default="FMC650"),
        sa.Column("firmware_ver", sa.String(20), nullable=True),
        sa.Column("online", sa.Boolean, server_default="false"),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=True),
        sa.Column("active", sa.Boolean, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_device_imei", "device", ["imei"])

    # telemetry_record — tabla base, se convierte en hypertable después
    op.create_table(
        "telemetry_record",
        sa.Column("time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("device_id", UUID(as_uuid=True), nullable=False),
        sa.Column("vehicle_id", UUID(as_uuid=True), sa.ForeignKey("vehicle.id"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("lat", sa.Float, nullable=True),
        sa.Column("lon", sa.Float, nullable=True),
        sa.Column("speed_kmh", sa.Float, nullable=True),
        sa.Column("heading", sa.SmallInteger, nullable=True),
        sa.Column("altitude_m", sa.Float, nullable=True),
        sa.Column("ignition", sa.Boolean, nullable=True),
        sa.Column("pto_active", sa.Boolean, nullable=True),
        sa.Column("ext_voltage_mv", sa.Integer, nullable=True),
        sa.Column("can_data", JSONB, nullable=True),
    )
    # PK compuesta requerida por TimescaleDB
    op.execute("ALTER TABLE telemetry_record ADD PRIMARY KEY (time, device_id);")

    # Convertir en hypertable TimescaleDB
    op.execute("""
        SELECT create_hypertable('telemetry_record', 'time',
            chunk_time_interval => INTERVAL '1 day');
    """)
    # Compresión automática tras 7 días
    op.execute("""
        ALTER TABLE telemetry_record SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'vehicle_id,tenant_id'
        );
    """)
    op.execute("""
        SELECT add_compression_policy('telemetry_record', INTERVAL '7 days');
    """)

    # Índices para queries frecuentes
    op.execute("CREATE INDEX ix_telemetry_vehicle_time ON telemetry_record (vehicle_id, time DESC);")
    op.execute("CREATE INDEX ix_telemetry_tenant_time  ON telemetry_record (tenant_id, time DESC);")

    # alert_rule
    op.create_table(
        "alert_rule",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("active", sa.Boolean, server_default="true"),
        sa.Column("vehicle_filter", JSONB, nullable=False, server_default='{"scope":"all"}'),
        sa.Column("condition", JSONB, nullable=False),
        sa.Column("severity", sa.String(20), nullable=False, server_default="warning"),
        sa.Column("actions", JSONB, nullable=False, server_default="[]"),
        sa.Column("escalation", JSONB, nullable=False, server_default="[]"),
        sa.Column("schedule", JSONB, nullable=False, server_default='{"type":"always"}'),
        sa.Column("cooldown_minutes", sa.Integer, server_default="30"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_by_user_id", UUID(as_uuid=True), sa.ForeignKey("user.id"), nullable=True),
        sa.CheckConstraint("severity IN ('info','warning','critical')", name="ck_rule_severity"),
    )

    # Hot-reload trigger para rules-engine
    op.execute("""
        CREATE OR REPLACE FUNCTION notify_rule_change() RETURNS trigger AS $$
        BEGIN
          PERFORM pg_notify('rules_changed', row_to_json(NEW)::text);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER alert_rule_changed
          AFTER INSERT OR UPDATE OR DELETE ON alert_rule
          FOR EACH ROW EXECUTE FUNCTION notify_rule_change();
    """)

    # alert_instance
    op.create_table(
        "alert_instance",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("rule_id", UUID(as_uuid=True), sa.ForeignKey("alert_rule.id"), nullable=False),
        sa.Column("vehicle_id", UUID(as_uuid=True), sa.ForeignKey("vehicle.id"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("triggered_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="firing"),
        sa.Column("trigger_value", JSONB, nullable=True),
        sa.Column("ack_by_user_id", UUID(as_uuid=True), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("ack_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ack_note", sa.String(1000), nullable=True),
        sa.CheckConstraint("status IN ('firing','acknowledged','resolved','escalated')", name="ck_alert_status"),
    )

    # maintenance_plan
    op.create_table(
        "maintenance_plan",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("vehicle_id", UUID(as_uuid=True), sa.ForeignKey("vehicle.id"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("trigger_condition", JSONB, nullable=False),
        sa.Column("next_due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("warn_before_pct", sa.Integer, server_default="10"),
        sa.Column("active", sa.Boolean, server_default="true"),
    )

    # maintenance_log
    op.create_table(
        "maintenance_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("vehicle_id", UUID(as_uuid=True), sa.ForeignKey("vehicle.id"), nullable=False),
        sa.Column("plan_id", UUID(as_uuid=True), sa.ForeignKey("maintenance_plan.id"), nullable=True),
        sa.Column("performed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("performed_by", UUID(as_uuid=True), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("description", sa.String(1000), nullable=True),
        sa.Column("reset_counters", ARRAY(sa.String), nullable=True),
        sa.Column("cost_eur", sa.Numeric(10, 2), nullable=True),
        sa.Column("photo_urls", ARRAY(sa.String), nullable=True),
    )

    # Continuous aggregates
    op.execute("""
        CREATE MATERIALIZED VIEW telemetry_1h
        WITH (timescaledb.continuous) AS
        SELECT
            time_bucket('1 hour', time)                         AS bucket,
            vehicle_id, tenant_id,
            avg((can_data->>'hydraulic_pressure_1')::float)     AS avg_pressure_1,
            max((can_data->>'hydraulic_pressure_1')::float)     AS max_pressure_1,
            avg((can_data->>'oil_temp_c')::float)               AS avg_oil_temp,
            max((can_data->>'oil_temp_c')::float)               AS max_oil_temp,
            sum(CASE WHEN pto_active THEN 1 ELSE 0 END)         AS pto_active_minutes,
            sum(CASE WHEN ignition   THEN 1 ELSE 0 END)         AS engine_on_minutes,
            count(*)                                            AS record_count
        FROM telemetry_record
        GROUP BY bucket, vehicle_id, tenant_id
        WITH NO DATA;
    """)
    op.execute("""
        SELECT add_continuous_aggregate_policy('telemetry_1h',
            start_offset => INTERVAL '3 hours',
            end_offset   => INTERVAL '1 hour',
            schedule_interval => INTERVAL '1 hour');
    """)


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS telemetry_1h CASCADE;")
    op.drop_table("maintenance_log")
    op.drop_table("maintenance_plan")
    op.drop_table("alert_instance")
    op.execute("DROP TRIGGER IF EXISTS alert_rule_changed ON alert_rule;")
    op.execute("DROP FUNCTION IF EXISTS notify_rule_change;")
    op.drop_table("alert_rule")
    op.drop_table("telemetry_record")
    op.drop_table("device")
    op.drop_table("vehicle")
    op.drop_table("vehicle_type")
    op.drop_table("permission_grant")
    op.drop_table("user")
    op.drop_table("tenant")
```

- [ ] **Step 4.3: Ejecutar migración**

```bash
cd /opt/cmg-telematic1/backend
docker compose -f ../docker-compose.yml run --rm core-api alembic upgrade head
```

Salida esperada: `Running upgrade  -> 001, initial schema with TimescaleDB`

- [ ] **Step 4.4: Verificar schema**

```bash
docker compose exec postgres psql -U cmg -d cmg_telematics -c "\dt"
```

Salida esperada: 10 tablas listadas incluyendo `telemetry_record`, `alert_rule`, etc.

```bash
docker compose exec postgres psql -U cmg -d cmg_telematics \
  -c "SELECT hypertable_name FROM timescaledb_information.hypertables;"
```

Salida esperada: `telemetry_record`

---

## Task 5: core-api — FastAPI skeleton + JWT auth

**Files:**
- Create: `backend/app/core/security.py`
- Create: `backend/app/schemas/auth.py`
- Create: `backend/app/api/v1/auth.py`
- Create: `backend/app/api/v1/router.py`
- Create: `backend/app/main.py`

- [ ] **Step 5.1: `app/core/security.py`**

```python
# backend/app/core/security.py
from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from passlib.context import CryptContext
from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload["type"] = "access"
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def create_refresh_token(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.now(timezone.utc) + timedelta(
        days=settings.refresh_token_expire_days
    )
    payload["type"] = "refresh"
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
```

- [ ] **Step 5.2: `app/schemas/auth.py`**

```python
# backend/app/schemas/auth.py
import uuid
from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class CurrentUser(BaseModel):
    user_id: uuid.UUID
    tenant_id: uuid.UUID
    tenant_tier: str
    role: str
    email: str
```

- [ ] **Step 5.3: `app/api/v1/auth.py`**

```python
# backend/app/api/v1/auth.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.core.security import verify_password, create_access_token, create_refresh_token, decode_token
from app.models.user import User
from app.models.tenant import Tenant
from app.schemas.auth import LoginRequest, TokenResponse, RefreshRequest

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email, User.active == True))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales incorrectas")

    tenant = await db.get(Tenant, user.tenant_id)
    payload = {
        "sub": str(user.id),
        "tenant_id": str(user.tenant_id),
        "tenant_tier": tenant.tier,
        "role": user.role,
        "email": user.email,
    }
    return TokenResponse(
        access_token=create_access_token(payload),
        refresh_token=create_refresh_token(payload),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest):
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise ValueError
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido")
    payload.pop("exp", None)
    payload.pop("type", None)
    return TokenResponse(
        access_token=create_access_token(payload),
        refresh_token=create_refresh_token(payload),
    )
```

- [ ] **Step 5.4: `app/api/v1/router.py`**

```python
# backend/app/api/v1/router.py
from fastapi import APIRouter
from app.api.v1.auth import router as auth_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
```

- [ ] **Step 5.5: `app/main.py`**

```python
# backend/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.router import api_router
from app.core.config import settings

app = FastAPI(
    title="CMG Telematics API",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if not settings.is_production else ["https://telematics.cmghidraulica.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}
```

- [ ] **Step 5.6: Construir imagen y verificar**

```bash
cd /opt/cmg-telematic1
docker compose build core-api
docker compose up -d core-api
```

```bash
curl -s http://localhost:8010/health | python3 -m json.tool
```

Salida esperada:
```json
{"status": "ok", "version": "2.0.0"}
```

```bash
curl -s http://localhost:8010/docs | grep -c "CMG Telematics"
```

Salida esperada: `1` (la página Swagger existe)

---

## Task 6: Seed data — tenant CMG + admin + vehicle types

**Files:**
- Create: `backend/app/seeds/initial.py`
- Create: `backend/app/seeds/__init__.py`

- [ ] **Step 6.1: `app/seeds/initial.py`**

```python
# backend/app/seeds/initial.py
"""
Seed idempotente: crea tenant CMG, usuario superadmin y 3 vehicle_types.
Ejecutar: python -m app.seeds.initial
"""
import asyncio
import uuid
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import select
from app.core.config import settings
from app.core.security import hash_password
from app.models.base import Base
from app.models.tenant import Tenant
from app.models.user import User
from app.models.vehicle_type import VehicleType

VACUUM_SENSORS = [
    {"key": "hydraulic_pressure_1", "label": "Presión bomba principal", "unit": "bar",
     "min": 0, "max": 300, "gauge_type": "circular", "warn_above": 220, "alert_above": 250, "avl_id": 305},
    {"key": "hydraulic_pressure_2", "label": "Presión bomba secundaria", "unit": "bar",
     "min": 0, "max": 300, "gauge_type": "circular", "warn_above": 220, "alert_above": 250, "avl_id": 306},
    {"key": "oil_level_pct", "label": "Nivel aceite hidráulico", "unit": "%",
     "min": 0, "max": 100, "gauge_type": "linear", "warn_below": 20, "alert_below": 10, "avl_id": 307},
    {"key": "oil_temp_c", "label": "Temperatura aceite", "unit": "°C",
     "min": 0, "max": 120, "gauge_type": "circular", "warn_above": 80, "alert_above": 95, "avl_id": 308},
    {"key": "filter_pressure_bar", "label": "Presión filtro retorno", "unit": "bar",
     "min": 0, "max": 20, "gauge_type": "circular", "warn_above": 5, "alert_above": 8, "avl_id": 309},
    {"key": "cycle_count", "label": "Ciclos vaciado", "unit": "ciclos",
     "min": 0, "max": 9999, "gauge_type": "numeric", "avl_id": 310},
    {"key": "pto_active", "label": "PTO", "unit": None,
     "gauge_type": "led", "avl_id": 239},
]

SWEEPER_SENSORS = [
    {"key": "brush_speed_rpm", "label": "RPM cepillos", "unit": "rpm",
     "min": 0, "max": 1500, "gauge_type": "circular", "warn_above": 1200, "avl_id": 320},
    {"key": "water_level_pct", "label": "Nivel agua", "unit": "%",
     "min": 0, "max": 100, "gauge_type": "linear", "warn_below": 15, "avl_id": 321},
    {"key": "water_pressure_bar", "label": "Presión agua", "unit": "bar",
     "min": 0, "max": 15, "gauge_type": "circular", "warn_above": 10, "avl_id": 322},
    {"key": "work_speed_kmh", "label": "Velocidad trabajo", "unit": "km/h",
     "min": 0, "max": 25, "gauge_type": "circular", "avl_id": 323},
]

CISTERN_SENSORS = [
    {"key": "tank_level_pct", "label": "Nivel depósito", "unit": "%",
     "min": 0, "max": 100, "gauge_type": "linear", "warn_below": 10, "avl_id": 330},
    {"key": "pump_pressure_bar", "label": "Presión bomba descarga", "unit": "bar",
     "min": 0, "max": 20, "gauge_type": "circular", "warn_above": 15, "avl_id": 331},
    {"key": "flow_rate_lpm", "label": "Caudal", "unit": "L/min",
     "min": 0, "max": 500, "gauge_type": "numeric", "avl_id": 332},
]


async def run():
    engine = create_async_engine(settings.db_url, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as db:
        # Tenant CMG
        result = await db.execute(select(Tenant).where(Tenant.slug == "cmg"))
        cmg = result.scalar_one_or_none()
        if not cmg:
            cmg = Tenant(id=uuid.uuid4(), tier="cmg", name="CMG Metalhidráulica S.L.",
                         slug="cmg", active=True)
            db.add(cmg)
            await db.flush()
            print("Creado tenant CMG")

        # Usuario superadmin
        result = await db.execute(select(User).where(User.email == "admin@cmg.es"))
        if not result.scalar_one_or_none():
            admin = User(
                tenant_id=cmg.id, email="admin@cmg.es",
                hashed_password=hash_password("Admin2026!"),
                full_name="Administrador CMG", role="admin",
            )
            db.add(admin)
            print("Creado usuario admin@cmg.es / Admin2026!")

        # Vehicle types
        for slug, name, sensors in [
            ("vacuum", "Camión aspirador", VACUUM_SENSORS),
            ("sweeper", "Barredora municipal", SWEEPER_SENSORS),
            ("cistern", "Camión cisterna", CISTERN_SENSORS),
        ]:
            result = await db.execute(select(VehicleType).where(VehicleType.slug == slug))
            if not result.scalar_one_or_none():
                db.add(VehicleType(slug=slug, name=name, sensor_schema=sensors))
                print(f"Creado vehicle_type: {slug}")

        await db.commit()
    await engine.dispose()
    print("Seed completado.")


if __name__ == "__main__":
    asyncio.run(run())
```

- [ ] **Step 6.2: Ejecutar seed**

```bash
cd /opt/cmg-telematic1
docker compose run --rm core-api python -m app.seeds.initial
```

Salida esperada:
```
Creado tenant CMG
Creado usuario admin@cmg.es / Admin2026!
Creado vehicle_type: vacuum
Creado vehicle_type: sweeper
Creado vehicle_type: cistern
Seed completado.
```

- [ ] **Step 6.3: Test de login con el admin**

```bash
curl -s -X POST http://localhost:8010/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@cmg.es","password":"Admin2026!"}' | python3 -m json.tool
```

Salida esperada: JSON con `access_token`, `refresh_token`, `token_type: bearer`.

- [ ] **Step 6.4: Commit**

```bash
cd /opt/cmg-telematic1
git init
git add docker-compose.yml .env.example Caddyfile backend/
git commit -m "feat: foundations — docker, schema TimescaleDB, FastAPI auth, seed data"
```

---

## Task 7: ingest-svc — estructura y configuración

**Files:**
- Create: `services/ingest/pyproject.toml`
- Create: `services/ingest/Dockerfile`
- Create: `services/ingest/src/config.py`
- Create: `services/ingest/src/__init__.py`

- [ ] **Step 7.1: `services/ingest/pyproject.toml`**

```toml
# services/ingest/pyproject.toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.backends.legacy:build"

[project]
name = "cmg-ingest-svc"
version = "2.0.0"
requires-python = ">=3.12"
dependencies = [
    "asyncpg==0.29.0",
    "redis[asyncio]==5.1.1",
    "pydantic-settings==2.5.2",
]

[project.optional-dependencies]
dev = ["pytest==8.3.3", "pytest-asyncio==0.24.0"]
```

- [ ] **Step 7.2: `services/ingest/Dockerfile`**

```dockerfile
# services/ingest/Dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir -e .
COPY src/ ./src/
CMD ["python", "-m", "src.main"]
```

- [ ] **Step 7.3: `services/ingest/src/config.py`**

```python
# services/ingest/src/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    db_url: str
    redis_url: str
    tcp_host: str = "0.0.0.0"
    tcp_port: int = 5027
    environment: str = "development"


settings = Settings()
```

---

## Task 8: Codec 8 — decodificador del protocolo Teltonika

**Files:**
- Create: `services/ingest/src/codec8.py`
- Create: `tests/ingest/test_codec8.py`

- [ ] **Step 8.1: Test primero — `tests/ingest/test_codec8.py`**

```python
# tests/ingest/test_codec8.py
import pytest
from services.ingest.src.codec8 import decode_packet, AVLRecord

# Paquete Codec 8 real de un FMC650 (simplificado para tests)
# Estructura: preamble(4) + length(4) + codec_id(1) + num_records_1(1) +
#             avl_data + num_records_2(1) + crc(4)
SAMPLE_PACKET = bytes.fromhex(
    "00000000"          # preamble
    "00000025"          # data field length = 37 bytes
    "08"                # codec ID = 8
    "01"                # number of data 1 = 1 record
    # AVL record:
    "0000018D82B25E80"  # timestamp ms = 1689350000000 → 2023-07-14T20:13:20Z
    "00"                # priority = 0
    # GPS element (15 bytes):
    "0239C5B8"          # longitude = 37,290,424 → -0.3785... corregido
    "0178FB96"          # latitude = 24,969,110 → 39.473...
    "0064"              # altitude = 100m
    "00B4"              # angle = 180°
    "07"                # satellites = 7
    "0040"              # speed = 64 km/h
    # IO element:
    "00"                # event IO ID
    "02"                # total IOs = 2
    "01"                # 1-byte IOs count = 1
    "EF01"              # IO 239 (ignition) = 1
    "00"                # 2-byte IOs count = 0
    "00"                # 4-byte IOs count = 0
    "00"                # 8-byte IOs count = 0
    "01"                # number of data 2 = 1
    "D6B2FEAA"          # CRC-16/IBM
)


def test_decode_returns_list_of_avl_records():
    records = decode_packet(SAMPLE_PACKET)
    assert isinstance(records, list)
    assert len(records) == 1


def test_decode_timestamp():
    records = decode_packet(SAMPLE_PACKET)
    r = records[0]
    assert r.timestamp_ms == 1689350000000


def test_decode_gps():
    records = decode_packet(SAMPLE_PACKET)
    r = records[0]
    assert r.speed_kmh == 64
    assert r.heading == 180
    assert r.satellites == 7
    assert r.altitude_m == 100


def test_decode_ignition_io():
    records = decode_packet(SAMPLE_PACKET)
    r = records[0]
    assert r.io_elements.get(239) == 1  # ignition ON


def test_decode_invalid_preamble_raises():
    bad_packet = b"\x01\x00\x00\x00" + SAMPLE_PACKET[4:]
    with pytest.raises(ValueError, match="preamble"):
        decode_packet(bad_packet)


def test_decode_insufficient_data_raises():
    with pytest.raises(ValueError):
        decode_packet(b"\x00\x00\x00\x00\x00\x00\x00\x05")
```

- [ ] **Step 8.2: Ejecutar test para verificar que falla**

```bash
cd /opt/cmg-telematic1
pip install pytest pytest-asyncio -q --break-system-packages 2>/dev/null || true
python -m pytest tests/ingest/test_codec8.py -v 2>&1 | head -20
```

Salida esperada: `ImportError` o `ModuleNotFoundError` — el módulo no existe todavía.

- [ ] **Step 8.3: Implementar `services/ingest/src/codec8.py`**

```python
# services/ingest/src/codec8.py
"""
Decodificador del protocolo Teltonika Codec 8.

Formato del paquete:
  [0:4]   Preamble — siempre 0x00000000
  [4:8]   Data Field Length (uint32 big-endian) — bytes desde codec_id hasta CRC exclusive
  [8]     Codec ID — 0x08 para Codec 8
  [9]     Number of Data 1
  [10:N]  AVL Data records
  [N]     Number of Data 2 (debe coincidir con Number of Data 1)
  [N+1:N+5] CRC-16/IBM sobre bytes [8:N+1]

Cada AVL Data record:
  [0:8]   Timestamp (uint64, milisegundos epoch UTC)
  [8]     Priority (uint8) — 0=Low, 1=High, 2=Panic
  [9:24]  GPS Element (15 bytes)
  [24:]   IO Element

GPS Element (15 bytes):
  [0:4]   Longitude (int32, grados * 10^7, big-endian)
  [4:8]   Latitude  (int32, grados * 10^7, big-endian)
  [8:10]  Altitude  (int16, metros)
  [10:12] Angle     (uint16, grados, 0=Norte, 90=Este)
  [12]    Satellites (uint8)
  [13:15] Speed     (uint16, km/h)

IO Element (Codec 8):
  [0]     Event IO ID (uint8) — 0 si es un record periódico
  [1]     N of Total IO (uint8)
  [2]     N of 1-byte IOs
  [3:3+N*3]  pairs (IO_ID uint8, value uint8)
  ...continúa con 2-byte, 4-byte, 8-byte IOs
"""
import struct
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class AVLRecord:
    timestamp_ms: int
    priority: int
    longitude: float
    latitude: float
    altitude_m: int
    heading: int
    satellites: int
    speed_kmh: int
    event_io_id: int
    io_elements: dict = field(default_factory=dict)

    @property
    def datetime_utc(self) -> datetime:
        return datetime.fromtimestamp(self.timestamp_ms / 1000, tz=timezone.utc)


def decode_packet(data: bytes) -> list[AVLRecord]:
    """Decodifica un paquete Codec 8 completo. Devuelve lista de AVLRecord."""
    if len(data) < 10:
        raise ValueError("Paquete demasiado corto")

    preamble = struct.unpack_from(">I", data, 0)[0]
    if preamble != 0x00000000:
        raise ValueError(f"preamble inválido: {preamble:#010x}")

    data_length = struct.unpack_from(">I", data, 4)[0]
    if len(data) < 8 + data_length + 4:
        raise ValueError("Datos incompletos según data_length")

    codec_id = data[8]
    if codec_id != 0x08:
        raise ValueError(f"Codec ID no soportado: {codec_id:#04x} (esperado 0x08)")

    num_records = data[9]
    offset = 10
    records: list[AVLRecord] = []

    for _ in range(num_records):
        rec, offset = _decode_avl_record(data, offset)
        records.append(rec)

    num_records_2 = data[offset]
    if num_records_2 != num_records:
        raise ValueError(f"Mismatch registros: {num_records} vs {num_records_2}")

    return records


def _decode_avl_record(data: bytes, offset: int) -> tuple[AVLRecord, int]:
    """Decodifica un AVL record desde `offset`. Devuelve (record, nuevo_offset)."""
    timestamp_ms = struct.unpack_from(">Q", data, offset)[0]
    offset += 8

    priority = data[offset]
    offset += 1

    # GPS Element (15 bytes)
    lon_raw = struct.unpack_from(">i", data, offset)[0]
    lat_raw = struct.unpack_from(">i", data, offset + 4)[0]
    altitude_m = struct.unpack_from(">h", data, offset + 8)[0]
    heading = struct.unpack_from(">H", data, offset + 10)[0]
    satellites = data[offset + 12]
    speed_kmh = struct.unpack_from(">H", data, offset + 13)[0]
    offset += 15

    longitude = lon_raw / 1e7
    latitude = lat_raw / 1e7

    # IO Element
    event_io_id = data[offset]
    offset += 1
    _total_ios = data[offset]
    offset += 1

    io_elements: dict[int, int] = {}

    for io_size in (1, 2, 4, 8):
        count = data[offset]
        offset += 1
        fmt = {1: "B", 2: ">H", 4: ">I", 8: ">Q"}[io_size]
        for _ in range(count):
            io_id = data[offset]
            offset += 1
            (value,) = struct.unpack_from(fmt, data, offset)
            offset += io_size
            io_elements[io_id] = value

    return AVLRecord(
        timestamp_ms=timestamp_ms,
        priority=priority,
        longitude=longitude,
        latitude=latitude,
        altitude_m=altitude_m,
        heading=heading,
        satellites=satellites,
        speed_kmh=speed_kmh,
        event_io_id=event_io_id,
        io_elements=io_elements,
    ), offset


def build_ack(num_records: int) -> bytes:
    """Construye el ACK que el servidor devuelve al dispositivo."""
    return struct.pack(">I", num_records)
```

- [ ] **Step 8.4: Ejecutar tests del codec**

```bash
cd /opt/cmg-telematic1
PYTHONPATH=/opt/cmg-telematic1 python -m pytest tests/ingest/test_codec8.py -v
```

Salida esperada: 5 tests PASSED.

---

## Task 9: ingest-svc — TCP server + writer + publisher

**Files:**
- Create: `services/ingest/src/server.py`
- Create: `services/ingest/src/writer.py`
- Create: `services/ingest/src/publisher.py`
- Create: `services/ingest/src/main.py`

- [ ] **Step 9.1: `services/ingest/src/writer.py`**

```python
# services/ingest/src/writer.py
"""
Escribe registros telemetría en TimescaleDB via asyncpg (directo, no ORM).
Más rendimiento que SQLAlchemy para inserciones de alta frecuencia.
"""
import asyncpg
import logging
from datetime import datetime, timezone
from src.codec8 import AVLRecord

logger = logging.getLogger(__name__)

# AVL IDs estándar que mapeamos a columnas fijas
AVL_IGNITION = 239    # 1 = encendido, 0 = apagado
AVL_EXT_VOLTAGE = 66  # mV batería externa (2-byte IO)
AVL_PTO = 179         # PTO activo (1-byte IO) — ajustar según configuración FMC650


async def write_record(
    conn: asyncpg.Connection,
    avl: AVLRecord,
    device_id: str,
    vehicle_id: str,
    tenant_id: str,
) -> None:
    """Inserta un AVLRecord en telemetry_record."""
    ts = avl.datetime_utc

    ignition = bool(avl.io_elements.get(AVL_IGNITION, 0))
    pto_active = bool(avl.io_elements.get(AVL_PTO, 0))
    ext_voltage_mv = avl.io_elements.get(AVL_EXT_VOLTAGE)

    # Todo lo demás del IO va a can_data JSONB
    known_avl_ids = {AVL_IGNITION, AVL_PTO, AVL_EXT_VOLTAGE}
    can_data = {
        f"avl_{io_id}": value
        for io_id, value in avl.io_elements.items()
        if io_id not in known_avl_ids
    } or None

    await conn.execute("""
        INSERT INTO telemetry_record
            (time, device_id, vehicle_id, tenant_id,
             lat, lon, speed_kmh, heading, altitude_m,
             ignition, pto_active, ext_voltage_mv, can_data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT DO NOTHING
    """,
        ts, device_id, vehicle_id, tenant_id,
        avl.latitude if avl.latitude != 0 else None,
        avl.longitude if avl.longitude != 0 else None,
        float(avl.speed_kmh),
        avl.heading, avl.altitude_m,
        ignition, pto_active, ext_voltage_mv,
        can_data,
    )


async def get_device_info(
    conn: asyncpg.Connection, imei: str
) -> dict | None:
    """Devuelve {device_id, vehicle_id, tenant_id} para un IMEI. None si no existe."""
    row = await conn.fetchrow("""
        SELECT d.id AS device_id, d.vehicle_id, v.tenant_id
        FROM device d
        JOIN vehicle v ON v.id = d.vehicle_id
        WHERE d.imei = $1 AND d.active = true AND v.active = true
    """, imei)
    if not row:
        return None
    return {
        "device_id": str(row["device_id"]),
        "vehicle_id": str(row["vehicle_id"]),
        "tenant_id": str(row["tenant_id"]),
    }


async def update_device_online(
    conn: asyncpg.Connection, imei: str, online: bool
) -> None:
    await conn.execute("""
        UPDATE device SET online=$1, last_seen=now() WHERE imei=$2
    """, online, imei)
```

- [ ] **Step 9.2: `services/ingest/src/publisher.py`**

```python
# services/ingest/src/publisher.py
"""
Publica registros en Redis Stream 'telemetry.raw'.
Los consumers (rules-engine) leen desde este stream.
"""
import json
import logging
from redis.asyncio import Redis
from src.codec8 import AVLRecord

logger = logging.getLogger(__name__)
STREAM_KEY = "telemetry.raw"
MAX_STREAM_LEN = 100_000  # máximo de mensajes en el stream (circular buffer)


async def publish_record(
    redis: Redis,
    avl: AVLRecord,
    device_id: str,
    vehicle_id: str,
    tenant_id: str,
) -> None:
    """Publica un AVL record al stream Redis. Non-blocking."""
    payload = {
        "time": avl.datetime_utc.isoformat(),
        "device_id": device_id,
        "vehicle_id": vehicle_id,
        "tenant_id": tenant_id,
        "lat": avl.latitude,
        "lon": avl.longitude,
        "speed_kmh": avl.speed_kmh,
        "heading": avl.heading,
        "altitude_m": avl.altitude_m,
        "ignition": avl.io_elements.get(239, 0),
        "pto_active": avl.io_elements.get(179, 0),
        "ext_voltage_mv": avl.io_elements.get(66),
        "can_data": {
            f"avl_{k}": v for k, v in avl.io_elements.items()
            if k not in {239, 179, 66}
        },
    }
    await redis.xadd(
        STREAM_KEY,
        {"payload": json.dumps(payload)},
        maxlen=MAX_STREAM_LEN,
        approximate=True,
    )
```

- [ ] **Step 9.3: `services/ingest/src/server.py`**

```python
# services/ingest/src/server.py
"""
TCP server asyncio para dispositivos Teltonika FMC650.
Protocolo: Codec 8. Cada conexión es un dispositivo.

Flujo por conexión:
  1. Recibir IMEI (2 bytes longitud + N bytes ASCII)
  2. Responder 0x01 (ACK IMEI)
  3. Loop: recibir paquete Codec 8 → decodificar → escribir DB → publicar Redis → enviar ACK
  4. Si el IMEI no está registrado, cerrar conexión
"""
import asyncio
import asyncpg
import logging
import struct
from redis.asyncio import Redis
from src.codec8 import decode_packet, build_ack
from src.writer import write_record, get_device_info, update_device_online
from src.publisher import publish_record
from src.config import settings

logger = logging.getLogger(__name__)


class TeltonikaConnection:
    def __init__(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
        db_pool: asyncpg.Pool,
        redis: Redis,
    ):
        self.reader = reader
        self.writer = writer
        self.db_pool = db_pool
        self.redis = redis
        self.imei: str | None = None
        self.device_info: dict | None = None
        self.peer = writer.get_extra_info("peername")

    async def handle(self) -> None:
        logger.info("Conexión nueva desde %s", self.peer)
        try:
            await self._handshake()
            if not self.device_info:
                return
            await self._receive_loop()
        except (asyncio.IncompleteReadError, ConnectionResetError):
            logger.info("Conexión cerrada por dispositivo %s", self.imei or self.peer)
        except Exception as e:
            logger.error("Error en conexión %s: %s", self.peer, e)
        finally:
            if self.imei:
                async with self.db_pool.acquire() as conn:
                    await update_device_online(conn, self.imei, False)
            self.writer.close()

    async def _handshake(self) -> None:
        """Lee el IMEI y responde ACK 0x01."""
        imei_len_bytes = await self.reader.readexactly(2)
        imei_len = struct.unpack(">H", imei_len_bytes)[0]
        imei_bytes = await self.reader.readexactly(imei_len)
        self.imei = imei_bytes.decode("ascii")
        logger.info("IMEI recibido: %s", self.imei)

        async with self.db_pool.acquire() as conn:
            self.device_info = await get_device_info(conn, self.imei)

        if not self.device_info:
            logger.warning("IMEI no registrado: %s — rechazando conexión", self.imei)
            self.writer.write(b"\x00")  # NACK
            await self.writer.drain()
            return

        self.writer.write(b"\x01")  # ACK
        await self.writer.drain()
        logger.info("IMEI aceptado: %s → vehicle %s", self.imei, self.device_info["vehicle_id"])

        async with self.db_pool.acquire() as conn:
            await update_device_online(conn, self.imei, True)

    async def _receive_loop(self) -> None:
        """Recibe paquetes Codec 8 en bucle hasta que la conexión se cierre."""
        while True:
            # Paquete: preamble(4) + length(4) + data + crc(4)
            header = await self.reader.readexactly(8)
            data_length = struct.unpack_from(">I", header, 4)[0]
            body = await self.reader.readexactly(data_length + 4)  # +4 para CRC
            packet = header + body

            try:
                records = decode_packet(packet)
            except ValueError as e:
                logger.error("Paquete inválido de %s: %s", self.imei, e)
                continue

            async with self.db_pool.acquire() as conn:
                for avl in records:
                    await write_record(
                        conn, avl,
                        self.device_info["device_id"],
                        self.device_info["vehicle_id"],
                        self.device_info["tenant_id"],
                    )
                    await publish_record(
                        self.redis, avl,
                        self.device_info["device_id"],
                        self.device_info["vehicle_id"],
                        self.device_info["tenant_id"],
                    )

            ack = build_ack(len(records))
            self.writer.write(ack)
            await self.writer.drain()
            logger.debug("Procesados %d registros de %s", len(records), self.imei)


async def run_server(db_pool: asyncpg.Pool, redis: Redis) -> None:
    server = await asyncio.start_server(
        lambda r, w: TeltonikaConnection(r, w, db_pool, redis).handle(),
        host=settings.tcp_host,
        port=settings.tcp_port,
        limit=1024 * 1024,  # buffer 1MB por conexión
    )
    addr = server.sockets[0].getsockname()
    logger.info("TCP Teltonika escuchando en %s:%s", *addr)
    async with server:
        await server.serve_forever()
```

- [ ] **Step 9.4: `services/ingest/src/main.py`**

```python
# services/ingest/src/main.py
import asyncio
import logging
import asyncpg
from redis.asyncio import Redis
from src.config import settings
from src.server import run_server

logging.basicConfig(
    level=logging.DEBUG if settings.environment == "development" else logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)


async def main() -> None:
    logger.info("Iniciando ingest-svc...")

    db_pool = await asyncpg.create_pool(
        dsn=settings.db_url.replace("+asyncpg", ""),
        min_size=5,
        max_size=20,
    )
    redis = Redis.from_url(settings.redis_url, decode_responses=True)

    try:
        await run_server(db_pool, redis)
    finally:
        await db_pool.close()
        await redis.aclose()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 9.5: Construir y arrancar ingest-svc**

```bash
cd /opt/cmg-telematic1
docker compose build ingest-svc
docker compose up -d ingest-svc
docker compose logs ingest-svc
```

Salida esperada: `TCP Teltonika escuchando en 0.0.0.0:5027`

---

## Task 10: Test de integración end-to-end

**Files:**
- Create: `tests/ingest/test_ingest_integration.py`
- Create: `tests/ingest/conftest.py`

- [ ] **Step 10.1: `tests/ingest/conftest.py`**

```python
# tests/ingest/conftest.py
import pytest
import asyncio

@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()
```

- [ ] **Step 10.2: `tests/ingest/test_ingest_integration.py`**

```python
# tests/ingest/test_ingest_integration.py
"""
Test de integración: simula un FMC650 conectándose al ingest-svc.
Requiere que docker compose esté corriendo con postgres + redis + ingest-svc.

Antes de ejecutar, registrar un dispositivo de prueba en la BD:
  INSERT INTO device (id, imei, model) VALUES (gen_random_uuid(), '000000000000001', 'FMC650_TEST');
"""
import asyncio
import struct
import pytest

INGEST_HOST = "localhost"
INGEST_PORT = 5027
TEST_IMEI = "000000000000001"


def build_imei_packet(imei: str) -> bytes:
    encoded = imei.encode("ascii")
    return struct.pack(">H", len(encoded)) + encoded


def build_codec8_packet() -> bytes:
    """Construye un paquete Codec 8 mínimo con 1 registro."""
    import time
    ts_ms = int(time.time() * 1000)

    # AVL record: timestamp + priority + GPS + IO
    avl = struct.pack(">Q", ts_ms)          # timestamp
    avl += b"\x00"                           # priority low
    avl += struct.pack(">i", -3785000)       # longitude: -0.3785 * 1e7
    avl += struct.pack(">i", 394730000)      # latitude:  39.473 * 1e7
    avl += struct.pack(">h", 50)             # altitude 50m
    avl += struct.pack(">H", 0)             # angle 0
    avl += b"\x06"                           # 6 satellites
    avl += struct.pack(">H", 30)            # 30 km/h
    # IO: 1 IO de 1 byte (ignition=1)
    avl += b"\x00"                           # event IO ID
    avl += b"\x01"                           # total IOs
    avl += b"\x01"                           # count 1-byte IOs
    avl += b"\xef\x01"                       # IO 239 = 1 (ignition on)
    avl += b"\x00\x00\x00"                  # 2,4,8-byte IOs = 0 each

    data = b"\x08"  # codec ID
    data += b"\x01"  # num records 1
    data += avl
    data += b"\x01"  # num records 2

    # CRC placeholder — FMC650 real calcula CRC-16/IBM
    # En este test aceptamos CRC=0 ya que no validamos CRC en el decoder
    length = struct.pack(">I", len(data))
    preamble = b"\x00\x00\x00\x00"
    crc = b"\x00\x00\x00\x00"
    return preamble + length + data + crc


@pytest.mark.asyncio
async def test_ingest_accepts_registered_imei():
    """El servidor acepta el IMEI y responde 0x01."""
    reader, writer = await asyncio.open_connection(INGEST_HOST, INGEST_PORT)
    writer.write(build_imei_packet(TEST_IMEI))
    await writer.drain()
    response = await asyncio.wait_for(reader.readexactly(1), timeout=5.0)
    assert response == b"\x01", f"Esperaba ACK 0x01, recibí {response.hex()}"
    writer.close()
    await writer.wait_closed()


@pytest.mark.asyncio
async def test_ingest_rejects_unknown_imei():
    """El servidor rechaza IMEIs no registrados con 0x00."""
    reader, writer = await asyncio.open_connection(INGEST_HOST, INGEST_PORT)
    writer.write(build_imei_packet("999999999999999"))
    await writer.drain()
    response = await asyncio.wait_for(reader.readexactly(1), timeout=5.0)
    assert response == b"\x00", f"Esperaba NACK 0x00, recibí {response.hex()}"
    writer.close()
    await writer.wait_closed()
```

- [ ] **Step 10.3: Registrar dispositivo de prueba en BD**

```bash
docker compose exec postgres psql -U cmg -d cmg_telematics -c "
-- Requiere que exista un vehicle primero. Creamos uno de prueba.
DO \$\$
DECLARE
  v_tenant_id UUID;
  v_type_id UUID;
  v_vehicle_id UUID := gen_random_uuid();
BEGIN
  SELECT id INTO v_tenant_id FROM tenant WHERE slug = 'cmg';
  SELECT id INTO v_type_id FROM vehicle_type WHERE slug = 'vacuum';
  INSERT INTO vehicle (id, tenant_id, vehicle_type_id, name, license_plate)
    VALUES (v_vehicle_id, v_tenant_id, v_type_id, 'TEST-001', 'TEST-001');
  INSERT INTO device (id, vehicle_id, imei, model)
    VALUES (gen_random_uuid(), v_vehicle_id, '000000000000001', 'FMC650');
END\$\$;
"
```

- [ ] **Step 10.4: Ejecutar tests de integración**

```bash
cd /opt/cmg-telematic1
PYTHONPATH=/opt/cmg-telematic1 python -m pytest tests/ingest/ -v
```

Salida esperada: todos los tests PASSED.

- [ ] **Step 10.5: Verificar datos en TimescaleDB**

```bash
docker compose exec postgres psql -U cmg -d cmg_telematics \
  -c "SELECT time, vehicle_id, speed_kmh, ignition FROM telemetry_record ORDER BY time DESC LIMIT 5;"
```

Salida esperada: filas con datos del test de integración.

- [ ] **Step 10.6: Verificar stream Redis**

```bash
docker compose exec redis redis-cli -a changeme_redis \
  XLEN telemetry.raw
```

Salida esperada: número > 0.

- [ ] **Step 10.7: Commit final del Plan 1**

```bash
cd /opt/cmg-telematic1
git add services/ tests/ backend/app/seeds/ backend/alembic/
git commit -m "feat: ingest-svc Codec 8 TCP + TimescaleDB writer + Redis Stream publisher"
```

---

## Auto-revisión del plan

**Spec coverage:**
- ✅ Docker + infraestructura base
- ✅ Schema completo TimescaleDB con hypertable + continuous aggregate
- ✅ Permisos en cascada (tabla creada, validación en Plan 2)
- ✅ JWT auth (login + refresh)
- ✅ Seed data (CMG tenant, admin, 3 vehicle types con sensor_schema)
- ✅ Codec 8 decoder con tests
- ✅ TCP server asyncio con handshake IMEI
- ✅ TimescaleDB writer (asyncpg directo)
- ✅ Redis Stream publisher
- ✅ Test e2e

**Pendiente para Plan 2:** core-api REST completo, rules-engine, notify-svc, WebSocket.

**Pendiente para Plan 3:** frontend React + gauges + rule builder.
