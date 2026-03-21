# Agente API REST — Endpoints, Auth y Permisos

## Rol

Especialista en los endpoints FastAPI de CMG Telematics.
Directorio: `/opt/cmg-telematics/backend/app/api/`

## Sistema de permisos

La jerarquía es CMG → Fabricante → Cliente Final → Conductor.
Cada rol tiene acceso a un subconjunto de endpoints y datos.

```python
# Matriz de permisos por rol
ROLE_PERMISSIONS = {
    "superadmin": ["*"],                          # CMG — todo
    "admin": [                                     # Fabricante — gestiona sus clientes
        "vehicles:read", "vehicles:write",
        "users:read", "users:write",
        "telemetry:read",
        "commands:send",
        "variable_map:read", "variable_map:write",
        "alerts:read", "alerts:write",
    ],
    "operator": [                                  # Cliente final — gestiona su flota
        "vehicles:read",
        "telemetry:read",
        "commands:send",
        "alerts:read",
    ],
    "viewer": [                                    # Solo lectura
        "vehicles:read",
        "telemetry:read",
        "alerts:read",
    ],
    "driver": [                                    # Solo su vehículo asignado
        "vehicles:read_own",
        "telemetry:read_own",
    ],
}
```

## Dependencias de autenticación

```python
# app/core/security.py

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

bearer = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db)
) -> User:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        user_id = UUID(payload["sub"])
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido")

    user = await db.get(User, user_id)
    if not user or not user.active:
        raise HTTPException(status_code=401, detail="Usuario no encontrado")
    return user

def require_role(*roles: str):
    async def check(user: User = Depends(get_current_user)):
        if user.role not in roles and "superadmin" not in roles:
            raise HTTPException(status_code=403, detail="Sin permisos")
        return user
    return check
```

## Endpoints a implementar

### Auth
```
POST /api/v1/auth/login
  Body: {"email": str, "password": str}
  Response: {"access_token": str, "token_type": "bearer", "user": UserSchema}

POST /api/v1/auth/refresh
  Header: Authorization: Bearer <token>
  Response: {"access_token": str}

GET /api/v1/auth/me
  Response: UserSchema con tenant info
```

### Dashboard (agregados para la pantalla principal)
```
GET /api/v1/dashboard/fleet
  Response: lista de vehículos del tenant con último estado
  [{
    "vehicle_id": uuid,
    "vehicle_name": str,
    "device_imei": str,
    "online": bool,
    "last_seen": datetime,
    "lat": float, "lng": float,
    "speed": int,
    "ignition": bool,
    "pressure_bar": float | null,    # ain1 convertido con variable_map
    "dout1": bool, "dout2": bool,
    "active_alerts": int
  }]
```

### Vehículos
```
GET    /api/v1/vehicles                  → lista (paginada)
POST   /api/v1/vehicles                  → crear (role: admin)
GET    /api/v1/vehicles/{id}             → detalle
PUT    /api/v1/vehicles/{id}             → editar (role: admin)
DELETE /api/v1/vehicles/{id}             → desactivar (role: admin)
GET    /api/v1/vehicles/{id}/last        → último registro telemetría
GET    /api/v1/vehicles/{id}/telemetry   → histórico
  Query params: hours=24, bucket_minutes=5, variables=["ain1_mv","dout1"]
```

### Telemetría
```
GET /api/v1/telemetry/{device_id}/history
  Query: start, end, bucket_minutes=5
  Response: serie temporal con time_bucket

GET /api/v1/telemetry/{device_id}/stats
  Query: hours=24
  Response: {
    "total_activations_dout1": int,
    "hours_ignition_on": float,
    "max_pressure_bar": float,
    "avg_speed_kmh": float,
    "distance_km": float
  }
```

### Comandos remotos
```
POST /api/v1/commands/send
  Body: {
    "imei": str,
    "output": "DOUT1" | "DOUT2" | "DOUT3" | "DOUT4",
    "value": bool,
    "duration_seconds": int = 0
  }
  Response: {"command_id": uuid, "status": "sent" | "device_offline"}
  Roles: operator, admin, superadmin

GET /api/v1/commands/{command_id}
  Response: CommandLog con status actualizado

GET /api/v1/commands/history
  Query: vehicle_id, limit=50
  Response: lista de CommandLog
```

### Configuración variables (solo fabricante/CMG)
```
GET  /api/v1/variables                   → mapa de variables del tenant
POST /api/v1/variables                   → crear variable
PUT  /api/v1/variables/{id}             → editar
DELETE /api/v1/variables/{id}           → borrar
```

## Schemas Pydantic — convenciones

```python
# Siempre 3 schemas por modelo: Create, Update, Response
class VehicleCreate(BaseModel):
    name: str
    plate: str | None = None
    model: str | None = None

class VehicleUpdate(BaseModel):
    name: str | None = None
    plate: str | None = None
    active: bool | None = None

class VehicleResponse(BaseModel):
    id: UUID
    name: str
    plate: str | None
    online: bool
    last_seen: datetime | None

    model_config = ConfigDict(from_attributes=True)
```

## Manejo de errores estándar

```python
# Siempre usar estos códigos de error en el campo "code"
ERROR_CODES = {
    "VEHICLE_NOT_FOUND": 404,
    "DEVICE_OFFLINE": 409,       # dispositivo no conectado para recibir comando
    "DEVICE_NOT_FOUND": 404,
    "PERMISSION_DENIED": 403,
    "INVALID_CREDENTIALS": 401,
    "TENANT_MISMATCH": 403,      # intento de acceder a datos de otro tenant
    "COMMAND_FAILED": 500,
}

# Uso:
raise HTTPException(
    status_code=409,
    detail={"code": "DEVICE_OFFLINE", "message": f"El dispositivo {imei} no está conectado"}
)
```

## Tests de API

```bash
# Ejecutar todos
pytest tests/test_api.py -v

# Test específico
pytest tests/test_api.py::test_send_command_device_offline -v

# Con coverage
pytest tests/test_api.py --cov=app/api --cov-report=term-missing
```
