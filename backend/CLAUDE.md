# Agente Backend — FastAPI + PostgreSQL/TimescaleDB + Redis

## Contexto

Eres el agente especialista del backend de CMG Telematics.
Directorio: `/opt/cmg-telematics/backend/`
Entorno Python: `/opt/cmg-telematics/backend/venv/`
Servicio systemd: `cmg-telematics` → puerto **8010** (API) + puerto **5027** (TCP Teltonika)

## Stack real instalado

```
fastapi==0.115.6
uvicorn[standard]==0.32.1   # con uvloop event loop
sqlalchemy[asyncio]==2.0.36
asyncpg==0.30.0
alembic==1.14.0
pydantic-settings==2.7.0
pydantic==2.10.4
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
redis[asyncio]==5.2.1
celery==5.4.0
httpx==0.28.1
python-multipart==0.0.20
aiomqtt==2.3.0
```

## Infraestructura real del VPS

- **PostgreSQL 16 nativo** (NO Docker) en localhost:5432, con extensión TimescaleDB
- **Redis nativo** (NO Docker) en localhost:6379, DB=2
- **Mosquitto MQTT** en Docker, puertos 1883/9001

## Arranque del backend

El servidor TCP de Teltonika arranca como asyncio.Task en el startup de FastAPI:

```python
# app/main.py — patrón exacto a seguir
from contextlib import asynccontextmanager
from fastapi import FastAPI
import asyncio
from app.services.teltonika.tcp_server import TeltonikaServer
from app.core.database import init_db

teltonika_server = TeltonikaServer()

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    tcp_task = asyncio.create_task(teltonika_server.start())
    yield
    tcp_task.cancel()

app = FastAPI(title="CMG Telematics API", lifespan=lifespan)
```

## Comandos de desarrollo

```bash
cd /opt/cmg-telematics/backend
source venv/bin/activate

# Arrancar en desarrollo (con reload)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Migraciones
alembic revision --autogenerate -m "descripcion"
alembic upgrade head
alembic downgrade -1

# Ver SQL generado sin ejecutar
alembic upgrade head --sql

# Seed de datos piloto
python scripts/seed_pilot.py

# Tests
pytest tests/ -v
pytest tests/test_api.py -v -k "test_login"
```

## Patrones obligatorios

### Settings (nunca leer .env directamente)
```python
# app/core/config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    redis_url: str
    tcp_port: int = 5027
    tcp_host: str = "0.0.0.0"
    secret_key: str
    access_token_expire_minutes: int = 60
    environment: str = "pilot"
    cors_origins: list[str] = ["*"]

    class Config:
        env_file = "/opt/cmg-telematics/.env"

settings = Settings()
```

### DB Session (siempre dependency injection)
```python
# app/core/database.py
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

engine = create_async_engine(settings.database_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session

# En endpoints:
async def mi_endpoint(db: AsyncSession = Depends(get_db)):
    ...
```

### Multi-tenant security (CRÍTICO — nunca saltarse esto)
```python
# Todos los queries deben filtrar por tenant del usuario autenticado
# Patrón:
result = await db.execute(
    select(Vehicle)
    .where(Vehicle.tenant_id == current_user.tenant_id)
    .where(Vehicle.active == True)
)
# NUNCA: select(Vehicle) sin filtro tenant
```

## Estructura de respuestas API

```python
# Siempre usar schemas Pydantic para request/response
# Nunca devolver modelos ORM directamente

# Respuesta estándar lista
class VehicleListResponse(BaseModel):
    items: list[VehicleSchema]
    total: int
    page: int
    per_page: int

# Respuesta error estándar
class ErrorResponse(BaseModel):
    detail: str
    code: str  # "VEHICLE_NOT_FOUND", "DEVICE_OFFLINE", etc.
```

## Health check obligatorio

```python
@app.get("/health")
async def health(db: AsyncSession = Depends(get_db)):
    # Verificar DB
    await db.execute(text("SELECT 1"))
    # Verificar TCP server
    tcp_ok = teltonika_server.is_running
    # Verificar Redis
    redis_ok = await redis_client.ping()
    return {
        "status": "ok",
        "tcp_server": "running" if tcp_ok else "stopped",
        "db": "ok",
        "redis": "ok" if redis_ok else "error",
        "active_devices": len(teltonika_server.active_connections)
    }
```
