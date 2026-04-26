# Sistema de Log de Comandos DOUT

## Fecha de implementación
2026-04-26

## Resumen de cambios

### TAREA 1 — Backend

#### Modelo
- **`backend/app/models/command_log.py`** (nuevo)
  - Tabla `command_log` con campos: `id`, `device_id`, `vehicle_id`, `tenant_id`, `command`, `status`, `sent_at`, `response`, `error_message`
  - FK en cascada a `device`, `vehicle`, `tenant`

#### Migración
- **`backend/alembic/versions/013_command_log.py`** (nuevo)
  - Crea tabla `command_log`
  - Índices en `vehicle_id`, `device_id`, `sent_at`

#### Endpoints
- **`backend/app/api/v1/commands.py`** (nuevo)
  - `GET /api/v1/vehicles/{vehicle_id}/commands?limit=50` — historial por vehículo (auth requerida)
  - `GET /api/v1/devices/{device_id}/commands?limit=50` — historial por dispositivo (auth requerida)
  - `POST /internal/commands/log` — registro de comando desde ingest-svc (sin auth, solo red interna Docker)
  - `PATCH /internal/commands/{log_id}/confirm` — confirmar con ACK del dispositivo (sin auth)

#### Router
- **`backend/app/api/v1/router.py`**: incluido `commands_router`
- **`backend/app/main.py`**: incluido `internal_router` con prefijo `/internal`

#### vehicles.py
- **`backend/app/api/v1/vehicles.py`** — endpoint `POST /vehicles/{id}/dout`:
  - El mensaje Redis ahora incluye `device_id`, `vehicle_id`, `tenant_id` para que el ingest-svc pueda loguear sin consultar la BD

### TAREA 2 — Ingest-svc

- **`services/ingest/pyproject.toml`**: añadido `httpx==0.27.2`
- **`services/ingest/src/config.py`**: añadido `core_api_url = "http://core-api:8010"`
- **`services/ingest/src/server.py`**: 
  - Nuevas funciones `_log_command()` y `_confirm_command()` (httpx async al core-api)
  - `command_listener`: cuando el dispositivo está conectado → `status=sent` + guarda `command:{imei}:last_log_id` en Redis (TTL 120s)
  - `command_listener`: cuando el dispositivo no está conectado → `status=failed` con `error_message="Dispositivo no conectado"`
  - `_receive_loop`: al recibir Codec 12 ACK → lee `command:{imei}:last_log_id` de Redis y actualiza a `status=confirmed` con el texto del ACK

### TAREA 3 — Frontend

- **`frontend/src/lib/types.ts`**: añadida interface `CommandLogEntry`
- **`frontend/src/lib/queryKeys.ts`**: añadida clave `vehicleCommands`
- **`frontend/src/features/vehicle/VehicleDetailPage.tsx`**:
  - Query `commandHistory` con `refetchInterval: 30_000` y `limit=10`
  - Sección "HISTORIAL DE COMANDOS" en panel inferior: tabla de últimos 10 comandos
  - Columnas: fecha/hora, comando (monospace), respuesta/error, badge de estado
  - Nuevo componente `CommandStatusBadge`: badge de color por estado (`pending`=gris, `sent`=azul, `failed`=rojo, `confirmed`=verde)

## Despliegue requerido

Para activar estos cambios en producción:

```bash
# 1. Aplicar migración de BD
sudo docker exec cmg-telematic1-core-api-1 alembic upgrade head

# 2. Reconstruir core-api (nuevos endpoints)
sudo docker-compose build core-api
sudo docker-compose up -d core-api

# 3. Reconstruir ingest-svc (httpx nuevo + lógica de log)
sudo docker-compose build ingest-svc
sudo docker-compose up -d ingest-svc

# 4. Reconstruir frontend (nuevos componentes)
sudo docker-compose build frontend
sudo docker-compose up -d frontend
```

## Flujo completo de un comando DOUT

```
Frontend → POST /api/v1/vehicles/{id}/dout
  ↓
core-api: construye comando + guarda Redis state + publica Redis PubSub
  (ahora incluye device_id/vehicle_id/tenant_id en el mensaje)
  ↓
ingest-svc command_listener recibe el mensaje
  ├─ Dispositivo conectado:
  │    → envía Codec 12 al FMC650
  │    → POST /internal/commands/log (status=sent)
  │    → guarda command:{imei}:last_log_id en Redis (TTL 120s)
  │    → FMC650 responde con Codec 12 ACK
  │    → _receive_loop detecta ACK
  │    → PATCH /internal/commands/{log_id}/confirm (status=confirmed, response=texto ACK)
  │
  └─ Dispositivo no conectado:
       → POST /internal/commands/log (status=failed, error_message=Dispositivo no conectado)
```
