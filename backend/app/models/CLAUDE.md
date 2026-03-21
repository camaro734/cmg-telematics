# Agente Base de Datos — TimescaleDB + SQLAlchemy

## Rol

Especialista en el esquema de datos de CMG Telematics y en queries
eficientes sobre series temporales con TimescaleDB.

Directorio: `/opt/cmg-telematics/backend/app/models/`

## Regla de oro

`telemetry_record` puede tener millones de filas. Nunca hacer un query
sin filtro `time` acotado. Siempre usar `time_bucket()` para agregaciones.
Un query sin filtro de tiempo tumba el VPS.

## Esquema completo

```python
# models/tenant.py
class Tenant(Base):
    __tablename__ = "tenant"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(20))   # 'cmg' | 'manufacturer' | 'end_client'
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tenant.id"))
    slug: Mapped[str] = mapped_column(String(100), unique=True)
    active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

# models/user.py
class User(Base):
    __tablename__ = "user"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20))
    # 'superadmin' | 'admin' | 'operator' | 'viewer' | 'driver'
    full_name: Mapped[str] = mapped_column(String(200))
    active: Mapped[bool] = mapped_column(default=True)

# models/vehicle.py
class Vehicle(Base):
    __tablename__ = "vehicle"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"))
    manufacturer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"))
    name: Mapped[str] = mapped_column(String(200))
    plate: Mapped[str | None] = mapped_column(String(20))
    model: Mapped[str | None] = mapped_column(String(100))
    active: Mapped[bool] = mapped_column(default=True)

# models/device.py
class Device(Base):
    __tablename__ = "device"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicle.id"))
    imei: Mapped[str] = mapped_column(String(15), unique=True, index=True)
    firmware_version: Mapped[str | None] = mapped_column(String(20))
    last_seen: Mapped[datetime | None]
    last_lat: Mapped[float | None]
    last_lng: Mapped[float | None]
    last_speed: Mapped[int | None]
    online: Mapped[bool] = mapped_column(default=False)

# models/telemetry.py — HYPERTABLE (no añadir índices manuales a 'time')
class TelemetryRecord(Base):
    __tablename__ = "telemetry_record"
    # Clave compuesta para hypertable
    time: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), primary_key=True)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("device.id"), primary_key=True)
    # GPS
    lat: Mapped[float | None]
    lng: Mapped[float | None]
    altitude: Mapped[int | None]
    speed: Mapped[int | None]
    satellites: Mapped[int | None]
    angle: Mapped[int | None]
    # Estado vehículo
    ignition: Mapped[bool | None]
    ext_voltage_mv: Mapped[int | None]
    battery_mv: Mapped[int | None]
    gsm_signal: Mapped[int | None]
    # IO proceso industrial (todos los IO IDs raw)
    io_data: Mapped[dict | None] = mapped_column(JSONB)
    # Entradas/salidas digitales explícitas (para queries rápidas)
    dout1: Mapped[bool | None]
    dout2: Mapped[bool | None]
    dout3: Mapped[bool | None]
    dout4: Mapped[bool | None]
    din1: Mapped[bool | None]
    din2: Mapped[bool | None]
    din3: Mapped[bool | None]
    din4: Mapped[bool | None]
    # Entradas analógicas (en mV raw — la conversión la hace la app según variable_map)
    ain1_mv: Mapped[int | None]
    ain2_mv: Mapped[int | None]
    ain3_mv: Mapped[int | None]

# models/variable_map.py
class VariableMap(Base):
    __tablename__ = "variable_map"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    manufacturer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"))
    vehicle_model: Mapped[str | None] = mapped_column(String(100))  # None = aplica a todos
    io_key: Mapped[str] = mapped_column(String(20))    # "ain1_mv", "io_300", "dout1"
    display_name: Mapped[str] = mapped_column(String(200))
    unit: Mapped[str] = mapped_column(String(20))
    scale_factor: Mapped[float] = mapped_column(default=1.0)
    offset: Mapped[float] = mapped_column(default=0.0)
    min_value: Mapped[float | None]
    max_value: Mapped[float | None]
    alert_low: Mapped[float | None]
    alert_high: Mapped[float | None]
    data_type: Mapped[str] = mapped_column(String(20), default="gauge")
    # 'gauge' | 'counter' | 'boolean' | 'hours'

# models/command_log.py
class CommandLog(Base):
    __tablename__ = "command_log"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("device.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id"))
    command_type: Mapped[str] = mapped_column(String(50))
    command_payload: Mapped[dict] = mapped_column(JSONB)
    raw_command: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    sent_at: Mapped[datetime | None]
    confirmed_at: Mapped[datetime | None]
    error_message: Mapped[str | None]
```

## Inicialización TimescaleDB (ejecutar una sola vez)

```python
# app/core/database.py — función init_db()
async def init_db():
    async with engine.begin() as conn:
        # Crear tablas normales
        await conn.run_sync(Base.metadata.create_all)

        # Activar extensión TimescaleDB
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb;"))

        # Convertir telemetry_record en hypertable (idempotente)
        await conn.execute(text("""
            SELECT create_hypertable(
                'telemetry_record', 'time',
                if_not_exists => TRUE,
                chunk_time_interval => INTERVAL '1 day'
            );
        """))

        # Índice para queries por dispositivo
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_telemetry_device_time
            ON telemetry_record (device_id, time DESC);
        """))

        # Política de compresión: comprimir chunks de más de 7 días
        await conn.execute(text("""
            ALTER TABLE telemetry_record SET (
                timescaledb.compress,
                timescaledb.compress_orderby = 'time DESC',
                timescaledb.compress_segmentby = 'device_id'
            );
        """))
        await conn.execute(text("""
            SELECT add_compression_policy(
                'telemetry_record',
                INTERVAL '7 days',
                if_not_exists => TRUE
            );
        """))

        # Política de retención: borrar datos de más de 2 años
        await conn.execute(text("""
            SELECT add_retention_policy(
                'telemetry_record',
                INTERVAL '2 years',
                if_not_exists => TRUE
            );
        """))
```

## Queries eficientes — plantillas obligatorias

```python
# ✓ CORRECTO — último estado de un dispositivo
async def get_last_telemetry(db, device_id: UUID) -> TelemetryRecord | None:
    result = await db.execute(
        select(TelemetryRecord)
        .where(TelemetryRecord.device_id == device_id)
        .order_by(TelemetryRecord.time.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()

# ✓ CORRECTO — histórico con time_bucket (siempre acotar el tiempo)
async def get_telemetry_history(db, device_id: UUID, hours: int = 24):
    return await db.execute(text("""
        SELECT
            time_bucket('5 minutes', time) AS bucket,
            AVG(ain1_mv) * :scale AS pressure_bar,
            AVG(speed) AS avg_speed,
            MAX(speed) AS max_speed,
            BOOL_OR(ignition) AS was_ignition_on
        FROM telemetry_record
        WHERE device_id = :device_id
          AND time >= NOW() - :hours * INTERVAL '1 hour'
        GROUP BY bucket
        ORDER BY bucket ASC
    """), {"device_id": str(device_id), "hours": hours, "scale": 0.006})

# ✓ CORRECTO — conteo de activaciones de una salida en un período
async def count_activations(db, device_id: UUID, output: str, date: date):
    return await db.execute(text("""
        SELECT COUNT(*) FILTER (WHERE current_val = TRUE AND prev_val = FALSE) AS activations
        FROM (
            SELECT
                :output_col::boolean AS current_val,
                LAG(:output_col::boolean) OVER (ORDER BY time) AS prev_val
            FROM telemetry_record
            WHERE device_id = :device_id
              AND time::date = :date
        ) t
    """), {"device_id": str(device_id), "output_col": output, "date": date})

# ✗ INCORRECTO — nunca hacer esto
await db.execute(select(TelemetryRecord))  # sin filtro tiempo = timeout garantizado
```

## Comandos de inspección en producción

```bash
# Conectar a TimescaleDB
docker exec -it cmg-timescaledb psql -U cmg -d cmg_telematics

# Ver estado de chunks e hypertables
SELECT * FROM timescaledb_information.hypertables;
SELECT * FROM timescaledb_information.chunks ORDER BY range_start DESC LIMIT 10;

# Ver tamaño de la tabla
SELECT hypertable_size('telemetry_record');

# Ver políticas activas
SELECT * FROM timescaledb_information.jobs;

# Últimos 5 records de cualquier dispositivo
SELECT time, device_id, lat, lng, speed, ain1_mv, dout1
FROM telemetry_record
ORDER BY time DESC
LIMIT 5;

# Records de las últimas 2 horas agrupados por 5 minutos
SELECT time_bucket('5 minutes', time) AS t, COUNT(*), AVG(ain1_mv)
FROM telemetry_record
WHERE time >= NOW() - INTERVAL '2 hours'
GROUP BY t ORDER BY t;
```
